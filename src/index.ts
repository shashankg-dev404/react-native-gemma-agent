// react-native-gemma-agent SDK
export const SDK_VERSION = '0.3.0';

// Model registry
export {
  BUILT_IN_MODELS,
  getModelEntry,
  listModels,
  modelConfigFromEntry,
  resolveModelConfig,
} from './ModelRegistry';
export type { ModelRegistryEntry } from './ModelRegistry';

// Core classes
export { ModelManager } from './ModelManager';
export { InferenceEngine } from './InferenceEngine';
export { SkillRegistry } from './SkillRegistry';
export { AgentOrchestrator } from './AgentOrchestrator';
export { BM25Scorer } from './BM25Scorer';
export { KnowledgeStore } from './KnowledgeStore';
export type { SkillExecutor } from './AgentOrchestrator';
export type { Note, NoteMetadata, NoteIndexEntry } from './KnowledgeStore';

// React hooks & provider
export { GemmaAgentProvider } from './GemmaAgentProvider';
export type { GemmaAgentProviderProps, GemmaAgentContextValue } from './GemmaAgentProvider';
export { useGemmaAgent } from './useGemmaAgent';
export type { UseGemmaAgentReturn } from './useGemmaAgent';
export { useModelDownload } from './useModelDownload';
export type { UseModelDownloadReturn } from './useModelDownload';
export { useSkillRegistry } from './useSkillRegistry';
export type { UseSkillRegistryReturn } from './useSkillRegistry';
export { useKnowledgeStore } from './useKnowledgeStore';
export type { UseKnowledgeStoreReturn } from './useKnowledgeStore';
export { useLLM } from './useLLM';
export type { UseLLMConfig, UseLLMReturn } from './useLLM';

// Skill execution
export { SkillSandbox } from './SkillSandbox';
export type { SkillSandboxHandle } from './SkillSandbox';

// Function call parsing
export { validateToolCalls, extractToolCallsFromText } from './FunctionCallParser';
export type { ParsedToolCall } from './FunctionCallParser';

// Types
export type {
  ModelStatus,
  ModelConfig,
  ModelInfo,
  DownloadProgress,
  ToolDefinition,
  ToolCall,
  Message,
  MessageRole,
  CompletionResult,
  CompletionTimings,
  GenerateOptions,
  TokenEvent,
  InferenceEngineConfig,
  SkillType,
  SkillParameter,
  SkillManifest,
  SkillResult,
  AgentEvent,
  AgentConfig,
  ContextUsage,
} from './types';
