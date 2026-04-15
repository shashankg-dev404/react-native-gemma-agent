// Inspired by @react-native-ai/llama (MIT)
// Source refs: packages/llama/src/ai-sdk.ts:333-349 (doGenerate content shape),
// :520-624 (stream loop — we do NOT port the literal <think> matching),
// :660-662 (abort wiring — ported with the addEventListener fix from
// callstackincubator/ai#199).
// https://github.com/callstackincubator/ai

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { InferenceEngine } from '../InferenceEngine';
import type { SkillRegistry } from '../SkillRegistry';
import type { KnowledgeStore } from '../KnowledgeStore';
import type { ModelManager } from '../ModelManager';
import type {
  RunToolLoopConfig,
  RunToolLoopInput,
  RunToolLoopPart,
  SkillExecutor,
} from '../runToolLoop';
import { runToolLoop } from '../runToolLoop';
import { buildSystemPromptWithNotes } from '../buildSystemPrompt';
import { prepareMessages } from './prepareMessages';
import { separateProviderAndConsumerTools } from './toolShapeBridge';
import {
  buildProviderMetadata,
  buildV3Usage,
  createStreamBridge,
  runToolLoopPartToContent,
  toV3Warnings,
} from './streamPartBridge';
import { convertRunToolLoopFinishReason } from './convertFinishReason';

export type GemmaLanguageModelDefaults = {
  maxChainDepth?: number;
  skillRouting?: 'all' | 'bm25';
  maxToolsPerInvocation?: number;
  activeCategories?: string[];
  skillTimeout?: number;
  contextWarningThreshold?: number;
};

export type GemmaLanguageModelConfig = {
  modelId?: string;
  engine: InferenceEngine;
  registry: SkillRegistry;
  executor?: SkillExecutor | null;
  knowledgeStore?: KnowledgeStore | null;
  modelManager?: ModelManager | null;
  systemPrompt?: string;
  defaults?: GemmaLanguageModelDefaults;
};

export type GemmaProviderOptions = {
  activeCategories?: string[];
  skillRouting?: 'all' | 'bm25';
  maxToolsPerInvocation?: number;
  maxChainDepth?: number;
  enable_thinking?: boolean;
  reasoning_format?: 'none' | 'deepseek' | 'qwen';
};

const DEFAULTS: Required<GemmaLanguageModelDefaults> = {
  maxChainDepth: 5,
  skillRouting: 'all',
  maxToolsPerInvocation: 5,
  activeCategories: [],
  skillTimeout: 30_000,
  contextWarningThreshold: 0.8,
};

const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful AI assistant running on-device. Answer the user directly. Do not show reasoning steps or tool evaluation. Be concise.';

export class GemmaLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = 'v3' as const;
  readonly provider = 'gemma';
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

  private engine: InferenceEngine;
  private registry: SkillRegistry;
  private executor: SkillExecutor | null;
  private knowledgeStore: KnowledgeStore | null;
  private modelManager: ModelManager | null;
  private systemPrompt: string;
  private defaults: Required<GemmaLanguageModelDefaults>;

  constructor(config: GemmaLanguageModelConfig) {
    this.modelId = config.modelId ?? 'gemma-4-e2b';
    this.engine = config.engine;
    this.registry = config.registry;
    this.executor = config.executor ?? null;
    this.knowledgeStore = config.knowledgeStore ?? null;
    this.modelManager = config.modelManager ?? null;
    this.systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.defaults = {
      maxChainDepth: config.defaults?.maxChainDepth ?? DEFAULTS.maxChainDepth,
      skillRouting: config.defaults?.skillRouting ?? DEFAULTS.skillRouting,
      maxToolsPerInvocation:
        config.defaults?.maxToolsPerInvocation ??
        DEFAULTS.maxToolsPerInvocation,
      activeCategories:
        config.defaults?.activeCategories ?? DEFAULTS.activeCategories,
      skillTimeout: config.defaults?.skillTimeout ?? DEFAULTS.skillTimeout,
      contextWarningThreshold:
        config.defaults?.contextWarningThreshold ??
        DEFAULTS.contextWarningThreshold,
    };
  }

  async prepare(modelPath?: string): Promise<void> {
    if (this.engine.isLoaded) {
      return;
    }
    if (modelPath) {
      await this.engine.loadModel(modelPath);
      return;
    }
    if (this.modelManager) {
      const path =
        this.modelManager.modelPath ?? (await this.modelManager.findModel());
      if (!path) {
        throw new Error(
          'GemmaLanguageModel.prepare: ModelManager has no model on device. Call modelManager.download() first.',
        );
      }
      await this.engine.loadModel(path);
      return;
    }
    throw new Error(
      'GemmaLanguageModel.prepare: no model loaded. Pass a path to prepare(modelPath), configure the provider with { modelManager }, or call engine.loadModel(path) yourself.',
    );
  }

  async unload(): Promise<void> {
    await this.engine.unload();
  }

  async doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    const prelude = await this.prepareCall(options);
    const parts: RunToolLoopPart[] = [];

    const abortCleanup = this.wireAbort(options.abortSignal);

    try {
      const result = await runToolLoop(
        { engine: this.engine, registry: this.registry, executor: this.executor },
        prelude.config,
        prelude.input,
        (part) => {
          parts.push(part);
        },
      );

      const content: LanguageModelV3Content[] = [];
      for (const part of parts) {
        const mapped = runToolLoopPartToContent(part);
        if (mapped) {
          content.push(mapped);
        }
      }

      return {
        content,
        finishReason: convertRunToolLoopFinishReason(result.finishReason),
        usage: buildV3Usage(result.usage),
        providerMetadata: buildProviderMetadata(result.providerMetadata),
        warnings: prelude.warnings,
      };
    } finally {
      abortCleanup();
    }
  }

  async doStream(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3StreamResult> {
    const prelude = await this.prepareCall(options);
    const engine = this.engine;
    const registry = this.registry;
    const executor = this.executor;

    const abortSignal = options.abortSignal;
    let abortCleanup: (() => void) | null = null;

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start: async (controller) => {
        controller.enqueue({
          type: 'stream-start',
          warnings: prelude.warnings,
        });

        abortCleanup = wireAbortToEngine(engine, abortSignal);

        const bridge = createStreamBridge(controller);

        try {
          await runToolLoop(
            { engine, registry, executor },
            prelude.config,
            prelude.input,
            bridge,
          );
          controller.close();
        } catch (err) {
          controller.enqueue({ type: 'error', error: err });
          controller.close();
        } finally {
          abortCleanup?.();
          abortCleanup = null;
        }
      },
      cancel: () => {
        engine.stopGeneration().catch(() => {});
        abortCleanup?.();
        abortCleanup = null;
      },
    });

    return { stream };
  }

  private async prepareCall(options: LanguageModelV3CallOptions): Promise<{
    config: RunToolLoopConfig;
    input: RunToolLoopInput;
    warnings: SharedV3Warning[];
  }> {
    const { messages, warnings: prepareWarnings } = prepareMessages(
      options.prompt,
    );
    const functionTools = (options.tools ?? []).filter(
      (t): t is LanguageModelV3FunctionTool => t.type === 'function',
    );
    const providerToolWarnings = (options.tools ?? [])
      .filter((t) => t.type !== 'function')
      .map(
        (t) =>
          `Provider tool "${(t as { name?: string }).name ?? 'unknown'}" dropped — only function tools are supported`,
      );

    const { consumerTools, collisionWarnings } = separateProviderAndConsumerTools(
      functionTools,
      this.registry,
    );

    const gemmaOpts =
      (options.providerOptions?.gemma as GemmaProviderOptions | undefined) ??
      {};

    const warnings: string[] = [
      ...prepareWarnings,
      ...providerToolWarnings,
      ...collisionWarnings,
    ];

    const contextUsage = this.engine.getContextUsage();
    const thresholdPct = this.defaults.contextWarningThreshold * 100;
    if (contextUsage.total > 0 && contextUsage.percent >= thresholdPct) {
      warnings.push(
        `Context usage at ${contextUsage.percent}% of ${contextUsage.total} tokens`,
      );
    }

    if (options.toolChoice && options.toolChoice.type === 'tool') {
      warnings.push(
        `toolChoice { type: 'tool', toolName: '${options.toolChoice.toolName}' } downgraded to 'auto' — per-tool selection is not supported yet`,
      );
    }
    if (options.toolChoice && options.toolChoice.type === 'required') {
      warnings.push(
        "toolChoice 'required' downgraded to 'auto' — forced tool calls are not supported yet",
      );
    }

    const config: RunToolLoopConfig = {
      maxChainDepth: gemmaOpts.maxChainDepth ?? this.defaults.maxChainDepth,
      skillTimeout: this.defaults.skillTimeout,
      skillRouting: gemmaOpts.skillRouting ?? this.defaults.skillRouting,
      maxToolsPerInvocation:
        gemmaOpts.maxToolsPerInvocation ??
        this.defaults.maxToolsPerInvocation,
      activeCategories:
        gemmaOpts.activeCategories ??
        (this.defaults.activeCategories.length > 0
          ? this.defaults.activeCategories
          : undefined),
    };

    const query = extractLatestUserQuery(options.prompt);
    const systemPrompt = await buildSystemPromptWithNotes(
      this.systemPrompt,
      this.registry,
      this.knowledgeStore,
    );

    const input: RunToolLoopInput = {
      systemPrompt,
      messages,
      query,
      extraTools: consumerTools.length > 0 ? consumerTools : undefined,
    };

    return { config, input, warnings: toV3Warnings(warnings) };
  }

  private wireAbort(signal?: AbortSignal): () => void {
    return wireAbortToEngine(this.engine, signal);
  }
}

function wireAbortToEngine(
  engine: InferenceEngine,
  signal: AbortSignal | undefined,
): () => void {
  if (!signal) {
    return () => {};
  }
  const listener = () => {
    engine.stopGeneration().catch(() => {});
  };
  signal.addEventListener('abort', listener);
  return () => signal.removeEventListener('abort', listener);
}

function extractLatestUserQuery(
  prompt: LanguageModelV3CallOptions['prompt'],
): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const msg = prompt[i];
    if (msg.role !== 'user') continue;
    const texts: string[] = [];
    for (const part of msg.content) {
      if (part.type === 'text') {
        texts.push(part.text);
      }
    }
    if (texts.length > 0) {
      return texts.join('\n');
    }
  }
  return '';
}
