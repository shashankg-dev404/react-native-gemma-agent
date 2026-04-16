# Phase 19 Synthesis — Vercel AI SDK Adapter (V3)

> **Scope**: Consolidates the four Phase A competitor writeups (`phase19-competitor-*.md`) into one design-ready document. Produces the pain-point ranking, component→V3 mapping, concrete shape mismatches, differentiator surfaces, porting decisions (license-annotated), and open questions Phase C / ADR-006 must resolve.
>
> **Resolved before this doc** (do not relitigate):
> - Target `LanguageModelV3` / `@ai-sdk/provider ^3.x`. V2 is superseded.
> - Skills run **provider-executed** inside the adapter. Consumer-supplied `tools` on `streamText` still run client-side; both coexist.
> - No separate Apple-LLM writeup; its `globalThis.__APPLE_LLM_TOOLS__` pattern informed the provider-executed design.

---

## 1. Unified pain-point ranking (across four competitors)

Scored as `frequency (# competitors affected) × severity (1–5)`. A pain-point is "affecting" a competitor if it ships broken OR if the competitor doesn't have the surface at all (i.e., `react-native-executorch`'s missing AI SDK provider counts as "affected" for every AI-SDK-only pain point because its users literally cannot do the thing).

| # | Pain point | Freq | Sev | Score | Who's affected (citations) | Our answer |
|---|---|---:|---:|---:|---|---|
| 1 | **Tool-call argument streaming missing or broken** — no `tool-input-start / -delta / -end` emitted, so `useChat()` can't render "calling tool X with args …" as args decode | 4 | 4 | **16** | llama (ai-sdk.ts:569–580 emits only the finished `tool-call`); mlc (ai-sdk.ts:240–281 doesn't stream tool calls at all, just final `finish_reason: 'tool_calls'`); executorch (utils/llm.ts:15–46 — full-response regex, no streaming); AI SDK users on any of these get no live tool UI | Emit `tool-input-start/-delta/-end` from `TokenData.tool_calls` progressive updates, then final `tool-call` part. |
| 2 | **Tool parameter schema is lost in transit** — silent correctness bug, model gets tool NAME but not parameter shape | 2 | 5 | **10** | llama (ai-sdk.ts:409–415 passes V3 `inputSchema` under `function.inputSchema` but llama.rn reads `function.parameters` — drops the schema); mlc (ai-sdk.ts:25–49 `convertToolsToNativeFormat` collapses JSON Schema to `Record<string, string>` of param descriptions only, no types/required/enum); issue [#201](https://github.com/callstackincubator/ai/issues/201) indirectly | Explicit `inputSchema` → `parameters` rename at the V3→llama.rn boundary; pass full JSON Schema through untouched (our `SkillRegistry.toToolDefinitions` already produces this shape: SkillRegistry.ts:78–94). |
| 3 | **`options.abortSignal` ignored** — only `stream.cancel()` works; AI SDK users wiring abort controllers are silently not-cancelling | 3 | 3 | **9** | llama (ai-sdk.ts:660–662 vs language-model-v3-call-options.ts:109–111); mlc (ai-sdk.ts:230–233 — same); executorch (has `interrupt()` on the hook, not on an AI SDK contract) | Wire `options.abortSignal.addEventListener('abort', …)` → `InferenceEngine.stopGeneration()`; also wire `ReadableStream.cancel` for the llama-compat path. |
| 4 | **`providerOptions` passthrough dropped** — users can't toggle `enable_thinking`, `reasoning_format`, etc. from `streamText({ providerOptions: { … } })` | 2 | 4 | **8** | llama (issue [#199](https://github.com/callstackincubator/ai/issues/199) — confirmed open, `providerOptions` never reaches `context.completion`); mlc (ai-sdk.ts has no providerOptions consumption at all) | Forward `options.providerOptions.gemma` straight into `InferenceEngine.generate`'s `GenerateOptions`; the passthrough slot is also where we expose `activeCategories`, `skillRouting`, etc. (see §4). |
| 5 | **Non-standard tool-result role in chat history** — breaks Jinja template correctness, model sees tool outputs as assistant speech | 2 | 4 | **8** | executorch (LLMController.ts:403–417 inserts tool responses as `role: 'assistant'`); llama (ai-sdk.ts:174–220 drops assistant-embedded `tool-result` parts with a `console.warn` — OK because V3 allows tool-role messages, but their "Model executed tools are not supported" warning blocks our provider-executed model); issue [#146](https://github.com/callstackincubator/ai/issues/146) | We always emit tool outputs as `role: 'tool'` with `tool_call_id` (AgentOrchestrator.ts:210–218 already does this). |
| 6 | **Reasoning detection by literal `<think>` string match** — fails when tokenizer splits the tag | 2 | 3 | **6** | llama (ai-sdk.ts:28, 250–254, 520–624 — state machine keyed on literal `<think>` / `</tool_call>` tokens, broken for multi-token splits, see issue #199); mlc has no reasoning support at all | Read `result.reasoning_content` from llama.rn directly (InferenceEngine.ts:322) — tokenizer-free. Emit `reasoning-start/-delta/-end` from this field. |
| 7 | **`toolChoice` variants silently downgraded** — `'required'` and `{ type: 'tool', toolName }` fall back to `'none'` or `'auto'` | 2 | 3 | **6** | mlc (ai-sdk.ts:51–64 emits `console.warn`, returns `'none'`); llama (ai-sdk.ts:414, 510 defaults to `'auto'`, no normalization of the richer V3 union) | Pass `{ type: 'tool', toolName }` through to llama.rn (it supports it); emit a `stream-start` warning if llama.rn rejects. Never silently downgrade. |
| 8 | **Model load failures — Gemma 4 / new models blocked on the library side** | 2 | 4 | **8** | llama (issue [#206](https://github.com/callstackincubator/ai/issues/206) — Gemma 4 E2B does not load, open); executorch (issue [#1062](https://github.com/software-mansion/react-native-executorch/issues/1062) Gemma 4 support, [#935](https://github.com/software-mansion/react-native-executorch/issues/935) Qwen 3.5 blocked) | Already fixed for us: llama.rn 0.12.0-rc.3+ pin (`memory/project_llamarn_version.md`). Phase 22 locks this in and extends to Qwen 3.5, MobileLLM-Pro, GLM 5.1. |
| 9 | **Install pain / missing version matrix / polyfill gotchas** | 2 | 3 | **6** | llama (issues [#201](https://github.com/callstackincubator/ai/issues/201), [#146](https://github.com/callstackincubator/ai/issues/146)); mlc (issues [#140](https://github.com/callstackincubator/ai/issues/140), [#133](https://github.com/callstackincubator/ai/issues/133), [#105](https://github.com/callstackincubator/ai/issues/105)) | (a) Ship adapter as subpath (`react-native-gemma-agent/ai`) so non-AI-SDK users don't pay the peer-dep cost. (b) Require `react-native >= 0.76` only. (c) Document `web-streams-polyfill` need upfront. (d) Matrix table in ADR-006. |
| 10 | **`providerMetadata` timings surface absent / inconsistent** — no ttft/prefill-tps/decode-tps exposure | 2 | 2 | **4** | llama (no `providerMetadata.llama.timings` wrapper); executorch (hook exposes tokens/sec via getters, not through AI SDK metadata) | Expose `providerMetadata.gemma.timings` in every `finish` part (mirror mlc's pattern: ai-sdk.ts:183–189, 271–277). |
| 11 | **Regex-based tool-call parsing (non-AI-SDK path)** — greedy `\[(.|\s)*\]` catches any bracket pair | 1 | 3 | **3** | executorch (utils/llm.ts:15–46) | We use llama.rn's native PEG parser (ADR-002) + a balanced-brace JSON-block fallback (FunctionCallParser.ts:94–112). |
| 12 | **Response doesn't set `stream-start` warnings** — consumers get `console.warn` spam instead of programmatic warnings | 2 | 2 | **4** | llama (ai-sdk.ts:527–530 always empty warnings array); mlc (console.warn for toolChoice downgrade) | Collect adapter-time warnings (unsupported param, polyfill absent, toolChoice downgrade) and emit them in `stream-start`. |

**Top three to feature in ADR-006's "what we fix on day one"**: #1 (streaming tool args), #2 (schema loss), #4 (providerOptions passthrough). These are the most visible AI-SDK-user-facing gaps in the leading competitor and are tractable in our adapter.

---

## 2. Component-to-LanguageModelV3 mapping

`LanguageModelV3` surfaces: `doGenerate`, `doStream`, tool-bridge (input + output direction via call options and stream parts), prompt-augmentation (system message manipulation before hand-off), below-adapter (pre-filters on the options before we build llama.rn params). "Below-adapter" means our code that runs before `context.completion()` is called.

| Our component | Source | V3 surface | Glue code (condensed) |
|---|---|---|---|
| `InferenceEngine.loadModel` / `.unload` | `src/InferenceEngine.ts:84–119, 220–228` | Provider lifecycle — NOT on LanguageModelV3 itself. Exposed as `model.prepare()` / `model.unload()` on our provider's returned model object (mirror llama's `@react-native-ai/llama` ai-sdk.ts:364–373). | `GemmaLanguageModel.prepare()` wraps `ModelManager` + `engine.loadModel`. |
| `InferenceEngine.generate` | `InferenceEngine.ts:125–204` | **Core of `doGenerate` and `doStream`**. In `doStream`, the `onToken` callback drives stream-part emission. | Convert `options.prompt` (V3Prompt) → our `Message[]`; convert `options.tools` (V3FunctionTool[]) → llama.rn `parameters`-keyed tools; call `engine.generate(messages, opts, onToken)`; map result → V3 content / stream parts. |
| `InferenceEngine.stopGeneration` | `InferenceEngine.ts:209–214` | `stream.cancel` handler + `options.abortSignal` listener in both `doGenerate` and `doStream`. | `options.abortSignal?.addEventListener('abort', () => engine.stopGeneration())`; mirror on stream.cancel. |
| `InferenceEngine.getContextUsage` | `InferenceEngine.ts:267–272` | `providerMetadata.gemma.contextUsage` on `finish`. Not first-class in V3. | Attach in `finish.providerMetadata` only; no stream-part. |
| `SkillRegistry.toToolDefinitions` | `SkillRegistry.ts:78–94` | **Tool bridge — input direction (skills→tools)**. Runs *below-adapter* to assemble the effective tools list we send llama.rn. | Adapter calls `registry.toToolDefinitions(activeCategories)` to get skills in OpenAI shape (parameters-keyed), merges with consumer-supplied `options.tools` (after `inputSchema`→`parameters` rename), hands to llama.rn. Skills are marked with a marker key (`providerExecuted: true` at emit time). |
| `SkillRegistry.getSkillsForCategories` | `SkillRegistry.ts:61–69` | **Below-adapter pre-filter** before tool list assembly. Driven by `providerOptions.gemma.activeCategories`. | Called once per `doGenerate`/`doStream` call before building the tool list. |
| `BM25Scorer` | `src/BM25Scorer.ts` (entire file) | **Below-adapter pre-filter** on the skill subset. Driven by `providerOptions.gemma.skillRouting === 'bm25'` + `maxToolsPerInvocation`. | Score skills against the latest user-role message's text content (flattened from V3 `TextPart[]`); take top-N; hand to llama.rn. |
| `FunctionCallParser.validateToolCalls` | `FunctionCallParser.ts:16–42` | **Validation gate** before emitting `tool-call` parts. Filters llama.rn's `result.toolCalls` to those that match a registered skill. | Unknown-tool calls get a `stream-start` warning and are dropped from the provider-executed path (but left in the `content` for consumer-supplied tool matching). |
| `FunctionCallParser.extractToolCallsFromText` | `FunctionCallParser.ts:52–89` | **Fallback** in both `doGenerate` and `doStream` when llama.rn's native parser emits zero tool calls but the text contains a JSON block. | Scan `result.text`; if matches, emit synthetic `tool-input-start/-end` + `tool-call` parts with a warning. Same behavior as today. |
| `AgentOrchestrator.sendMessage` | `AgentOrchestrator.ts:95–241` | **Runs inside `doStream` when skills are registered** (provider-executed path). The orchestrator's while-loop (`AgentOrchestrator.ts:115–222`) becomes the adapter's internal tool-execution loop, emitting `tool-call` (providerExecuted) + `tool-result` parts per iteration. | The orchestrator's loop is reused conceptually; we don't call `AgentOrchestrator` directly from the adapter because it owns conversation history. Instead we factor the loop into a `runAgentLoop(engine, registry, executor, messages, tools, onStreamPart)` helper used by both. See §3 mismatch #1 and §6 Q2. |
| `AgentOrchestrator.buildSystemPrompt` | `AgentOrchestrator.ts:291–306` | **Prompt-augmentation** — splices `KnowledgeStore.getIndex()` into the system message. | Adapter calls this (or inlines the same logic) before handing to llama.rn. Only if the provider was configured with a `KnowledgeStore` instance. |
| `AgentOrchestrator.checkConnectivity` | `AgentOrchestrator.ts:343–356` | Inside the provider-executed tool loop, per-skill. Same as today. | No AI-SDK surface — internal guard. |
| `KnowledgeStore.getIndex` | `KnowledgeStore.ts:263–279` | **Prompt-augmentation**. Runs in the adapter's system-prompt build step when the provider has a `knowledgeStore` config. | `system = baseSystem + '\n\n## Saved Notes…\n' + await knowledgeStore.getIndex()`. |
| `KnowledgeStore` (read/write actions) | `KnowledgeStore.ts:74–144, 150–201, 237–256` | Backs the `local_notes` skill (currently in skills catalog). Adapter surfaces these as provider-executed tool calls like any other skill. | No new surface — reuse existing `local_notes` skill registration. |
| `ModelManager` | `src/ModelManager.ts` | Behind `model.prepare()` / model id resolution. Below-adapter. | Not on LanguageModelV3; exposed as provider-method ergonomics. |
| `SkillSandbox` (component) | `src/SkillSandbox.tsx` | Provided to the adapter via the existing `SkillExecutor` callback — mount the sandbox in-app, wire it into the provider config (same as current SDK wiring). | `gemma.languageModel(id, { skillExecutor })`. |
| `Message` type | `src/types.ts:64–72` | V3Prompt ↔ our Message translation (both directions). | See §3 mismatch #2. |
| `ToolCall` type | `src/types.ts:55–62` | V3 `LanguageModelV3ToolCall` stream-part translation. | See §3 mismatch #5. |
| `SkillResult` type | `src/types.ts:163–167` | V3 `ToolResultPart.output` (7-variant union) translation when emitting `tool-result` stream parts (provider-executed) AND when converting consumer-supplied tool-role messages back to llama.rn. | See §3 mismatch #3. |
| `AgentEvent` (thinking/token/skill_called/skill_result/response/context_warning/error) | `src/types.ts:171–178` | Maps to V3 stream parts. Not 1:1. | See §3 mismatch #4. |

---

## 3. Mismatches to resolve

Concrete shape incompatibilities. Each entry: what the mismatch is, what we translate to, where the code lives.

### Mismatch 1 — AgentOrchestrator owns history; LanguageModelV3 is stateless

- **Our shape**: `AgentOrchestrator` holds `history: Message[]` and mutates it across turns (AgentOrchestrator.ts:50, 106, 159–162, 175–182, 210–218).
- **V3 shape**: `doGenerate` / `doStream` are **stateless** — every call receives the full `prompt: LanguageModelV3Prompt`. No per-model history.
- **Translation**: Factor out the tool-execution loop into a stateless helper. The adapter's `doStream` (a) receives the full V3 prompt, (b) converts to `Message[]`, (c) runs the agent loop against `engine` + `registry` + `executor`, emitting V3 stream parts per iteration, (d) returns once the loop exits (no tool calls this iteration). The orchestrator class stays for non-adapter consumers and for `useGemmaAgent`; its loop body is extracted into `runToolLoop(...)` that both it and the adapter use. ADR-006 will codify this factoring.

### Mismatch 2 — `Message.content: string` vs `LanguageModelV3Message.content: ContentPart[]`

- **Our shape**: `{ role, content: string, tool_calls?, tool_call_id?, name? }` (types.ts:66–72).
- **V3 shape**:
  - `system`: `content: string` (matches).
  - `user`: `content: Array<TextPart | FilePart>` — must flatten.
  - `assistant`: `content: Array<TextPart | FilePart | ReasoningPart | ToolCallPart | ToolResultPart>` — flatten text; extract `ToolCallPart`s into OpenAI-style `tool_calls: []`; put reasoning in llama.rn's `reasoning_content` slot on the message if the template consumes it, else drop with a warning; `ToolResultPart` on assistant is rejected with a warning (llama does the same: ai-sdk.ts:174–220).
  - `tool`: `content: Array<ToolResultPart | ToolApprovalResponsePart>` — each becomes a separate `{ role: 'tool', content: <stringified output>, tool_call_id }` message.
- **Translation**: new `prepareMessages(prompt: LanguageModelV3Prompt): Message[]` function ported from `@react-native-ai/llama`'s `prepareMessagesWithMedia` (MIT; ai-sdk.ts:93–225) with our `Message` as the target type. FilePart → base64 `data:` URL for Phase 22 multimodal; for Phase 19 text-only, FilePart produces a warning + drop.

### Mismatch 3 — `SkillResult` vs V3 `ToolResultOutput` (7 variants)

- **Our shape**: `{ result?: string; error?: string; image?: { base64: string } }` (types.ts:163–167).
- **V3 shape**: `output` is tagged union of:
  - `{ type: 'text', value: string }`
  - `{ type: 'json', value: JSONValue }`
  - `{ type: 'execution-denied', reason?: string }`
  - `{ type: 'error-text', value: string }`
  - `{ type: 'error-json', value: JSONValue }`
  - `{ type: 'content', value: Array<{ type: 'text' | 'media', ... }> }`
- **Translation (outbound, provider-executed skill → V3 `tool-result` part)**:
  - `SkillResult.error` present → `{ type: 'error-text', value: error }`
  - `SkillResult.image` present → `{ type: 'content', value: [{ type: 'text', text: result ?? '' }, { type: 'media', data: image.base64, mediaType: 'image/png' }] }`
  - `SkillResult.result` JSON-parseable → `{ type: 'json', value: JSON.parse(result) }`
  - else → `{ type: 'text', value: result ?? '' }`
- **Translation (inbound, consumer-supplied tool-role message → llama.rn `role: 'tool'`)**:
  - `text`: use `value` verbatim
  - `json`: `JSON.stringify(value)`
  - `execution-denied`: `"User denied execution: ${reason ?? 'no reason given'}"` (explicit, else model retries — per `phase19-competitor-vercel-ai.md` guidance)
  - `error-text` / `error-json`: `"Error: ${value}"` / `"Error: ${JSON.stringify(value)}"`
  - `content`: flatten text parts; media parts become `data:` URL references

### Mismatch 4 — `AgentEvent` vs V3 stream-part union

| Our `AgentEvent` | V3 stream parts emitted | Notes |
|---|---|---|
| `thinking` | `reasoning-start` (when `result.reasoning_content` is non-empty) | Only emit when actual reasoning exists; `thinking` today is a hook-only hint. |
| `token` | `text-delta` | Standard mapping. Opens `text-start` before first delta, closes `text-end` at end. |
| `skill_called { name, parameters }` | `tool-input-start { id, toolName, providerExecuted: true }` + `tool-input-delta`* + `tool-input-end` + `tool-call { toolCallId, toolName, input: <JSON string>, providerExecuted: true }` | Driven by `TokenData.tool_calls` progressive updates and llama.rn's final `result.toolCalls`. |
| `skill_result { name, result }` | `tool-result { toolCallId, toolName, output: <variant>, providerExecuted: true }` | `output` via mismatch #3 translation. |
| `response { text, reasoning }` | `text-end` + `finish { finishReason, usage, providerMetadata }` | Reasoning already closed via `reasoning-end`. |
| `context_warning { usage }` | No stream part. Surfaced via `providerMetadata.gemma.contextUsage` on `finish`, and via `stream-start.warnings` if above threshold at call start. | AI SDK has no "warning mid-stream" primitive; metadata is the idiomatic slot. |
| `error { error }` | `error { error }` (terminal) | Straightforward. |

### Mismatch 5 — `ToolCall.function.arguments` vs V3 `ToolCall.input`

- **Our shape**: `{ type: 'function', id, function: { name, arguments: string } }` (types.ts:55–62).
- **V3 shape**: `{ type: 'tool-call', toolCallId: string, toolName: string, input: string, providerExecuted?: boolean }` (language-model-v3-tool-call.ts).
- **Translation**: `{ type: 'tool-call', toolCallId: tc.id, toolName: tc.function.name, input: tc.function.arguments, providerExecuted: isSkill ? true : undefined }`. `input` is a JSON **string**, not a parsed object — our `arguments` already is one (llama.rn emits a string; see InferenceEngine.ts:315).

### Mismatch 6 — Finish reason

- **Our shape**: `{ stoppedEos: boolean, stoppedLimit: boolean, contextFull: boolean }` + `toolCalls[]` presence (types.ts:92–94).
- **V3 shape**: `{ unified: 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other', raw?: string }`.
- **Translation** (port `convertFinishReason` from llama: ai-sdk.ts:48–69, MIT):
  - `toolCalls.length > 0 && !stoppedEos` → `{ unified: 'tool-calls', raw: 'tool_calls' }`
  - `stoppedEos` → `{ unified: 'stop', raw: 'stopped_eos' }`
  - `stoppedLimit || contextFull` → `{ unified: 'length', raw: 'stopped_limit' }`
  - else → `{ unified: 'other', raw: 'unknown' }`

### Mismatch 7 — Tool-definition key: `parameters` vs `inputSchema`

- **Our shape / llama.rn shape**: `{ type: 'function', function: { name, description, parameters: JSONSchema7 } }` (SkillRegistry.ts:78–94, types.ts:38–53).
- **V3 shape**: `{ type: 'function', name, description?, inputSchema: JSONSchema7, ... }` (no `function` wrapper; key is `inputSchema`).
- **Translation**: at the adapter boundary (consumer V3 tools → llama.rn tools):
  ```ts
  const toolsForLlama = [...v3Tools, ...skillTools].map(t =>
    'inputSchema' in t
      ? { type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }
      : t // already in llama.rn shape (from SkillRegistry)
  );
  ```
  Fixes the latent bug in `@react-native-ai/llama` (ai-sdk.ts:409–415 passes `inputSchema` verbatim; llama.rn ignores unknown keys → schema silently dropped).

### Mismatch 8 — `toolChoice`

- **Our shape**: `'auto' | 'none' | string` (types.ts:111).
- **V3 shape**: `'auto' | 'none' | 'required' | { type: 'tool', toolName: string }`.
- **Translation**: pass `'auto' | 'none' | 'required'` through as strings to llama.rn. For `{ type: 'tool', toolName }`, pass `{ type: 'function', function: { name: toolName } }` — llama.rn accepts this shape via Jinja templates. If the model's chat template rejects, emit a `stream-start` warning and downgrade to `'required'` rather than `'none'`.

### Mismatch 9 — Usage shape

- **Our shape**: `CompletionTimings` with `promptTokens`, `predictedTokens`, speeds, ms (types.ts:74–81).
- **V3 shape**: `{ inputTokens?: { total, noCache?, cacheRead?, cacheWrite? }, outputTokens?: { total, text?, reasoning? } }`.
- **Translation**:
  - `inputTokens.total = timings.promptTokens`
  - `outputTokens.total = timings.predictedTokens`
  - `outputTokens.reasoning` = reasoning token count if `result.reasoning` non-empty (approximate: count via llama.rn tokenizer or leave undefined)
  - All speed/ms fields → `providerMetadata.gemma.timings`.

### Mismatch 10 — `InferenceEngineConfig.contextSize` is per-engine, not per-call

- **Our shape**: context size fixed at `loadModel`; `GenerateOptions.maxTokens` only caps per-call output.
- **V3 shape**: `maxOutputTokens` is per-call. No per-call context window knob.
- **Translation**: `options.maxOutputTokens` → `n_predict`. Context size stays a provider-creation-time setting (`gemma.languageModel(id, { contextSize: 8192 })`). This matches llama's provider (ai-sdk.ts:22–26).

### Mismatch 11 — `responseFormat` / JSON mode

- **Our shape**: no native `responseFormat` today.
- **V3 shape**: `responseFormat: { type: 'text' } | { type: 'json', schema?: JSONSchema7, name?, description? }`.
- **Translation**: pass to llama.rn's `response_format: { type: 'json_object', schema }`. Defer full grammar-constrained decoding to Phase 23. For Phase 19, forward the schema and rely on llama.rn's JSON mode; emit `stream-start` warning that validation isn't yet enforced (Phase 23 will add `jsonrepair` fallback — see §5 porting list).

---

## 4. Differentiators — how our unique surfaces show up in V3

V3 gives us three places to surface things competitors don't have: (a) tool metadata, (b) `providerMetadata` (on `finish` parts and responses), (c) `providerOptions` (as call-option input), (d) system-prompt augmentation (invisible to AI SDK but visible to the model). Plus one: provider-config knobs at `gemma.languageModel(id, { ... })` time.

| Differentiator | Where it surfaces | Exact API sketch |
|---|---|---|
| **Provider-executed skills (no one else auto-runs tools on-device)** | Tool metadata + stream parts. Each skill tool-call part carries `providerExecuted: true`. `tool-result` part follows without the consumer calling back. | Registered via existing `SkillRegistry` → `GemmaProvider` config. Consumer writes `streamText({ model, messages })` with NO `tools`; provider still executes registered skills. If consumer DOES pass `tools`, those are consumer-executed and coexist with provider-executed skills. |
| **Skill categories (ADR-003 / Phase 15)** | `providerOptions.gemma.activeCategories: string[]` on call options. | `streamText({ model, providerOptions: { gemma: { activeCategories: ['research'] } }, messages })`. Adapter applies `SkillRegistry.getSkillsForCategories` before building tool list. Also settable at provider creation as the default. |
| **BM25 skill routing (ADR-004)** | `providerOptions.gemma.skillRouting: 'all' \| 'bm25'` + `providerOptions.gemma.maxToolsPerInvocation: number`. | Adapter scores skills against the latest user-role message's flattened text before calling llama.rn. Zero cost when `skillRouting === 'all'`. Default `'all'`. |
| **KnowledgeStore / `local_notes` (ADR-005)** | (a) **System-prompt augmentation** — `KnowledgeStore.getIndex()` spliced into the system message when provider has a `knowledgeStore` config. (b) `local_notes` surfaces as a **provider-executed tool** like any other skill (read/search/save actions). (c) Optional: `providerMetadata.gemma.knowledgeBase.totalBytes` on `finish` for observability. | `gemma.languageModel(id, { knowledgeStore: myStore })`. No call-option surface needed for (a); (b) is automatic if `local_notes` is in `SkillRegistry`. |
| **WebView skill sandbox** | Not directly on the V3 surface — hidden implementation detail. Consumers wire `SkillSandbox` into their app once (same as today) and pass the executor to the provider. | `gemma.languageModel(id, { skillExecutor: sandbox.execute })`. Invisible to AI SDK. |
| **Context-usage visibility** | `providerMetadata.gemma.contextUsage: { used, total, percent }` on `finish` parts + `stream-start.warnings` when `percent >= threshold`. | No new surface for consumers; just richer metadata. |
| **Rich llama.rn timings** | `providerMetadata.gemma.timings: { promptMs, promptPerSecond, predictedMs, predictedPerSecond }` on `finish`. | Mirror mlc's `extraUsage` pattern. |
| **Android offline guard** | Inside the provider-executed tool loop, per-skill (existing `AgentOrchestrator.checkConnectivity`). Failure surfaces as a `tool-result.output = { type: 'error-text' }` with a specific message. | No new surface. |

**Explicit non-differentiators for Phase 19** (not shipped in ADR-006, deferred):
- `textEmbeddingModel`, `rerankModel`, `speechModel` variants (llama has 4; we ship `languageModel` only — Phase 24+).
- `generateObject` / structured-output enforcement (stub in ADR-006; full implementation in Phase 23 / future ADR-007).
- iOS parity (Phase 24).

---

## 5. Porting decisions — license-annotated

Each entry: `verbatim | with changes | re-implement | inspire only`. Every "fork" or "port" names the source path + line range and cites the license. All sources verified MIT or Apache-2.0.

### From `@react-native-ai/llama@0.12.0` (MIT — confirmed in Phase A writeup lines 3–8)

| Source | Range | Decision | Rationale |
|---|---|---|---|
| `convertFinishReason` | `packages/llama/src/ai-sdk.ts:48–69` | **Port with changes** — attest MIT; adapt input type from llama.rn's raw `NativeCompletionResult` shape to our already-mapped `CompletionResult` (InferenceEngine.ts:300–329). Outputs V3 `{ unified, raw }`. | Covers mismatch #6. Upstream logic is sound; we need a different input surface. |
| `prepareMessagesWithMedia` | `packages/llama/src/ai-sdk.ts:93–225` | **Port with changes** — attest MIT; target our `Message` type instead of upstream `LLMMessage`. Drop the "Model executed tools are not supported" warning on assistant-embedded tool-result parts since our provider-executed design emits those legitimately. | Covers mismatch #2. Their flattening logic is correct; type target differs. |
| `createLlamaProvider` callable-provider shape | `packages/llama/src/ai-sdk.ts:1089–1158` | **Inspire only** — AI SDK provider convention is a pattern, not copyrightable. Re-implement with our own code. | Keeps attribution surface minimal. |
| Token FSM state machine (text/reasoning/tool-call) | `packages/llama/src/ai-sdk.ts:28, 250–254, 520–624` | **Inspire only** — we use llama.rn's native `result.toolCalls` + `TokenData.tool_calls` + `reasoning_content` (InferenceEngine.ts:185–193, 322) directly; their FSM keyed on literal string tags is the buggy path (issue #199). | Don't port broken logic. Keep the idea of emitting `-start/-delta/-end` around content classes. |
| `parseModelId` / model-path helpers | `packages/llama/src/storage.ts:16–29, 1–110` | **Do not port** — we own `ModelManager` (`src/ModelManager.ts`) and the `owner/repo/file.gguf` id convention is trivial to re-derive if we want it. | Avoids adopting their opinion on download/storage. |
| Stream cancellation wiring | `packages/llama/src/ai-sdk.ts:660–662` | **Inspire only** — we add what they don't (abortSignal wiring). | Pain point #3. |

### From `@react-native-ai/mlc` (MIT — confirmed in writeup lines 4–6)

| Source | Range | Decision | Rationale |
|---|---|---|---|
| `providerMetadata.extraUsage` pattern | `packages/mlc/src/ai-sdk.ts:183–189, 271–277` + `NativeMLCEngine.ts:17–27` | **Inspire only** — mirror the shape (`providerMetadata.gemma.timings` with ttft, prefill_tps, decode_tps) but populated from llama.rn `result.timings`. | Differentiator #7 above. |
| Per-stream listener-cleanup discipline | `packages/mlc/src/ai-sdk.ts:220–226, 283` | **Inspire only** — not directly applicable (we don't use RN EventEmitters) but the "cleanup function in the stream" pattern is good hygiene. | Generic pattern. |
| `convertToolsToNativeFormat` | `packages/mlc/src/ai-sdk.ts:25–49` | **Do not port** — this is the bug (lossy Record<string, string>). Actively avoid. | Pain point #2. |

### From `react-native-executorch` (Apache-2.0 — needs per-file verification before port; Phase A writeup line 5 notes this)

| Source | Range | Decision | Rationale |
|---|---|---|---|
| `fixAndValidateStructuredOutput` | `packages/react-native-executorch/src/utils/llm.ts:99–116` | **Reserve for Phase 23** — port with changes when we implement `generateObject`. Verify Apache-2.0 on that file. | Covers mismatch #11 fallback path. |
| `LLMController` structure | `packages/react-native-executorch/src/LLMController.ts:19–72, 157–191` | **Inspire only** — validates our `AgentOrchestrator` shape; don't port. | Already have equivalent. |
| `parseToolCall` regex | `packages/react-native-executorch/src/utils/llm.ts:15–46` | **Do not port** — fragile greedy regex; we have the native PEG parser. | Pain point #11. |
| `capabilities`-gated TS overloads | `packages/react-native-executorch/src/useLLM.ts:20–27` | **Reserve for Phase 20** — not Phase 19. | DX pattern for declarative hook. |

### From `vercel/ai` (Apache-2.0 — writeup line 5)

| Source | Decision | Rationale |
|---|---|---|
| `@ai-sdk/provider` types (`LanguageModelV3`, stream parts, call options, content, tool-call, tool-result, finish-reason, usage, function-tool, provider-tool, prompt) | **Depend on as peer** (`@ai-sdk/provider ^3.x`). Do not vendor. | Upstream owns this surface. |
| No source files are copied from `vercel/ai` itself | — | — |

### Internal (our existing code — reused, not ported)

- `src/InferenceEngine.ts` — reused behind doGenerate/doStream.
- `src/SkillRegistry.ts` — reused; its `toToolDefinitions` is called below-adapter.
- `src/BM25Scorer.ts` — reused below-adapter on `options.tools` and on the skill subset.
- `src/FunctionCallParser.ts` — reused as validation gate and fallback text scan.
- `src/KnowledgeStore.ts` — reused in system-prompt augmentation.
- `src/AgentOrchestrator.ts` — **refactor required**: extract the tool-execution loop into a stateless helper `runToolLoop(...)` that both the orchestrator and the adapter use. This is a Phase 19 implementation task, not a porting task. The orchestrator itself stays for non-AI-SDK consumers.

---

## 6. Open questions for Phase C (ADR-006)

Decisions that need Shashank's input before the ADR is written:

### Q1 — Subpath export path

`react-native-gemma-agent/ai` (subpath of main package) vs. separate package (`@react-native-gemma-agent/ai`). Subpath is lighter ops (one package, one publish), matches `next/headers` convention. Separate package lets users not installing AI SDK avoid the peer dep cost. **Preference: subpath** — we already gate the `@ai-sdk/provider` dep to the subpath via `package.json` `exports`. Decision?

### Q2 — Orchestrator refactor scope

The adapter needs a stateless `runToolLoop` helper (see §5 "Internal"). Two options:
- **(A)** Extract the loop body from `AgentOrchestrator.sendMessage` into a pure function; have the orchestrator call it for its per-turn iteration. Clean, but touches `AgentOrchestrator.ts` — ~80 lines of churn.
- **(B)** Duplicate the loop in the adapter; accept drift over time. Smaller blast radius now, but we'll pay later.
Preference: **(A)**. OK to refactor `AgentOrchestrator.ts` in Phase 19?

### Q3 — `generateObject` / Phase 23 coupling

ADR-006 can: (a) declare `generateObject` OUT OF SCOPE and defer everything to Phase 23's ADR-007; (b) include a minimal `responseFormat: { type: 'json', schema }` passthrough to llama.rn's JSON mode (no validation / repair) and punt the repair loop to Phase 23; (c) include the full `jsonrepair` + Zod path now. Preference: **(b)** — pass-through is cheap and unblocks `generateObject` on simple schemas; Phase 23 adds the validation loop. Agreed?

### Q4 — Consumer tools + skills coexistence

Confirmed resolved in Phase A (both coexist). One open sub-question: if a consumer-supplied tool and a registered skill have the **same name**, which wins? Preference: **skill wins** (surface a warning). Alternative: consumer tool wins (treat registered skills as defaults). Pick?

### Q5 — Provider-executed loop max-depth

Reuse `AgentConfig.maxChainDepth` (default 5, AgentOrchestrator.ts:27) OR expose it on call options as `providerOptions.gemma.maxChainDepth`? Preference: **both** — provider-creation-time default, per-call override via `providerOptions`. Agreed?

### Q6 — `providerMetadata.gemma` tool surface for `local_notes`

Do we also expose `providerMetadata.gemma.knowledgeBase` (total bytes, note count, last modified) on `finish` parts for observability? Or keep that to `useKnowledgeStore` in the RN layer only? Preference: **skip for ADR-006**, keep it RN-layer. Agreed?

### Q7 — `gemma.languageModel` non-text variants

Llama ships `textEmbeddingModel` / `rerankModel` / `speechModel`. We ship only `languageModel` for Phase 19. OK to explicitly mark the other three as "future scope" in ADR-006's "Not in scope" section?

### Q8 — Warnings aggregation

Each call collects warnings (unsupported param, toolChoice downgrade, missing polyfill, FilePart dropped, reasoning-content lost, consumer-tool/skill name collision). These go into `stream-start.warnings` for `doStream` and into `generate result.warnings` for `doGenerate`. Do we want a singleton warning-logger on the provider too (so devs can read `provider.getRecentWarnings()`) or stream-start-only? Preference: **stream-start-only** — matches spec, no hidden state.

### Q9 — Package name framing in docs

Do we position the adapter as "the Gemma 4 provider for Vercel AI SDK" or as "a multi-model on-device provider that happens to ship Gemma 4 today" (anticipating Phase 21)? Preference: **latter framing** even in ADR-006, so Phase 21's multi-model work doesn't require a doc rewrite.

---

## 7. Phase C deliverable shape (preview)

ADR-006 (`docs/ADR/006-vercel-ai-sdk-compat.md`) will include:
1. Status / Context (pointing back to this synthesis).
2. Decision — target V3, provider-executed skills, subpath export, surfaces per §4.
3. Public API sketch — `gemma.languageModel`, `createGemmaProvider`, provider config, `providerOptions.gemma.*` schema.
4. Stream-part mapping table — §3 mismatches #4 + #5 formalized.
5. Pain points fixed on day one — §1's top 3 rows, explicitly.
6. Internal refactor — `runToolLoop` extraction from `AgentOrchestrator` (Q2 answer).
7. Out of scope — embeddings, rerank, speech, full `generateObject` validation, iOS.
8. Test plan — matrix (streamText × tools × abortSignal × providerOptions × skill-routing modes).
9. License attestations table (from §5).
10. Consequences + Risks.
