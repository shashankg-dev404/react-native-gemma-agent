import type {
  LanguageModelV3Content,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
  SharedV3ProviderMetadata,
  SharedV3Warning,
} from '@ai-sdk/provider';
import type { SkillResult } from '../types';
import type {
  RunToolLoopPart,
  RunToolLoopProviderMetadata,
  RunToolLoopUsage,
} from '../runToolLoop';
import { convertRunToolLoopFinishReason } from './convertFinishReason';

type StreamController = ReadableStreamDefaultController<LanguageModelV3StreamPart>;

export function createStreamBridge(
  controller: StreamController,
): (part: RunToolLoopPart) => void {
  let openTextId: string | null = null;
  let openReasoningId: string | null = null;

  const closeText = () => {
    if (openTextId !== null) {
      controller.enqueue({ type: 'text-end', id: openTextId });
      openTextId = null;
    }
  };
  const closeReasoning = () => {
    if (openReasoningId !== null) {
      controller.enqueue({ type: 'reasoning-end', id: openReasoningId });
      openReasoningId = null;
    }
  };

  return (part) => {
    switch (part.type) {
      case 'text-start':
        closeText();
        controller.enqueue({ type: 'text-start', id: part.id });
        openTextId = part.id;
        return;
      case 'text-delta':
        if (openTextId !== part.id) {
          closeText();
          controller.enqueue({ type: 'text-start', id: part.id });
          openTextId = part.id;
        }
        controller.enqueue({
          type: 'text-delta',
          id: part.id,
          delta: part.delta,
        });
        return;
      case 'text-end':
        closeText();
        return;
      case 'reasoning-start':
        closeReasoning();
        controller.enqueue({ type: 'reasoning-start', id: part.id });
        openReasoningId = part.id;
        return;
      case 'reasoning-delta':
        if (openReasoningId !== part.id) {
          closeReasoning();
          controller.enqueue({ type: 'reasoning-start', id: part.id });
          openReasoningId = part.id;
        }
        controller.enqueue({
          type: 'reasoning-delta',
          id: part.id,
          delta: part.delta,
        });
        return;
      case 'reasoning-end':
        closeReasoning();
        return;
      case 'tool-input-start': {
        closeText();
        closeReasoning();
        controller.enqueue({
          type: 'tool-input-start',
          id: part.toolCallId,
          toolName: part.toolName,
          providerExecuted: part.providerExecuted,
        });
        controller.enqueue({
          type: 'tool-input-delta',
          id: part.toolCallId,
          delta: JSON.stringify(part.parameters),
        });
        controller.enqueue({
          type: 'tool-input-end',
          id: part.toolCallId,
        });
        return;
      }
      case 'tool-input-delta':
        controller.enqueue({
          type: 'tool-input-delta',
          id: part.toolCallId,
          delta: part.delta,
        });
        return;
      case 'tool-input-end':
        controller.enqueue({
          type: 'tool-input-end',
          id: part.toolCallId,
        });
        return;
      case 'tool-call':
        controller.enqueue({
          type: 'tool-call',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          input: part.input,
          providerExecuted: part.providerExecuted,
        });
        return;
      case 'tool-result': {
        const { result, isError } = skillResultToJson(part.result);
        controller.enqueue({
          type: 'tool-result',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          result,
          isError,
        });
        return;
      }
      case 'finish': {
        closeText();
        closeReasoning();
        controller.enqueue({
          type: 'finish',
          finishReason: convertRunToolLoopFinishReason(part.finishReason),
          usage: buildV3Usage(part.usage),
          providerMetadata: buildProviderMetadata(part.providerMetadata),
        });
        return;
      }
      case 'error': {
        closeText();
        closeReasoning();
        controller.enqueue({ type: 'error', error: part.error });
        return;
      }
    }
  };
}

export function runToolLoopPartToContent(
  part: RunToolLoopPart,
): LanguageModelV3Content | null {
  switch (part.type) {
    case 'text-delta':
      return { type: 'text', text: part.delta };
    case 'reasoning-delta':
      return { type: 'reasoning', text: part.delta };
    case 'tool-call':
      return {
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        providerExecuted: part.providerExecuted,
      };
    case 'tool-result': {
      const { result, isError } = skillResultToJson(part.result);
      return {
        type: 'tool-result',
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        result,
        isError,
      };
    }
    default:
      return null;
  }
}

export function buildV3Usage(usage: RunToolLoopUsage): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: usage.promptTokens,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: usage.completionTokens,
      text: usage.completionTokens,
      reasoning: usage.reasoningTokens,
    },
  };
}

export function buildProviderMetadata(
  metadata: RunToolLoopProviderMetadata,
): SharedV3ProviderMetadata {
  return {
    gemma: {
      timings: {
        promptMs: metadata.timings.promptMs,
        promptPerSecond: metadata.timings.promptPerSecond,
        predictedMs: metadata.timings.predictedMs,
        predictedPerSecond: metadata.timings.predictedPerSecond,
      },
      contextUsage: {
        used: metadata.contextUsage.used,
        total: metadata.contextUsage.total,
        percent: metadata.contextUsage.percent,
      },
    },
  };
}

export function toV3Warnings(warnings: string[]): SharedV3Warning[] {
  return warnings.map((message) => ({ type: 'other', message }));
}

function skillResultToJson(result: SkillResult): {
  result: NonNullable<unknown>;
  isError?: boolean;
} {
  if (result.error) {
    return { result: result.error, isError: true };
  }
  if (result.image) {
    return {
      result: { mediaType: 'image/png', data: result.image.base64 },
    };
  }
  if (typeof result.result === 'string') {
    return { result: result.result };
  }
  return { result: 'No result' };
}
