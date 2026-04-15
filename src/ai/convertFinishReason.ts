// Ported with changes from @react-native-ai/llama (MIT)
// Source: packages/llama/src/ai-sdk.ts:48-69
// https://github.com/callstackincubator/ai
//
// Adapted input from raw NativeCompletionResult to our mapped CompletionResult
// (src/types.ts) and added a hadToolCalls path so provider-executed skill
// turns surface as 'tool-calls'.

import type { LanguageModelV3FinishReason } from '@ai-sdk/provider';
import type { CompletionResult } from '../types';
import type { RunToolLoopFinishReason } from '../runToolLoop';

export function convertFinishReason(
  result: CompletionResult,
  hadToolCalls: boolean,
): LanguageModelV3FinishReason {
  if (hadToolCalls) {
    return { unified: 'tool-calls', raw: 'tool_calls' };
  }
  if (result.stoppedEos) {
    return { unified: 'stop', raw: 'stopped_eos' };
  }
  if (result.stoppedLimit) {
    return { unified: 'length', raw: 'stopped_limit' };
  }
  if (result.contextFull) {
    return { unified: 'length', raw: 'context_full' };
  }
  return { unified: 'other', raw: undefined };
}

export function convertRunToolLoopFinishReason(
  reason: RunToolLoopFinishReason,
): LanguageModelV3FinishReason {
  switch (reason) {
    case 'stop':
      return { unified: 'stop', raw: 'stopped_eos' };
    case 'length':
      return { unified: 'length', raw: 'stopped_limit' };
    case 'tool-calls':
      return { unified: 'tool-calls', raw: 'tool_calls' };
    case 'other':
    default:
      return { unified: 'other', raw: undefined };
  }
}
