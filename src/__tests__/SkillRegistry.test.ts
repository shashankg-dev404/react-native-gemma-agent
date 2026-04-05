import { SkillRegistry } from '../SkillRegistry';
import type { SkillManifest } from '../types';

const nativeSkill: SkillManifest = {
  name: 'calculator',
  description: 'Math calculator',
  version: '1.0.0',
  type: 'native',
  parameters: { expression: { type: 'string', description: 'Math expr' } },
  requiredParameters: ['expression'],
  execute: async () => ({ result: '42' }),
};

const jsSkill: SkillManifest = {
  name: 'wiki',
  description: 'Search Wikipedia',
  version: '1.0.0',
  type: 'js',
  parameters: { query: { type: 'string' } },
  requiredParameters: ['query'],
  html: '<html><body></body></html>',
  instructions: 'Use for factual queries',
};

describe('SkillRegistry', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
  });

  it('registers and retrieves a native skill', () => {
    registry.registerSkill(nativeSkill);
    expect(registry.hasSkill('calculator')).toBe(true);
    expect(registry.getSkill('calculator')).toBe(nativeSkill);
  });

  it('registers and retrieves a JS skill', () => {
    registry.registerSkill(jsSkill);
    expect(registry.hasSkill('wiki')).toBe(true);
  });

  it('rejects JS skill without html', () => {
    const bad: SkillManifest = {
      name: 'bad_js',
      description: 'Missing html',
      version: '1.0.0',
      type: 'js',
      parameters: {},
    };
    expect(() => registry.registerSkill(bad)).toThrow('requires an html field');
  });

  it('rejects native skill without execute', () => {
    const bad: SkillManifest = {
      name: 'bad_native',
      description: 'Missing execute',
      version: '1.0.0',
      type: 'native',
      parameters: {},
    };
    expect(() => registry.registerSkill(bad)).toThrow(
      'requires an execute function',
    );
  });

  it('unregisters a skill', () => {
    registry.registerSkill(nativeSkill);
    registry.unregisterSkill('calculator');
    expect(registry.hasSkill('calculator')).toBe(false);
  });

  it('getSkills returns all registered', () => {
    registry.registerSkill(nativeSkill);
    registry.registerSkill(jsSkill);
    expect(registry.getSkills()).toHaveLength(2);
  });

  it('getSkill returns null for unknown', () => {
    expect(registry.getSkill('nope')).toBeNull();
  });

  it('clear removes all skills', () => {
    registry.registerSkill(nativeSkill);
    registry.registerSkill(jsSkill);
    registry.clear();
    expect(registry.getSkills()).toHaveLength(0);
  });

  describe('toToolDefinitions', () => {
    it('converts skills to OpenAI-compatible format', () => {
      registry.registerSkill(nativeSkill);
      const tools = registry.toToolDefinitions();
      expect(tools).toHaveLength(1);
      expect(tools[0].type).toBe('function');
      expect(tools[0].function.name).toBe('calculator');
      expect(tools[0].function.parameters.type).toBe('object');
      expect(tools[0].function.parameters.properties).toHaveProperty(
        'expression',
      );
      expect(tools[0].function.parameters.required).toEqual(['expression']);
    });

    it('appends instructions to description', () => {
      registry.registerSkill(jsSkill);
      const tools = registry.toToolDefinitions();
      expect(tools[0].function.description).toContain('Search Wikipedia');
      expect(tools[0].function.description).toContain(
        'Use for factual queries',
      );
    });

    it('returns empty array when no skills registered', () => {
      expect(registry.toToolDefinitions()).toEqual([]);
    });
  });
});
