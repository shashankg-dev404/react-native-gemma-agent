// Ported with changes from @react-native-ai/llama (MIT)
// Source: packages/llama/src/ai-sdk.ts:93-225
// https://github.com/callstackincubator/ai
//
// Targets our Message type (src/types.ts) with string content instead of
// llama.rn's LLMMessage array-content shape. Dropped the upstream
// "Model executed tools are not supported" branch per ADR-006: our
// provider-executed design emits assistant-embedded tool results legitimately.
// FilePart is dropped with a warning until Phase 22 wires multimodal.

import type {
  LanguageModelV3Prompt,
  LanguageModelV3TextPart,
  LanguageModelV3ReasoningPart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolResultPart,
} from '@ai-sdk/provider';
import type { Message, ToolCall } from '../types';
import { toolResultOutputToString } from './convertToolResultOutput';

type PrepareMessagesResult = {
  messages: Message[];
  warnings: string[];
};

export function prepareMessages(
  prompt: LanguageModelV3Prompt,
): PrepareMessagesResult {
  const messages: Message[] = [];
  const warnings: string[] = [];

  for (const message of prompt) {
    switch (message.role) {
      case 'system': {
        messages.push({ role: 'system', content: message.content });
        break;
      }
      case 'user': {
        const texts: string[] = [];
        for (const part of message.content) {
          if (part.type === 'text') {
            texts.push((part as LanguageModelV3TextPart).text);
          } else if (part.type === 'file') {
            warnings.push(
              'FilePart dropped — multimodal not yet supported',
            );
          }
        }
        messages.push({ role: 'user', content: texts.join('\n') });
        break;
      }
      case 'assistant': {
        const texts: string[] = [];
        const toolCalls: ToolCall[] = [];
        const embeddedResults: LanguageModelV3ToolResultPart[] = [];
        for (const part of message.content) {
          if (part.type === 'text') {
            texts.push((part as LanguageModelV3TextPart).text);
          } else if (part.type === 'reasoning') {
            texts.push((part as LanguageModelV3ReasoningPart).text);
          } else if (part.type === 'tool-call') {
            const call = part as LanguageModelV3ToolCallPart;
            toolCalls.push({
              type: 'function',
              id: call.toolCallId,
              function: {
                name: call.toolName,
                arguments:
                  typeof call.input === 'string'
                    ? call.input
                    : JSON.stringify(call.input),
              },
            });
          } else if (part.type === 'tool-result') {
            embeddedResults.push(part as LanguageModelV3ToolResultPart);
          } else if (part.type === 'file') {
            warnings.push(
              'FilePart dropped — multimodal not yet supported',
            );
          }
        }

        const assistantMsg: Message = {
          role: 'assistant',
          content: toolCalls.length > 0 ? '' : texts.join('\n'),
        };
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }
        messages.push(assistantMsg);

        for (const result of embeddedResults) {
          messages.push({
            role: 'tool',
            content: toolResultOutputToString(result.output),
            tool_call_id: result.toolCallId,
            name: result.toolName,
          });
        }
        break;
      }
      case 'tool': {
        for (const part of message.content) {
          if (part.type === 'tool-result') {
            const result = part as LanguageModelV3ToolResultPart;
            messages.push({
              role: 'tool',
              content: toolResultOutputToString(result.output),
              tool_call_id: result.toolCallId,
              name: result.toolName,
            });
          }
        }
        break;
      }
    }
  }

  return { messages, warnings };
}
