/**
 * Tests for InferenceEngine — focuses on context-usage accounting.
 *
 * `llama.rn` is mocked at module level so tests can drive completion results
 * without a native backend.
 */

type MockContext = {
  gpu: boolean;
  reasonNoGPU: string;
  model: { desc: string; nParams: number };
  completion: jest.Mock;
  stopCompletion: jest.Mock;
  bench: jest.Mock;
};

jest.mock('llama.rn', () => {
  const mockContext: MockContext = {
    gpu: false,
    reasonNoGPU: '',
    model: { desc: 'mock', nParams: 1 },
    completion: jest.fn(),
    stopCompletion: jest.fn().mockResolvedValue(undefined),
    bench: jest.fn().mockResolvedValue({
      speedPp: 0,
      speedTg: 0,
      flashAttn: false,
    }),
  };
  return {
    __esModule: true,
    __mockContext: mockContext,
    initLlama: jest.fn().mockResolvedValue(mockContext),
    releaseAllLlama: jest.fn().mockResolvedValue(undefined),
  };
});

import { InferenceEngine } from '../InferenceEngine';

const llamaRn = jest.requireMock('llama.rn') as {
  __mockContext: MockContext;
  initLlama: jest.Mock;
  releaseAllLlama: jest.Mock;
};

function queueCompletion(promptN: number, predictedN: number): void {
  llamaRn.__mockContext.completion.mockImplementationOnce(async () => ({
    text: '',
    content: '',
    reasoning_content: null,
    tool_calls: [],
    timings: {
      prompt_n: promptN,
      prompt_ms: 100,
      prompt_per_second: 100,
      predicted_n: predictedN,
      predicted_ms: 100,
      predicted_per_second: 100,
    },
    stopped_eos: true,
    stopped_limit: 0,
    context_full: false,
  }));
}

describe('InferenceEngine', () => {
  let engine: InferenceEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    // Re-stub the default bench/stopCompletion resolvers after clearAllMocks
    llamaRn.__mockContext.stopCompletion.mockResolvedValue(undefined);
    llamaRn.__mockContext.bench.mockResolvedValue({
      speedPp: 0,
      speedTg: 0,
      flashAttn: false,
    });
    llamaRn.initLlama.mockResolvedValue(llamaRn.__mockContext);
    llamaRn.releaseAllLlama.mockResolvedValue(undefined);
    engine = new InferenceEngine({ contextSize: 1024 });
  });

  describe('getContextUsage — cumulative KV-fill semantics', () => {
    it('returns zero usage before any generate() call', async () => {
      await engine.loadModel('/tmp/test.gguf');
      expect(engine.getContextUsage()).toEqual({
        used: 0,
        total: 1024,
        percent: 0,
      });
    });

    it('accumulates prompt diff + predicted tokens across multiple generate() calls', async () => {
      await engine.loadModel('/tmp/test.gguf');

      // Turn 1: full prompt (500) + 100 predicted → cumulative 600
      queueCompletion(500, 100);
      await engine.generate([{ role: 'user', content: 'hello' }]);
      expect(engine.getContextUsage()).toEqual({
        used: 600,
        total: 1024,
        percent: 59,
      });

      // Turn 2: only the NEW tokens are reprocessed after KV cache reuse.
      // llama.rn reports `prompt_n = 50` as the diff, not 550 total.
      // Cumulative must grow to 600 + 50 + 80 = 730.
      queueCompletion(50, 80);
      await engine.generate([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'more' },
      ]);
      expect(engine.getContextUsage()).toEqual({
        used: 730,
        total: 1024,
        percent: 71,
      });

      // Turn 3: tiny diff + 50 predicted → cumulative 800
      queueCompletion(20, 50);
      await engine.generate([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
        { role: 'user', content: 'more' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'again' },
      ]);
      expect(engine.getContextUsage()).toEqual({
        used: 800,
        total: 1024,
        percent: 78,
      });
    });

    it('clamps cumulative usage to contextSize (never exceeds 100%)', async () => {
      await engine.loadModel('/tmp/test.gguf');
      queueCompletion(800, 500); // 1300 > 1024
      await engine.generate([{ role: 'user', content: 'hi' }]);
      const usage = engine.getContextUsage();
      expect(usage.used).toBe(1024);
      expect(usage.total).toBe(1024);
      expect(usage.percent).toBe(100);
    });

    it('resetContextUsage() zeroes the cumulative counter', async () => {
      await engine.loadModel('/tmp/test.gguf');
      queueCompletion(400, 200);
      await engine.generate([{ role: 'user', content: 'hi' }]);
      expect(engine.getContextUsage().used).toBe(600);

      engine.resetContextUsage();
      expect(engine.getContextUsage()).toEqual({
        used: 0,
        total: 1024,
        percent: 0,
      });
    });

    it('cumulative counter keeps growing after resetContextUsage()', async () => {
      await engine.loadModel('/tmp/test.gguf');
      queueCompletion(400, 200);
      await engine.generate([{ role: 'user', content: 'hi' }]);
      engine.resetContextUsage();

      queueCompletion(100, 50);
      await engine.generate([{ role: 'user', content: 'hi again' }]);
      expect(engine.getContextUsage().used).toBe(150);
    });
  });

  describe('reasoning_format native boundary translation', () => {
    it("translates internal 'qwen' tag to 'deepseek' before calling completion", async () => {
      await engine.loadModel('/tmp/test.gguf');
      queueCompletion(10, 5);
      await engine.generate([{ role: 'user', content: 'hi' }], {
        reasoning_format: 'qwen',
        enable_thinking: true,
      });
      const params = llamaRn.__mockContext.completion.mock.calls[0][0];
      expect(params.reasoning_format).toBe('deepseek');
      expect(params.enable_thinking).toBe(true);
    });

    it("passes 'deepseek' through unchanged", async () => {
      await engine.loadModel('/tmp/test.gguf');
      queueCompletion(10, 5);
      await engine.generate([{ role: 'user', content: 'hi' }], {
        reasoning_format: 'deepseek',
      });
      expect(
        llamaRn.__mockContext.completion.mock.calls[0][0].reasoning_format,
      ).toBe('deepseek');
    });

    it("defaults to 'none' when reasoning_format is omitted", async () => {
      await engine.loadModel('/tmp/test.gguf');
      queueCompletion(10, 5);
      await engine.generate([{ role: 'user', content: 'hi' }]);
      expect(
        llamaRn.__mockContext.completion.mock.calls[0][0].reasoning_format,
      ).toBe('none');
    });
  });

  describe('unload() — Bug 2 regression', () => {
    it('zeroes cumulative usage and last-call token counters', async () => {
      await engine.loadModel('/tmp/test.gguf');
      queueCompletion(400, 200);
      await engine.generate([{ role: 'user', content: 'hi' }]);
      expect(engine.getContextUsage().used).toBeGreaterThan(0);

      await engine.unload();
      expect(engine.getContextUsage()).toEqual({
        used: 0,
        total: 1024,
        percent: 0,
      });
    });

    it('leaves contextSize intact after unload so the UI can still show the window total', async () => {
      await engine.loadModel('/tmp/test.gguf');
      queueCompletion(300, 100);
      await engine.generate([{ role: 'user', content: 'hi' }]);
      await engine.unload();
      expect(engine.getContextUsage().total).toBe(1024);
    });
  });
});
