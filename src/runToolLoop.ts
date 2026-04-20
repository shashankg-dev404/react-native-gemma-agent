import type {
  Message,
  SkillManifest,
  SkillResult,
  ToolDefinition,
  ContextUsage,
  CompletionTimings,
  CompletionResult,
} from './types';
import type { InferenceEngine } from './InferenceEngine';
import type { SkillRegistry } from './SkillRegistry';
import { BM25Scorer } from './BM25Scorer';
import {
  validateToolCalls,
  extractToolCallsFromText,
  type ParsedToolCall,
} from './FunctionCallParser';

export type SkillExecutor = (
  html: string,
  params: Record<string, unknown>,
  timeout?: number,
) => Promise<SkillResult>;

export type RunToolLoopFinishReason =
  | 'stop'
  | 'length'
  | 'tool-calls'
  | 'other';

export type RunToolLoopUsage = {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
};

export type RunToolLoopProviderMetadata = {
  timings: CompletionTimings;
  contextUsage: ContextUsage;
};

export type RunToolLoopPart =
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; delta: string }
  | { type: 'reasoning-end'; id: string }
  | {
      type: 'tool-input-start';
      toolCallId: string;
      toolName: string;
      parameters: Record<string, unknown>;
      providerExecuted?: boolean;
    }
  | { type: 'tool-input-delta'; toolCallId: string; delta: string }
  | { type: 'tool-input-end'; toolCallId: string }
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      input: string;
      parameters: Record<string, unknown>;
      providerExecuted?: boolean;
    }
  | {
      type: 'tool-result';
      toolCallId: string;
      toolName: string;
      result: SkillResult;
      providerExecuted?: boolean;
    }
  | {
      type: 'finish';
      finishReason: RunToolLoopFinishReason;
      usage: RunToolLoopUsage;
      responseText: string;
      reasoning: string | null;
      providerMetadata: RunToolLoopProviderMetadata;
    }
  | { type: 'error'; error: string };

export type RunToolLoopDeps = {
  engine: InferenceEngine;
  registry: SkillRegistry;
  executor: SkillExecutor | null;
};

export type RunToolLoopConfig = {
  maxChainDepth: number;
  skillTimeout: number;
  skillRouting: 'all' | 'bm25';
  maxToolsPerInvocation: number;
  activeCategories?: string[];
  enable_thinking?: boolean;
  reasoning_format?: 'none' | 'deepseek' | 'qwen';
};

export type RunToolLoopInput = {
  systemPrompt: string;
  messages: Message[];
  query: string;
  /**
   * Consumer-supplied tools that coexist with registered skills.
   * Skills run provider-executed (loop continues). When the model calls a
   * tool that matches an entry here but is NOT a registered skill, the loop
   * emits tool-input-start + tool-call (without providerExecuted) and
   * terminates with finishReason 'tool-calls'. The consumer executes it.
   */
  extraTools?: ToolDefinition[];
};

export type RunToolLoopResult = {
  finalMessages: Message[];
  finishReason: RunToolLoopFinishReason;
  usage: RunToolLoopUsage;
  providerMetadata: RunToolLoopProviderMetadata;
};

let loopCounter = 0;

export async function runToolLoop(
  deps: RunToolLoopDeps,
  config: RunToolLoopConfig,
  input: RunToolLoopInput,
  onPart: (part: RunToolLoopPart) => void,
): Promise<RunToolLoopResult> {
  const loopId = ++loopCounter;
  const skillTools = getToolsForQuery(deps.registry, config, input.query);
  const extraTools = input.extraTools ?? [];
  const extraToolNames = new Set(extraTools.map((t) => t.function.name));
  const tools: ToolDefinition[] = [...skillTools, ...extraTools];
  const appended: Message[] = [];
  const conversation: Message[] = [
    { role: 'system', content: input.systemPrompt },
    ...input.messages,
  ];
  let lastResult: CompletionResult | null = null;
  let depth = 0;

  while (depth < config.maxChainDepth) {
    depth++;

    const tokenBuffer: string[] = [];

    const result = await deps.engine.generate(
      conversation,
      {
        tools: tools.length > 0 ? tools : undefined,
        toolChoice: tools.length > 0 ? 'auto' : undefined,
        enable_thinking: config.enable_thinking,
        reasoning_format: config.reasoning_format,
      },
      (tokenEvent) => {
        if (tokenEvent.token) {
          tokenBuffer.push(tokenEvent.token);
        }
      },
    );
    lastResult = result;

    let parsedCalls = validateToolCalls(result.toolCalls, deps.registry, {
      extraToolNames,
    });
    if (parsedCalls.length === 0 && result.text.trim()) {
      parsedCalls = extractToolCallsFromText(result.text, deps.registry, {
        extraToolNames,
      });
    }

    const hasToolCalls = parsedCalls.length > 0;

    if (!hasToolCalls) {
      if (result.reasoning) {
        const rId = `reasoning-${depth}`;
        onPart({ type: 'reasoning-start', id: rId });
        onPart({ type: 'reasoning-delta', id: rId, delta: result.reasoning });
        onPart({ type: 'reasoning-end', id: rId });
      }

      const usesReasoning =
        !!result.reasoning ||
        (!!config.reasoning_format && config.reasoning_format !== 'none');

      if (usesReasoning) {
        // tokenBuffer mixes thinking + text tokens; prefer clean content
        // and strip any <think>...</think> blocks llama.rn didn't remove
        // (including empty ones emitted by the chat template).
        const cleanText = stripThinkTags(result.content || '').trim();
        if (cleanText) {
          const textId = `text-${depth}`;
          onPart({ type: 'text-start', id: textId });
          onPart({ type: 'text-delta', id: textId, delta: cleanText });
          onPart({ type: 'text-end', id: textId });
        }
      } else if (tokenBuffer.length > 0) {
        const textId = `text-${depth}`;
        onPart({ type: 'text-start', id: textId });
        for (const token of tokenBuffer) {
          onPart({ type: 'text-delta', id: textId, delta: token });
        }
        onPart({ type: 'text-end', id: textId });
      }
    }

    const consumerCall = parsedCalls.find((c) => c.isConsumerTool);
    if (consumerCall) {
      const rawConsumerId =
        consumerCall.id ??
        result.toolCalls.find(
          (tc) => tc.function.name === consumerCall.name,
        )?.id ??
        `call_${consumerCall.name}_${depth}`;
      const toolCallId = `call_${loopId}_${depth}_${rawConsumerId}`;

      const assistantMsg: Message = {
        role: 'assistant',
        content: '',
        tool_calls: result.toolCalls,
      };
      appended.push(assistantMsg);

      onPart({
        type: 'tool-input-start',
        toolCallId,
        toolName: consumerCall.name,
        parameters: consumerCall.parameters,
        providerExecuted: false,
      });

      onPart({
        type: 'tool-call',
        toolCallId,
        toolName: consumerCall.name,
        input: JSON.stringify(consumerCall.parameters),
        parameters: consumerCall.parameters,
        providerExecuted: false,
      });

      const providerMetadata: RunToolLoopProviderMetadata = {
        timings: result.timings,
        contextUsage: deps.engine.getContextUsage(),
      };
      const usage = buildUsage(result);

      if (result.reasoning) {
        const rId = `reasoning-${depth}`;
        onPart({ type: 'reasoning-start', id: rId });
        onPart({ type: 'reasoning-delta', id: rId, delta: result.reasoning });
        onPart({ type: 'reasoning-end', id: rId });
      }

      onPart({
        type: 'finish',
        finishReason: 'tool-calls',
        usage,
        responseText: '',
        reasoning: result.reasoning,
        providerMetadata,
      });

      return {
        finalMessages: appended,
        finishReason: 'tool-calls',
        usage,
        providerMetadata,
      };
    }

    if (parsedCalls.length === 0) {
      const rawText = result.content || result.text;
      let responseText =
        config.reasoning_format && config.reasoning_format !== 'none'
          ? stripThinkTags(rawText).trim()
          : rawText.trim();
      if (!responseText && depth > 1) {
        const lastToolMsg = [...conversation, ...appended]
          .slice()
          .reverse()
          .find((m) => m.role === 'tool');
        responseText = lastToolMsg?.content || 'Done.';
      }

      const assistantMsg: Message = {
        role: 'assistant',
        content: responseText,
      };
      appended.push(assistantMsg);

      const providerMetadata: RunToolLoopProviderMetadata = {
        timings: result.timings,
        contextUsage: deps.engine.getContextUsage(),
      };
      const usage = buildUsage(result);
      const finishReason: RunToolLoopFinishReason = result.stoppedLimit
        ? 'length'
        : 'stop';

      onPart({
        type: 'finish',
        finishReason,
        usage,
        responseText,
        reasoning: result.reasoning,
        providerMetadata,
      });

      return {
        finalMessages: appended,
        finishReason,
        usage,
        providerMetadata,
      };
    }

    // Strip thinking/reasoning from content on the assistant-with-tool_calls
    // message. Empty string is safe here: llama.rn's Jinja template handles
    // empty content when tool_calls is present (OpenAI-compatible format).
    const assistantMsg: Message = {
      role: 'assistant',
      content: '',
      tool_calls: result.toolCalls,
    };
    appended.push(assistantMsg);
    conversation.push(assistantMsg);

    for (const call of parsedCalls) {
      // llama.rn resets its tool-call ID counter per generate() call, so
      // chained iterations produce duplicate IDs (e.g. "call_0" twice).
      // Use the raw ID for conversation messages (llama.rn must match
      // tool_call_id to assistant.tool_calls[].id), but prefix with depth
      // for stream parts so the AI SDK sees unique IDs across the chain.
      const conversationId =
        call.id ??
        result.toolCalls.find((tc) => tc.function.name === call.name)?.id ??
        `call_${call.name}_${depth}`;
      const streamId = `call_${loopId}_${depth}_${conversationId}`;

      onPart({
        type: 'tool-input-start',
        toolCallId: streamId,
        toolName: call.name,
        parameters: call.parameters,
        providerExecuted: true,
      });

      onPart({
        type: 'tool-call',
        toolCallId: streamId,
        toolName: call.name,
        input: JSON.stringify(call.parameters),
        parameters: call.parameters,
        providerExecuted: true,
      });

      const skillResult = await executeSkill(deps, config, call);

      onPart({
        type: 'tool-result',
        toolCallId: streamId,
        toolName: call.name,
        result: skillResult,
        providerExecuted: true,
      });

      const resultContent = skillResult.error
        ? `Error: ${skillResult.error}`
        : skillResult.result ?? 'No result';

      const toolMsg: Message = {
        role: 'tool',
        content: resultContent,
        tool_call_id: conversationId,
        name: call.name,
      };
      appended.push(toolMsg);
      conversation.push(toolMsg);
    }
  }

  const fallback =
    'I tried to use tools but reached the maximum chain depth. Here is what I know so far.';
  const fallbackMsg: Message = { role: 'assistant', content: fallback };
  appended.push(fallbackMsg);

  const fallbackTextId = `text-fallback`;
  onPart({ type: 'text-start', id: fallbackTextId });
  onPart({ type: 'text-delta', id: fallbackTextId, delta: fallback });
  onPart({ type: 'text-end', id: fallbackTextId });

  const timings: CompletionTimings = lastResult?.timings ?? {
    promptTokens: 0,
    promptMs: 0,
    promptPerSecond: 0,
    predictedTokens: 0,
    predictedMs: 0,
    predictedPerSecond: 0,
  };
  const providerMetadata: RunToolLoopProviderMetadata = {
    timings,
    contextUsage: deps.engine.getContextUsage(),
  };
  const usage: RunToolLoopUsage = lastResult
    ? buildUsage(lastResult)
    : { promptTokens: 0, completionTokens: 0 };

  onPart({
    type: 'finish',
    finishReason: 'other',
    usage,
    responseText: fallback,
    reasoning: null,
    providerMetadata,
  });

  return {
    finalMessages: appended,
    finishReason: 'other',
    usage,
    providerMetadata,
  };
}

function buildUsage(result: CompletionResult): RunToolLoopUsage {
  return {
    promptTokens: result.timings.promptTokens,
    completionTokens: result.timings.predictedTokens,
  };
}

const THINK_TAG_PATTERN = /<think>[\s\S]*?<\/think>\s*/g;

function stripThinkTags(text: string): string {
  return text.replace(THINK_TAG_PATTERN, '');
}

function getToolsForQuery(
  registry: SkillRegistry,
  config: RunToolLoopConfig,
  query: string,
): ToolDefinition[] {
  const categoryFiltered = registry.getSkillsForCategories(
    config.activeCategories,
  );

  if (config.skillRouting !== 'bm25') {
    return skillsToToolDefs(categoryFiltered);
  }

  if (categoryFiltered.length <= config.maxToolsPerInvocation) {
    return skillsToToolDefs(categoryFiltered);
  }

  const bm25 = new BM25Scorer();
  bm25.buildIndex(categoryFiltered);
  const ranked = bm25.topN(query, config.maxToolsPerInvocation);
  return skillsToToolDefs(ranked.map(({ skill }) => skill));
}

function skillsToToolDefs(skills: readonly SkillManifest[]): ToolDefinition[] {
  return skills.map((skill) => ({
    type: 'function' as const,
    function: {
      name: skill.name,
      description: skill.description,
      parameters: {
        type: 'object' as const,
        properties: skill.parameters,
        required: skill.requiredParameters,
      },
    },
  }));
}

async function checkConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    await fetch('https://www.google.com/generate_204', {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

async function executeSkill(
  deps: RunToolLoopDeps,
  config: RunToolLoopConfig,
  call: ParsedToolCall,
): Promise<SkillResult> {
  const { skill, parameters } = call;

  if (!skill) {
    return { error: `Cannot execute skill "${call.name}": not registered` };
  }

  if (skill.requiresNetwork) {
    const online = await checkConnectivity();
    if (!online) {
      return {
        error: 'No internet connection. This skill requires network access.',
      };
    }
  }

  if (skill.type === 'native' && skill.execute) {
    try {
      return await withTimeout(
        skill.execute(parameters),
        config.skillTimeout,
      );
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : 'Native skill failed',
      };
    }
  }

  if (skill.type === 'js' && skill.html) {
    if (!deps.executor) {
      return {
        error: 'No skill executor available. SkillSandbox not mounted.',
      };
    }
    try {
      return await deps.executor(skill.html, parameters, config.skillTimeout);
    } catch (err) {
      return {
        error:
          err instanceof Error ? err.message : 'JS skill execution failed',
      };
    }
  }

  return {
    error: `Cannot execute skill "${call.name}": unsupported type "${skill.type}"`,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Skill timed out after ${ms}ms`)), ms),
    ),
  ]);
}
