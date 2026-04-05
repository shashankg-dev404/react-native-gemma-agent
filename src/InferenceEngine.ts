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
      const llamaMessages = messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      const completionParams: Record<string, unknown> = {
        messages: llamaMessages,
        n_predict: options?.maxTokens ?? DEFAULT_GENERATE.maxTokens,
        temperature: options?.temperature ?? DEFAULT_GENERATE.temperature,
        top_p: options?.topP ?? DEFAULT_GENERATE.topP,
        top_k: options?.topK ?? DEFAULT_GENERATE.topK,
        stop: options?.stop ?? ['<end_of_turn>', '<eos>'],
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

      return this.mapResult(result);
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
   * Unload the model and free memory.
   */
  async unload(): Promise<void> {
    if (this.context) {
      await releaseAllLlama();
      this.context = null;
      this.modelInfo = null;
      this._isGenerating = false;
    }
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

    const toolCalls: ToolCall[] = (result.tool_calls ?? []).map(tc => ({
      type: 'function' as const,
      id: tc.id,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    }));

    return {
      text: result.text,
      content: result.content ?? result.text,
      toolCalls,
      timings,
      stoppedEos: result.stopped_eos,
      stoppedLimit: result.stopped_limit > 0,
      contextFull: result.context_full,
    };
  }
}
