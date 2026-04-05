// react-native-gemma-agent types

export type ModelStatus =
  | 'not_downloaded'
  | 'downloading'
  | 'ready'
  | 'loading'
  | 'loaded'
  | 'error';

export type ModelConfig = {
  /** HuggingFace repo ID (e.g., 'unsloth/gemma-4-E2B-it-GGUF') */
  repoId: string;
  /** GGUF filename within the repo */
  filename: string;
  /** Expected file size in bytes (for progress calculation) */
  expectedSize?: number;
  /** SHA256 checksum for verification */
  checksum?: string;
};

export type DownloadProgress = {
  bytesDownloaded: number;
  totalBytes: number;
  /** 0-100 */
  percent: number;
};

export type ModelInfo = {
  status: ModelStatus;
  path: string | null;
  sizeBytes: number | null;
  description: string | null;
  nParams: number | null;
  nEmbd: number | null;
};

export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description?: string;
        enum?: string[];
      }>;
      required?: string[];
    };
  };
};

export type ToolCall = {
  type: 'function';
  id?: string;
  function: {
    name: string;
    arguments: string;
  };
};

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export type Message = {
  role: MessageRole;
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

export type CompletionTimings = {
  promptTokens: number;
  promptMs: number;
  promptPerSecond: number;
  predictedTokens: number;
  predictedMs: number;
  predictedPerSecond: number;
};

export type CompletionResult = {
  text: string;
  content: string;
  toolCalls: ToolCall[];
  timings: CompletionTimings;
  stoppedEos: boolean;
  stoppedLimit: boolean;
  contextFull: boolean;
};

export type GenerateOptions = {
  /** Max tokens to generate */
  maxTokens?: number;
  /** Sampling temperature (0-2) */
  temperature?: number;
  /** Top-p nucleus sampling */
  topP?: number;
  /** Top-k sampling */
  topK?: number;
  /** Stop sequences */
  stop?: string[];
  /** Tool definitions for function calling */
  tools?: ToolDefinition[];
  /** Tool choice strategy */
  toolChoice?: 'auto' | 'none' | string;
};

export type TokenEvent = {
  token: string;
  toolCalls?: ToolCall[];
};

export type InferenceEngineConfig = {
  /** Context window size in tokens */
  contextSize?: number;
  /** Batch size for prompt processing */
  batchSize?: number;
  /** Number of threads for inference */
  threads?: number;
  /** Flash attention mode */
  flashAttn?: 'auto' | 'on' | 'off';
  /** Lock model in memory */
  useMlock?: boolean;
  /** Number of GPU layers to offload (-1 = all) */
  gpuLayers?: number;
};
