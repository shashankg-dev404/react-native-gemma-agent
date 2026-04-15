import { prepareMessages } from '../ai/prepareMessages';
import type { LanguageModelV3Prompt } from '@ai-sdk/provider';

describe('prepareMessages', () => {
  it('passes system role through', () => {
    const prompt: LanguageModelV3Prompt = [
      { role: 'system', content: 'You are helpful.' },
    ];
    const { messages, warnings } = prepareMessages(prompt);
    expect(messages).toEqual([
      { role: 'system', content: 'You are helpful.' },
    ]);
    expect(warnings).toEqual([]);
  });

  it('joins user text parts into single content string', () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'world' },
        ],
      },
    ];
    const { messages, warnings } = prepareMessages(prompt);
    expect(messages).toEqual([{ role: 'user', content: 'Hello\nworld' }]);
    expect(warnings).toEqual([]);
  });

  it('drops user FileParts with a warning', () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'look at this' },
          {
            type: 'file',
            data: 'ignored',
            mediaType: 'image/png',
          },
        ],
      },
    ];
    const { messages, warnings } = prepareMessages(prompt);
    expect(messages).toEqual([{ role: 'user', content: 'look at this' }]);
    expect(warnings).toContain(
      'FilePart dropped — multimodal not yet supported',
    );
  });

  it('collapses assistant text and reasoning into one content', () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'think' },
          { type: 'text', text: 'answer' },
        ],
      },
    ];
    const { messages } = prepareMessages(prompt);
    expect(messages).toEqual([
      { role: 'assistant', content: 'think\nanswer' },
    ]);
  });

  it('maps assistant ToolCallPart to Message.tool_calls with empty content', () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call_1',
            toolName: 'search',
            input: { q: 'cats' },
          },
        ],
      },
    ];
    const { messages } = prepareMessages(prompt);
    expect(messages).toEqual([
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            type: 'function',
            id: 'call_1',
            function: { name: 'search', arguments: '{"q":"cats"}' },
          },
        ],
      },
    ]);
  });

  it('preserves string-typed tool call input verbatim', () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'c',
            toolName: 'n',
            input: '{"already":"json"}',
          },
        ],
      },
    ];
    const { messages } = prepareMessages(prompt);
    expect(messages[0].tool_calls?.[0].function.arguments).toBe(
      '{"already":"json"}',
    );
  });

  it('emits tool-role messages for every inbound ToolResultOutput variant', () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'a',
            toolName: 'n',
            output: { type: 'text', value: 'ok' },
          },
          {
            type: 'tool-result',
            toolCallId: 'b',
            toolName: 'n',
            output: { type: 'json', value: { x: 1 } },
          },
          {
            type: 'tool-result',
            toolCallId: 'c',
            toolName: 'n',
            output: { type: 'error-text', value: 'oops' },
          },
          {
            type: 'tool-result',
            toolCallId: 'd',
            toolName: 'n',
            output: { type: 'error-json', value: { code: 500 } },
          },
          {
            type: 'tool-result',
            toolCallId: 'e',
            toolName: 'n',
            output: { type: 'execution-denied', reason: 'no' },
          },
          {
            type: 'tool-result',
            toolCallId: 'f',
            toolName: 'n',
            output: {
              type: 'content',
              value: [{ type: 'text', text: 'body' }],
            },
          },
          {
            type: 'tool-result',
            toolCallId: 'g',
            toolName: 'n',
            output: {
              type: 'content',
              value: [
                {
                  type: 'image-data',
                  data: 'xx',
                  mediaType: 'image/png',
                },
              ],
            },
          },
        ],
      },
    ];
    const { messages } = prepareMessages(prompt);
    expect(messages.map((m) => m.content)).toEqual([
      'ok',
      '{"x":1}',
      'Error: oops',
      'Error: {"code":500}',
      'no',
      'body',
      '[image-data]',
    ]);
    expect(messages.every((m) => m.role === 'tool')).toBe(true);
  });

  it('emits assistant-embedded tool-result as a tool-role message without warning', () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'c1',
            toolName: 'search',
            input: {},
          },
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 'search',
            output: { type: 'text', value: 'done' },
          },
        ],
      },
    ];
    const { messages, warnings } = prepareMessages(prompt);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('assistant');
    expect(messages[1]).toEqual({
      role: 'tool',
      content: 'done',
      tool_call_id: 'c1',
      name: 'search',
    });
    expect(warnings).toEqual([]);
  });
});
