import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FunctionTool,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';
import { GemmaLanguageModel } from '../ai/GemmaLanguageModel';
import { SkillRegistry } from '../SkillRegistry';
import type {
  CompletionResult,
  ContextUsage,
  GenerateOptions,
  Message,
  SkillManifest,
  TokenEvent,
} from '../types';

class MockInferenceEngine {
  isLoaded = true;
  isGenerating = false;

  private responses: CompletionResult[] = [];
  private callIndex = 0;
  private usageQueue: ContextUsage[] = [];
  private staticUsage: ContextUsage = { used: 30, total: 4096, percent: 1 };
  stopGenerationCalls = 0;
  generateCallArgs: Array<{
    messages: Message[];
    options?: GenerateOptions;
  }> = [];
  tokenStreams: string[][] = [];

  pushResponse(
    response: Partial<CompletionResult>,
    tokenStream?: string[],
  ): void {
    this.responses.push({
      text: '',
      content: '',
      reasoning: null,
      toolCalls: [],
      timings: {
        promptTokens: 10,
        promptMs: 100,
        promptPerSecond: 100,
        predictedTokens: 20,
        predictedMs: 200,
        predictedPerSecond: 100,
      },
      stoppedEos: true,
      stoppedLimit: false,
      contextFull: false,
      ...response,
    });
    this.tokenStreams.push(tokenStream ?? []);
  }

  setStaticUsage(usage: ContextUsage): void {
    this.staticUsage = usage;
  }

  pushUsage(usage: ContextUsage): void {
    this.usageQueue.push(usage);
  }

  async generate(
    messages: Message[],
    options?: GenerateOptions,
    onToken?: (e: TokenEvent) => void,
  ): Promise<CompletionResult> {
    this.generateCallArgs.push({ messages, options });
    if (this.callIndex >= this.responses.length) {
      throw new Error('MockInferenceEngine: no more responses queued');
    }
    const tokens = this.tokenStreams[this.callIndex] ?? [];
    for (const token of tokens) {
      onToken?.({ token });
    }
    return this.responses[this.callIndex++];
  }

  getContextUsage(): ContextUsage {
    if (this.usageQueue.length > 0) {
      const idx = Math.min(this.callIndex, this.usageQueue.length - 1);
      return this.usageQueue[idx];
    }
    return this.staticUsage;
  }

  resetContextUsage = jest.fn();
  async stopGeneration(): Promise<void> {
    this.stopGenerationCalls++;
  }
  async unload(): Promise<void> {}
  getInfo() {
    return {
      loaded: true,
      gpu: false,
      reasonNoGPU: null,
      description: null,
      nParams: null,
    };
  }
}

const calcSkill: SkillManifest = {
  name: 'calculator',
  description: 'Math calculator',
  version: '1.0.0',
  type: 'native',
  requiresNetwork: false,
  parameters: { expression: { type: 'string' } },
  execute: async (params) => ({
    result: String(eval(String(params.expression))),
  }),
};

const wikiSkill: SkillManifest = {
  name: 'query_wikipedia',
  description: 'Search Wikipedia for factual information about any topic.',
  version: '1.0.0',
  type: 'js',
  parameters: { query: { type: 'string' } },
  html: '<html></html>',
};

const searchSkill: SkillManifest = {
  name: 'web_search',
  description: 'Search the web for current information.',
  version: '1.0.0',
  type: 'js',
  parameters: { query: { type: 'string' } },
  html: '<html></html>',
};

function makeModel(
  engine: MockInferenceEngine,
  skills: SkillManifest[],
  defaults?: ConstructorParameters<typeof GemmaLanguageModel>[0]['defaults'],
): GemmaLanguageModel {
  const registry = new SkillRegistry();
  for (const s of skills) {
    registry.registerSkill(s);
  }
  return new GemmaLanguageModel({
    engine: engine as never,
    registry,
    defaults,
  });
}

function userPrompt(text: string): LanguageModelV3CallOptions['prompt'] {
  return [{ role: 'user', content: [{ type: 'text', text }] }];
}

async function collectStream(
  stream: ReadableStream<LanguageModelV3StreamPart>,
): Promise<LanguageModelV3StreamPart[]> {
  const reader = stream.getReader();
  const parts: LanguageModelV3StreamPart[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  return parts;
}

describe('GemmaLanguageModel', () => {
  it('doStream emits stream-start → text-* → finish for a text-only turn', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse(
      { text: 'Hello!', content: 'Hello!' },
      ['Hel', 'lo', '!'],
    );
    const model = makeModel(engine, []);

    const { stream } = await model.doStream({ prompt: userPrompt('hi') });
    const parts = await collectStream(stream);

    expect(parts[0].type).toBe('stream-start');
    const textDeltas = parts.filter((p) => p.type === 'text-delta');
    expect(textDeltas.length).toBe(3);
    const starts = parts.filter((p) => p.type === 'text-start');
    const ends = parts.filter((p) => p.type === 'text-end');
    expect(starts.length).toBe(1);
    expect(ends.length).toBe(1);
    expect(parts[parts.length - 1].type).toBe('finish');
  });

  it('doStream emits tool-input-start/-delta/-end then tool-call and tool-result for a skill turn', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({
      toolCalls: [
        {
          type: 'function',
          id: 'call_0',
          function: { name: 'calculator', arguments: '{"expression":"2+2"}' },
        },
      ],
    });
    engine.pushResponse(
      { text: 'The answer is 4.', content: 'The answer is 4.' },
      ['The answer is 4.'],
    );
    const model = makeModel(engine, [calcSkill]);

    const { stream } = await model.doStream({
      prompt: userPrompt('what is 2+2'),
    });
    const parts = await collectStream(stream);

    const types = parts.map((p) => p.type);
    const startIdx = types.indexOf('tool-input-start');
    const deltaIdx = types.indexOf('tool-input-delta');
    const endIdx = types.indexOf('tool-input-end');
    const callIdx = types.indexOf('tool-call');
    const resultIdx = types.indexOf('tool-result');

    expect(startIdx).toBeGreaterThan(-1);
    expect(deltaIdx).toBe(startIdx + 1);
    expect(endIdx).toBe(startIdx + 2);
    expect(callIdx).toBe(endIdx + 1);
    expect(resultIdx).toBe(callIdx + 1);

    const toolCall = parts[callIdx] as Extract<
      LanguageModelV3StreamPart,
      { type: 'tool-call' }
    >;
    expect(toolCall.toolName).toBe('calculator');
    expect(toolCall.providerExecuted).toBe(true);
    expect(toolCall.input).toBe('{"expression":"2+2"}');

    const toolResult = parts[resultIdx] as Extract<
      LanguageModelV3StreamPart,
      { type: 'tool-result' }
    >;
    expect(toolResult.result).toBe('4');
    expect(toolResult.isError).toBeUndefined();
  });

  it('abortSignal calls engine.stopGeneration', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'slow', content: 'slow' });
    const model = makeModel(engine, []);

    const abort = new AbortController();
    const { stream } = await model.doStream({
      prompt: userPrompt('hi'),
      abortSignal: abort.signal,
    });

    abort.abort();
    await collectStream(stream);

    expect(engine.stopGenerationCalls).toBeGreaterThan(0);
  });

  it('respects providerOptions.gemma.maxChainDepth override', async () => {
    const engine = new MockInferenceEngine();
    for (let i = 0; i < 5; i++) {
      engine.pushResponse({
        toolCalls: [
          {
            type: 'function',
            id: `call_${i}`,
            function: { name: 'calculator', arguments: '{"expression":"1+1"}' },
          },
        ],
      });
    }
    const model = makeModel(engine, [calcSkill]);

    const { stream } = await model.doStream({
      prompt: userPrompt('loop'),
      providerOptions: { gemma: { maxChainDepth: 2 } },
    });
    await collectStream(stream);

    expect(engine.generateCallArgs.length).toBe(2);
  });

  it('providerOptions.gemma.skillRouting=bm25 filters tools by query relevance', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'ok', content: 'ok' });
    const model = makeModel(engine, [calcSkill, wikiSkill, searchSkill]);

    const { stream } = await model.doStream({
      prompt: userPrompt('calculate 2+2'),
      providerOptions: {
        gemma: { skillRouting: 'bm25', maxToolsPerInvocation: 1 },
      },
    });
    await collectStream(stream);

    const tools = engine.generateCallArgs[0].options?.tools;
    expect(tools).toHaveLength(1);
    expect(tools![0].function.name).toBe('calculator');
  });

  it('emits stream-start warning when context usage is at or above threshold', async () => {
    const engine = new MockInferenceEngine();
    engine.setStaticUsage({ used: 3500, total: 4096, percent: 85 });
    engine.pushResponse({ text: 'hi', content: 'hi' });
    const model = makeModel(engine, []);

    const { stream } = await model.doStream({ prompt: userPrompt('hi') });
    const parts = await collectStream(stream);

    const start = parts[0] as Extract<
      LanguageModelV3StreamPart,
      { type: 'stream-start' }
    >;
    expect(
      start.warnings.some(
        (w) => w.type === 'other' && w.message.includes('85%'),
      ),
    ).toBe(true);
  });

  it('forwards consumer tools to the engine alongside provider-executed skills', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'hi', content: 'hi' });
    const model = makeModel(engine, [calcSkill]);

    const consumerTool: LanguageModelV3FunctionTool = {
      type: 'function',
      name: 'external_api',
      description: 'Call an external API',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
      },
    };

    const { stream } = await model.doStream({
      prompt: userPrompt('hi'),
      tools: [consumerTool],
    });
    await collectStream(stream);

    const tools = engine.generateCallArgs[0].options?.tools;
    expect(tools).toBeDefined();
    const names = tools!.map((t) => t.function.name);
    expect(names).toContain('calculator');
    expect(names).toContain('external_api');
  });

  it('warns and drops consumer tool when name collides with a registered skill', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'ok', content: 'ok' });
    const model = makeModel(engine, [calcSkill]);

    const colliding: LanguageModelV3FunctionTool = {
      type: 'function',
      name: 'calculator',
      description: 'A different calculator',
      inputSchema: {
        type: 'object',
        properties: { x: { type: 'string' } },
      },
    };

    const { stream } = await model.doStream({
      prompt: userPrompt('math'),
      tools: [colliding],
    });
    const parts = await collectStream(stream);

    const start = parts[0] as Extract<
      LanguageModelV3StreamPart,
      { type: 'stream-start' }
    >;
    expect(
      start.warnings.some(
        (w) =>
          w.type === 'other' &&
          w.message.toLowerCase().includes('calculator') &&
          w.message.toLowerCase().includes('precedence'),
      ),
    ).toBe(true);
  });

  it('finish part carries providerMetadata.gemma with timings and contextUsage', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'hi', content: 'hi' });
    engine.setStaticUsage({ used: 100, total: 4096, percent: 2 });
    const model = makeModel(engine, []);

    const { stream } = await model.doStream({ prompt: userPrompt('hi') });
    const parts = await collectStream(stream);

    const finish = parts[parts.length - 1] as Extract<
      LanguageModelV3StreamPart,
      { type: 'finish' }
    >;
    expect(finish.providerMetadata).toBeDefined();
    const gemma = finish.providerMetadata!.gemma as {
      timings: { promptMs: number; predictedMs: number };
      contextUsage: { total: number };
    };
    expect(gemma.timings.promptMs).toBe(100);
    expect(gemma.timings.predictedMs).toBe(200);
    expect(gemma.contextUsage.total).toBe(4096);
  });

  it('doGenerate returns content array with text part for a text-only turn', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse(
      { text: 'Hello there', content: 'Hello there' },
      ['Hello ', 'there'],
    );
    const model = makeModel(engine, []);

    const result = await model.doGenerate({ prompt: userPrompt('hi') });

    expect(result.finishReason.unified).toBe('stop');
    const textParts = result.content.filter((c) => c.type === 'text');
    expect(textParts.length).toBeGreaterThan(0);
    expect(result.usage.inputTokens.total).toBe(10);
    expect(result.usage.outputTokens.total).toBe(20);
    expect(result.providerMetadata?.gemma).toBeDefined();
  });

  it('doGenerate content includes tool-call and tool-result for a skill turn', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({
      toolCalls: [
        {
          type: 'function',
          id: 'call_0',
          function: { name: 'calculator', arguments: '{"expression":"5*5"}' },
        },
      ],
    });
    engine.pushResponse(
      { text: '25', content: '25' },
      ['25'],
    );
    const model = makeModel(engine, [calcSkill]);

    const result = await model.doGenerate({
      prompt: userPrompt('what is 5*5'),
    });

    const toolCalls = result.content.filter((c) => c.type === 'tool-call');
    const toolResults = result.content.filter((c) => c.type === 'tool-result');
    expect(toolCalls.length).toBe(1);
    expect(toolResults.length).toBe(1);
    expect((toolResults[0] as { result: unknown }).result).toBe('25');
  });

  it('sends all skills when skillRouting defaults to "all"', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'ok', content: 'ok' });
    const model = makeModel(engine, [calcSkill, wikiSkill, searchSkill]);

    const { stream } = await model.doStream({ prompt: userPrompt('hello') });
    await collectStream(stream);

    const tools = engine.generateCallArgs[0].options?.tools;
    expect(tools).toHaveLength(3);
  });

  it('drops provider tools with a warning', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'ok', content: 'ok' });
    const model = makeModel(engine, []);

    const { stream } = await model.doStream({
      prompt: userPrompt('hi'),
      tools: [
        {
          type: 'provider',
          id: 'openai.web_search',
          name: 'web_search',
          args: {},
        },
      ],
    });
    const parts = await collectStream(stream);

    const start = parts[0] as Extract<
      LanguageModelV3StreamPart,
      { type: 'stream-start' }
    >;
    expect(
      start.warnings.some(
        (w) =>
          w.type === 'other' &&
          w.message.toLowerCase().includes('web_search'),
      ),
    ).toBe(true);
  });
});
