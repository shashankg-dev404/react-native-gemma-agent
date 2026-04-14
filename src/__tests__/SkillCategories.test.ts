import { SkillRegistry } from '../SkillRegistry';
import type { SkillManifest, AgentEvent } from '../types';
import { AgentOrchestrator } from '../AgentOrchestrator';
import type { CompletionResult, Message, GenerateOptions, TokenEvent } from '../types';

// --- Test skills across 3 categories ---

const financeSkill: SkillManifest = {
  name: 'stock_price',
  description: 'Get stock price',
  version: '1.0.0',
  type: 'native',
  category: 'finance',
  parameters: { ticker: { type: 'string' } },
  execute: async () => ({ result: '$150' }),
};

const taxSkill: SkillManifest = {
  name: 'tax_calculator',
  description: 'Calculate tax',
  version: '1.0.0',
  type: 'native',
  category: 'finance',
  parameters: { amount: { type: 'string' } },
  execute: async () => ({ result: '$30' }),
};

const wikiSkill: SkillManifest = {
  name: 'query_wikipedia',
  description: 'Search Wikipedia for factual information about any topic.',
  version: '1.0.0',
  type: 'js',
  category: 'research',
  parameters: { query: { type: 'string' } },
  html: '<html></html>',
};

const webSearchSkill: SkillManifest = {
  name: 'web_search',
  description: 'Search the web for current information.',
  version: '1.0.0',
  type: 'js',
  category: 'research',
  parameters: { query: { type: 'string' } },
  html: '<html></html>',
};

const calcSkill: SkillManifest = {
  name: 'calculator',
  description: 'Math calculator',
  version: '1.0.0',
  type: 'native',
  category: 'utility',
  parameters: { expression: { type: 'string' } },
  execute: async (params) => ({ result: String(eval(String(params.expression))) }),
};

const uncategorizedSkill: SkillManifest = {
  name: 'mystery_tool',
  description: 'A tool with no category',
  version: '1.0.0',
  type: 'native',
  parameters: {},
  execute: async () => ({ result: 'mystery' }),
};

const allSkills = [financeSkill, taxSkill, wikiSkill, webSearchSkill, calcSkill, uncategorizedSkill];

// --- Mock InferenceEngine ---

class MockInferenceEngine {
  isLoaded = true;
  isGenerating = false;
  private responses: CompletionResult[] = [];
  private callIndex = 0;
  generateCallArgs: Array<{ messages: Message[]; options?: GenerateOptions }> = [];

  pushResponse(response: Partial<CompletionResult>): void {
    this.responses.push({
      text: '',
      content: '',
      reasoning: null,
      toolCalls: [],
      timings: {
        promptTokens: 10, promptMs: 100, promptPerSecond: 100,
        predictedTokens: 20, predictedMs: 200, predictedPerSecond: 100,
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

  resetContextUsage = jest.fn();

  async stopGeneration() {}
  async unload() {}
  getInfo() {
    return { loaded: true, gpu: false, reasonNoGPU: null, description: null, nParams: null };
  }
}

// --- SkillRegistry Category Tests ---

describe('SkillRegistry — Categories', () => {
  let registry: SkillRegistry;

  beforeEach(() => {
    registry = new SkillRegistry();
    for (const s of allSkills) {
      registry.registerSkill(s);
    }
  });

  it('getCategories returns deduplicated category list', () => {
    const cats = registry.getCategories().sort();
    expect(cats).toEqual(['finance', 'research', 'uncategorized', 'utility']);
  });

  it('getSkillsByCategory returns correct skills for a category', () => {
    const finance = registry.getSkillsByCategory('finance');
    expect(finance.map(s => s.name).sort()).toEqual(['stock_price', 'tax_calculator']);
  });

  it('getSkillsByCategory returns uncategorized skills', () => {
    const uncat = registry.getSkillsByCategory('uncategorized');
    expect(uncat).toHaveLength(1);
    expect(uncat[0].name).toBe('mystery_tool');
  });

  it('getSkillsByCategory returns empty for unknown category', () => {
    expect(registry.getSkillsByCategory('nonexistent')).toEqual([]);
  });

  it('getSkillsForCategories with undefined returns all skills', () => {
    expect(registry.getSkillsForCategories(undefined)).toHaveLength(6);
  });

  it('getSkillsForCategories with empty array returns all skills', () => {
    expect(registry.getSkillsForCategories([])).toHaveLength(6);
  });

  it('getSkillsForCategories filters to specified categories', () => {
    const filtered = registry.getSkillsForCategories(['finance', 'utility']);
    const names = filtered.map(s => s.name).sort();
    expect(names).toEqual(['calculator', 'stock_price', 'tax_calculator']);
  });

  it('uncategorized skills included when "uncategorized" in activeCategories', () => {
    const filtered = registry.getSkillsForCategories(['uncategorized']);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('mystery_tool');
  });

  it('uncategorized skills excluded when activeCategories set without "uncategorized"', () => {
    const filtered = registry.getSkillsForCategories(['finance']);
    const names = filtered.map(s => s.name);
    expect(names).not.toContain('mystery_tool');
  });

  it('toToolDefinitions respects activeCategories filter', () => {
    const tools = registry.toToolDefinitions(['research']);
    expect(tools).toHaveLength(2);
    const names = tools.map(t => t.function.name).sort();
    expect(names).toEqual(['query_wikipedia', 'web_search']);
  });

  it('toToolDefinitions without filter returns all skills', () => {
    const tools = registry.toToolDefinitions();
    expect(tools).toHaveLength(6);
  });
});

// --- AgentOrchestrator Category Integration Tests ---

function makeOrchestrator(
  engine: MockInferenceEngine,
  skills: SkillManifest[],
  config?: Record<string, unknown>,
) {
  const registry = new SkillRegistry();
  for (const s of skills) {
    registry.registerSkill(s);
  }
  return new AgentOrchestrator(engine as any, registry, config as any);
}

describe('AgentOrchestrator — Category Filtering', () => {
  it('sends only skills from active categories', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ content: 'ok', text: 'ok' });

    const orchestrator = makeOrchestrator(
      engine,
      [calcSkill, wikiSkill, financeSkill],
      { activeCategories: ['utility'] },
    );
    await orchestrator.sendMessage('hello');

    const tools = engine.generateCallArgs[0].options?.tools;
    expect(tools).toHaveLength(1);
    expect(tools![0].function.name).toBe('calculator');
  });

  it('sends all skills when activeCategories is undefined', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ content: 'ok', text: 'ok' });

    const orchestrator = makeOrchestrator(
      engine,
      [calcSkill, wikiSkill, financeSkill],
      { activeCategories: undefined },
    );
    await orchestrator.sendMessage('hello');

    const tools = engine.generateCallArgs[0].options?.tools;
    expect(tools).toHaveLength(3);
  });

  it('sends no skills when activeCategories is empty array with no uncategorized', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ content: 'ok', text: 'ok' });

    // All skills have categories, empty activeCategories means "no filter" per spec
    // (empty array = all pass through)
    const orchestrator = makeOrchestrator(
      engine,
      [calcSkill, wikiSkill],
      { activeCategories: [] },
    );
    await orchestrator.sendMessage('hello');

    const tools = engine.generateCallArgs[0].options?.tools;
    // Empty array means no filter — all skills pass through
    expect(tools).toHaveLength(2);
  });

  it('category filter composes with BM25 routing', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ content: 'ok', text: 'ok' });

    // 3 skills in research + utility, filter to research only, then BM25 picks top 1
    const orchestrator = makeOrchestrator(
      engine,
      [calcSkill, wikiSkill, webSearchSkill],
      {
        activeCategories: ['research'],
        skillRouting: 'bm25',
        maxToolsPerInvocation: 1,
      },
    );
    await orchestrator.sendMessage('search for Einstein on Wikipedia');

    const tools = engine.generateCallArgs[0].options?.tools;
    expect(tools).toHaveLength(1);
    // Both are research, BM25 should rank wikipedia higher for this query
    expect(tools![0].function.name).toBe('query_wikipedia');
  });

  it('setActiveCategories changes filtering at runtime', async () => {
    const engine = new MockInferenceEngine();
    engine.pushResponse({ content: 'ok', text: 'ok' });
    engine.pushResponse({ content: 'ok', text: 'ok' });

    const orchestrator = makeOrchestrator(
      engine,
      [calcSkill, wikiSkill, financeSkill],
      { activeCategories: ['utility'] },
    );

    await orchestrator.sendMessage('first');
    let tools = engine.generateCallArgs[0].options?.tools;
    expect(tools).toHaveLength(1);
    expect(tools![0].function.name).toBe('calculator');

    // Switch to finance
    orchestrator.reset();
    orchestrator.setActiveCategories(['finance']);

    await orchestrator.sendMessage('second');
    tools = engine.generateCallArgs[1].options?.tools;
    expect(tools).toHaveLength(1);
    expect(tools![0].function.name).toBe('stock_price');
  });
});
