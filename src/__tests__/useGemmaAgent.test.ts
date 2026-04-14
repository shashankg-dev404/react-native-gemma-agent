/**
 * Tests for the `useGemmaAgent` hook.
 *
 * We don't pull in react-test-renderer or @testing-library — the codebase
 * has no existing hook-test infrastructure and the SDK targets RN at runtime
 * only. Instead we mock `react` with a minimal synchronous hook harness that
 * supports `useState`, `useRef`, and `useCallback`. Tests re-render by
 * re-invoking the hook (`rerender()`) to read the latest state snapshot.
 */

type MockStore = {
  values: unknown[];
  idx: number;
  refs: Array<{ current: unknown }>;
  refIdx: number;
};

jest.mock('react', () => {
  const store: MockStore = { values: [], idx: 0, refs: [], refIdx: 0 };

  return {
    __mockStore: store,
    useState: <T>(initial: T | (() => T)) => {
      const idx = store.idx++;
      if (store.values.length <= idx) {
        const init =
          typeof initial === 'function' ? (initial as () => T)() : initial;
        store.values.push(init);
      }
      const setter = (value: T | ((prev: T) => T)) => {
        const prev = store.values[idx] as T;
        store.values[idx] =
          typeof value === 'function'
            ? (value as (prev: T) => T)(prev)
            : value;
      };
      return [store.values[idx] as T, setter];
    },
    useCallback: <T>(fn: T): T => fn,
    useRef: <T>(initial: T) => {
      const idx = store.refIdx++;
      if (store.refs.length <= idx) {
        store.refs.push({ current: initial as unknown });
      }
      return store.refs[idx];
    },
  };
});

jest.mock('../GemmaAgentProvider', () => ({
  useGemmaAgentContext: jest.fn(),
}));

import { useGemmaAgent } from '../useGemmaAgent';
import { useGemmaAgentContext } from '../GemmaAgentProvider';
import type { ContextUsage, ModelStatus } from '../types';

const mockReact = jest.requireMock('react') as { __mockStore: MockStore };

function resetStore(): void {
  const s = mockReact.__mockStore;
  s.values = [];
  s.idx = 0;
  s.refs = [];
  s.refIdx = 0;
}

function rerender() {
  mockReact.__mockStore.idx = 0;
  mockReact.__mockStore.refIdx = 0;
  return useGemmaAgent();
}

type FakeEngine = {
  isLoaded: boolean;
  unload: jest.Mock;
  getContextUsage: jest.Mock<ContextUsage, []>;
};

type FakeOrchestrator = {
  reset: jest.Mock;
};

type FakeModelManager = {
  status: ModelStatus;
  modelPath: string | null;
  findModel: jest.Mock;
  onStatusChange: (listener: (s: ModelStatus) => void) => () => void;
};

function buildContext(overrides?: {
  modelPath?: string | null;
  ctxUsage?: ContextUsage;
}) {
  const engine: FakeEngine = {
    isLoaded: true,
    unload: jest.fn().mockResolvedValue(undefined),
    getContextUsage: jest.fn().mockReturnValue(
      overrides?.ctxUsage ?? { used: 0, total: 1024, percent: 0 },
    ),
  };
  const orchestrator: FakeOrchestrator = { reset: jest.fn() };
  const modelManager: FakeModelManager = {
    status: 'loaded',
    modelPath:
      overrides?.modelPath === undefined
        ? '/data/local/tmp/model.gguf'
        : overrides.modelPath,
    findModel: jest.fn(),
    onStatusChange: () => () => {},
  };
  const ctx = {
    modelManager,
    engine,
    orchestrator,
    activeCategories: undefined,
    setActiveCategories: jest.fn(),
  };
  (useGemmaAgentContext as jest.Mock).mockReturnValue(ctx);
  return { ctx, engine, orchestrator, modelManager };
}

describe('useGemmaAgent', () => {
  describe('unloadModel', () => {
    it('resets orchestrator, clears state, and zeroes contextUsage', async () => {
      resetStore();
      const { engine, orchestrator } = buildContext();

      // First render creates all useState slots
      let hook = rerender();

      // Seed state as if a chat session had populated the hook.
      // useState call order inside useGemmaAgent (src/useGemmaAgent.ts:55-67):
      //   0: messages, 1: streamingText, 2: isProcessing,
      //   3: modelStatus, 4: activeSkill, 5: error, 6: contextUsage
      const store = mockReact.__mockStore;
      store.values[0] = [{ role: 'user', content: 'hi' }];
      store.values[1] = 'streaming...';
      store.values[4] = 'calculator';
      store.values[5] = 'something broke';
      store.values[6] = { used: 500, total: 1024, percent: 49 };

      hook = rerender();
      expect(hook.messages).toHaveLength(1);
      expect(hook.streamingText).toBe('streaming...');
      expect(hook.activeSkill).toBe('calculator');
      expect(hook.error).toBe('something broke');
      expect(hook.contextUsage).toEqual({
        used: 500,
        total: 1024,
        percent: 49,
      });

      await hook.unloadModel();

      expect(engine.unload).toHaveBeenCalledTimes(1);
      expect(orchestrator.reset).toHaveBeenCalledTimes(1);

      hook = rerender();
      expect(hook.messages).toEqual([]);
      expect(hook.streamingText).toBe('');
      expect(hook.error).toBeNull();
      expect(hook.activeSkill).toBeNull();
      expect(hook.contextUsage).toEqual({ used: 0, total: 0, percent: 0 });
      expect(hook.modelStatus).toBe('ready');
    });

    it('sets modelStatus to not_downloaded when modelPath is null', async () => {
      resetStore();
      buildContext({ modelPath: null });

      let hook = rerender();
      await hook.unloadModel();
      hook = rerender();
      expect(hook.modelStatus).toBe('not_downloaded');
    });
  });
});
