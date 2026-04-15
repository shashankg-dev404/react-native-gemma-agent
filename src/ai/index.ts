// Vercel AI SDK V3 subpath entry for react-native-gemma-agent.
// Peer dep: @ai-sdk/provider ^3.x. Consumers who don't use the AI SDK
// never import this file and pay no install cost.

export { createGemmaProvider } from './createGemmaProvider';
export type {
  GemmaProvider,
  GemmaProviderConfig,
} from './createGemmaProvider';

export { GemmaLanguageModel } from './GemmaLanguageModel';
export type {
  GemmaLanguageModelConfig,
  GemmaLanguageModelDefaults,
  GemmaProviderOptions,
} from './GemmaLanguageModel';

export { convertFinishReason } from './convertFinishReason';
export { prepareMessages } from './prepareMessages';
export { skillResultToToolOutput } from './convertToolResultOutput';
export {
  v3ToolToToolDefinition,
  separateProviderAndConsumerTools,
} from './toolShapeBridge';
