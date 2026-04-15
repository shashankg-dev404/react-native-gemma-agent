import type { LanguageModelV3ToolResultOutput } from '@ai-sdk/provider';
import type { SkillResult } from '../types';

export function skillResultToToolOutput(
  result: SkillResult,
): LanguageModelV3ToolResultOutput {
  if (result.error) {
    return { type: 'error-text', value: result.error };
  }

  if (result.image) {
    return {
      type: 'content',
      value: [
        {
          type: 'image-data',
          data: result.image.base64,
          mediaType: 'image/png',
        },
      ],
    };
  }

  if (typeof result.result === 'string') {
    return { type: 'text', value: result.result };
  }

  return { type: 'text', value: 'No result' };
}

export function toolResultOutputToString(
  output: LanguageModelV3ToolResultOutput,
): string {
  switch (output.type) {
    case 'text':
      return output.value;
    case 'error-text':
      return `Error: ${output.value}`;
    case 'json':
      return JSON.stringify(output.value);
    case 'error-json':
      return `Error: ${JSON.stringify(output.value)}`;
    case 'execution-denied':
      return output.reason ?? 'Execution denied';
    case 'content': {
      const textParts: string[] = [];
      for (const part of output.value) {
        if (part.type === 'text') {
          textParts.push(part.text);
        } else {
          textParts.push(`[${part.type}]`);
        }
      }
      return textParts.join('\n');
    }
    default:
      return '';
  }
}
