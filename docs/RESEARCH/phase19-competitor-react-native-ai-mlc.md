# Phase 19 Competitor Analysis — `@react-native-ai/mlc`

- **Repo**: https://github.com/callstackincubator/ai (monorepo, `packages/mlc/`)
- **License**: MIT
- **Analyzed from**: `packages/mlc/src/` on `main` (2026-04-16)
- **Transport**: TurboModule (`MLCEngine`) backed by native MLC-LLM runtime on iOS and Android.
- **Dependencies**: `@ai-sdk/provider` (V3), `react-native >= 0.76`.

## Architecture: RN → JS → AI SDK parts

1. **Native layer**: a TurboModule named `MLCEngine` exposes `generateText`, `streamText`, `cancelStream`, `downloadModel`, `prepareModel`, `unloadModel`, plus three RN `EventEmitter`s: `onChatUpdate`, `onChatComplete`, `onDownloadProgress` (NativeMLCEngine.ts:97-120).
2. **JS adapter**: `MlcChatLanguageModel` implements `LanguageModelV3`. `doGenerate` is one request-response; `doStream` opens a stream via `streamText` and subscribes to the update + complete events, converting each to `LanguageModelV3StreamPart`s (ai-sdk.ts:135-304).
3. **Cancellation**: `stream.cancel()` → `cancelStream(streamId)`. Each stream has a native-side id returned by `streamText()` (ai-sdk.ts:230-233, 289-294). Cleanup removes RN event listeners.

## Provider shape

```ts
export const mlc = {
  languageModel: (modelId: string = 'Llama-3.2-3B-Instruct') => new MlcChatLanguageModel(modelId)
}
```

- Only a `languageModel` method — no embedding / rerank / speech variants (contrast with llama package which has 4).
- **Model ID convention**: free-form string matching MLC's model catalog (e.g. `'Llama-3.2-3B-Instruct'`, `'Phi-3.5-mini'`). The TurboModule resolves this to a downloaded native bundle.
- **Lifecycle**: `prepare()` → `NativeMLCEngine.prepareModel(modelId)`, `download()` → `downloadModel(modelId)` with progress via the emitter, `unload()` → `unloadModel()`, `remove()` → `removeModel(modelId)` (ai-sdk.ts:96-114).
- No `supportedUrls` — empty object, because MLC does not consume external file/image URLs.

## Tool-calling bridge

- **Input**: AI SDK tools → native format via `convertToolsToNativeFormat` (ai-sdk.ts:25-49). **Lossy**: extracts only `description` per parameter — drops types, `required`, `enum`, nested shapes. MLC's native side gets `parameters: Record<string, string>` (parameter name → description) rather than a JSON Schema.
- **`toolChoice`**: mapped to `'none'` or `'auto'`. `required` / `tool: { toolName }` variants are logged as `console.warn` and fall back to `'none'` (ai-sdk.ts:51-64). This is a real-world AI-SDK feature regression vs llama package.
- **Output**:
  - `doGenerate`: reads `response.tool_calls` and emits `tool-call` content parts. Notably, it **stringifies `arguments` manually** (`JSON.stringify(toolCall.function.arguments || {})`) because the TurboModule returns arguments as `Record<string, string>`, not a JSON string (ai-sdk.ts:159-167).
  - `doStream`: **does not stream tool calls at all**. Only `text-delta` is enqueued during streaming; the only other part is the final `finish` (ai-sdk.ts:240-281). If the model calls a tool, it surfaces as `finish_reason: 'tool_calls'` but no `tool-call` stream-part. This is a gap.
- **No reasoning** support at all in this provider.

## Streaming mechanics

- Native `streamText` returns a string `streamId` synchronously (via Promise). RN event subscriptions are added; events are filtered by `streamId` implicitly because they are per-stream emitters.
- No abort-signal wiring. `stream.cancel()` is the only path.
- Emits `text-start` / `text-delta*` / `text-end` / `finish` — a flat shape with no reasoning, tool-call, or file parts.
- `providerMetadata.mlc.extraUsage` surfaces the rich MLC timings (`ttft_s`, `prefill_tokens_per_s`, `decode_tokens_per_s`, `jump_forward_tokens`) — ai-sdk.ts:183-189, NativeMLCEngine.ts:17-27. Useful pattern; we should expose the same for llama.rn via `providerMetadata.gemma`.

## What's good — worth copying or forking

1. **Clean TurboModule spec shape** (NativeMLCEngine.ts:97-120) — good reference for the eventual on-device backends section of our architecture. Not immediately useful for Phase 19 (we sit on llama.rn, not a native TurboModule), but useful for Phase 25 (Vulkan / Hexagon).
2. **`providerMetadata.extraUsage` pattern** (ai-sdk.ts:183-189, 271-277) — we should surface `timings` from llama.rn in the same slot.
3. **Per-stream cleanup discipline** (ai-sdk.ts:220-226, 283) — listeners in an array; cleanup function removes them all. Applicable to any RN-event-based stream, including what we'd use for native backends.

## Pain points — top issues

| Rank | Issue | Title | Sev | One-liner |
|---|---|---|---|---|
| 1 | [#148](https://github.com/callstackincubator/ai/issues/148) | MLC tool calling & Android equivalent of Apple Intelligence | High | Blocked label. Tool calling on MLC is still incomplete end-to-end. |
| 2 | [#140](https://github.com/callstackincubator/ai/issues/140) (closed) | feat(mlc): Improve Android DX | Med | Android DX was the main complaint — build errors, missing native artifacts. |
| 3 | [#193](https://github.com/callstackincubator/ai/pulls) | feat: build MLC iOS for iPhone & simulator | Med | Open PR, `Blocked` label. Simulator + device unified build is non-trivial. |
| 4 | [#133](https://github.com/callstackincubator/ai/issues/133) (closed) | `'tvm/runtime/packed_func.h'` file not found | Med | Common MLC-LLM submodule build failure. |
| 5 | [#105](https://github.com/callstackincubator/ai/issues/105) (closed) | `mlc-llm` project has changed structure, need update podspec | Med | MLC upstream churn breaks the package periodically. |

## What we can do better (Phase 19 design points)

1. **Don't lossy-map tool parameters** — always pass JSON Schema through to llama.rn. Our `SkillRegistry.toToolDefinitions` already produces a proper schema (SkillRegistry.ts:78-94). We just forward it, not reshape it.
2. **Do stream tool calls** — MLC can't, we can. llama.rn exposes `TokenData.tool_calls` progressively; we can emit `tool-input-start` / `tool-input-delta` / `tool-input-end` / `tool-call` parts so the UI can render tool args as they are decoded.
3. **Expose rich `providerMetadata.gemma.timings`** — copy the MLC pattern exactly (ttft, prefill tps, decode tps). These are the numbers LinkedIn evaluators screenshot.
4. **Don't silently downgrade toolChoice** — if a caller passes `{ type: 'tool', toolName }`, pass it through to llama.rn, which supports it. If llama.rn ever drops support, emit a stream-start warning instead of a `console.warn` (AI SDK best practice).
5. **Keep a single llama.rn-style provider** — we don't need to fragment into `gemma/llama` + `gemma/mlc` packages. One provider, multi-model via Phase 21.
