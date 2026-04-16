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
  /** Raw text output (includes thinking + tool call tokens) */
  text: string;
  /** Filtered content (thinking and tool call tokens removed) */
  content: string;
  /** Model's chain-of-thought reasoning, if any */
  reasoning: string | null;
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
  /** Forward to llama.rn to enable thinking/reasoning output */
  enable_thinking?: boolean;
  reasoning_format?: 'none' | 'deepseek' | 'qwen';
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

// --- Skill System Types ---

export type SkillType = 'js' | 'native';

export type SkillParameter = {
  type: string;
  description?: string;
  enum?: string[];
};

export type SkillManifest = {
  name: string;
  description: string;
  version: string;
  type: SkillType;
  parameters: Record<string, SkillParameter>;
  requiredParameters?: string[];
  /** HTML content for JS skills — loaded into hidden WebView */
  html?: string;
  /** Native execution function — for skills that run in RN context */
  execute?: (params: Record<string, unknown>) => Promise<SkillResult>;
  /** Instructions for the LLM on when/how to use this skill */
  instructions?: string;
  /** Whether this skill requires network access. SDK checks connectivity before execution. */
  requiresNetwork?: boolean;
  /** Skill category for grouping (e.g. 'utility', 'research'). Uncategorized skills are always included unless explicitly excluded. */
  category?: string;
};

export type SkillResult = {
  result?: string;
  error?: string;
  image?: { base64: string };
};

// --- Agent Types ---

export type AgentEvent =
  | { type: 'thinking' }
  | { type: 'token'; token: string }
  | { type: 'skill_called'; name: string; parameters: Record<string, unknown> }
  | { type: 'skill_result'; name: string; result: SkillResult }
  | { type: 'response'; text: string; reasoning: string | null }
  | { type: 'context_warning'; usage: ContextUsage }
  | { type: 'error'; error: string };

export type AgentConfig = {
  /** Max chained skill calls before stopping (prevents infinite loops). Default: 5 */
  maxChainDepth?: number;
  /** Timeout for each skill execution in ms. Default: 30000 */
  skillTimeout?: number;
  /** Base system prompt prepended to all conversations */
  systemPrompt?: string;
  /** Skill routing strategy. 'all' sends every skill; 'bm25' pre-filters by query relevance. Default: 'all' */
  skillRouting?: 'all' | 'bm25';
  /** Max skills sent to the model per invocation (only used with 'bm25' routing). Default: 5 */
  maxToolsPerInvocation?: number;
  /** When set, only skills matching a listed category are sent to the model. Uncategorized skills are always included unless this array is non-empty and doesn't include 'uncategorized'. */
  activeCategories?: string[];
  /** Context usage fraction (0-1) at which `onContextWarning` fires. Default: 0.8 (80%). */
  contextWarningThreshold?: number;
  /**
   * Called once per threshold crossing when context usage reaches
   * `contextWarningThreshold`. Use this to auto-summarize, clear history,
   * or alert the user before the context window fills up. Fires at most
   * once per conversation until `reset()` is called.
   */
  onContextWarning?: (usage: ContextUsage) => void;
};

export type ContextUsage = {
  /** Tokens used so far */
  used: number;
  /** Total context window size in tokens */
  total: number;
  /** Usage percentage (0-100) */
  percent: number;
};
