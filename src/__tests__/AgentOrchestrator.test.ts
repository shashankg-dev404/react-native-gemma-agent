import { AgentOrchestrator } from '../AgentOrchestrator';
import { SkillRegistry } from '../SkillRegistry';
import type {
  CompletionResult,
  ContextUsage,
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
  // Optional per-call context usage queue — if set, the orchestrator sees
  // a different usage value after each generation. When empty, defaults
  // to a static low usage value.
  private usageQueue: Array<{ used: number; total: number; percent: number }> =
    [];
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

  pushUsage(percent: number, total = 4096): void {
    const used = Math.round((percent / 100) * total);
    this.usageQueue.push({ used, total, percent });
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
    // After each generate() the orchestrator calls this. Shift the next
    // queued usage value. When the queue is empty, return the last value
    // (so repeated reads after the final generation see the same number).
    if (this.usageQueue.length > 0) {
      // callIndex was already incremented in generate(); we want the
      // entry corresponding to the MOST RECENT generation (callIndex - 1).
      const idx = Math.min(this.callIndex - 1, this.usageQueue.length - 1);
      if (idx < 0) {
        return { used: 0, total: 4096, percent: 0 };
      }
      return this.usageQueue[idx];
    }
    return { used: 30, total: 4096, percent: 1 };
  }

  resetContextUsage = jest.fn();

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

  describe('context warning', () => {
    it('fires onContextWarning once when crossing the default 80% threshold', async () => {
      const engine = new MockInferenceEngine();
      engine.pushResponse({ content: 'reply', text: 'reply' });
      engine.pushUsage(82);

      const warnings: ContextUsage[] = [];
      const orchestrator = makeOrchestrator(engine, [], {
        onContextWarning: (usage: ContextUsage) => warnings.push(usage),
      });

      const events: AgentEvent[] = [];
      await orchestrator.sendMessage('hello', (e) => events.push(e));

      expect(warnings).toHaveLength(1);
      expect(warnings[0].percent).toBe(82);
      expect(events.filter((e) => e.type === 'context_warning')).toHaveLength(1);
    });

    it('does NOT fire when usage stays below threshold', async () => {
      const engine = new MockInferenceEngine();
      engine.pushResponse({ content: 'reply', text: 'reply' });
      engine.pushUsage(50);

      const warnings: unknown[] = [];
      const orchestrator = makeOrchestrator(engine, [], {
        onContextWarning: () => warnings.push(1),
      });

      const events: AgentEvent[] = [];
      await orchestrator.sendMessage('hello', (e) => events.push(e));

      expect(warnings).toHaveLength(0);
      expect(events.some((e) => e.type === 'context_warning')).toBe(false);
    });

    it('does not re-fire on subsequent messages while still above threshold', async () => {
      const engine = new MockInferenceEngine();
      engine.pushResponse({ content: 'first', text: 'first' });
      engine.pushResponse({ content: 'second', text: 'second' });
      engine.pushResponse({ content: 'third', text: 'third' });
      engine.pushUsage(85);
      engine.pushUsage(90);
      engine.pushUsage(95);

      const warnings: unknown[] = [];
      const orchestrator = makeOrchestrator(engine, [], {
        onContextWarning: () => warnings.push(1),
      });

      await orchestrator.sendMessage('one');
      await orchestrator.sendMessage('two');
      await orchestrator.sendMessage('three');

      // Only the first crossing counts
      expect(warnings).toHaveLength(1);
    });

    it('re-fires after reset() + re-crossing threshold', async () => {
      const engine = new MockInferenceEngine();
      engine.pushResponse({ content: 'first', text: 'first' });
      engine.pushResponse({ content: 'second', text: 'second' });
      engine.pushUsage(85);
      engine.pushUsage(81);

      const warnings: unknown[] = [];
      const orchestrator = makeOrchestrator(engine, [], {
        onContextWarning: () => warnings.push(1),
      });

      await orchestrator.sendMessage('one');
      expect(warnings).toHaveLength(1);

      orchestrator.reset();
      await orchestrator.sendMessage('two');

      // Warning should fire a second time after reset
      expect(warnings).toHaveLength(2);
    });

    it('honors a custom threshold (e.g. 0.5)', async () => {
      const engine = new MockInferenceEngine();
      engine.pushResponse({ content: 'reply', text: 'reply' });
      engine.pushUsage(55);

      const warnings: unknown[] = [];
      const orchestrator = makeOrchestrator(engine, [], {
        contextWarningThreshold: 0.5,
        onContextWarning: () => warnings.push(1),
      });

      await orchestrator.sendMessage('hello');
      expect(warnings).toHaveLength(1);
    });

    it('reset() clears context warning state and allows re-firing', async () => {
      const engine = new MockInferenceEngine();
      engine.pushResponse({ content: 'a', text: 'a' });
      engine.pushResponse({ content: 'b', text: 'b' });
      engine.pushUsage(85);
      engine.pushUsage(85);

      let fired = 0;
      const orchestrator = makeOrchestrator(engine, [], {
        onContextWarning: () => {
          fired++;
        },
      });

      await orchestrator.sendMessage('first');
      expect(fired).toBe(1);

      // Without reset, a second message above threshold should NOT re-fire
      // (but mock only has one usage entry — emulate by pushing another).
      // Instead verify reset path:
      orchestrator.reset();
      expect(orchestrator.conversation).toHaveLength(0);

      await orchestrator.sendMessage('second');
      expect(fired).toBe(2);
    });

    it('emits context_warning event even without callback', async () => {
      const engine = new MockInferenceEngine();
      engine.pushResponse({ content: 'reply', text: 'reply' });
      engine.pushUsage(81);

      const orchestrator = makeOrchestrator(engine, []);
      const events: AgentEvent[] = [];
      await orchestrator.sendMessage('hi', (e) => events.push(e));

      const warning = events.find((e) => e.type === 'context_warning');
      expect(warning).toBeDefined();
      if (warning && warning.type === 'context_warning') {
        expect(warning.usage.percent).toBe(81);
      }
    });

    it('swallows errors thrown by onContextWarning callback', async () => {
      const engine = new MockInferenceEngine();
      engine.pushResponse({ content: 'reply', text: 'reply' });
      engine.pushUsage(90);

      const orchestrator = makeOrchestrator(engine, [], {
        onContextWarning: () => {
          throw new Error('callback boom');
        },
      });

      // sendMessage should still resolve normally
      const result = await orchestrator.sendMessage('hi');
      expect(result).toBe('reply');
    });

    it('fires the 80% warning only when cumulative usage crosses the threshold', async () => {
      // Simulates cumulative KV-cache growth across three turns:
      // the warning must not fire on the 40% or 60% reads, only on 82%.
      const engine = new MockInferenceEngine();
      engine.pushResponse({ content: 'a', text: 'a' });
      engine.pushResponse({ content: 'b', text: 'b' });
      engine.pushResponse({ content: 'c', text: 'c' });
      engine.pushUsage(40);
      engine.pushUsage(60);
      engine.pushUsage(82);

      const fires: ContextUsage[] = [];
      const orchestrator = makeOrchestrator(engine, [], {
        onContextWarning: (usage: ContextUsage) => fires.push(usage),
      });

      await orchestrator.sendMessage('one');
      expect(fires).toHaveLength(0);
      await orchestrator.sendMessage('two');
      expect(fires).toHaveLength(0);
      await orchestrator.sendMessage('three');
      expect(fires).toHaveLength(1);
      expect(fires[0].percent).toBe(82);
    });

    it('reset() propagates to engine.resetContextUsage()', async () => {
      const engine = new MockInferenceEngine();
      const orchestrator = makeOrchestrator(engine, []);

      orchestrator.reset();
      expect(engine.resetContextUsage).toHaveBeenCalledTimes(1);
    });
  });

  describe('reasoning format wiring', () => {
    it('forwards enable_thinking and reasoning_format to engine.generate', async () => {
      const engine = new MockInferenceEngine();
      engine.pushResponse({ content: 'hello', text: 'hello' });

      const orchestrator = makeOrchestrator(engine, [], {
        enable_thinking: true,
        reasoning_format: 'qwen',
      });

      await orchestrator.sendMessage('hi');
      const opts = engine.generateCallArgs[0].options as any;
      expect(opts.enable_thinking).toBe(true);
      expect(opts.reasoning_format).toBe('qwen');
    });

    it('strips empty <think></think> blocks from visible response', async () => {
      const engine = new MockInferenceEngine();
      engine.pushResponse({
        content: '<think>\n\n</think>\n\nThe journey was 155 minutes long.',
        text: '<think>\n\n</think>\n\nThe journey was 155 minutes long.',
      });

      const orchestrator = makeOrchestrator(engine, [], {
        reasoning_format: 'qwen',
      });

      const response = await orchestrator.sendMessage('hi');
      expect(response).not.toContain('<think>');
      expect(response).not.toContain('</think>');
      expect(response).toContain('155 minutes');
    });

    it('strips populated <think>...</think> blocks from visible response', async () => {
      const engine = new MockInferenceEngine();
      engine.pushResponse({
        content: '<think>step 1: subtract 14:20 from 16:55</think>\n\nAnswer: 2h 35m',
        text: '<think>step 1: subtract 14:20 from 16:55</think>\n\nAnswer: 2h 35m',
      });

      const orchestrator = makeOrchestrator(engine, [], {
        reasoning_format: 'qwen',
      });

      const response = await orchestrator.sendMessage('hi');
      expect(response).not.toContain('<think>');
      expect(response).not.toContain('step 1');
      expect(response).toContain('2h 35m');
    });
  });
});
