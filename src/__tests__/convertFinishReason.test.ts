import {
  convertFinishReason,
  convertRunToolLoopFinishReason,
} from '../ai/convertFinishReason';
import type { CompletionResult } from '../types';

function baseResult(overrides: Partial<CompletionResult> = {}): CompletionResult {
  return {
    text: '',
    content: '',
    reasoning: null,
    toolCalls: [],
    timings: {
      promptTokens: 0,
      promptMs: 0,
      promptPerSecond: 0,
      predictedTokens: 0,
      predictedMs: 0,
      predictedPerSecond: 0,
    },
    stoppedEos: false,
    stoppedLimit: false,
    contextFull: false,
    ...overrides,
  };
}

describe('convertFinishReason', () => {
  it('maps stoppedEos to stop', () => {
    expect(convertFinishReason(baseResult({ stoppedEos: true }), false)).toEqual({
      unified: 'stop',
      raw: 'stopped_eos',
    });
  });

  it('maps stoppedLimit to length', () => {
    expect(
      convertFinishReason(baseResult({ stoppedLimit: true }), false),
    ).toEqual({ unified: 'length', raw: 'stopped_limit' });
  });

  it('maps contextFull to length', () => {
    expect(
      convertFinishReason(baseResult({ contextFull: true }), false),
    ).toEqual({ unified: 'length', raw: 'context_full' });
  });

  it('maps hadToolCalls to tool-calls regardless of other flags', () => {
    expect(convertFinishReason(baseResult({ stoppedEos: true }), true)).toEqual({
      unified: 'tool-calls',
      raw: 'tool_calls',
    });
  });

  it('falls back to other when no flag is set', () => {
    expect(convertFinishReason(baseResult(), false)).toEqual({
      unified: 'other',
      raw: undefined,
    });
  });
});

describe('convertRunToolLoopFinishReason', () => {
  it('maps stop', () => {
    expect(convertRunToolLoopFinishReason('stop')).toEqual({
      unified: 'stop',
      raw: 'stopped_eos',
    });
  });

  it('maps length', () => {
    expect(convertRunToolLoopFinishReason('length')).toEqual({
      unified: 'length',
      raw: 'stopped_limit',
    });
  });

  it('maps tool-calls', () => {
    expect(convertRunToolLoopFinishReason('tool-calls')).toEqual({
      unified: 'tool-calls',
      raw: 'tool_calls',
    });
  });

  it('maps other', () => {
    expect(convertRunToolLoopFinishReason('other')).toEqual({
      unified: 'other',
      raw: undefined,
    });
  });
});
