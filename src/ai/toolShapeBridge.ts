import type { LanguageModelV3FunctionTool } from '@ai-sdk/provider';
import type { ToolDefinition } from '../types';
import type { SkillRegistry } from '../SkillRegistry';

type BridgeResult = {
  tool: ToolDefinition;
  warnings: string[];
};

export function v3ToolToToolDefinition(
  tool: LanguageModelV3FunctionTool,
): BridgeResult {
  const warnings: string[] = [];
  const schema = tool.inputSchema as
    | { type?: string; properties?: unknown; required?: unknown }
    | undefined;

  const isObjectSchema =
    schema &&
    typeof schema === 'object' &&
    schema.type === 'object' &&
    schema.properties &&
    typeof schema.properties === 'object';

  if (!isObjectSchema) {
    warnings.push(
      `Tool "${tool.name}" has no object inputSchema — sending empty parameters`,
    );
  }

  const properties = (isObjectSchema
    ? (schema.properties as Record<string, unknown>)
    : {}) as ToolDefinition['function']['parameters']['properties'];
  const required =
    isObjectSchema && Array.isArray(schema.required)
      ? (schema.required as string[])
      : undefined;

  const definition: ToolDefinition = {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: {
        type: 'object',
        properties,
        required,
      },
    },
  };

  return { tool: definition, warnings };
}

type SeparateResult = {
  skillTools: ToolDefinition[];
  consumerTools: ToolDefinition[];
  collisionWarnings: string[];
};

export function separateProviderAndConsumerTools(
  tools: LanguageModelV3FunctionTool[] | undefined,
  registry: SkillRegistry,
): SeparateResult {
  const skillTools = registry.toToolDefinitions();
  const skillNames = new Set(skillTools.map((t) => t.function.name));

  const consumerTools: ToolDefinition[] = [];
  const collisionWarnings: string[] = [];

  for (const v3Tool of tools ?? []) {
    if (skillNames.has(v3Tool.name)) {
      collisionWarnings.push(
        `Consumer tool "${v3Tool.name}" dropped — a registered skill with the same name takes precedence`,
      );
      continue;
    }
    const { tool, warnings } = v3ToolToToolDefinition(v3Tool);
    consumerTools.push(tool);
    collisionWarnings.push(...warnings);
  }

  return { skillTools, consumerTools, collisionWarnings };
}
