import type {
  LanguageModelV3CallOptions,
  LanguageModelV3FunctionTool,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';
import { createGemmaProvider } from '../ai/createGemmaProvider';
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

const notesSkill: SkillManifest = {
  name: 'local_notes',
  description: 'Search saved notes',
  version: '1.0.0',
  type: 'native',
  requiresNetwork: false,
  parameters: { query: { type: 'string' } },
  execute: async () => ({ result: '' }),
};

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

describe('createGemmaProvider — factory shape', () => {
  it('throws when engine is missing', () => {
    expect(() =>
      // @ts-expect-error deliberately missing engine
      createGemmaProvider({}),
    ).toThrow(/engine is required/);
  });

  it('returns a callable provider that produces GemmaLanguageModel', () => {
    const engine = new MockInferenceEngine();
    const provider = createGemmaProvider({ engine: engine as never });
    const model = provider('gemma-4-e2b');
    expect(model).toBeInstanceOf(GemmaLanguageModel);
    expect(model.modelId).toBe('gemma-4-e2b');
    expect(model.provider).toBe('gemma');
    expect(model.specificationVersion).toBe('v3');
  });

  it('exposes .languageModel() equivalent to the callable form', () => {
    const engine = new MockInferenceEngine();
    const provider = createGemmaProvider({ engine: engine as never });
    const a = provider('gemma-4-e4b');
    const b = provider.languageModel('gemma-4-e4b');
    expect(a.modelId).toBe(b.modelId);
    expect(a.modelId).toBe('gemma-4-e4b');
  });

  it('defaults modelId when none is passed', () => {
    const engine = new MockInferenceEngine();
    const provider = createGemmaProvider({ engine: engine as never });
    expect(provider().modelId).toBe('gemma-4-e2b');
  });

  it('creates a default registry when none is supplied', () => {
    const engine = new MockInferenceEngine();
    const provider = createGemmaProvider({ engine: engine as never });
    const model = provider();
    expect(model).toBeInstanceOf(GemmaLanguageModel);
  });

  it('shares the supplied registry across all models it creates', () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'ok', content: 'ok' });
    const registry = new SkillRegistry();
    registry.registerSkill(calcSkill);
    const provider = createGemmaProvider({
      engine: engine as never,
      registry,
    });
    const model = provider();
    return model
      .doStream({ prompt: userPrompt('hi') })
      .then((r) => collectStream(r.stream))
      .then(() => {
        const tools = engine.generateCallArgs[0].options?.tools;
        expect(tools).toHaveLength(1);
        expect(tools![0].function.name).toBe('calculator');
      });
  });

  it('merges provider defaults with per-model opts, per-model winning', async () => {
    const engine = new MockInferenceEngine();
    for (let i = 0; i < 6; i++) {
      engine.pushResponse({
        toolCalls: [
          {
            type: 'function',
            id: `call_${i}`,
            function: {
              name: 'calculator',
              arguments: '{"expression":"1+1"}',
            },
          },
        ],
      });
    }
    const registry = new SkillRegistry();
    registry.registerSkill(calcSkill);

    const provider = createGemmaProvider({
      engine: engine as never,
      registry,
      defaults: { maxChainDepth: 5 },
    });
    const model = provider(undefined, { maxChainDepth: 1 });

    const { stream } = await model.doStream({ prompt: userPrompt('loop') });
    await collectStream(stream);

    expect(engine.generateCallArgs.length).toBe(1);
  });
});

describe('createGemmaProvider — consumer-tool coexistence', () => {
  it('forwards a consumer tool to the engine tool list', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'hi', content: 'hi' });
    const registry = new SkillRegistry();
    registry.registerSkill(calcSkill);
    const provider = createGemmaProvider({
      engine: engine as never,
      registry,
    });

    const externalTool: LanguageModelV3FunctionTool = {
      type: 'function',
      name: 'weather',
      description: 'Get weather',
      inputSchema: {
        type: 'object',
        properties: { city: { type: 'string' } },
      },
    };

    const { stream } = await provider().doStream({
      prompt: userPrompt('hi'),
      tools: [externalTool],
    });
    await collectStream(stream);

    const tools = engine.generateCallArgs[0].options?.tools;
    const names = tools!.map((t) => t.function.name);
    expect(names).toEqual(expect.arrayContaining(['calculator', 'weather']));
  });

  it('terminates the loop on a consumer tool-call without emitting tool-result', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({
      toolCalls: [
        {
          type: 'function',
          id: 'call_0',
          function: {
            name: 'weather',
            arguments: '{"city":"Paris"}',
          },
        },
      ],
    });
    const registry = new SkillRegistry();
    const provider = createGemmaProvider({
      engine: engine as never,
      registry,
    });

    const externalTool: LanguageModelV3FunctionTool = {
      type: 'function',
      name: 'weather',
      description: 'Get weather',
      inputSchema: {
        type: 'object',
        properties: { city: { type: 'string' } },
      },
    };

    const { stream } = await provider().doStream({
      prompt: userPrompt('weather in Paris'),
      tools: [externalTool],
    });
    const parts = await collectStream(stream);

    const toolCall = parts.find((p) => p.type === 'tool-call') as Extract<
      LanguageModelV3StreamPart,
      { type: 'tool-call' }
    >;
    expect(toolCall).toBeDefined();
    expect(toolCall.toolName).toBe('weather');
    expect(toolCall.providerExecuted).toBe(false);

    const toolResult = parts.find((p) => p.type === 'tool-result');
    expect(toolResult).toBeUndefined();

    const finish = parts[parts.length - 1] as Extract<
      LanguageModelV3StreamPart,
      { type: 'finish' }
    >;
    expect(finish.type).toBe('finish');
    expect(finish.finishReason.unified).toBe('tool-calls');
  });

  it('keeps running the loop when a skill is called (provider-executed)', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({
      toolCalls: [
        {
          type: 'function',
          id: 'call_0',
          function: {
            name: 'calculator',
            arguments: '{"expression":"2+2"}',
          },
        },
      ],
    });
    engine.pushResponse({ text: '4', content: '4' }, ['4']);
    const registry = new SkillRegistry();
    registry.registerSkill(calcSkill);
    const provider = createGemmaProvider({
      engine: engine as never,
      registry,
    });

    const { stream } = await provider().doStream({
      prompt: userPrompt('what is 2+2'),
    });
    const parts = await collectStream(stream);

    const toolResult = parts.find((p) => p.type === 'tool-result');
    expect(toolResult).toBeDefined();

    expect(engine.generateCallArgs.length).toBe(2);
  });

  it('collision: skill name shadows consumer tool, consumer dropped with warning', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'ok', content: 'ok' });
    const registry = new SkillRegistry();
    registry.registerSkill(calcSkill);
    const provider = createGemmaProvider({
      engine: engine as never,
      registry,
    });

    const colliding: LanguageModelV3FunctionTool = {
      type: 'function',
      name: 'calculator',
      description: 'Different calc',
      inputSchema: {
        type: 'object',
        properties: { x: { type: 'string' } },
      },
    };

    const { stream } = await provider().doStream({
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

    const tools = engine.generateCallArgs[0].options?.tools;
    expect(tools).toHaveLength(1);
    expect(tools![0].function.name).toBe('calculator');
    expect(tools![0].function.description).toBe('Math calculator');
  });

  it('consumer tool inputSchema is translated into llama.rn parameters shape', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'ok', content: 'ok' });
    const provider = createGemmaProvider({ engine: engine as never });

    const schemaRich: LanguageModelV3FunctionTool = {
      type: 'function',
      name: 'search',
      description: 'search docs',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'query string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    };

    const { stream } = await provider().doStream({
      prompt: userPrompt('x'),
      tools: [schemaRich],
    });
    await collectStream(stream);

    const tools = engine.generateCallArgs[0].options?.tools!;
    const sent = tools.find((t) => t.function.name === 'search')!;
    expect(sent.function.parameters.properties.query).toBeDefined();
    expect(sent.function.parameters.required).toEqual(['query']);
  });
});

describe('createGemmaProvider — knowledgeStore wiring', () => {
  const FAKE_INDEX = '- Note A [tag1]: first line\n- Note B: second line';

  type FakeStore = { getIndex: () => Promise<string> };

  it('does not touch system prompt when knowledgeStore is absent', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'ok', content: 'ok' });
    const provider = createGemmaProvider({ engine: engine as never });

    const { stream } = await provider().doStream({
      prompt: userPrompt('hi'),
    });
    await collectStream(stream);

    const systemMsg = engine.generateCallArgs[0].messages[0];
    expect(systemMsg.role).toBe('system');
    expect(systemMsg.content).not.toContain('Saved Notes');
  });

  it('does not touch system prompt when local_notes skill is not registered', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'ok', content: 'ok' });
    const fakeStore: FakeStore = { getIndex: async () => FAKE_INDEX };
    const provider = createGemmaProvider({
      engine: engine as never,
      knowledgeStore: fakeStore as never,
    });

    const { stream } = await provider().doStream({
      prompt: userPrompt('hi'),
    });
    await collectStream(stream);

    const systemMsg = engine.generateCallArgs[0].messages[0];
    expect(systemMsg.content).not.toContain('Saved Notes');
  });

  it('appends notes index to system prompt when local_notes is registered', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'ok', content: 'ok' });
    const registry = new SkillRegistry();
    registry.registerSkill(notesSkill);
    const fakeStore: FakeStore = { getIndex: async () => FAKE_INDEX };
    const provider = createGemmaProvider({
      engine: engine as never,
      registry,
      knowledgeStore: fakeStore as never,
    });

    const { stream } = await provider().doStream({
      prompt: userPrompt('hi'),
    });
    await collectStream(stream);

    const systemMsg = engine.generateCallArgs[0].messages[0];
    expect(systemMsg.content).toContain('Saved Notes');
    expect(systemMsg.content).toContain('<!-- notes-start -->');
    expect(systemMsg.content).toContain('<!-- notes-end -->');
    expect(systemMsg.content).toContain('Note A');
  });

  it('omits notes block when store returns an empty index', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'ok', content: 'ok' });
    const registry = new SkillRegistry();
    registry.registerSkill(notesSkill);
    const fakeStore: FakeStore = { getIndex: async () => '' };
    const provider = createGemmaProvider({
      engine: engine as never,
      registry,
      knowledgeStore: fakeStore as never,
    });

    const { stream } = await provider().doStream({
      prompt: userPrompt('hi'),
    });
    await collectStream(stream);

    const systemMsg = engine.generateCallArgs[0].messages[0];
    expect(systemMsg.content).not.toContain('Saved Notes');
  });
});

describe('createGemmaProvider — providerOptions passthrough', () => {
  it('activeCategories from providerOptions filters tools', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'ok', content: 'ok' });
    const registry = new SkillRegistry();
    registry.registerSkill({ ...calcSkill, category: 'utility' });
    registry.registerSkill({
      name: 'wiki',
      description: 'Search wiki',
      version: '1.0.0',
      type: 'native',
      parameters: {},
      execute: async () => ({ result: '' }),
      category: 'research',
    });
    const provider = createGemmaProvider({
      engine: engine as never,
      registry,
    });

    const { stream } = await provider().doStream({
      prompt: userPrompt('x'),
      providerOptions: { gemma: { activeCategories: ['utility'] } },
    });
    await collectStream(stream);

    const tools = engine.generateCallArgs[0].options?.tools!;
    const names = tools.map((t) => t.function.name);
    expect(names).toEqual(['calculator']);
  });

  it('defaults.activeCategories filter when providerOptions omits it', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'ok', content: 'ok' });
    const registry = new SkillRegistry();
    registry.registerSkill({ ...calcSkill, category: 'utility' });
    registry.registerSkill({
      name: 'wiki',
      description: 'Search wiki',
      version: '1.0.0',
      type: 'native',
      parameters: {},
      execute: async () => ({ result: '' }),
      category: 'research',
    });
    const provider = createGemmaProvider({
      engine: engine as never,
      registry,
      defaults: { activeCategories: ['research'] },
    });

    const { stream } = await provider().doStream({ prompt: userPrompt('x') });
    await collectStream(stream);

    const tools = engine.generateCallArgs[0].options?.tools!;
    expect(tools.map((t) => t.function.name)).toEqual(['wiki']);
  });

  it('downgrades toolChoice=required with a warning', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'ok', content: 'ok' });
    const provider = createGemmaProvider({ engine: engine as never });

    const { stream } = await provider().doStream({
      prompt: userPrompt('x'),
      toolChoice: { type: 'required' },
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
          w.message.toLowerCase().includes("'required'"),
      ),
    ).toBe(true);
  });

  it('downgrades toolChoice={type:"tool"} with a warning naming the tool', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ text: 'ok', content: 'ok' });
    const registry = new SkillRegistry();
    registry.registerSkill(calcSkill);
    const provider = createGemmaProvider({
      engine: engine as never,
      registry,
    });

    const { stream } = await provider().doStream({
      prompt: userPrompt('x'),
      toolChoice: { type: 'tool', toolName: 'calculator' },
    });
    const parts = await collectStream(stream);

    const start = parts[0] as Extract<
      LanguageModelV3StreamPart,
      { type: 'stream-start' }
    >;
    expect(
      start.warnings.some(
        (w) =>
          w.type === 'other' && w.message.includes('calculator'),
      ),
    ).toBe(true);
  });
});

describe('createGemmaProvider — subpath surface', () => {
  it('index.ts re-exports createGemmaProvider, GemmaLanguageModel, and helpers', async () => {
    const subpath = await import('../ai');
    expect(typeof subpath.createGemmaProvider).toBe('function');
    expect(typeof subpath.GemmaLanguageModel).toBe('function');
    expect(typeof subpath.convertFinishReason).toBe('function');
    expect(typeof subpath.prepareMessages).toBe('function');
    expect(typeof subpath.skillResultToToolOutput).toBe('function');
    expect(typeof subpath.v3ToolToToolDefinition).toBe('function');
    expect(typeof subpath.separateProviderAndConsumerTools).toBe('function');
  });
});
