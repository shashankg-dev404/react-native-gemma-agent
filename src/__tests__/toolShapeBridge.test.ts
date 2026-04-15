import {
  v3ToolToToolDefinition,
  separateProviderAndConsumerTools,
} from '../ai/toolShapeBridge';
import { SkillRegistry } from '../SkillRegistry';
import type { LanguageModelV3FunctionTool } from '@ai-sdk/provider';

describe('v3ToolToToolDefinition', () => {
  it('renames inputSchema → parameters and preserves the schema', () => {
    const v3Tool: LanguageModelV3FunctionTool = {
      type: 'function',
      name: 'search',
      description: 'look up things',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'the query' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    };
    const { tool, warnings } = v3ToolToToolDefinition(v3Tool);
    expect(tool).toEqual({
      type: 'function',
      function: {
        name: 'search',
        description: 'look up things',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'the query' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
      },
    });
    expect(warnings).toEqual([]);
  });

  it('falls back to empty parameters when inputSchema is missing', () => {
    const v3Tool = {
      type: 'function',
      name: 'noop',
      description: 'd',
      inputSchema: undefined,
    } as unknown as LanguageModelV3FunctionTool;
    const { tool, warnings } = v3ToolToToolDefinition(v3Tool);
    expect(tool.function.parameters.properties).toEqual({});
    expect(tool.function.parameters.required).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/noop/);
  });

  it('defaults description to empty string when missing', () => {
    const v3Tool: LanguageModelV3FunctionTool = {
      type: 'function',
      name: 'x',
      inputSchema: { type: 'object', properties: {} },
    };
    const { tool } = v3ToolToToolDefinition(v3Tool);
    expect(tool.function.description).toBe('');
  });
});

describe('separateProviderAndConsumerTools', () => {
  function makeRegistry() {
    const reg = new SkillRegistry();
    reg.registerSkill({
      name: 'search',
      description: 'registry search',
      version: '1.0.0',
      type: 'native',
      parameters: { q: { type: 'string' } },
      requiredParameters: ['q'],
      execute: async () => ({ result: '' }),
    });
    return reg;
  }

  it('returns registry skills as skillTools', () => {
    const reg = makeRegistry();
    const { skillTools } = separateProviderAndConsumerTools(undefined, reg);
    expect(skillTools).toHaveLength(1);
    expect(skillTools[0].function.name).toBe('search');
  });

  it('drops consumer tools that collide with skill names and emits warnings', () => {
    const reg = makeRegistry();
    const tools: LanguageModelV3FunctionTool[] = [
      {
        type: 'function',
        name: 'search',
        description: 'consumer tool',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        type: 'function',
        name: 'calculate',
        description: 'math',
        inputSchema: {
          type: 'object',
          properties: { expr: { type: 'string' } },
          required: ['expr'],
        },
      },
    ];
    const { consumerTools, collisionWarnings } =
      separateProviderAndConsumerTools(tools, reg);

    expect(consumerTools).toHaveLength(1);
    expect(consumerTools[0].function.name).toBe('calculate');
    expect(consumerTools[0].function.parameters.required).toEqual(['expr']);
    expect(
      collisionWarnings.some((w) => w.includes('search')),
    ).toBe(true);
  });

  it('returns empty consumerTools when no tools supplied', () => {
    const reg = makeRegistry();
    const { consumerTools, collisionWarnings } =
      separateProviderAndConsumerTools(undefined, reg);
    expect(consumerTools).toEqual([]);
    expect(collisionWarnings).toEqual([]);
  });
});
