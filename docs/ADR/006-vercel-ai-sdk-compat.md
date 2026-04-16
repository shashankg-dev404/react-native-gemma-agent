# ADR-006: Vercel AI SDK Adapter — LanguageModelV3

## Status
Accepted (2026-04-17)

## Context

Two competing on-device RN inference providers already ship Vercel AI SDK
adapters (`@react-native-ai/llama`, `@react-native-ai/mlc`).
`react-native-executorch` does not — its users cannot use
`streamText` / `generateObject` / `useChat` at all. Our SDK currently
exposes `useGemmaAgent` only; consumers who have standardized on the
Vercel AI SDK cannot adopt us without a second mental model.

Phase A (`docs/RESEARCH/phase19-competitor-*.md`) read the four competitor
sources directly. Phase B (`docs/RESEARCH/phase19-synthesis.md`)
consolidated findings into a design-ready document: a unified pain-point
ranking, a component → V3 mapping, 11 concrete shape mismatches,
differentiator surfaces, and license-annotated porting decisions.

Key forces:
- **V3, not V2** — every active competitor declares
  `specificationVersion = 'v3'` and depends on `@ai-sdk/provider` 3.x.
  `LanguageModelV2` is superseded. `docs/PLAN.md:36` still reads "V2";
  this ADR codifies the V3 target.
- **Leading competitor has day-one-fixable gaps** — synthesis §1 ranks
  12 pain points; top three (`tool-input-start/-delta/-end` missing,
  `inputSchema`→`parameters` silent schema loss, `abortSignal` ignored)
  are all tractable inside our adapter.
- **Our moat (skills + categories + BM25 + KnowledgeStore) must survive
  the translation to V3** — synthesis §4 identifies the V3 surfaces
  (`providerOptions`, `providerMetadata`, provider config, tool stream
  parts with `providerExecuted: true`) that carry each differentiator.
- **Our internals need one refactor** — `AgentOrchestrator.sendMessage`
  (AgentOrchestrator.ts:95–241) owns conversation history; V3
  `doGenerate` / `doStream` are stateless. The agent loop body must be
  factored into a stateless helper so both the orchestrator and the
  adapter can reuse it.

Target PLAN row: `docs/PLAN.md:33–44` (Phase 19, v0.3.0 "Close the Reach
Gap").

## Decision

Ship a LanguageModelV3 provider for our inference stack, exported as the
`react-native-gemma-agent/ai` subpath.

### Core target

- `specificationVersion: 'v3'`
- `@ai-sdk/provider ^3.x` as a peer dependency (Apache-2.0; synthesis §5)
- Subpath-gated peer dep: consumers not on the AI SDK pay no install
  cost (per synthesis §1 pain #9)

### Provider-executed skills coexist with consumer-supplied tools

Registered skills (`SkillRegistry`) run **provider-executed**: the
adapter runs the tool-loop internally, emits `tool-call` /
`tool-result` stream parts with `providerExecuted: true`, and never
asks the consumer to supply an `execute` callback for them. Any tools
the consumer passes to `streamText({ tools })` are **consumer-executed**
in the standard AI SDK way and coexist with skills in the same turn.

On **name collision**, the skill wins and the adapter emits a
`stream-start` warning naming the dropped consumer tool (Q4).

### Positioning

The adapter ships as "a multi-model on-device provider for the Vercel
AI SDK" that happens to run Gemma 4 today; Phase 21 (multi-model
support) does not require a doc rewrite (Q9).

### Resolved API shape

- Subpath export (Q1): `react-native-gemma-agent/ai`
- Extract stateless `runToolLoop` from `AgentOrchestrator` (Q2): yes,
  Phase 19 implementation task
- `generateObject` (Q3): `responseFormat` passthrough to llama.rn JSON
  mode in Phase 19; full repair / Zod validation deferred to Phase 23
  (ADR-007)
- `maxChainDepth` (Q5): provider-creation default **and**
  `providerOptions.gemma.maxChainDepth` per-call override
- `providerMetadata.gemma.knowledgeBase` (Q6): skip for ADR-006
- `textEmbeddingModel` / `rerankModel` / `speechModel` (Q7): explicitly
  out of scope
- Warnings (Q8): `stream-start.warnings` only; no provider-level
  singleton logger

## Public API sketch

```ts
// react-native-gemma-agent/ai — subpath entry
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from '@ai-sdk/provider';

export interface GemmaProviderConfig {
  engine: InferenceEngine;
  registry?: SkillRegistry;
  knowledgeStore?: KnowledgeStore;
  skillExecutor?: SkillExecutor;
  defaults?: GemmaLanguageModelDefaults;
}

export interface GemmaLanguageModelDefaults {
  contextSize?: number;            // provider-creation default, see mismatch #10
  maxChainDepth?: number;          // default 5; per-call override via providerOptions.gemma
  skillRouting?: 'all' | 'bm25';   // default 'all'
  maxToolsPerInvocation?: number;  // default 5
  activeCategories?: string[];
  enableThinking?: boolean;        // forwarded to llama.rn (synthesis §1 pain #4)
  reasoningFormat?: 'none' | 'deepseek' | 'qwen';
}

export interface GemmaProvider {
  languageModel(
    modelId: string,
    opts?: GemmaLanguageModelDefaults,
  ): GemmaLanguageModel;
  // textEmbeddingModel / rerankModel / speechModel: out of scope (Q7)
}

export interface GemmaLanguageModel extends LanguageModelV3 {
  readonly specificationVersion: 'v3';
  readonly provider: 'gemma';
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]>;
  prepare(): Promise<void>;   // wraps ModelManager + InferenceEngine.loadModel
  unload(): Promise<void>;
  doGenerate(options: LanguageModelV3CallOptions): Promise<...>;
  doStream(options: LanguageModelV3CallOptions): Promise<...>;
}

export function createGemmaProvider(config: GemmaProviderConfig): GemmaProvider;
```

### `providerOptions.gemma` call-option schema

```ts
type GemmaProviderOptions = {
  // Per-call overrides of provider defaults:
  activeCategories?: string[];
  skillRouting?: 'all' | 'bm25';
  maxToolsPerInvocation?: number;
  maxChainDepth?: number;
  // Forwarded verbatim to llama.rn (pain #4):
  enable_thinking?: boolean;
  reasoning_format?: 'none' | 'deepseek' | 'qwen';
};
```

### `providerMetadata.gemma` output shape (attached to every `finish` part)

```ts
type GemmaProviderMetadata = {
  timings: {
    promptMs: number;
    promptPerSecond: number;
    predictedMs: number;
    predictedPerSecond: number;
  };
  contextUsage: { used: number; total: number; percent: number };
  // knowledgeBase surface deferred (Q6)
};
```

Source citations: provider shape mirrors
`packages/llama/src/ai-sdk.ts:1089–1158` (MIT, "inspire only" per
synthesis §5); timings shape mirrors `packages/mlc/src/ai-sdk.ts:183–189`
(MIT, "inspire only"). Our reference fields are
`InferenceEngine.mapResult` (InferenceEngine.ts:300–329) and
`InferenceEngine.getContextUsage` (InferenceEngine.ts:267–272).

## Stream-part mapping

| V3 stream part | When we emit | Source |
|---|---|---|
| `stream-start` | Exactly once, first. `warnings` carries all call-time warnings (unsupported param, skill/consumer-tool name collision, FilePart dropped, toolChoice downgrade, polyfill absent, context ≥ threshold). | Adapter call-prelude. |
| `text-start` | Before first `text-delta` of a turn. | Driven by non-empty `TokenData.token`. |
| `text-delta` | Every llama.rn token with non-reasoning, non-tool-call content. | `InferenceEngine.generate` `onToken` (InferenceEngine.ts:185–193). |
| `text-end` | When streaming text closes (before `finish`). | End of generate callback. |
| `reasoning-start` / `-delta` / `-end` | When `result.reasoning_content` is non-empty. Uses `InferenceEngine.CompletionResult.reasoning` (types.ts:88–89, InferenceEngine.ts:322) — **no literal `<think>` matching** (fixes synthesis §1 pain #6). | Per-turn. |
| `tool-input-start` | First time a given tool-call ID appears in `TokenData.tool_calls` during streaming. `providerExecuted: true` for skills, absent for consumer tools. | Progressive `TokenData` updates. |
| `tool-input-delta` | Each subsequent JSON-string delta for that tool-call ID. | Progressive `TokenData` updates. |
| `tool-input-end` | When llama.rn finalizes the tool-call JSON. | End of that tool call's streaming. |
| `tool-call` | Once per validated tool call, after `-end`. `input` is the JSON string (not parsed), matching V3 `LanguageModelV3ToolCall.input`. | `validateToolCalls` pass (FunctionCallParser.ts:16–42), falling through to `extractToolCallsFromText` (FunctionCallParser.ts:52–89) when llama.rn's PEG parser misses. |
| `tool-result` | Only for provider-executed skills. `output` is translated per synthesis §3 mismatch #3. | After `SkillExecutor` resolves. |
| `finish` | Exactly once, last. `finishReason` via ported `convertFinishReason`, `usage` via synthesis §3 mismatch #9 translation, `providerMetadata.gemma` populated. | End of `runToolLoop`. |
| `error` | Terminal. | Catch block around `runToolLoop`. |
| `raw` | When `includeRawChunks: true` is set on call options. | Passthrough of raw `TokenData`. |

### Sequencing invariants (enforced by adapter)

- `stream-start` is always first.
- Every `*-delta` is wrapped by a matching `*-start` / `*-end`.
- `finish` is terminal — no stream parts emitted after it.
- Within a turn, `text-*`, `reasoning-*`, and `tool-input-*` may
  interleave but each class has its own `-start` / `-end` bracket.
- `tool-call` follows its own `tool-input-end`; `tool-result` follows
  its `tool-call` (provider-executed only).

## Pain points fixed on day one

From synthesis §1 top 3. Each row names the source bug, the issue URL,
and the implementation sentence.

| Pain | Source (competitor) | Issue | Our fix |
|---|---|---|---|
| `tool-input-start / -delta / -end` never emitted → `useChat()` can't render live tool-arg decode | `@react-native-ai/llama` ai-sdk.ts:569–580 (only final `tool-call`); `@react-native-ai/mlc` ai-sdk.ts:240–281 (not streamed at all) | — | Emit `-start/-delta/-end` from `TokenData.tool_calls` progressive updates (`InferenceEngine.ts:185–193`), followed by the final `tool-call`. |
| Tool `inputSchema` silently dropped — model knows tool names but not param shapes | `@react-native-ai/llama` ai-sdk.ts:409–415 passes V3 `inputSchema` verbatim; llama.rn reads `function.parameters`. Latent correctness bug. | [callstackincubator/ai#201](https://github.com/callstackincubator/ai/issues/201) | Explicit `inputSchema → parameters` rename at the V3 → llama.rn boundary (synthesis §3 mismatch #7). Our `SkillRegistry.toToolDefinitions` (SkillRegistry.ts:78–94) already emits the llama.rn-native shape. |
| `options.abortSignal` ignored; only `stream.cancel()` works | `@react-native-ai/llama` ai-sdk.ts:660–662; `@react-native-ai/mlc` ai-sdk.ts:230–233 | [callstackincubator/ai#199](https://github.com/callstackincubator/ai/issues/199) (related) | `options.abortSignal?.addEventListener('abort', () => engine.stopGeneration())` in both `doGenerate` and `doStream`; mirror on `ReadableStream.cancel`. Uses `InferenceEngine.stopGeneration` (InferenceEngine.ts:209–214). |

## Internal refactor

Extract the tool-execution loop from
`AgentOrchestrator.sendMessage` (AgentOrchestrator.ts:115–222) into a
stateless helper in a new file `src/runToolLoop.ts`.

```ts
// src/runToolLoop.ts
export interface RunToolLoopDeps {
  engine: InferenceEngine;
  registry: SkillRegistry;
  executor: SkillExecutor | null;
  knowledgeStore?: KnowledgeStore;
}

export interface RunToolLoopConfig {
  maxChainDepth: number;
  skillTimeout: number;
  skillRouting: 'all' | 'bm25';
  maxToolsPerInvocation: number;
  activeCategories?: string[];
  systemPrompt: string;
  contextWarningThreshold: number;
}

export interface RunToolLoopInput {
  messages: Message[];            // full conversation prefix, stateless
  extraTools?: ToolDefinition[];  // consumer-supplied, from V3 call options
  toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  abortSignal?: AbortSignal;
  providerOptions?: GemmaProviderOptions;
}

export async function runToolLoop(
  deps: RunToolLoopDeps,
  config: RunToolLoopConfig,
  input: RunToolLoopInput,
  onPart: (part: LanguageModelV3StreamPart) => void,
): Promise<{
  finalMessages: Message[];
  finishReason: LanguageModelV3FinishReason;
  usage: LanguageModelV3Usage;
  providerMetadata: GemmaProviderMetadata;
}>;
```

The orchestrator's existing `sendMessage` becomes a thin wrapper:
append the user message to `this.history`, call `runToolLoop` with
that prefix, then append the final messages back. Signature of
`AgentOrchestrator` does not change. The per-turn event shapes
(`AgentEvent`) are preserved for backwards compatibility by having
`sendMessage` subscribe to `onPart` and fan out to `onEvent`.

Target churn: ~80 lines moved, ~30 lines of glue. No behaviour change
for existing `useGemmaAgent` consumers.

## Differentiator surfaces

Mirrors synthesis §4.

| Differentiator | V3 surface |
|---|---|
| Provider-executed skills | Stream parts with `providerExecuted: true`; `tool-result` emitted without consumer callback. |
| Skill categories (ADR-003, Phase 15) | `providerOptions.gemma.activeCategories: string[]` (call-level override) + `GemmaLanguageModelDefaults.activeCategories` (provider-level default). Applied via `SkillRegistry.getSkillsForCategories` (SkillRegistry.ts:61–69). |
| BM25 routing (ADR-004) | `providerOptions.gemma.skillRouting: 'all' \| 'bm25'` + `maxToolsPerInvocation`. Scored against the latest user-role message's flattened text before building the tool list. Zero-cost when `'all'`. Uses `BM25Scorer` (src/BM25Scorer.ts). |
| KnowledgeStore (ADR-005) | (a) System-prompt augmentation via `KnowledgeStore.getIndex()` (KnowledgeStore.ts:263–279) — the same splice `AgentOrchestrator.buildSystemPrompt` uses today (AgentOrchestrator.ts:291–306). (b) `local_notes` surfaces as a provider-executed tool via its `SkillRegistry` entry. |
| WebView skill sandbox | Internal — wired via `GemmaProviderConfig.skillExecutor`. Invisible to AI SDK. |
| Context usage | `providerMetadata.gemma.contextUsage` on every `finish` part; `stream-start.warnings` when `percent >= contextWarningThreshold` at call start. Uses `InferenceEngine.getContextUsage` (InferenceEngine.ts:267–272). |
| llama.rn timings | `providerMetadata.gemma.timings` on every `finish` part — mirrors `@react-native-ai/mlc`'s `extraUsage` pattern. |
| Android offline guard | Per-skill inside the tool loop (`AgentOrchestrator.checkConnectivity`). Failure becomes `tool-result.output = { type: 'error-text', value: 'No internet connection' }`. |

## Out of scope (Phase 19)

- **Embedding / rerank / speech models** (Q7). Synthesis §4. We ship
  `languageModel` only. Non-text variants land post-v0.3.0.
- **Full `generateObject` validation / repair** (Q3). Phase 19 ships
  `responseFormat: { type: 'json', schema }` passthrough to llama.rn
  JSON mode. Phase 23 (ADR-007) adds the `jsonrepair` + Zod validation
  loop — reserved port is `fixAndValidateStructuredOutput` from
  executorch (`packages/react-native-executorch/src/utils/llm.ts:99–116`,
  Apache-2.0, per synthesis §5).
- **iOS parity** — Phase 24.
- **Multimodal input beyond text** (FilePart drop with warning) — Phase
  29. Provider accepts V3 `FilePart` in the prompt and emits a
  stream-start warning; Phase 22 will wire it through to llama.rn
  multimodal.
- **`providerMetadata.gemma.knowledgeBase`** (Q6). RN layer still
  exposes it via `useKnowledgeStore`.

## Test plan

### Unit — stream-part sequencing and translation

Matrix of `doStream` scenarios. Each cell asserts (a) the exact
stream-part sequence, (b) invariants hold (`stream-start` first,
`finish` terminal, every `*-delta` bracketed), (c) correct
`providerExecuted` flag, (d) correct `tool-result.output` variant.

| tools | toolChoice | abortSignal | skillRouting | maxChainDepth | Expected |
|---|---|---|---|---|---|
| none | — | off | — | — | `stream-start → text-* → finish` |
| skills only | auto | off | all | default | `stream-start → tool-input-*(providerExecuted) → tool-call(providerExecuted) → tool-result(providerExecuted) → text-* → finish` |
| consumer only | auto | off | — | — | `stream-start → tool-input-* → tool-call → finish` (no tool-result — consumer executes) |
| skills + consumer | auto | off | all | default | Mixed; collision → skill wins, stream-start warning present |
| skills only | `{ type: 'tool', toolName }` | off | all | default | That tool's call emitted first |
| skills only | auto | **on** → abort mid-stream | all | default | `error` part fires; `InferenceEngine.stopGeneration` called |
| skills only | auto | off | bm25 | default | Skills scored, top-N sent; unranked skills not called |
| skills only | auto | off | all | override via `providerOptions.gemma.maxChainDepth: 2` | Loop terminates at depth 2 with fallback response |
| skills only | auto | off | all | default + `activeCategories: ['research']` | Only research-category skills considered |

### Unit — `doGenerate` path

Single-shot parity with `doStream`:
- Text-only response → `content: [{ type: 'text', text }]`
- Tool-call response → `content: [{ type: 'tool-call', ... }]`,
  `finishReason.unified = 'tool-calls'`
- Provider-executed skill → `content: [toolCall, toolResult]` in one
  response (same pattern as llama's ai-sdk.ts:333–349)

### Unit — translation correctness

- `convertFinishReason` — all 4 paths (stoppedEos, stoppedLimit,
  contextFull, toolCalls) map to the 4 V3 unified reasons (synthesis §3
  mismatch #6).
- `prepareMessages` — ports `@react-native-ai/llama`'s
  `prepareMessagesWithMedia` (ai-sdk.ts:93–225, MIT). Cases: user with
  TextPart only, assistant with ReasoningPart, assistant with
  ToolCallPart, tool-role with ToolResultPart (all 7 output variants),
  assistant-embedded ToolResultPart → warning + drop.
- `inputSchema → parameters` rename — golden test that V3 function-tool
  with full JSON Schema reaches llama.rn with the schema intact.
- `SkillResult → ToolResultOutput` — all 4 outbound variants
  (text/json/error-text/content+media) per synthesis §3 mismatch #3.
- `ToolResultOutput → llama.rn tool-role message` — all 7 inbound
  variants including `execution-denied` explicit message.

### Integration — `useChat()` in example app

Add a `useChat()` tab to `example/App.tsx` that imports from
`react-native-gemma-agent/ai`, registers all 6 existing skills, and
exercises: text turn, skill turn, chained skills, abort mid-stream,
`providerOptions.gemma.skillRouting: 'bm25'`. Manual on-device
acceptance per CLAUDE.md rule 6 (Android first).

### Regression

All 124 existing tests across 10 suites stay green. `runToolLoop`
extraction must not change orchestrator behaviour (verified by the
existing `AgentOrchestrator.test.ts` matrix).

## License attestations

All ports verified MIT or Apache-2.0 per synthesis §5.

| Source | Range | License | Port decision | Notes |
|---|---|---|---|---|
| `@react-native-ai/llama` `convertFinishReason` | `packages/llama/src/ai-sdk.ts:48–69` | MIT | **Port with changes** | Retain copyright notice; adapt input type from raw `NativeCompletionResult` to our already-mapped `CompletionResult` (types.ts:83–95). |
| `@react-native-ai/llama` `prepareMessagesWithMedia` | `packages/llama/src/ai-sdk.ts:93–225` | MIT | **Port with changes** | Target our `Message` type (types.ts:66–72). Drop the "Model executed tools are not supported" assistant-tool-result warning — our provider-executed design emits those legitimately. |
| `@react-native-ai/llama` `createLlamaProvider` | `packages/llama/src/ai-sdk.ts:1089–1158` | MIT | **Inspire only** | Callable-provider convention is a pattern, not a copyable unit. |
| `@react-native-ai/llama` token FSM | `packages/llama/src/ai-sdk.ts:520–624` | MIT | **Do not port** | Buggy literal `<think>` matching (issue #199). We use `result.reasoning_content` directly. |
| `@react-native-ai/mlc` `extraUsage` shape | `packages/mlc/src/ai-sdk.ts:183–189, 271–277` | MIT | **Inspire only** | Shape of `providerMetadata.gemma.timings`. |
| `@react-native-ai/mlc` `convertToolsToNativeFormat` | `packages/mlc/src/ai-sdk.ts:25–49` | MIT | **Do not port** | Lossy schema collapse (synthesis §1 pain #2). |
| `react-native-executorch` `fixAndValidateStructuredOutput` | `packages/react-native-executorch/src/utils/llm.ts:99–116` | Apache-2.0 | **Reserve — Phase 23** | Verify per-file license header at port time. Covers the `generateObject` repair loop. |
| `react-native-executorch` `parseToolCall` regex | `packages/react-native-executorch/src/utils/llm.ts:15–46` | Apache-2.0 | **Do not port** | Fragile greedy regex; our PEG parser + balanced-brace fallback is stronger. |
| `@ai-sdk/provider` types | npm | Apache-2.0 | **Peer dependency** | `^3.x`. Do not vendor. Subpath-gated to keep non-AI-SDK consumers install-cost-free. |

NOTICE/attribution lines for ported functions land in a top-of-file
comment in `src/ai/convertFinishReason.ts` and
`src/ai/prepareMessages.ts`, citing the original file path and the
MIT upstream.

## Consequences

### Positive

- Closes the single largest adoption gap in `docs/PLAN.md:20–24`
  (AI SDK compat). `react-native-executorch` users get a migration
  path; `@react-native-ai/llama` users get a provider that fixes the
  top-3 streaming/schema/abort gaps on day one.
- Our skill system becomes discoverable to any dev who already knows
  the Vercel AI SDK — zero learning curve for the 90% of the surface.
- `providerMetadata.gemma.timings` + `contextUsage` gives consumers
  richer observability than any competitor ships today.
- `runToolLoop` extraction is strictly additive — existing
  `useGemmaAgent` consumers see no behaviour change.
- Subpath export keeps `@ai-sdk/provider` out of the install graph for
  consumers who only use `useGemmaAgent`.

### Negative

- V3's stateless contract forces a refactor (`runToolLoop` extraction).
  ~80 lines of churn inside `AgentOrchestrator`, plus ~300 lines of new
  adapter code in `src/ai/`.
- Peer dep on `@ai-sdk/provider ^3.x` exposes us to AI SDK's release
  cadence. A V4 spec bump will require adapter work; the subpath
  gating limits blast radius.
- JS-adapter-layer translation cost: prompt flattening, stream-part
  sequencing, and per-call tool-def key renaming run on every call.
  Cost is negligible vs. inference latency, but measurable in
  benchmarks — we'll document this explicitly.

### Risks

- **llama.rn streaming `TokenData.tool_calls` semantics may change
  between RCs.** Mitigated by pinning llama.rn to `0.12.0-rc.3+`
  (ADR-001 + `memory/project_llamarn_version.md`) and Phase 22's
  explicit pinning ADR.
- **V3 spec ships stream-part changes mid-Phase-19.** Mitigated by
  tracking `@ai-sdk/provider` 3.x patch versions in CI; the V3 stream
  part union has been stable since 3.0.0 (synthesis §1 row 12).
- **Provider-executed skills + consumer tools collision on the same
  name is resolved in favour of skills.** Small DX risk for a consumer
  who assumes their tool registration wins; mitigated by loud
  `stream-start` warning naming the dropped tool.
- **`responseFormat` passthrough without Zod repair in Phase 19 may
  produce invalid JSON** on small models. Mitigated by a `stream-start`
  warning and a documented "use Phase 23's validated path for
  production" note in migration docs.

## Alternatives Considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Target `LanguageModelV2` (PLAN.md's current wording) | Matches PLAN.md literal text | Spec superseded; every active competitor is on V3; we'd ship a dead-on-arrival adapter (synthesis Phase A Finding 1) | **Rejected** |
| Consumer-executed skills only (force devs to pass every skill as an AI SDK `tool` with `execute`) | Simpler adapter; no `runToolLoop` refactor | Loses our DX moat (skills auto-run); breaks the "register once, works everywhere" promise of `useGemmaAgent`; competitor `@react-native-ai/apple-llm`'s provider-executed design shows this works | **Rejected** |
| Separate package `@react-native-gemma-agent/ai` | Zero install cost for non-AI-SDK consumers | Two packages to publish, version, and document; `next/headers` convention supports subpath-with-peer-dep cleanly; Q1 resolved in favour of subpath | **Rejected** |
| Full `generateObject` with `jsonrepair` + Zod now | Feature parity with AI SDK's strictness | Phase 19 is already large; Q3 resolved in favour of passthrough-now, validated-later; reserves `fixAndValidateStructuredOutput` port for Phase 23 | **Rejected** |
| Consumer-tool-wins on name collision | Matches some devs' intuition that "my tools override defaults" | Breaks the invariant that registered skills always run provider-executed; a silently-consumer-executed skill yields wrong `providerExecuted` flags and wrong stream-part sequence | **Rejected** (Q4) |
| `maxChainDepth` provider-creation only | Smaller surface | Common case (debugging a misbehaving chain per-call) forces a full provider rebuild; Q5 resolved in favour of both | **Rejected** |
| Provider-level `getRecentWarnings()` singleton | Devs can inspect warnings after the fact | Hidden state, doesn't compose with SSR; Q8 resolved in favour of `stream-start` only | **Rejected** |
