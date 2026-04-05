import type { ToolCall, SkillManifest } from './types';
import type { SkillRegistry } from './SkillRegistry';

export type ParsedToolCall = {
  name: string;
  parameters: Record<string, unknown>;
  skill: SkillManifest;
  /** Original tool call ID from llama.rn (needed for tool role messages) */
  id?: string;
};

/**
 * Primary path: validate tool_calls from llama.rn's native parser
 * against registered skills. Returns only calls for known skills.
 */
export function validateToolCalls(
  toolCalls: ToolCall[],
  registry: SkillRegistry,
): ParsedToolCall[] {
  const validated: ParsedToolCall[] = [];

  for (const tc of toolCalls) {
    const skill = registry.getSkill(tc.function.name);
    if (!skill) continue;

    let parameters: Record<string, unknown>;
    try {
      parameters = JSON.parse(tc.function.arguments);
    } catch {
      parameters = {};
    }

    validated.push({
      name: tc.function.name,
      parameters,
      skill,
      id: tc.id,
    });
  }

  return validated;
}

/**
 * Fallback: scan raw text for JSON tool call blocks when llama.rn's
 * native PEG parser misses them (e.g., malformed special tokens).
 *
 * Looks for two patterns:
 *   1. {"tool_call": {"name": "...", "parameters": {...}}}
 *   2. {"name": "...", "arguments": {...}}
 */
export function extractToolCallsFromText(
  text: string,
  registry: SkillRegistry,
): ParsedToolCall[] {
  const results: ParsedToolCall[] = [];

  // Find JSON-like blocks in the text
  const jsonBlocks = findJsonBlocks(text);

  for (const block of jsonBlocks) {
    try {
      const parsed = JSON.parse(block);

      let name: string | undefined;
      let parameters: Record<string, unknown> = {};

      if (parsed.tool_call && typeof parsed.tool_call === 'object') {
        name = parsed.tool_call.name;
        parameters = parsed.tool_call.parameters ?? {};
      } else if (parsed.name && typeof parsed.name === 'string') {
        name = parsed.name;
        const raw = parsed.arguments ?? parsed.parameters ?? {};
        parameters = typeof raw === 'string' ? JSON.parse(raw) : raw;
      }

      if (!name) continue;

      const skill = registry.getSkill(name);
      if (!skill) continue;

      results.push({ name, parameters, skill });
    } catch {
      // Skip malformed JSON
    }
  }

  return results;
}

/**
 * Extract balanced JSON blocks from text by tracking brace depth.
 */
function findJsonBlocks(text: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        blocks.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return blocks;
}
