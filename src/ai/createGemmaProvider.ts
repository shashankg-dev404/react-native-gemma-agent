// Inspired by @react-native-ai/llama createLlamaProvider (MIT)
// Source: packages/llama/src/ai-sdk.ts:1089-1158
// https://github.com/callstackincubator/ai
//
// The callable-provider convention is a pattern, not a copyable unit.
// This implementation is written from scratch against our config shape.

import type { InferenceEngine } from '../InferenceEngine';
import { SkillRegistry } from '../SkillRegistry';
import type { KnowledgeStore } from '../KnowledgeStore';
import type { SkillExecutor } from '../runToolLoop';
import {
  GemmaLanguageModel,
  type GemmaLanguageModelDefaults,
} from './GemmaLanguageModel';

export type GemmaProviderConfig = {
  engine: InferenceEngine;
  registry?: SkillRegistry;
  knowledgeStore?: KnowledgeStore | null;
  skillExecutor?: SkillExecutor | null;
  systemPrompt?: string;
  defaults?: GemmaLanguageModelDefaults;
};

export interface GemmaProvider {
  (modelId?: string, opts?: GemmaLanguageModelDefaults): GemmaLanguageModel;
  languageModel(
    modelId?: string,
    opts?: GemmaLanguageModelDefaults,
  ): GemmaLanguageModel;
}

export function createGemmaProvider(
  config: GemmaProviderConfig,
): GemmaProvider {
  if (!config.engine) {
    throw new Error('createGemmaProvider: config.engine is required');
  }

  const registry = config.registry ?? new SkillRegistry();

  const makeModel = (
    modelId?: string,
    opts?: GemmaLanguageModelDefaults,
  ): GemmaLanguageModel =>
    new GemmaLanguageModel({
      modelId: modelId ?? 'gemma-4-e2b',
      engine: config.engine,
      registry,
      executor: config.skillExecutor ?? null,
      knowledgeStore: config.knowledgeStore ?? null,
      systemPrompt: config.systemPrompt,
      defaults: { ...(config.defaults ?? {}), ...(opts ?? {}) },
    });

  const provider = ((
    modelId?: string,
    opts?: GemmaLanguageModelDefaults,
  ) => makeModel(modelId, opts)) as GemmaProvider;

  provider.languageModel = makeModel;

  return provider;
}
