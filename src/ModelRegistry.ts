import type { ModelConfig } from './types';

export type ModelRegistryEntry = {
  name: string;
  repoId: string;
  filename: string;
  expectedSize: number;
  contextSize: number;
  minRamGb: number;
  toolCalling: boolean;
  reasoningFormat?: 'deepseek' | 'qwen';
  npuEligible: boolean;
};

export const BUILT_IN_MODELS: Record<string, ModelRegistryEntry> = {
  'gemma-4-e2b-it': {
    name: 'Gemma 4 E2B-it',
    repoId: 'ggml-org/gemma-4-E2B-it-GGUF',
    filename: 'gemma-4-E2B-it-Q4_K_M.gguf',
    expectedSize: 3_200_000_000,
    contextSize: 8192,
    minRamGb: 4,
    toolCalling: true,
    npuEligible: true,
  },
  'gemma-4-e4b-it': {
    name: 'Gemma 4 E4B-it',
    repoId: 'ggml-org/gemma-4-E4B-it-GGUF',
    filename: 'gemma-4-E4B-it-Q4_K_M.gguf',
    expectedSize: 5_000_000_000,
    contextSize: 8192,
    minRamGb: 6,
    toolCalling: true,
    npuEligible: true,
  },
  'qwen-3.5-0.8b': {
    name: 'Qwen 3.5 0.8B',
    repoId: 'unsloth/Qwen3.5-0.8B-GGUF',
    filename: 'Qwen3.5-0.8B-UD-Q4_K_M.gguf',
    expectedSize: 600_000_000,
    contextSize: 4096,
    minRamGb: 2,
    toolCalling: true,
    reasoningFormat: 'qwen',
    npuEligible: false,
  },
  'qwen-3.5-4b': {
    name: 'Qwen 3.5 4B',
    repoId: 'unsloth/Qwen3.5-4B-GGUF',
    filename: 'Qwen3.5-4B-UD-Q4_K_M.gguf',
    expectedSize: 2_800_000_000,
    contextSize: 8192,
    minRamGb: 4,
    toolCalling: true,
    reasoningFormat: 'qwen',
    npuEligible: true,
  },
  'llama-3.2-1b': {
    name: 'Llama 3.2 1B Instruct',
    repoId: 'bartowski/Llama-3.2-1B-Instruct-GGUF',
    filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    expectedSize: 950_000_000,
    contextSize: 4096,
    minRamGb: 2,
    toolCalling: false,
    npuEligible: false,
  },
  'llama-3.2-3b': {
    name: 'Llama 3.2 3B Instruct',
    repoId: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    expectedSize: 2_200_000_000,
    contextSize: 8192,
    minRamGb: 4,
    toolCalling: true,
    npuEligible: true,
  },
  'smollm2-1.7b': {
    name: 'SmolLM2 1.7B Instruct',
    repoId: 'bartowski/SmolLM2-1.7B-Instruct-GGUF',
    filename: 'SmolLM2-1.7B-Instruct-Q4_K_M.gguf',
    expectedSize: 1_100_000_000,
    contextSize: 4096,
    minRamGb: 2,
    toolCalling: false,
    npuEligible: false,
  },
};

export function getModelEntry(modelId: string): ModelRegistryEntry | null {
  return BUILT_IN_MODELS[modelId] ?? null;
}

export function listModels(): string[] {
  return Object.keys(BUILT_IN_MODELS);
}

export function modelConfigFromEntry(entry: ModelRegistryEntry): ModelConfig {
  return {
    repoId: entry.repoId,
    filename: entry.filename,
    expectedSize: entry.expectedSize,
  };
}

export function resolveModelConfig(model: string | ModelConfig): ModelConfig {
  if (typeof model === 'string') {
    const entry = getModelEntry(model);
    if (!entry) {
      throw new Error(
        `Unknown model "${model}". Use listModels() to see available IDs, or pass a ModelConfig object.`,
      );
    }
    return modelConfigFromEntry(entry);
  }
  return model;
}
