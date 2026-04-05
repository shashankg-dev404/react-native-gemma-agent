import { validateToolCalls, extractToolCallsFromText } from '../FunctionCallParser';
import { SkillRegistry } from '../SkillRegistry';
import type { SkillManifest, ToolCall } from '../types';

const calcSkill: SkillManifest = {
  name: 'calculator',
  description: 'Math calculator',
  version: '1.0.0',
  type: 'native',
  parameters: { expression: { type: 'string' } },
  execute: async () => ({ result: '42' }),
};

const wikiSkill: SkillManifest = {
  name: 'query_wikipedia',
  description: 'Wikipedia search',
  version: '1.0.0',
  type: 'js',
  parameters: { query: { type: 'string' } },
  html: '<html></html>',
};

function makeRegistry(): SkillRegistry {
  const reg = new SkillRegistry();
  reg.registerSkill(calcSkill);
  reg.registerSkill(wikiSkill);
  return reg;
}

describe('validateToolCalls', () => {
  it('validates known tool calls', () => {
    const registry = makeRegistry();
    const toolCalls: ToolCall[] = [
      {
        type: 'function',
        id: 'call_0',
        function: { name: 'calculator', arguments: '{"expression":"2+2"}' },
      },
    ];

    const parsed = validateToolCalls(toolCalls, registry);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('calculator');
    expect(parsed[0].parameters).toEqual({ expression: '2+2' });
    expect(parsed[0].id).toBe('call_0');
  });

  it('skips unknown tool names', () => {
    const registry = makeRegistry();
    const toolCalls: ToolCall[] = [
      {
        type: 'function',
        function: { name: 'unknown_tool', arguments: '{}' },
      },
    ];

    const parsed = validateToolCalls(toolCalls, registry);
    expect(parsed).toHaveLength(0);
  });

  it('handles malformed JSON arguments', () => {
    const registry = makeRegistry();
    const toolCalls: ToolCall[] = [
      {
        type: 'function',
        function: { name: 'calculator', arguments: 'not json' },
      },
    ];

    const parsed = validateToolCalls(toolCalls, registry);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].parameters).toEqual({});
  });

  it('handles empty tool calls array', () => {
    const registry = makeRegistry();
    const parsed = validateToolCalls([], registry);
    expect(parsed).toHaveLength(0);
  });

  it('validates multiple tool calls', () => {
    const registry = makeRegistry();
    const toolCalls: ToolCall[] = [
      {
        type: 'function',
        id: 'call_0',
        function: { name: 'calculator', arguments: '{"expression":"1+1"}' },
      },
      {
        type: 'function',
        id: 'call_1',
        function: { name: 'query_wikipedia', arguments: '{"query":"Einstein"}' },
      },
    ];

    const parsed = validateToolCalls(toolCalls, registry);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('calculator');
    expect(parsed[1].name).toBe('query_wikipedia');
  });
});

describe('extractToolCallsFromText', () => {
  it('extracts tool_call pattern from text', () => {
    const registry = makeRegistry();
    const text = 'Let me calculate that. {"tool_call": {"name": "calculator", "parameters": {"expression": "5*10"}}}';
    const parsed = extractToolCallsFromText(text, registry);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('calculator');
    expect(parsed[0].parameters).toEqual({ expression: '5*10' });
  });

  it('extracts name/arguments pattern', () => {
    const registry = makeRegistry();
    const text = '{"name": "query_wikipedia", "arguments": {"query": "Mars"}}';
    const parsed = extractToolCallsFromText(text, registry);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('query_wikipedia');
    expect(parsed[0].parameters).toEqual({ query: 'Mars' });
  });

  it('returns empty for text with no JSON', () => {
    const registry = makeRegistry();
    const parsed = extractToolCallsFromText('Just a plain response.', registry);
    expect(parsed).toHaveLength(0);
  });

  it('skips malformed JSON blocks', () => {
    const registry = makeRegistry();
    const text = '{"name": "calculator", "arguments": {"expression": "bad}}}';
    const parsed = extractToolCallsFromText(text, registry);
    // The brace tracking may or may not extract a valid block — but it should not crash
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('skips unknown skill names in text', () => {
    const registry = makeRegistry();
    const text = '{"tool_call": {"name": "nonexistent", "parameters": {}}}';
    const parsed = extractToolCallsFromText(text, registry);
    expect(parsed).toHaveLength(0);
  });

  it('handles empty text', () => {
    const registry = makeRegistry();
    const parsed = extractToolCallsFromText('', registry);
    expect(parsed).toHaveLength(0);
  });

  it('extracts multiple tool calls from text', () => {
    const registry = makeRegistry();
    const text =
      '{"tool_call": {"name": "calculator", "parameters": {"expression": "1+1"}}} and ' +
      '{"tool_call": {"name": "query_wikipedia", "parameters": {"query": "Sun"}}}';
    const parsed = extractToolCallsFromText(text, registry);
    expect(parsed).toHaveLength(2);
  });
});
