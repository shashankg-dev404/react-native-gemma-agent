import {
  initLlama,
  releaseAllLlama,
  type LlamaContext,
  type TokenData,
  type NativeCompletionResult,
} from 'llama.rn';
import type {
  Message,
  CompletionResult,
  CompletionTimings,
  ContextUsage,
  GenerateOptions,
  TokenEvent,
  ToolCall,
  ToolDefinition,
  InferenceEngineConfig,
} from './types';

const DEFAULT_CONFIG: Required<InferenceEngineConfig> = {
  contextSize: 4096,
  batchSize: 512,
  threads: 4,
  flashAttn: 'auto',
  useMlock: true,
  gpuLayers: -1,
};

const DEFAULT_GENERATE: Required<Pick<GenerateOptions, 'maxTokens' | 'temperature' | 'topP' | 'topK'>> = {
  maxTokens: 1024,
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
};

type LoadedModelInfo = {
  gpu: boolean;
  reasonNoGPU: string;
  description: string | null;
  nParams: number | null;
};

export class InferenceEngine {
  private context: LlamaContext | null = null;
  private config: Required<InferenceEngineConfig>;
  private modelInfo: LoadedModelInfo | null = null;
  private _isGenerating = false;
  private _lastPromptTokens = 0;
  private _lastPredictedTokens = 0;
  /**
   * Cumulative KV-cache fill across the current session. Grows as each
   * generate() call processes new prompt tokens + predicts new output.
   * Only reset via resetContextUsage() or unload().
   *
   * NOTE: `result.timings.prompt_n` from llama.rn is the number of tokens
   * actually evaluated for the prompt on this call — i.e. the diff after
   * KV cache reuse, not the total prompt length. See
   * e2e/result_phase-17-context-warnings.md for the logcat evidence.
   */
  private _cumulativeUsed = 0;

  constructor(config?: InferenceEngineConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  get isLoaded(): boolean {
    return this.context !== null;
  }

  get isGenerating(): boolean {
    return this._isGenerating;
  }

  get gpu(): boolean {
    return this.modelInfo?.gpu ?? false;
  }

  /**
   * Load a GGUF model into memory.
   * @param modelPath — absolute path to the .gguf file on device
   * @param onProgress — loading progress callback (0-100)
   * @returns load time in ms
   */
  async loadModel(
    modelPath: string,
    onProgress?: (percent: number) => void,
  ): Promise<number> {
    if (this.context) {
      throw new Error('Model already loaded. Call unload() first.');
    }

    const start = Date.now();

    this.context = await initLlama(
      {
        model: modelPath,
        n_ctx: this.config.contextSize,
        n_batch: this.config.batchSize,
        n_threads: this.config.threads,
        flash_attn_type: this.config.flashAttn,
        use_mlock: this.config.useMlock,
        n_gpu_layers: this.config.gpuLayers,
      },
      (progress: number) => {
        onProgress?.(progress);
      },
    );

    const loadTimeMs = Date.now() - start;

    this.modelInfo = {
      gpu: this.context.gpu,
      reasonNoGPU: this.context.reasonNoGPU,
      description: this.context.model?.desc ?? null,
      nParams: this.context.model?.nParams ?? null,
    };

    return loadTimeMs;
  }

  /**
   * Run inference with messages and optional tools.
   * Returns the full completion result including any tool calls.
   */
  async generate(
    messages: Message[],
    options?: GenerateOptions,
    onToken?: (event: TokenEvent) => void,
  ): Promise<CompletionResult> {
    if (!this.context) {
      throw new Error('No model loaded. Call loadModel() first.');
    }
    if (this._isGenerating) {
      throw new Error('Generation already in progress. Call stopGeneration() first.');
    }

    this._isGenerating = true;

    try {
      const llamaMessages = messages.map(msg => {
        const m: Record<string, unknown> = {
          role: msg.role,
          content: msg.content ?? '',
        };
        // Only include fields with actual string values — undefined/null
        // fields become JSON null and crash llama.cpp's Jinja parser
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          m.tool_calls = msg.tool_calls.map(tc => ({
            type: tc.type,
            id: tc.id ?? 'call_0',
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments ?? '{}',
            },
          }));
        }
        if (typeof msg.tool_call_id === 'string') {
          m.tool_call_id = msg.tool_call_id;
        }
        if (typeof msg.name === 'string') {
          m.name = msg.name;
        }
        return m;
      });

      const completionParams: Record<string, unknown> = {
        messages: llamaMessages,
        n_predict: options?.maxTokens ?? DEFAULT_GENERATE.maxTokens,
        temperature: options?.temperature ?? DEFAULT_GENERATE.temperature,
        top_p: options?.topP ?? DEFAULT_GENERATE.topP,
        top_k: options?.topK ?? DEFAULT_GENERATE.topK,
        stop: options?.stop,
        jinja: true,
        enable_thinking: options?.enable_thinking ?? false,
        reasoning_format: options?.reasoning_format ?? 'none',
      };

      if (options?.tools && options.tools.length > 0) {
        completionParams.tools = options.tools;
        completionParams.tool_choice = options.toolChoice ?? 'auto';
      }

      const result: NativeCompletionResult = await this.context.completion(
        completionParams as any,
        (data: TokenData) => {
          if (onToken && data.token) {
            onToken({
              token: data.token,
              toolCalls: data.tool_calls as ToolCall[] | undefined,
            });
          }
        },
      );

      const mapped = this.mapResult(result);
      this._lastPromptTokens = mapped.timings.promptTokens;
      this._lastPredictedTokens = mapped.timings.predictedTokens;
      this._cumulativeUsed +=
        mapped.timings.promptTokens + mapped.timings.predictedTokens;
      return mapped;
    } finally {
      this._isGenerating = false;
    }
  }

  /**
   * Stop an in-progress generation.
   */
  async stopGeneration(): Promise<void> {
    if (this.context && this._isGenerating) {
      await this.context.stopCompletion();
      this._isGenerating = false;
    }
  }

  /**
   * Unload the model and free memory. Also zeroes context-usage tracking
   * so a subsequent getContextUsage() reflects a fresh session.
   */
  async unload(): Promise<void> {
    if (this.context) {
      await releaseAllLlama();
      this.context = null;
      this.modelInfo = null;
      this._isGenerating = false;
    }
    this.resetContextUsage();
  }

  /**
   * Zero the cumulative context-usage counter. Called by
   * AgentOrchestrator.reset() when the user clears the conversation,
   * and by unload(). Safe to call when no model is loaded.
   */
  resetContextUsage(): void {
    this._lastPromptTokens = 0;
    this._lastPredictedTokens = 0;
    this._cumulativeUsed = 0;
  }

  /**
   * Get info about the loaded model.
   */
  getInfo(): {
    loaded: boolean;
    gpu: boolean;
    reasonNoGPU: string | null;
    description: string | null;
    nParams: number | null;
  } {
    return {
      loaded: this.isLoaded,
      gpu: this.modelInfo?.gpu ?? false,
      reasonNoGPU: this.modelInfo?.reasonNoGPU ?? null,
      description: this.modelInfo?.description ?? null,
      nParams: this.modelInfo?.nParams ?? null,
    };
  }

  /**
   * Get cumulative context-window usage for the current session.
   * Grows monotonically as generate() calls process new prompt tokens
   * (the diff after KV cache reuse) plus predicted output. Clamped to
   * contextSize so `percent` never exceeds 100. Zeroes only when
   * resetContextUsage() or unload() is called.
   */
  getContextUsage(): ContextUsage {
    const total = this.config.contextSize;
    const used = Math.min(this._cumulativeUsed, total);
    const percent = total > 0 ? Math.round((used / total) * 100) : 0;
    return { used, total, percent };
  }

  /**
   * Run a benchmark.
   * Returns prompt processing and token generation speeds.
   */
  async bench(
    pp = 512,
    tg = 128,
    pl = 1,
    nr = 3,
  ): Promise<{ ppSpeed: number; tgSpeed: number; flashAttn: boolean } | null> {
    if (!this.context) {
      return null;
    }

    try {
      const result = await this.context.bench(pp, tg, pl, nr);
      return {
        ppSpeed: result.speedPp ?? 0,
        tgSpeed: result.speedTg ?? 0,
        flashAttn: Boolean(result.flashAttn),
      };
    } catch {
      return null;
    }
  }

  private mapResult(result: NativeCompletionResult): CompletionResult {
    const timings: CompletionTimings = {
      promptTokens: result.timings.prompt_n,
      promptMs: result.timings.prompt_ms,
      promptPerSecond: result.timings.prompt_per_second,
      predictedTokens: result.timings.predicted_n,
      predictedMs: result.timings.predicted_ms,
      predictedPerSecond: result.timings.predicted_per_second,
    };

    const toolCalls: ToolCall[] = (result.tool_calls ?? []).map((tc, i) => ({
      type: 'function' as const,
      id: tc.id ?? `call_${i}`,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments ?? '{}',
      },
    }));

    return {
      text: result.text,
      content: result.content || result.text,
      reasoning: result.reasoning_content || null,
      toolCalls,
      timings,
      stoppedEos: result.stopped_eos,
      stoppedLimit: result.stopped_limit > 0,
      contextFull: result.context_full,
    };
  }
}
