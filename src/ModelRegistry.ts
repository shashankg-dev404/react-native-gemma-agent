import type { ModelConfig } from './types';

export type ModelRegistryEntry = {
  name: string;
  repoId: string;
  filename: string;
  commitSha: string;
  sha256: string;
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
    repoId: 'unsloth/gemma-4-E2B-it-GGUF',
    filename: 'gemma-4-E2B-it-Q4_K_M.gguf',
    commitSha: 'f064409f340b34190993560b2168133e5dbae558',
    sha256: 'ac0069ebccd39925d836f24a88c0f0c858d20578c29b21ab7cedce66ee576845',
    expectedSize: 3_106_735_776,
    contextSize: 8192,
    minRamGb: 4,
    toolCalling: true,
    npuEligible: true,
  },
  'gemma-4-e4b-it': {
    name: 'Gemma 4 E4B-it',
    repoId: 'ggml-org/gemma-4-E4B-it-GGUF',
    filename: 'gemma-4-E4B-it-Q4_K_M.gguf',
    commitSha: '2714b5519c6c3516b1000e7c5e1eba998dfe1fe8',
    sha256: '90ce98129eb3e8cc57e62433d500c97c624b1e3af1fcc85dd3b55ad7e0313e9f',
    expectedSize: 5_335_289_824,
    contextSize: 8192,
    minRamGb: 6,
    toolCalling: true,
    npuEligible: true,
  },
  'qwen-3.5-0.8b': {
    name: 'Qwen 3.5 0.8B',
    repoId: 'unsloth/Qwen3.5-0.8B-GGUF',
    filename: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    commitSha: '6ab461498e2023f6e3c1baea90a8f0fe38ab64d0',
    sha256: 'bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517',
    expectedSize: 532_517_120,
    contextSize: 4096,
    minRamGb: 2,
    toolCalling: true,
    reasoningFormat: 'qwen',
    npuEligible: false,
  },
  'qwen-3.5-4b': {
    name: 'Qwen 3.5 4B',
    repoId: 'unsloth/Qwen3.5-4B-GGUF',
    filename: 'Qwen3.5-4B-Q4_K_M.gguf',
    commitSha: 'e87f176479d0855a907a41277aca2f8ee7a09523',
    sha256: '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
    expectedSize: 2_740_937_888,
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
    commitSha: '067b946cf014b7c697f3654f621d577a3e3afd1c',
    sha256: '6f85a640a97cf2bf5b8e764087b1e83da0fdb51d7c9fab7d0fece9385611df83',
    expectedSize: 807_694_464,
    contextSize: 4096,
    minRamGb: 2,
    toolCalling: false,
    npuEligible: false,
  },
  'llama-3.2-3b': {
    name: 'Llama 3.2 3B Instruct',
    repoId: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    commitSha: '5ab33fa94d1d04e903623ae72c95d1696f09f9e8',
    sha256: '6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff',
    expectedSize: 2_019_377_696,
    contextSize: 8192,
    minRamGb: 4,
    toolCalling: true,
    npuEligible: true,
  },
  'smollm2-1.7b': {
    name: 'SmolLM2 1.7B Instruct',
    repoId: 'bartowski/SmolLM2-1.7B-Instruct-GGUF',
    filename: 'SmolLM2-1.7B-Instruct-Q4_K_M.gguf',
    commitSha: '1f03464768bfcc0319fc50da8ff5fb20b6417ba2',
    sha256: '77665ea4815999596525c636fbeb56ba8b080b46ae85efef4f0d986a139834d7',
    expectedSize: 1_055_609_824,
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
    commitSha: entry.commitSha,
    checksum: entry.sha256,
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
