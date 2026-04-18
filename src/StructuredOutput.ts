import type { InferenceEngine } from './InferenceEngine';
import type { GenerateOptions, Message } from './types';

type ZodLike = {
  _def: unknown;
  safeParse: (data: unknown) => { success: true; data: unknown } | { success: false; error: unknown };
  parse: (data: unknown) => unknown;
  // Zod 4+ ships a native JSON Schema converter on the schema itself.
  toJSONSchema?: () => Record<string, unknown>;
};

export type StructuredOutputSchema =
  | ZodLike
  | Record<string, unknown>;

export type GenerateStructuredInput<T> = {
  schema: StructuredOutputSchema;
  prompt: string;
  systemPrompt?: string;
  /** Passthrough generation options (maxTokens, temperature, etc.) */
  generateOptions?: Omit<GenerateOptions, 'responseFormat' | 'tools' | 'toolChoice'>;
  /** Max retry attempts when the model produces unparseable / invalid JSON. Default 2 (total 3 attempts). */
  maxRetries?: number;
};

export type GenerateStructuredResult<T> = {
  object: T;
  raw: string;
  attempts: number;
};

const DEFAULT_SYSTEM_PROMPT =
  'You output JSON only. Respond with a single JSON object that conforms exactly to the provided schema. Do not include prose, markdown fences, or explanations.';

export function isZodSchema(schema: unknown): schema is ZodLike {
  return (
    typeof schema === 'object' &&
    schema !== null &&
    '_def' in schema &&
    typeof (schema as ZodLike).safeParse === 'function'
  );
}

export function toJsonSchema(schema: StructuredOutputSchema): Record<string, unknown> {
  if (!isZodSchema(schema)) {
    return schema;
  }
  if (typeof schema.toJSONSchema === 'function') {
    return schema.toJSONSchema();
  }
  let converter: ((s: unknown) => Record<string, unknown>) | null = null;
  try {
    const mod = require('zod-to-json-schema');
    converter = mod.zodToJsonSchema ?? mod.default ?? mod;
  } catch {
    throw new Error(
      'generateStructured: received a Zod v3 schema but `zod-to-json-schema` is not installed. Install it (`npm install zod-to-json-schema`), upgrade to Zod v4 (which ships a native `toJSONSchema` method), or pass a plain JSON Schema object.',
    );
  }
  if (typeof converter !== 'function') {
    throw new Error(
      'generateStructured: `zod-to-json-schema` did not export a callable converter.',
    );
  }
  return converter(schema);
}

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenceStart = trimmed.indexOf('```');
  if (fenceStart !== -1) {
    const afterFence = trimmed.slice(fenceStart + 3).replace(/^json\s*/i, '');
    const fenceEnd = afterFence.lastIndexOf('```');
    if (fenceEnd !== -1) {
      return afterFence.slice(0, fenceEnd).trim();
    }
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function validate<T>(
  schema: StructuredOutputSchema,
  parsed: unknown,
): { ok: true; value: T } | { ok: false; error: string } {
  if (isZodSchema(schema)) {
    const result = schema.safeParse(parsed);
    if (result.success) {
      return { ok: true, value: result.data as T };
    }
    const err = result.error as { message?: string } | undefined;
    return { ok: false, error: err?.message ?? 'Zod validation failed' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Expected a JSON object at the top level' };
  }
  return { ok: true, value: parsed as T };
}

export async function generateStructured<T>(
  engine: InferenceEngine,
  input: GenerateStructuredInput<T>,
): Promise<GenerateStructuredResult<T>> {
  const jsonSchema = toJsonSchema(input.schema);
  const maxRetries = input.maxRetries ?? 2;

  const systemPrompt = input.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  const baseMessages: Message[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: input.prompt },
  ];

  let lastRaw = '';
  let lastError = '';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const messages: Message[] =
      attempt === 0
        ? baseMessages
        : [
            ...baseMessages,
            {
              role: 'user',
              content: `Your previous response failed validation: ${lastError}. Respond again with a single JSON object that matches the schema exactly. Do not wrap it in markdown.`,
            },
          ];

    const result = await engine.generate(messages, {
      ...input.generateOptions,
      responseFormat: {
        type: 'json_schema',
        schema: jsonSchema,
        strict: true,
      },
    });

    lastRaw = result.content ?? result.text ?? '';
    const jsonText = extractJson(lastRaw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      continue;
    }

    const validated = validate<T>(input.schema, parsed);
    if (validated.ok) {
      return { object: validated.value, raw: lastRaw, attempts: attempt + 1 };
    }
    lastError = validated.error;
  }

  throw new Error(
    `generateStructured: failed after ${maxRetries + 1} attempts. Last error: ${lastError}. Last raw output: ${lastRaw.slice(0, 500)}`,
  );
}
