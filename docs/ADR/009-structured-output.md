# ADR-009: Structured Output API

## Status
Accepted (2026-04-16)

## Context

Ollama and the Vercel AI SDK both treat structured output as a first-class primitive. Ollama added `format: json | JSONSchema` to `/api/generate`. The AI SDK exposes `generateObject({ model, schema, prompt })`, which under the hood sends `responseFormat: { type: 'json', schema }` to the provider and parses/validates the returned text.

Two questions fall out of that:

1. **What surface do we expose?** A raw primitive callers can hit directly (for non-AI-SDK consumers) and a wired AI-SDK path (for `generateObject` users). The moat is the primitive; the adapter is table stakes.

2. **How do we constrain the model?** llama.rn rc.8 exposes `response_format: { type: 'json_schema', json_schema: { schema } }` which maps to llama.cpp's grammar-based constrained decoding. Before rc.8 this surface was not exposed; we would have needed a retry-with-validation loop driven only by prompt steering. Now the native path is available, the retry loop becomes a belt-and-suspenders fallback for the cases where the model still produces syntactically-off output (rare with grammar decoding, but not zero).

Schema authoring: TypeScript users overwhelmingly reach for Zod (v3 / v4). The AI SDK canonicalised around it with `asSchema` / `jsonSchema` wrappers. Accepting Zod is table stakes. Accepting raw JSON Schema is the escape hatch for consumers with existing schemas or non-Zod stacks.

## Decision

### 1. Ship a standalone primitive

`generateStructured<T>(engine, { schema, prompt, systemPrompt?, generateOptions?, maxRetries? })` lives in `src/StructuredOutput.ts` and is re-exported from `react-native-gemma-agent`. It takes an `InferenceEngine` plus input; it does not go through `runToolLoop` and does not require a `GemmaAgentProvider`.

Rationale:
- Not every consumer uses the AI SDK. The Vercel adapter is a subpath import (`react-native-gemma-agent/ai`) gated on `@ai-sdk/provider`. Forcing structured output through that subpath would make it unreachable for raw `useLLM` users and for anyone running the engine directly.
- The primitive is also what the adapter calls. One code path, two entry points.

### 2. Accept Zod OR JSON Schema, detect via `_def`

```ts
if ('_def' in schema && typeof schema.safeParse === 'function') { /* Zod */ }
```

Zod schemas are converted to JSON Schema via `zod-to-json-schema`, which is declared as an optional peer dep in `package.json`:

```jsonc
"peerDependenciesMeta": {
  "zod": { "optional": true },
  "zod-to-json-schema": { "optional": true }
}
```

Non-Zod users pay zero install cost. Zod users who forget to install `zod-to-json-schema` get a clear error at call time pointing to the fix. The conversion is a lazy `require` inside `toJsonSchema()` so nothing imports the module at module evaluation time.

Validation: for Zod schemas we call `schema.safeParse()`. For raw JSON Schema we only enforce "the output is a JSON object"; consumers who want stricter validation can wrap the JSON Schema in Zod and pass the Zod schema instead. Shipping a full JSON Schema validator (Ajv etc.) would triple our bundle for a capability most consumers can express in Zod.

### 3. Native constrained decoding as primary, retry-with-validation as safety net

Every call passes `response_format: { type: 'json_schema', json_schema: { strict: true, schema } }` to `llama.rn`. The grammar sampler forces token selection inside the schema, so the vast majority of outputs parse on attempt 1.

If parsing or validation fails (markdown fence, trailing prose, validation miss on a nested constraint grammar doesn't enforce), the primitive re-invokes the engine with an appended user turn describing the specific failure. Default `maxRetries: 2` — three attempts total. Final failure throws with the last raw output included (truncated to 500 chars) so the caller can debug without needing to instrument the engine.

### 4. Wire AI SDK `generateObject` via `doGenerate`/`doStream` branch

`GemmaLanguageModel.doGenerate()` checks `options.responseFormat?.type === 'json'`. When set, it skips `runToolLoop` entirely and calls `generateStructured` directly. The return is a single `{ type: 'text', text: JSON.stringify(object) }` content part — the AI SDK parses and validates via its own `asSchema` pipeline.

When `responseFormat === 'json'` and `tools` are also passed, we emit a warning and drop the tools. AI SDK treats structured output and tool calling as mutually exclusive (`generateObject` does not accept `tools`); we follow suit.

## Consequences

### Positive
- Two entry points (primitive + adapter) share one implementation.
- Grammar decoding keeps one-shot success high on Gemma 4 and the multi-model catalog; retry fallback catches the edge cases.
- Zod-free consumers pay nothing: no new runtime deps, no install bloat.
- `generateObject` from `ai` works without changes to consumer code once they wire the provider.

### Negative
- Retry fallback is sequential and counts against the context window. Three attempts on a large prompt could burn ~3x the input tokens. Default `maxRetries: 2` is a deliberate compromise; consumers can set `0` if they want fail-fast.
- JSON Schema path has no validation beyond "is an object". Consumers who want deep validation without Zod are on their own.

### Risks
- Grammar decoding exposed in rc.8 could regress in a later llama.rn bump. Mitigation: the peer range is `>=0.12.0-rc.8 <0.13.0` (ADR-008), so minor bumps can't sneak in.
- Constrained decoding can over-constrain: a schema that's technically satisfiable but requires tokens the sampler rejects can cause the model to emit garbage or a degenerate minimal-valid output. Mitigation: consumers should keep schemas tight but not adversarial; the retry loop catches obvious garbage.
- A malformed Zod schema that `zod-to-json-schema` fails to convert produces a thrown conversion error, not a structured output failure. That's acceptable — it's a developer error caught at call time.

## Alternatives Considered

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| Only expose via AI SDK adapter | Simpler API surface | Raw `useLLM` and direct-engine consumers lose the feature | Rejected |
| Grammar (BNF) instead of JSON Schema | llama.cpp's grammar layer is strictly more expressive | JSON Schema is the lingua franca for AI SDK, Ollama, OpenAI; consumers who want raw grammar can pass through via `GenerateOptions` | Rejected |
| Retry-with-validation only (no grammar) | Works on any backend, no pin required | Worse one-shot success rate; more tokens burned; more failed calls | Rejected |
| Ship Ajv for JSON Schema validation | Strict validation without forcing Zod | ~200KB bundle cost for a capability most consumers already have via Zod | Rejected |
| Require Zod as a hard peer dep | Simpler detection logic | Non-TS / non-Zod consumers can't use the primitive | Rejected |
| **Grammar primary + retry fallback; Zod optional, JSON Schema passthrough** | Covers both ecosystems with a single path | Modest retry-loop overhead in the edge case | **Chosen** |
