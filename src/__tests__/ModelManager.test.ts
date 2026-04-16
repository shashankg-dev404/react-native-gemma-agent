jest.mock('react-native-fs', () => ({}), { virtual: true });

import { assertChecksumMatches, buildHuggingFaceUrl } from '../ModelManager';

describe('buildHuggingFaceUrl', () => {
  it('pins to the given commit SHA', () => {
    const url = buildHuggingFaceUrl('owner/repo-GGUF', 'model-Q4_K_M.gguf', 'abc123');
    expect(url).toBe('https://huggingface.co/owner/repo-GGUF/resolve/abc123/model-Q4_K_M.gguf');
  });

  it('falls back to main when commitSha is omitted', () => {
    const url = buildHuggingFaceUrl('owner/repo-GGUF', 'model.gguf');
    expect(url).toBe('https://huggingface.co/owner/repo-GGUF/resolve/main/model.gguf');
  });
});

describe('assertChecksumMatches', () => {
  const goodHash = 'ac0069ebccd39925d836f24a88c0f0c858d20578c29b21ab7cedce66ee576845';

  it('passes when hashes match exactly', () => {
    expect(() => assertChecksumMatches(goodHash, goodHash, 'model.gguf')).not.toThrow();
  });

  it('is case-insensitive on both sides', () => {
    expect(() =>
      assertChecksumMatches(goodHash.toUpperCase(), goodHash, 'model.gguf'),
    ).not.toThrow();
    expect(() =>
      assertChecksumMatches(goodHash, goodHash.toUpperCase(), 'model.gguf'),
    ).not.toThrow();
  });

  it('throws with actual and expected hashes when they differ', () => {
    const bad = 'deadbeef'.repeat(8);
    expect(() => assertChecksumMatches(bad, goodHash, 'gemma-Q4.gguf')).toThrow(
      /SHA-256 mismatch for gemma-Q4\.gguf/,
    );
    expect(() => assertChecksumMatches(bad, goodHash, 'gemma-Q4.gguf')).toThrow(goodHash);
    expect(() => assertChecksumMatches(bad, goodHash, 'gemma-Q4.gguf')).toThrow(bad);
  });
});
