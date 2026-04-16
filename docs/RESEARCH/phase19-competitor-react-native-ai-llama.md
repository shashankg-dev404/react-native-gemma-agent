# Phase 19 Competitor Analysis — `@react-native-ai/llama`

- **Repo**: https://github.com/callstackincubator/ai (monorepo, `packages/llama/`)
- **Version analyzed**: `0.12.0` (latest on `main` as of 2026-04-16)
- **License**: **MIT** — free to fork/port with attribution
- **Dependencies**: `@ai-sdk/provider ^3.0.5`, `@ai-sdk/provider-utils ^4.0.1`, `react-native-blob-util`, `zod`, peer `llama.rn ^0.10.1`, peer `react-native >= 0.76.0`
- **Npm name**: `@react-native-ai/llama`
- **Author**: Szymon Rybczak (Callstack), with Mike Grabowski. Part of the larger `react-native-ai` umbrella.

## Architecture: RN native → JS → AI SDK parts

1. **Transport layer**: pure JS wrapper over `llama.rn` — no custom TurboModule, no JSI additions. Delegates all native interaction to `llama.rn`'s existing `LlamaContext` (packages/llama/src/ai-sdk.ts:22-26, 315-319).
2. **Streaming mechanics**: opens `context.completion(params, tokenCallback)` and fans each `TokenData` out to a `ReadableStream<LanguageModelV3StreamPart>`. The `tokenCallback` is a synchronous function; each token enqueues directly into the controller (ai-sdk.ts:548-624).
3. **Cancellation**: `ReadableStream.cancel` → `context.stopCompletion()` (ai-sdk.ts:660-662). No abort-signal plumbing from AI SDK call options (which is a gap — see pain points).
4. **Prompt format**: converts `LanguageModelV3Prompt` → internal `LLMMessage[]` (role-tagged, with content parts), then passes to llama.rn's chat-template Jinja engine via `completion({ messages })`. Media (images/audio) becomes base64 `data:` URLs or `file://` URLs on a per-part basis (ai-sdk.ts:93-145).
5. **Ctx shift**: when a multimodal projector is attached, `ctx_shift: false` is forced — this is a llama.rn constraint for mmproj (ai-sdk.ts:317-320).
6. **Polyfill requirement**: requires `ReadableStream` in the RN JS environment; throws a `TypeError` pointing to `web-streams-polyfill` if missing (ai-sdk.ts:483-487, 197-201).

## Provider shape

```ts
import { llama, createLlamaProvider } from '@react-native-ai/llama'

// Default provider (shared instance)
const model = llama.languageModel('owner/repo/file.gguf', { contextParams: { n_ctx: 4096 } })

// Or create a scoped provider
const provider = createLlamaProvider()
const model2 = provider.languageModel(path, opts)

// Non-text models
provider.textEmbeddingModel(path, { normalize: -1, contextParams: ... })
provider.rerankModel(path, { contextParams: { pooling_type: 'rank' } })
provider.speechModel(path, { vocoderPath: 'vocoder.gguf' })
```

- **Model ID convention**: `owner/repo/filename.gguf` (HuggingFace). Their `parseModelId` splits on `/` and requires exactly this shape (storage.ts:16-29).
- **`modelId` property**: set to the local file path, not the HF id — intentional since AI SDK uses `modelId` for logging/telemetry (ai-sdk.ts:291-293).
- **`supportedUrls`**: dynamically returns `image/*` + `audio/*` patterns when a projector is configured, else `{}` (ai-sdk.ts:277-285). Only `file://` and `data:` schemes — HTTP URLs are not supported.
- **Lifecycle**: consumer must explicitly `await model.prepare()` before first use or the adapter prints a `console.warn` on every call (ai-sdk.ts:380-383). No lazy-load-on-demand.
- **Cleanup**: `model.unload()` releases native context + multimodal buffers (ai-sdk.ts:364-373).

## Tool-calling bridge

- **Input mapping**: AI SDK `tools[]` (union of `LanguageModelV3FunctionTool` and `LanguageModelV3ProviderTool`) is passed through as `{ type: 'function', function: { name, description, parameters } }` directly to `llama.rn`'s `completion()` — no schema rewriting (ai-sdk.ts:409-415). Relies fully on llama.rn's Jinja + native PEG tool-call parser.
- **Output mapping**:
  - `doGenerate`: reads `response.tool_calls` and emits a `type: 'tool-call'` content part with `input: toolCall.function.arguments` (a JSON **string**, not parsed — matches the V3 spec at language-model-v3-tool-call.ts:22-23) (ai-sdk.ts:434-443).
  - `doStream`: waits for the `</tool_call>` literal token from llama.rn, then emits a single `tool-call` stream-part per tool (ai-sdk.ts:569-580). **Does not** emit `tool-input-start` / `tool-input-delta` / `tool-input-end` — the UI sees the finished call only.
- **`toolChoice`**: passed through as a string; defaults to `'auto'` if not specified (ai-sdk.ts:414, 510). No normalization of the richer V3 `toolChoice` union (e.g. `{ type: 'tool', toolName }`).
- **Tool results**: consumer-executed. In `prepareMessagesWithMedia`, `tool-result` parts from an assistant message are dropped with a `console.warn` ("Model executed tools are not supported") — only tool-role messages produce tool turns (ai-sdk.ts:174-220).
- **Streaming mechanics for thinking + tool-call**: a tiny state machine with four states (`text` | `reasoning` | `tool-call` | `none`), driven by matching literal `<think>` / `</think>` / `<tool_call>` / `</tool_call>` tokens from the tokenizer stream (ai-sdk.ts:28, 250-254, 520-622). This is **known-broken for tokenizers that split those tags** (see issue #199).

## Streaming mechanics

- **Transport**: `ReadableStream` per call. No AsyncIterable fallback.
- **Backpressure**: none — tokens are enqueued as fast as llama.rn emits them. If downstream is slow, memory grows. No user-facing knob.
- **Cancellation**: `stream.cancel()` → `context.stopCompletion()`. No propagation of `options.abortSignal` — if you pass `AbortSignal`, it's ignored (ai-sdk.ts:660-662 vs language-model-v3-call-options.ts:109-111).
- **Warnings**: emits `stream-start` with an empty warnings array always (ai-sdk.ts:527-530). Does not surface provider-level warnings (unsupported params, missing polyfills, etc.).

## What's good — worth copying or forking

All MIT. Specific files worth porting or adapting:

1. **State-machine token classifier** (ai-sdk.ts:520-624) — the approach of driving a tiny FSM over literal special tokens to split text / reasoning / tool-call is a clean design. We'd re-implement, not fork verbatim, because our `FunctionCallParser` already covers the fallback text-scan path.
2. **`prepareMessagesWithMedia`** (ai-sdk.ts:93-225) — clean mapping from V3 prompt into llama.rn's chat-template-friendly `LLMMessage[]`. Especially the `tool-result` → `role: 'tool'` conversion (lines 205-220). We can port the shape and adapt to our `Message` type.
3. **`convertFinishReason`** (ai-sdk.ts:48-69) — the translation of llama.rn's `stopped_eos` / `stopped_word` / `stopped_limit` to V3's `{ unified, raw }` pair. Directly reusable.
4. **Model-path / HuggingFace storage helpers** (storage.ts:1-110) — MIT; we already have `ModelManager`, so copy only the shape of the `owner/repo/filename.gguf` id convention and their `parseModelId`.
5. **`createLlamaProvider` shape** (ai-sdk.ts:1089-1158) — callable provider with `.languageModel` / `.textEmbeddingModel` / etc. methods. This is the AI SDK provider convention — we should follow it exactly.

## Pain points — top issues from GitHub

Searched `gh search issues --repo callstackincubator/ai` sorted by comment count and reactions; filtered to issues that touch the llama package (apple/mlc issues noted separately).

| Rank | Issue | Title | Sev | One-liner |
|---|---|---|---|---|
| 1 | [#199](https://github.com/callstackincubator/ai/issues/199) | AI SDK adapter does not support native reasoning extraction or `providerOptions` passthrough | High | `providerOptions` from `streamText`/`generateText` never reaches `context.completion`, so `enable_thinking` / `reasoning_format` can't be toggled. Reasoning detection is literal string match on `<think>`, which fails when the tokenizer splits the tag into `[`, `think`, `]`. |
| 2 | [#206](https://github.com/callstackincubator/ai/issues/206) | Gemma4 E2B does not load into memory using this library | High | Open bug: Gemma 4 E2B won't load. User asks when Gemma 4 arch support will come. |
| 3 | [#201](https://github.com/callstackincubator/ai/issues/201) | Android and iOS installation problem | Med | Missing android/ios folders after install. Likely a publish-config / `react-native-builder-bob` issue. |
| 4 | [#146](https://github.com/callstackincubator/ai/issues/146) | Missing polyfills and supported Expo/RN versions | Med | Users have to hand-patch the package and hit TurboModule signature mismatches on older RN. No version matrix documented. |
| 5 | [#148](https://github.com/callstackincubator/ai/issues/148) | MLC tool calling & Android equivalent of Apple Intelligence | Med | Enhancement, but the pattern (tool calling on Android) affects how users pick between `@react-native-ai/llama` vs `@react-native-ai/mlc`. |

Closed PRs / issues worth noting:
- **#73** `feat(mlc): add support for tool calling` — closed, shipped. Shows how they route tool results back.
- **#165** plans to add Function Gemma 270M — closed, not added yet.

## What we can do better (Phase 19 design points)

Each of the top pain points maps to a design decision for our adapter:

1. **#199 (reasoning + providerOptions passthrough)** → our adapter MUST forward `options.providerOptions.gemma` (or `.llama`) straight into `InferenceEngine.generate`'s `GenerateOptions`. This is exactly where we ship `enable_thinking`, `reasoning_format`, `force_pure_content`, etc. And we already use llama.rn's `reasoning_content` field (InferenceEngine.ts:321) so detection is tokenizer-free.
2. **#206 (Gemma 4 won't load)** → we already ship working Gemma 4 E2B via llama.rn `0.12.0-rc.3+` (see `memory/project_llamarn_version.md`). Our Phase 22 `llama.rn` pin + auto-quant selection directly addresses this for AI SDK users.
3. **#201 / #146 (install + polyfill pain)** → document a version matrix in the Phase 19 ADR, and expose the adapter as a subpath (`react-native-gemma-agent/ai`) so users who don't want AI SDK don't pay the `@ai-sdk/provider` dependency cost. Also require `react-native >= 0.76` only, not `>= 0.80`.
4. **Tool-call streaming gap** (no `tool-input-start/delta/end` parts, ai-sdk.ts:569-580) → our adapter should emit these. AI SDK's `useChat()` uses them to render "calling tool X…" UI as arguments stream. We can map them from `TokenData.tool_calls` deltas.
5. **Ignored `abortSignal`** → wire `options.abortSignal` to `InferenceEngine.stopGeneration()`. Trivial, not done upstream.
6. **Tool bridging is one-way** — llama's adapter has no concept of auto-executing skills. Our `AgentOrchestrator` already has the skill-exec loop; we expose skills as standard AI SDK `tools` and let the AI SDK's own tool-execution loop drive, OR we can run the loop provider-side and emit `providerExecuted: true` tool-call / tool-result parts. This is a deliberate design fork in Phase C.
