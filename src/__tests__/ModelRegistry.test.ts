import {
  BUILT_IN_MODELS,
  getModelEntry,
  listModels,
  modelConfigFromEntry,
  resolveModelConfig,
} from '../ModelRegistry';

describe('ModelRegistry', () => {
  it('lists all built-in model IDs', () => {
    const ids = listModels();
    expect(ids).toContain('gemma-4-e2b-it');
    expect(ids).toContain('qwen-3.5-4b');
    expect(ids).toContain('llama-3.2-3b');
    expect(ids).toContain('smollm2-1.7b');
    expect(ids.length).toBe(Object.keys(BUILT_IN_MODELS).length);
  });

  it('getModelEntry returns entry for known model', () => {
    const entry = getModelEntry('qwen-3.5-4b');
    expect(entry).not.toBeNull();
    expect(entry!.name).toBe('Qwen 3.5 4B');
    expect(entry!.toolCalling).toBe(true);
    expect(entry!.reasoningFormat).toBe('qwen');
  });

  it('getModelEntry returns null for unknown model', () => {
    expect(getModelEntry('nonexistent')).toBeNull();
  });

  it('modelConfigFromEntry produces a valid ModelConfig', () => {
    const entry = getModelEntry('gemma-4-e2b-it')!;
    const config = modelConfigFromEntry(entry);
    expect(config.repoId).toBe(entry.repoId);
    expect(config.filename).toBe(entry.filename);
    expect(config.expectedSize).toBe(entry.expectedSize);
  });

  it('resolveModelConfig resolves a string ID to ModelConfig', () => {
    const config = resolveModelConfig('llama-3.2-3b');
    expect(config.repoId).toBe('bartowski/Llama-3.2-3B-Instruct-GGUF');
    expect(config.filename).toBe('Llama-3.2-3B-Instruct-Q4_K_M.gguf');
  });

  it('resolveModelConfig passes through a ModelConfig object', () => {
    const custom = { repoId: 'user/custom-GGUF', filename: 'custom.gguf' };
    expect(resolveModelConfig(custom)).toBe(custom);
  });

  it('resolveModelConfig throws for unknown string ID', () => {
    expect(() => resolveModelConfig('bad-id')).toThrow('Unknown model "bad-id"');
  });

  it('every entry has required fields', () => {
    for (const [, entry] of Object.entries(BUILT_IN_MODELS)) {
      expect(entry.name).toBeTruthy();
      expect(entry.repoId).toContain('/');
      expect(entry.filename).toMatch(/\.gguf$/);
      expect(entry.expectedSize).toBeGreaterThan(0);
      expect(entry.contextSize).toBeGreaterThan(0);
      expect(entry.minRamGb).toBeGreaterThan(0);
      expect(typeof entry.toolCalling).toBe('boolean');
      expect(typeof entry.npuEligible).toBe('boolean');
      if (entry.reasoningFormat) {
        expect(['deepseek', 'qwen']).toContain(entry.reasoningFormat);
      }
    }
  });

  it('every entry pins a commitSha and sha256', () => {
    for (const [id, entry] of Object.entries(BUILT_IN_MODELS)) {
      expect(entry.commitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.commitSha).not.toBe(entry.sha256);
      expect(id).toBeTruthy();
    }
  });

  it('modelConfigFromEntry carries commitSha and checksum forward', () => {
    const entry = getModelEntry('gemma-4-e2b-it')!;
    const config = modelConfigFromEntry(entry);
    expect(config.commitSha).toBe(entry.commitSha);
    expect(config.checksum).toBe(entry.sha256);
  });

  it('models without tool calling are flagged correctly', () => {
    const noToolCall = Object.entries(BUILT_IN_MODELS)
      .filter(([, e]) => !e.toolCalling)
      .map(([id]) => id);
    expect(noToolCall).toContain('llama-3.2-1b');
    expect(noToolCall).toContain('smollm2-1.7b');
    expect(noToolCall).not.toContain('gemma-4-e2b-it');
    expect(noToolCall).not.toContain('qwen-3.5-4b');
  });
});
