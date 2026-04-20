import { generateStructured, isZodSchema, toJsonSchema } from '../StructuredOutput';
import type {
  CompletionResult,
  ContextUsage,
  GenerateOptions,
  Message,
  TokenEvent,
} from '../types';

class MockEngine {
  isLoaded = true;
  isGenerating = false;
  private responses: CompletionResult[] = [];
  private callIndex = 0;
  generateCallArgs: Array<{ messages: Message[]; options?: GenerateOptions }> =
    [];

  pushResponseText(content: string): void {
    this.responses.push({
      text: content,
      content,
      reasoning: null,
      toolCalls: [],
      timings: {
        promptTokens: 10,
        promptMs: 1,
        promptPerSecond: 10,
        predictedTokens: 20,
        predictedMs: 1,
        predictedPerSecond: 20,
      },
      stoppedEos: true,
      stoppedLimit: false,
      contextFull: false,
    });
  }

  async generate(
    messages: Message[],
    options?: GenerateOptions,
    _onToken?: (e: TokenEvent) => void,
  ): Promise<CompletionResult> {
    this.generateCallArgs.push({ messages, options });
    if (this.callIndex >= this.responses.length) {
      throw new Error('MockEngine: no more responses queued');
    }
    return this.responses[this.callIndex++];
  }

  getContextUsage(): ContextUsage {
    return { used: 0, total: 4096, percent: 0 };
  }

  async stopGeneration(): Promise<void> {}
  async unload(): Promise<void> {}
}

describe('isZodSchema', () => {
  it('returns false for plain JSON Schema', () => {
    expect(isZodSchema({ type: 'object', properties: {} })).toBe(false);
  });

  it('returns true for an object with _def and safeParse', () => {
    const fake = {
      _def: { typeName: 'ZodObject' },
      safeParse: (_: unknown) => ({ success: true, data: {} }),
      parse: (_: unknown) => ({}),
    };
    expect(isZodSchema(fake)).toBe(true);
  });

  it('returns false when safeParse is missing even if _def is present', () => {
    expect(isZodSchema({ _def: {} })).toBe(false);
  });
});

describe('toJsonSchema', () => {
  it('passes through a plain JSON Schema unchanged', () => {
    const schema = { type: 'object', properties: { x: { type: 'number' } } };
    expect(toJsonSchema(schema as Record<string, unknown>)).toBe(schema);
  });

  it('throws a clear error when a Zod v3 schema is passed but zod-to-json-schema is missing', () => {
    const fake = {
      _def: { typeName: 'ZodObject' },
      safeParse: () => ({ success: true, data: {} }),
      parse: () => ({}),
    };
    expect(() => toJsonSchema(fake)).toThrow(
      /zod-to-json-schema.*not installed/,
    );
  });

  it('uses the Zod v4 native toJSONSchema method when present', () => {
    const converted = { type: 'object', properties: { x: { type: 'string' } } };
    const zod4Schema = {
      _def: { typeName: 'ZodObject' },
      safeParse: () => ({ success: true, data: {} }),
      parse: () => ({}),
      toJSONSchema: jest.fn(() => converted),
    };
    expect(toJsonSchema(zod4Schema)).toBe(converted);
    expect(zod4Schema.toJSONSchema).toHaveBeenCalledTimes(1);
  });
});

const schema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    count: { type: 'number' },
  },
  required: ['title', 'count'],
};

describe('generateStructured', () => {
  it('returns a parsed object on first attempt when JSON is valid', async () => {
    const engine = new MockEngine();
    engine.pushResponseText('{"title":"hello","count":3}');

    const result = await generateStructured<{ title: string; count: number }>(
      engine as never,
      { schema, prompt: 'extract' },
    );

    expect(result.object).toEqual({ title: 'hello', count: 3 });
    expect(result.attempts).toBe(1);
    expect(engine.generateCallArgs.length).toBe(1);
    const call = engine.generateCallArgs[0];
    expect(call.options?.responseFormat).toBeUndefined();
    const systemMsg = call.messages.find((m) => m.role === 'system');
    expect(systemMsg?.content).toContain('JSON Schema');
    expect(systemMsg?.content).toContain('"title"');
    expect(systemMsg?.content).toContain('"count"');
  });

  it('preserves the caller-supplied systemPrompt alongside the injected schema', async () => {
    const engine = new MockEngine();
    engine.pushResponseText('{"title":"x","count":0}');

    await generateStructured<{ title: string; count: number }>(
      engine as never,
      { schema, prompt: 'extract', systemPrompt: 'You are a calendar bot.' },
    );

    const systemMsg = engine.generateCallArgs[0].messages.find(
      (m) => m.role === 'system',
    );
    expect(systemMsg?.content).toContain('You are a calendar bot.');
    expect(systemMsg?.content).toContain('JSON Schema');
  });

  it('retries when the model first emits unparseable text, then succeeds', async () => {
    const engine = new MockEngine();
    engine.pushResponseText('this is not json');
    engine.pushResponseText('{"title":"retry","count":1}');

    const result = await generateStructured<{ title: string; count: number }>(
      engine as never,
      { schema, prompt: 'extract' },
    );

    expect(result.object).toEqual({ title: 'retry', count: 1 });
    expect(result.attempts).toBe(2);
    expect(engine.generateCallArgs.length).toBe(2);
    const retryMessages = engine.generateCallArgs[1].messages;
    const lastMessage = retryMessages[retryMessages.length - 1];
    expect(lastMessage.role).toBe('user');
    expect(lastMessage.content).toMatch(/failed validation/i);
  });

  it('strips markdown fences when the model wraps JSON in ```json', async () => {
    const engine = new MockEngine();
    engine.pushResponseText('```json\n{"title":"hi","count":2}\n```');

    const result = await generateStructured<{ title: string; count: number }>(
      engine as never,
      { schema, prompt: 'extract' },
    );

    expect(result.object).toEqual({ title: 'hi', count: 2 });
    expect(result.attempts).toBe(1);
  });

  it('throws with the last raw output after exhausting retries', async () => {
    const engine = new MockEngine();
    engine.pushResponseText('not json');
    engine.pushResponseText('still not json');
    engine.pushResponseText('absolutely not json');

    await expect(
      generateStructured(engine as never, {
        schema,
        prompt: 'x',
        maxRetries: 2,
      }),
    ).rejects.toThrow(/failed after 3 attempts.*absolutely not json/s);
  });

  it('respects maxRetries=0 by throwing after a single bad attempt', async () => {
    const engine = new MockEngine();
    engine.pushResponseText('not json');

    await expect(
      generateStructured(engine as never, {
        schema,
        prompt: 'x',
        maxRetries: 0,
      }),
    ).rejects.toThrow(/failed after 1 attempts/);
  });

  it('validates with a Zod-like safeParse and retries on validation failure', async () => {
    jest.isolateModules(() => {
      jest.doMock(
        'zod-to-json-schema',
        () => ({
          zodToJsonSchema: (_s: unknown) => schema,
        }),
        { virtual: true },
      );
    });

    const engine = new MockEngine();
    engine.pushResponseText('{"title":"hi","count":"not-a-number"}');
    engine.pushResponseText('{"title":"hi","count":5}');

    let attempts = 0;
    const fakeZod = {
      _def: { typeName: 'ZodObject' },
      safeParse: (data: unknown) => {
        attempts++;
        const d = data as { count?: unknown };
        if (typeof d.count === 'number') {
          return { success: true, data: d } as const;
        }
        return {
          success: false,
          error: { message: 'count must be a number' },
        } as const;
      },
      parse: (_: unknown) => ({}),
    };

    let freshGenerateStructured: typeof generateStructured;
    jest.isolateModules(() => {
      jest.doMock(
        'zod-to-json-schema',
        () => ({
          zodToJsonSchema: (_s: unknown) => schema,
        }),
        { virtual: true },
      );
      freshGenerateStructured = require('../StructuredOutput').generateStructured;
    });

    const result = await freshGenerateStructured!(engine as never, {
      schema: fakeZod,
      prompt: 'extract',
    });

    expect(result.object).toEqual({ title: 'hi', count: 5 });
    expect(result.attempts).toBe(2);
    expect(attempts).toBe(2);
  });
});
