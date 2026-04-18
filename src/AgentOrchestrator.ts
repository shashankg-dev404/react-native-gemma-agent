import type {
  Message,
  AgentEvent,
  AgentConfig,
  ContextUsage,
} from './types';
import type { InferenceEngine } from './InferenceEngine';
import type { SkillRegistry } from './SkillRegistry';
import type { KnowledgeStore } from './KnowledgeStore';
import { runToolLoop, type SkillExecutor } from './runToolLoop';
import { buildSystemPromptWithNotes } from './buildSystemPrompt';

export type { SkillExecutor } from './runToolLoop';

type ResolvedConfig = Required<
  Omit<AgentConfig, 'activeCategories' | 'onContextWarning'>
> & {
  activeCategories?: string[];
  onContextWarning?: (usage: ContextUsage) => void;
};

const DEFAULT_CONFIG: ResolvedConfig = {
  maxChainDepth: 5,
  skillTimeout: 30_000,
  systemPrompt:
    'You are a helpful AI assistant running on-device. Answer the user directly. Do not show reasoning steps or tool evaluation. Be concise.',
  skillRouting: 'all',
  maxToolsPerInvocation: 5,
  activeCategories: undefined,
  contextWarningThreshold: 0.8,
  onContextWarning: undefined,
  enable_thinking: false,
  reasoning_format: 'none',
};

export class AgentOrchestrator {
  private engine: InferenceEngine;
  private registry: SkillRegistry;
  private executor: SkillExecutor | null = null;
  private knowledgeStore: KnowledgeStore | null = null;
  private config: ResolvedConfig;
  private history: Message[] = [];
  private _isProcessing = false;
  private _contextWarningFired = false;

  constructor(
    engine: InferenceEngine,
    registry: SkillRegistry,
    config?: AgentConfig,
  ) {
    this.engine = engine;
    this.registry = registry;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get isProcessing(): boolean {
    return this._isProcessing;
  }

  get conversation(): ReadonlyArray<Message> {
    return this.history;
  }

  /**
   * Set the JS skill executor. Wired by the React layer to SkillSandbox.
   * Not needed if you only use native skills.
   */
  setSkillExecutor(executor: SkillExecutor): void {
    this.executor = executor;
  }

  /**
   * Set the knowledge store for system prompt injection.
   * When set and local_notes skill is registered, note index is appended to system prompt.
   */
  setKnowledgeStore(store: KnowledgeStore): void {
    this.knowledgeStore = store;
  }

  /**
   * Send a user message through the full agent loop:
   *   inference → tool call detection → skill execution → re-invoke model
   *
   * Returns the final assistant response text.
   */
  async sendMessage(
    text: string,
    onEvent?: (event: AgentEvent) => void,
  ): Promise<string> {
    if (this._isProcessing) {
      throw new Error('Already processing a message. Wait for completion.');
    }

    this._isProcessing = true;

    try {
      this.history = [...this.history, { role: 'user', content: text }];
      const systemPrompt = await this.buildSystemPrompt();

      let responseText = '';

      const result = await runToolLoop(
        {
          engine: this.engine,
          registry: this.registry,
          executor: this.executor,
        },
        {
          maxChainDepth: this.config.maxChainDepth,
          skillTimeout: this.config.skillTimeout,
          skillRouting: this.config.skillRouting,
          maxToolsPerInvocation: this.config.maxToolsPerInvocation,
          activeCategories: this.config.activeCategories,
          enable_thinking: this.config.enable_thinking,
          reasoning_format: this.config.reasoning_format,
        },
        {
          systemPrompt,
          messages: this.history,
          query: text,
        },
        (part) => {
          switch (part.type) {
            case 'text-delta':
              onEvent?.({ type: 'token', token: part.delta });
              break;
            case 'tool-input-start':
              onEvent?.({
                type: 'skill_called',
                name: part.toolName,
                parameters: part.parameters,
              });
              break;
            case 'tool-result':
              onEvent?.({
                type: 'skill_result',
                name: part.toolName,
                result: part.result,
              });
              break;
            case 'finish':
              responseText = part.responseText;
              onEvent?.({
                type: 'response',
                text: part.responseText,
                reasoning: part.reasoning,
              });
              break;
            case 'error':
              onEvent?.({ type: 'error', error: part.error });
              break;
          }
        },
      );

      this.history = [...this.history, ...result.finalMessages];
      this.checkContextWarning(onEvent);

      return responseText;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      onEvent?.({ type: 'error', error: errorMsg });
      throw err;
    } finally {
      this._isProcessing = false;
    }
  }

  reset(): void {
    this.history = [];
    this._contextWarningFired = false;
    this.engine.resetContextUsage();
  }

  /**
   * Current context window usage from the inference engine.
   * Reflects the most recent generation. Returns zeros before the first call.
   */
  getContextUsage(): ContextUsage {
    return this.engine.getContextUsage();
  }

  setSystemPrompt(prompt: string): void {
    this.config = { ...this.config, systemPrompt: prompt };
  }

  setActiveCategories(categories: string[] | undefined): void {
    this.config = { ...this.config, activeCategories: categories };
  }

  getActiveCategories(): string[] | undefined {
    return this.config.activeCategories;
  }

  private checkContextWarning(
    onEvent?: (event: AgentEvent) => void,
  ): void {
    if (this._contextWarningFired) {
      return;
    }
    const usage = this.engine.getContextUsage();
    if (usage.total <= 0) {
      return;
    }
    const thresholdPct = this.config.contextWarningThreshold * 100;
    if (usage.percent >= thresholdPct) {
      this._contextWarningFired = true;
      try {
        this.config.onContextWarning?.(usage);
      } catch {
        // Swallow callback errors — never crash the agent loop
      }
      onEvent?.({ type: 'context_warning', usage });
    }
  }

  private async buildSystemPrompt(): Promise<string> {
    return buildSystemPromptWithNotes(
      this.config.systemPrompt,
      this.registry,
      this.knowledgeStore,
    );
  }
}
