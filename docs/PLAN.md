# react-native-gemma-agent — Roadmap

> **Shipped**: v0.1.0 (MVP) and v0.2.0 (Knowledge Base, Skill Categories, Context Monitoring). Full history in `docs/SESSION_LOG.md` / `CHANGELOG.md`. ADRs 001–005 in `docs/ADR/`.
>
> **North star**: Be the default way to ship on-device **agents** — not just on-device LLMs — in React Native. The skill/agent layer is the moat; the inference engine is interchangeable.
>
> **Momentum note (2026-04-15)**: Competitors shipped this month. `react-native-executorch` now has a `useLLM` hook. `@react-native-ai/llama` + `@react-native-ai/mlc` ship the Vercel AI SDK provider pattern. Callstack released an Apple on-device provider with tool calling for RN. We are behind on reach, ahead on agent surface. v0.3.0 has to close reach gaps fast.

---

## Competitive Context (as of 2026-04-15)

| Package | Weekly DL | Primary offer | Has adapter? | Has useLLM? | iOS? |
|---|---:|---|---|---|---|
| `llama.rn` | 13,819 | Low-level GGUF binding (we depend on this) | — | — | Yes |
| `react-native-executorch` | 6,762 | Declarative hooks, multi-model catalog | via AI SDK | ✅ | Yes |
| `@react-native-ai/llama` | 3,109 | Vercel AI SDK provider over GGUF | ✅ | ✅ | Yes |
| `@react-native-ai/mlc` | — | Vercel AI SDK provider over MLC | ✅ | ✅ | Yes |
| `cactus-react-native` | 494 | Universal format, cross-platform | — | — | Yes |
| `react-native-litert-lm` | 453 | LiteRT-LM, Gemma-optimized | — | — | Partial |
| **`react-native-gemma-agent`** | **164** | **Skills + function calling + knowledge base** | **❌** | **❌** | **❌** |

**Where we lose today**: AI SDK compat, declarative hooks, iOS, prebuilt model catalog.
**Where we still win**: pluggable skills, WebView sandbox, BM25 routing, on-device knowledge base, skill categories. No competitor has the agent/skills layer.

---

## v0.3.0 — "Close the Reach Gap" (Ship fast, keep the agent moat)

> **Theme**: Ship every adoption blocker in one release. Solo-dev velocity play.
> **Target window**: 10–14 days. No polish passes until the full set lands.

### Phase 19: Vercel AI SDK Adapter [P0 — URGENT]
Competitors shipped this. Parity is table stakes now.

- [ ] Implement `LanguageModelV3` over our `InferenceEngine`
- [ ] Map streaming tokens → AI SDK `text-delta` / `tool-call` / `tool-result` parts
- [ ] Export as `react-native-gemma-agent/ai` subpath
- [ ] Bridge `SkillRegistry` → AI SDK `tools` param (two-way conversion)
- [ ] Example app tab using `useChat()` with our provider
- [ ] Docs: migration path from `@react-native-ai/llama` and `react-native-executorch`

**Exit**: `streamText({ model: gemmaProvider('gemma-4-e2b-it'), tools, messages })` end-to-end.
**New ADR**: `006-vercel-ai-sdk-compat.md`

### Phase 20: Declarative `useLLM` Hook [P0 — URGENT, promoted from P2]
`react-native-executorch` already ships this. Catch-up cost is low, pain of missing it is high.

- [x] `useLLM({ model, systemPrompt })` → `{ generate, stream, isReady, interrupt, isGenerating }`
- [x] `useLLM` without a Provider (internal singleton)
- [x] Lives alongside `useGemmaAgent` (same engine)
- [x] Quick-chat tab in example app in ≤8 lines

**Exit**: Parity with `react-native-executorch`'s `useLLM`.

### Phase 21: Multi-Model Support [P0]
Decouple from the Gemma brand in code. Keep package name for SEO.

- [x] Strip hardcoded Gemma prompt assumptions; defer to llama.rn Jinja templates
- [x] `ModelConfig` registry: Gemma 4 (E2B/E4B), Qwen 3.5 (0.8B/4B), Llama 3.2 (1B/3B), SmolLM 2 1.7B
- [x] Per-model quirks: tool-call format, context length, min RAM, NPU eligibility
- [x] `useModelDownload` accepts any registered model id (string or ModelConfig)
- [ ] Matrix test: each model x each built-in skill (requires on-device testing)

**Exit**: `model: 'qwen-3.5-4b'` works identically.
**New ADR**: `007-multi-model-support.md`
**Dropped**: Hammer 2.1 (doesn't exist), MobileLLM-Pro (no GGUF support), GLM 5.1 (too large for mobile)

### Phase 22: Prebuilt Model Catalog + Pinned llama.rn [P0]
Zero-friction model pull. Also fixes a real bug surface: llama.rn needs a post-Gemma-4-fixes commit or users hit `--chat-template` throughput regressions and garbled output on `-nkvo`.

- [ ] Host verified GGUF manifests (GitHub Releases tier-free)
- [ ] `ModelCatalog` with SHA-256 checksums
- [ ] CLI: `npx react-native-gemma-agent pull gemma-4-e2b-it`
- [ ] Auto-quant selection (Q4_K_M / Q5_K_M / Q8) based on device RAM
- [ ] **Pin llama.rn to a known-good commit** (post-Gemma-4 tokenizer + streaming fixes); document required `--chat-template` and disallowed flags (`-nkvo`)
- [ ] Verify conversion toolchain (`convert_hf_to_gguf` multimodal tensor-name fix)

**Exit**: `useModelDownload('gemma-4-e2b-it')` pulls from our catalog, verifies, loads with zero HF token.
**New ADR**: `008-llamarn-version-pinning.md`

### Phase 23: Structured Output API [P1 — NEW]
Ollama shipped `format: json | JSONSchema`. AI SDK users expect `generateObject()`. We should match.

- [ ] `generateStructured({ schema })` with Zod/JSON Schema
- [ ] Constrained decoding via llama.rn grammar / JSON schema hooks (if exposed; fall back to retry-with-validation)
- [ ] Wire into Vercel adapter's `generateObject` path

**Exit**: `generateObject({ model, schema: z.object(...), prompt })` works and validates.

---

## v0.4.0 — "iOS + Moat Deepening"

> **Theme**: Unlock the other half of RN, deepen the skills moat, ship the first real performance feature.

### Phase 24: iOS Support [P0]
Callstack shipped an Apple on-device RN provider in April. Every serious evaluator comparing us will open Xcode. We need to be there.

- [ ] Verify llama.rn iOS parity (Metal offload, memory pressure)
- [ ] WebView sandbox behavior on iOS (incognito semantics differ)
- [ ] Example: Xcode build + TestFlight
- [ ] Device matrix: iPhone 13+ (6GB RAM floor)
- [ ] CI: Android + iOS per PR
- [ ] Docs: iOS setup, Info.plist, background-mode guidance

**New ADR**: `009-ios-inference-path.md`

### Phase 25: Vulkan / Hexagon NPU Acceleration [P0 — NEW, promoted from long-tail]
llama.cpp landed a Vulkan DP4A flash-attention shader for quantized KV cache and Hexagon Matrix Extensions (HMX) for Snapdragon NPU (Q4_0/Q8_0). Real Android GPU/NPU paths finally exist.

- [ ] Surface `backend: 'cpu' | 'vulkan' | 'hexagon' | 'auto'` in `agentConfig`
- [ ] Capability detection at init (SoC, driver, Vulkan version)
- [ ] Auto-fallback on `vk::DeviceLostError` or very-long-context crashes
- [ ] Benchmark harness: E2B Q4_K_M across Pixel 8, S23, S24, OnePlus Adreno devices
- [ ] Document NNAPI deprecation (Android 15) — we are not adding NNAPI

**Exit**: Measurable tok/s improvement over CPU-only on Snapdragon 8 Gen 2+.
**New ADR**: `010-mobile-gpu-npu-backends.md`

### Phase 26: TurboQuant KV Cache [P1 — promoted from long-tail]
Community llama.cpp impl reported +22.8% decode at 32K with no PPL loss (sparse V dequant via attention sparsity). This is shippable once upstream merges.

- [ ] Track upstream llama.cpp PR(s); pin once merged
- [ ] Expose `kvCompression: 'off' | 'turboquant' | 'auto'` in `agentConfig`
- [ ] KV cache eviction/truncation API for memory-pressure callbacks

**New ADR**: `011-kv-cache-compression.md`

### Phase 27: Semantic Vector Routing [P1]
Ship the opt-in semantic router from ADR-004.

- [ ] Bundle `all-MiniLM-L6-v2` (23 MB ONNX) as optional peer download
- [ ] `skillRouting: 'semantic' | 'hybrid' | 'bm25' | 'all'`
- [ ] Hybrid mode (alpha configurable)
- [ ] Embeddings cached per skill, hash-invalidated

**New ADR**: `012-semantic-routing.md`

### Phase 28: Conversation Summarization [P1]
`onContextWarning` at 80% currently forces `resetConversation()`. Offer a better default.

- [ ] `summarizeConversation(keepLastN)` — collapses old turns into a system note
- [ ] Auto-summarize opt-in via `agentConfig`
- [ ] Preserves tool-call traces

---

## v0.5.0 — "Modality + Ecosystem"

> **Theme**: Beyond text. Plus the marketplace moves from nice-to-have to differentiator.

### Phase 29: Multimodal Vision [P0]
Gemma 4 E2B is natively multimodal. We're leaving capability on the table. Requires `mmproj-BF16.gguf` auxiliary file.

- [ ] Image input in `sendMessage({ text, images })`
- [ ] Camera / photo library helpers
- [ ] Ship `mmproj` fetcher in ModelCatalog; verify shape pre-batching (avoid vLLM-style co-batch crashes)
- [ ] Vision-aware skill protocol: skills can return `{ image }` the model re-interprets
- [ ] Visual token budget controls (70 / 140 / 280 / 560 / 1120)

### Phase 30: Audio Input [P1]
Gemma 4 E2B supports audio natively.

- [ ] Short-form audio (≤30s) in `sendMessage({ audio })`
- [ ] RN audio capture wiring
- [ ] ASR + speech-to-translated-text paths

### Phase 31: Skill Marketplace (read-only) [P1 — promoted from P2]
Callstack is building provider registries. A public skill registry is our analog and a genuine differentiator.

- [ ] `skills.registry.json` in a separate repo
- [ ] `npx react-native-gemma-agent skills search <query>`
- [ ] Signature verification on fetch
- [ ] No SDK runtime changes — purely tooling

### Phase 32: Speculative Decoding [P2 — NEW]
Research shows 2.8×–5.8× speedups with a draft model; mobile-plausible for long outputs on high-end devices.

- [ ] Small draft model (SmolLM-135M / Bonsai 1-bit?) paired with E4B target
- [ ] `speculative: { draftModel, draftBatch }` option
- [ ] Interrupt semantics across both native threads

### Phase 33: Expo Plugin [P2]
- [ ] Config plugin for Expo managed workflow
- [ ] Auto-patches native dependencies

---

## v0.6.0+ — Long Tail (unchanged from v0.2.x planning)

- [ ] Ollama backend adapter — desktop/dev testing path (uses Ollama's new `/v1/*` OpenAI-compat + `format` schema)
- [ ] On-device fine-tuning hooks — LoRA adapter loading (community E4B LoRAs exist)
- [ ] Telemetry SDK (opt-in) — anonymous skill-call metrics
- [ ] Skill marketplace write path — submission + review workflow
- [ ] QAT checkpoints when Google or community releases them (none yet as of 2026-04-15)

---

## Priority Framework

- **P0** — Adoption or moat-defining. Ship or someone else owns the space.
- **P1** — User-requested / obvious next step. Ship within the version.
- **P2** — Nice to have. Cut freely if scope slips.

---

## Current Focus

**Start Phase 19 (Vercel AI SDK Adapter) immediately**, followed by Phase 20 (`useLLM`). These two together close the single biggest perception gap vs `react-native-executorch` and `@react-native-ai/llama`. Phases 21–23 round out v0.3.0 and ship together as a single release.

**Solo-dev strategy**: v0.3.0 is six phases (19–23) of catch-up + structured output. Batch-merge, one example-app tab per phase, commit per phase, release when all five exit criteria pass.

---

## Changes vs previous plan (2026-04-15 rewrite)

- **Phase 19** unchanged in scope but reframed as urgent catch-up, not a lead move.
- **Phase 22 (useLLM)** promoted from P2/v0.3.0-tail to P0/v0.3.0-core — competitor shipped it.
- **Phase 20 (multi-model)** expanded to include MobileLLM-Pro int4, GLM 5.1; added NPU-eligibility metadata.
- **Phase 21 (catalog)** folded in llama.rn version pinning + `convert_hf_to_gguf` toolchain fixes.
- **Phase 23 (structured output)** NEW — parity with Ollama's `format` and AI SDK's `generateObject`.
- **Phase 24 (iOS)** unchanged in scope but urgency up; Callstack Apple provider is live.
- **Phase 25 (Vulkan/Hexagon)** NEW — promoted from long-tail. Real llama.cpp shaders landed.
- **Phase 26 (TurboQuant)** promoted from v0.6.0+ long-tail to v0.4.0 P1. Community impl exists.
- **Phase 31 (marketplace)** promoted from P2 to P1 — marketplace is genuine differentiation now.
- **Phase 32 (speculative decoding)** NEW at P2.
