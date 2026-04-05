import { BM25Scorer } from '../BM25Scorer';
import type { SkillManifest } from '../types';

const calculatorSkill: SkillManifest = {
  name: 'calculator',
  description: 'Evaluate mathematical expressions accurately.',
  version: '1.0.0',
  type: 'native',
  parameters: {
    expression: {
      type: 'string',
      description: 'Mathematical expression to evaluate (e.g. "2 + 3 * 4")',
    },
  },
  instructions: 'Use this when the user asks for calculations, math, unit conversions, or percentages.',
};

const wikipediaSkill: SkillManifest = {
  name: 'query_wikipedia',
  description: 'Search Wikipedia for factual information about any topic.',
  version: '1.0.0',
  type: 'js',
  parameters: {
    query: {
      type: 'string',
      description: 'The search query to send to Wikipedia',
    },
  },
  html: '<html></html>',
  instructions: 'Use this when the user asks a factual question.',
};

const webSearchSkill: SkillManifest = {
  name: 'web_search',
  description: 'Search the web for current information.',
  version: '1.0.0',
  type: 'js',
  parameters: {
    query: { type: 'string', description: 'The search query' },
  },
  html: '<html></html>',
  instructions: 'Use this for recent events or current information.',
};

describe('BM25Scorer', () => {
  let scorer: BM25Scorer;

  beforeEach(() => {
    scorer = new BM25Scorer();
    scorer.buildIndex([calculatorSkill, wikipediaSkill, webSearchSkill]);
  });

  it('ranks calculator first for math queries', () => {
    const results = scorer.score('evaluate mathematical expression 2 + 2');
    expect(results[0].skill.name).toBe('calculator');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('ranks calculator first for "calculate 15% of 200"', () => {
    const results = scorer.score('calculate 15% of 200');
    expect(results[0].skill.name).toBe('calculator');
  });

  it('ranks wikipedia first for "who was Einstein"', () => {
    const results = scorer.score('search Einstein on Wikipedia');
    expect(results[0].skill.name).toBe('query_wikipedia');
  });

  it('ranks wikipedia first for factual queries', () => {
    const results = scorer.score('factual information about quantum physics');
    expect(results[0].skill.name).toBe('query_wikipedia');
  });

  it('ranks web_search higher for "current events" queries', () => {
    const results = scorer.score('recent current events news');
    expect(results[0].skill.name).toBe('web_search');
  });

  it('topN returns only requested count', () => {
    const results = scorer.topN('math calculator', 2);
    expect(results).toHaveLength(2);
  });

  it('topN clamps to available skills', () => {
    const results = scorer.topN('test', 10);
    expect(results).toHaveLength(3);
  });

  it('returns all skills with scores for any query', () => {
    const results = scorer.score('hello world');
    expect(results).toHaveLength(3);
  });

  it('handles empty query', () => {
    const results = scorer.score('');
    expect(results).toHaveLength(3);
    results.forEach((r) => expect(r.score).toBe(0));
  });

  it('handles empty skill list', () => {
    scorer.buildIndex([]);
    const results = scorer.score('test query');
    expect(results).toHaveLength(0);
  });

  it('re-indexing replaces previous index', () => {
    scorer.buildIndex([calculatorSkill]);
    const results = scorer.score('math');
    expect(results).toHaveLength(1);
  });
});
