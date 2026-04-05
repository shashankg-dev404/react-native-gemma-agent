import { AgentOrchestrator } from '../AgentOrchestrator';
import { SkillRegistry } from '../SkillRegistry';
import type {
  CompletionResult,
  Message,
  GenerateOptions,
  TokenEvent,
  SkillManifest,
  AgentEvent,
} from '../types';

/**
 * Minimal mock of InferenceEngine for trajectory tests.
 * Each test sets up a sequence of responses the "model" will return.
 */
class MockInferenceEngine {
  isLoaded = true;
  isGenerating = false;

  private responses: CompletionResult[] = [];
  private callIndex = 0;
  generateCallArgs: Array<{ messages: Message[]; options?: GenerateOptions }> =
    [];

  pushResponse(response: Partial<CompletionResult>): void {
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
  }

  async generate(
    messages: Message[],
    options?: GenerateOptions,
    _onToken?: (event: TokenEvent) => void,
  ): Promise<CompletionResult> {
    this.generateCallArgs.push({ messages, options });
    if (this.callIndex >= this.responses.length) {
      throw new Error('MockInferenceEngine: no more responses queued');
    }
    return this.responses[this.callIndex++];
  }

  getContextUsage() {
    return { used: 30, total: 4096, percent: 1 };
  }

  async stopGeneration() {}
  async unload() {}
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
  execute: async (params) => ({ result: String(eval(String(params.expression))) }),
};

const failingSkill: SkillManifest = {
  name: 'failing_skill',
  description: 'Always fails',
  version: '1.0.0',
  type: 'native',
  parameters: {},
  execute: async () => {
    throw new Error('Skill exploded');
  },
};

const networkSkill: SkillManifest = {
  name: 'network_skill',
  description: 'Needs network',
  version: '1.0.0',
  type: 'native',
  requiresNetwork: true,
  parameters: {},
  execute: async () => ({ result: 'online data' }),
};

function makeOrchestrator(
  engine: MockInferenceEngine,
  skills: SkillManifest[],
  config?: Record<string, unknown>,
) {
  const registry = new SkillRegistry();
  for (const s of skills) {
    registry.registerSkill(s);
  }
  return new AgentOrchestrator(
    engine as any,
    registry,
    config as any,
  );
}

// Mock global fetch for connectivity checks
const originalFetch = global.fetch;

describe('AgentOrchestrator', () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns direct response when model makes no tool calls', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ content: 'Hello! How can I help?', text: 'Hello! How can I help?' });

    const orchestrator = makeOrchestrator(engine, [calcSkill]);
    const result = await orchestrator.sendMessage('hi');

    expect(result).toBe('Hello! How can I help?');
    expect(orchestrator.conversation).toHaveLength(2); // user + assistant
  });

  it('executes tool call and feeds result back to model', async () => {
    const engine = new MockInferenceEngine();

    // First response: model wants to call calculator
    engine.pushResponse({
      text: '',
      content: '',
      toolCalls: [
        {
          type: 'function',
          id: 'call_0',
          function: { name: 'calculator', arguments: '{"expression":"2+2"}' },
        },
      ],
    });

    // Second response: model answers with the result
    engine.pushResponse({
      text: 'The answer is 4.',
      content: 'The answer is 4.',
    });

    const orchestrator = makeOrchestrator(engine, [calcSkill]);
    const events: AgentEvent[] = [];
    const result = await orchestrator.sendMessage('what is 2+2', (e) =>
      events.push(e),
    );

    expect(result).toBe('The answer is 4.');
    expect(events.some((e) => e.type === 'skill_called')).toBe(true);
    expect(events.some((e) => e.type === 'skill_result')).toBe(true);
    expect(events.some((e) => e.type === 'response')).toBe(true);

    // Should have: user, assistant (tool_calls), tool, assistant (final)
    expect(orchestrator.conversation).toHaveLength(4);
  });

  it('handles skill execution failure gracefully', async () => {
    const engine = new MockInferenceEngine();

    engine.pushResponse({
      text: '',
      content: '',
      toolCalls: [
        {
          type: 'function',
          id: 'call_0',
          function: { name: 'failing_skill', arguments: '{}' },
        },
      ],
    });

    engine.pushResponse({
      text: 'Sorry, the skill failed.',
      content: 'Sorry, the skill failed.',
    });

    const orchestrator = makeOrchestrator(engine, [failingSkill]);
    const result = await orchestrator.sendMessage('do something');

    expect(result).toBe('Sorry, the skill failed.');

    // The tool message should contain the error
    const toolMsg = orchestrator.conversation.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('Error:');
    expect(toolMsg?.content).toContain('Skill exploded');
  });

  it('stops at max chain depth', async () => {
    const engine = new MockInferenceEngine();

    // Model keeps calling tools forever
    for (let i = 0; i < 5; i++) {
      engine.pushResponse({
        text: '',
        content: '',
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

    const orchestrator = makeOrchestrator(engine, [calcSkill], {
      maxChainDepth: 3,
    });
    const result = await orchestrator.sendMessage('loop forever');

    expect(result).toContain('maximum chain depth');
    expect(engine.generateCallArgs.length).toBe(3);
  });

  it('thinking text is NOT stored in assistant message content', async () => {
    const engine = new MockInferenceEngine();

    engine.pushResponse({
      text: 'thought\nLet me think...',
      content: '',
      reasoning: 'Let me think...',
      toolCalls: [
        {
          type: 'function',
          id: 'call_0',
          function: { name: 'calculator', arguments: '{"expression":"1+1"}' },
        },
      ],
    });

    engine.pushResponse({
      text: 'The answer is 2.',
      content: 'The answer is 2.',
    });

    const orchestrator = makeOrchestrator(engine, [calcSkill]);
    await orchestrator.sendMessage('what is 1+1');

    // The assistant message with tool_calls should have empty content
    const assistantWithTools = orchestrator.conversation.find(
      (m) => m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0,
    );
    expect(assistantWithTools?.content).toBe('');
  });

  it('throws when sendMessage called while processing', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({
      text: 'delayed',
      content: 'delayed',
    });

    const orchestrator = makeOrchestrator(engine, []);
    const p1 = orchestrator.sendMessage('first');

    await expect(orchestrator.sendMessage('second')).rejects.toThrow(
      'Already processing',
    );

    await p1;
  });

  it('reset clears conversation history', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ content: 'hi', text: 'hi' });

    const orchestrator = makeOrchestrator(engine, []);
    await orchestrator.sendMessage('hello');
    expect(orchestrator.conversation.length).toBeGreaterThan(0);

    orchestrator.reset();
    expect(orchestrator.conversation).toHaveLength(0);
  });

  describe('BM25 routing', () => {
    const wikiSkill: SkillManifest = {
      name: 'query_wikipedia',
      description: 'Search Wikipedia for factual information about any topic.',
      version: '1.0.0',
      type: 'js',
      parameters: { query: { type: 'string' } },
      html: '<html></html>',
      instructions: 'Use for factual questions.',
    };

    const searchSkill: SkillManifest = {
      name: 'web_search',
      description: 'Search the web for current information.',
      version: '1.0.0',
      type: 'js',
      parameters: { query: { type: 'string' } },
      html: '<html></html>',
    };

    it('sends only top-N skills when bm25 routing is enabled', async () => {
      const engine = new MockInferenceEngine();
      engine.pushResponse({ content: 'ok', text: 'ok' });

      const orchestrator = makeOrchestrator(
        engine,
        [calcSkill, wikiSkill, searchSkill],
        { skillRouting: 'bm25', maxToolsPerInvocation: 1 },
      );
      await orchestrator.sendMessage('calculate 2+2');

      // Should have sent only 1 tool to the engine
      const tools = engine.generateCallArgs[0].options?.tools;
      expect(tools).toBeDefined();
      expect(tools!.length).toBe(1);
      expect(tools![0].function.name).toBe('calculator');
    });

    it('sends all skills when routing is "all"', async () => {
      const engine = new MockInferenceEngine();
      engine.pushResponse({ content: 'ok', text: 'ok' });

      const orchestrator = makeOrchestrator(
        engine,
        [calcSkill, wikiSkill, searchSkill],
        { skillRouting: 'all' },
      );
      await orchestrator.sendMessage('hello');

      const tools = engine.generateCallArgs[0].options?.tools;
      expect(tools).toHaveLength(3);
    });

    it('sends all skills when count <= maxToolsPerInvocation', async () => {
      const engine = new MockInferenceEngine();
      engine.pushResponse({ content: 'ok', text: 'ok' });

      const orchestrator = makeOrchestrator(
        engine,
        [calcSkill],
        { skillRouting: 'bm25', maxToolsPerInvocation: 5 },
      );
      await orchestrator.sendMessage('math');

      // Only 1 skill registered, less than max 5 — should send all
      const tools = engine.generateCallArgs[0].options?.tools;
      expect(tools).toHaveLength(1);
    });
  });

  describe('network awareness', () => {
    it('blocks network skills when offline', async () => {
      // Mock fetch to fail (offline)
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const engine = new MockInferenceEngine();
      engine.pushResponse({
        text: '',
        content: '',
        toolCalls: [
          {
            type: 'function',
            id: 'call_0',
            function: { name: 'network_skill', arguments: '{}' },
          },
        ],
      });
      engine.pushResponse({
        text: 'No internet available.',
        content: 'No internet available.',
      });

      const orchestrator = makeOrchestrator(engine, [networkSkill]);
      await orchestrator.sendMessage('fetch data');

      const toolMsg = orchestrator.conversation.find((m) => m.role === 'tool');
      expect(toolMsg?.content).toContain('No internet connection');
    });

    it('allows offline skills regardless of connectivity', async () => {
      // Mock fetch to fail (offline)
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      const engine = new MockInferenceEngine();
      engine.pushResponse({
        text: '',
        content: '',
        toolCalls: [
          {
            type: 'function',
            id: 'call_0',
            function: {
              name: 'calculator',
              arguments: '{"expression":"3+3"}',
            },
          },
        ],
      });
      engine.pushResponse({
        text: 'The answer is 6.',
        content: 'The answer is 6.',
      });

      const orchestrator = makeOrchestrator(engine, [calcSkill]);
      const result = await orchestrator.sendMessage('what is 3+3');

      expect(result).toBe('The answer is 6.');
      const toolMsg = orchestrator.conversation.find((m) => m.role === 'tool');
      expect(toolMsg?.content).toBe('6');
    });
  });
});
