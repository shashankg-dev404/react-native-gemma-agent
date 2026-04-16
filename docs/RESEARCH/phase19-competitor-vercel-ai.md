# Phase 19 Spec Analysis — Vercel AI SDK (`vercel/ai`)

- **Repo**: https://github.com/vercel/ai
- **Analyzed from**: `main`, 2026-04-16
- **License**: Apache-2.0 (vercel/ai). Safe to implement against.
- **Version target**: AI SDK v5 / `@ai-sdk/provider ^3.0.5` → **LanguageModelV3**. (The user's prompt said V2; V2 has been superseded. Every active competitor — `@react-native-ai/llama@0.12.0`, `@react-native-ai/mlc`, `@react-native-ai/apple-llm` — declares `specificationVersion = 'v3'`. We ship V3.)

This writeup is a spec reference, not a competitor analysis. It captures exactly what the provider interface demands, so our Phase C implementation plan can be literal.

## Contract: `LanguageModelV3`

Source: `packages/provider/src/language-model/v3/language-model-v3.ts:8-61`

```ts
type LanguageModelV3 = {
  readonly specificationVersion: 'v3'
  readonly provider: string      // stable provider id, e.g. 'gemma'
  readonly modelId: string       // the model being used, free-form

  supportedUrls: PromiseLike<Record<string, RegExp[]>> | Record<string, RegExp[]>

  doGenerate(options: LanguageModelV3CallOptions): PromiseLike<LanguageModelV3GenerateResult>
  doStream(options: LanguageModelV3CallOptions): PromiseLike<LanguageModelV3StreamResult>
}
```

That's the whole interface. Two methods + three static properties. Everything else (`streamText`, `generateObject`, `useChat`, tool-execution loop) is AI-SDK-user-facing and built on these.

## Call options (input)

Source: `language-model-v3-call-options.ts`

Keys we must handle (not optional to "support" gracefully, but to either consume or surface as a stream-start warning):

- `prompt: LanguageModelV3Prompt` — list of role-tagged messages. See "Prompt format" below.
- `maxOutputTokens`, `temperature`, `topP`, `topK`, `presencePenalty`, `frequencyPenalty`, `stopSequences`, `seed` — map 1:1 to `GenerateOptions` on our `InferenceEngine`.
- `responseFormat` — `{ type: 'text' }` | `{ type: 'json', schema?: JSONSchema7, name?, description? }`. Feed to llama.rn's `response_format: { type: 'json_object', schema }`.
- `tools: Array<LanguageModelV3FunctionTool | LanguageModelV3ProviderTool>` — function-tool shape is already what llama.rn expects after trivial wrapping.
- `toolChoice: LanguageModelV3ToolChoice` — `'auto' | 'none' | 'required' | { type: 'tool', toolName }`.
- `includeRawChunks: boolean` — if true, also emit `type: 'raw'` parts in stream.
- `abortSignal: AbortSignal` — MUST wire to `engine.stopGeneration()`.
- `headers`, `providerOptions` — `providerOptions.gemma` (or matching key) is our passthrough slot.

## Prompt format (what we have to consume)

Source: `language-model-v3-prompt.ts`

```ts
type LanguageModelV3Message =
  | { role: 'system'; content: string }
  | { role: 'user'; content: Array<TextPart | FilePart> }
  | { role: 'assistant'; content: Array<TextPart | FilePart | ReasoningPart | ToolCallPart | ToolResultPart> }
  | { role: 'tool'; content: Array<ToolResultPart | ToolApprovalResponsePart> }
```

Key points:

- **Assistant messages can embed reasoning and tool-call parts** — we must serialize them back to the format llama.rn's Jinja template expects (OpenAI-style `tool_calls` array + `reasoning_content` on the assistant message).
- **Tool role messages carry `ToolResultPart[]`**, where the output is one of 7 variants: `text`, `json`, `execution-denied`, `error-text`, `error-json`, `content` (rich multimodal content with sub-parts). Most providers collapse all of these to a JSON string in the chat template; we should too, except `execution-denied` → the reason string.
- **File parts** carry `data: Uint8Array | URL | string` and a `mediaType`. Must convert to llama.rn's `data:` URL form when mmproj is present.
- **Reasoning parts** on assistant messages are history-only (past turns). We put them in the `reasoning_content` slot of our `Message` if llama.rn's chat template consumes it — otherwise drop with a warning.

## Stream output (what we must emit)

Source: `language-model-v3-stream-part.ts:12-106`

The stream-part union (17 variants):

```
stream-start { warnings }
  text-start / text-delta / text-end              (streaming body)
  reasoning-start / reasoning-delta / reasoning-end (CoT / thinking)
  tool-input-start / tool-input-delta / tool-input-end  (per-tool streaming args)
  tool-call (type: 'tool-call', toolCallId, toolName, input: string)
  tool-result (when providerExecuted)
  tool-approval-request
  file                                            (binary/blob output)
  source
response-metadata                                 (provider-specific metadata)
finish { finishReason, usage, providerMetadata }
raw (only if includeRawChunks: true)
error { error }
```

**Required sequencing invariants:**
- Any `-delta` must be preceded by a matching `-start` with the same `id`, and closed by a `-end`.
- `finish` is terminal and emitted exactly once.
- `tool-input-*` describes argument-delta streaming. The finished `tool-call` part (with the full `input` JSON string) should follow the matching `tool-input-end`.
- `stream-start` is first and carries any warnings (e.g. unsupported toolChoice variant, dropped param).

## Content format (non-streaming `doGenerate`)

Source: `language-model-v3-content.ts`

```ts
type LanguageModelV3Content =
  | LanguageModelV3Text
  | LanguageModelV3Reasoning
  | LanguageModelV3File
  | LanguageModelV3ToolApprovalRequest
  | LanguageModelV3Source
  | LanguageModelV3ToolCall
  | LanguageModelV3ToolResult
```

`doGenerate` returns `{ content: Content[], finishReason, usage, providerMetadata?, warnings, request?, response? }` (language-model-v3-generate-result.ts:11-63).

## Tool call / result shape

Source: `language-model-v3-tool-call.ts`, `language-model-v3-tool-result.ts`

- `ToolCall.input: string` — the arguments are **a JSON string**, not a parsed object. AI SDK parses it downstream against the tool schema. This matches llama.rn's output shape (`tool_calls[i].function.arguments` is a JSON string), so we pass it through literally.
- `ToolCall.providerExecuted?: boolean` — set to true when the provider ran the tool itself (used by Apple-LLM provider, potentially by us if we keep skills inside the provider).
- `ToolResult.result: JSONValue` — a parsed object, not a string. Important: when we emit tool-result stream parts from provider-executed skill runs, the shape differs from the prompt-consumed `ToolResultPart.output` which has a richer tagged union.

## Tools shape (input)

Source: `language-model-v3-function-tool.ts`

```ts
type LanguageModelV3FunctionTool = {
  type: 'function'
  name: string
  description?: string
  inputSchema: JSONSchema7    // NOT "parameters" — the field is "inputSchema" now in V3
  inputExamples?: Array<{ input: JSONObject }>
  strict?: boolean
  providerOptions?: SharedV3ProviderOptions
}
```

Gotcha: `inputSchema`, not `parameters`. When passing to llama.rn (which uses OpenAI's older `parameters` key), we rename. See `@react-native-ai/llama`'s one-liner (ai-sdk.ts:410-413):

```ts
completionOptions.tools = options.tools.map(({ type, ...tool }) => ({
  type,
  function: tool,  // (tool still has name, description, inputSchema as "parameters" — wait, this is buggy upstream)
}))
```

Actually, their adapter passes `inputSchema` under the `function` key verbatim — llama.rn ignores unknown keys, so they effectively **lose the schema**. Another pain point not filed as an issue: their tools tell the model the tool names but not the parameter schema. We should explicitly rename `inputSchema` → `parameters` when calling llama.rn.

## Finish reason

Source: `language-model-v3-finish-reason.ts`

```ts
type LanguageModelV3FinishReason = {
  unified: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other'
  raw?: string
}
```

Mapping from llama.rn: we already have the pattern in `convertFinishReason` (see the callstack llama writeup). `stopped_eos` / `stopped_word` → `stop`, `stopped_limit` → `length`, presence of `tool_calls` → `tool-calls`.

## Usage shape

Source: `language-model-v3-usage.ts`

```ts
type LanguageModelV3Usage = {
  inputTokens?: { total: number; noCache?: number; cacheRead?: number; cacheWrite?: number }
  outputTokens?: { total: number; text?: number; reasoning?: number }
}
```

We fill `inputTokens.total = result.timings.prompt_n`, `outputTokens.total = result.timings.predicted_n`, rest undefined.

## What the spec tells us we MUST do that competitors don't

Cross-referenced against the three competitor writeups:

1. **Respect `options.abortSignal`** — none of llama / mlc / apple wire it. We must.
2. **Emit `tool-input-start` / `-delta` / `-end`** — only llama emits the final `tool-call`; none emit streaming arg deltas. Our llama.rn (via `TokenData.tool_calls`) can support this.
3. **Pass `options.providerOptions`** down to the engine — llama drops it entirely (issue #199). We forward the whole `providerOptions.gemma` (or `.llama`) bag.
4. **Emit `stream-start` warnings for downgrades** — today they either `console.warn` (MLC on bad `toolChoice`) or silently drop (llama `tool-result` in assistant history). We emit via warnings.
5. **Rename `inputSchema` → `parameters`** for llama.rn — llama upstream has this bug.
6. **Expose `providerMetadata.gemma.timings`** — llama.rn's `timings` object is rich; wrap it like MLC does.
7. **Handle the 7 ToolResultPart output variants cleanly** — most adapters collapse to `JSON.stringify`. That's acceptable, but `execution-denied` should surface as a prompt string that explicitly says "User denied execution: {reason}", otherwise the model may retry.
