# Session Log — react-native-gemma-agent

> This file tracks what Claude Code has done in each session and what to pick up next.
> Load this file at the start of every new session.

---

## Session 1 — 2026-04-04

### What Was Done

**Research Phase (no code written):**

1. **Gemma 4 Deep Dive** — Researched the full Gemma 4 model family:
   - Models: E2B (2.3B effective), E4B, 26B MoE, 31B Dense
   - E2B runs in <1.5GB RAM with 2-bit quantization
   - 4x faster than Gemma 3, 60% less battery
   - 128K context, 140+ languages, multimodal (text+image+audio)
   - Apache 2.0 license
   - Native function calling + structured JSON output
   - Foundation for Gemini Nano 4 (code-compatible)
   - Benchmarks: AIME 89.2% (31B), Codeforces ELO 2150 vs Gemma 3's 110

2. **Community Research (/last30days)** — Found what people are building:
   - Agent Skills in Google AI Edge Gallery (biggest buzz)
   - Manufacturing/Industrial edge AI (CCTV + anomaly detection)
   - Robotics on Jetson Thor
   - Offline code generation
   - Vision/document understanding
   - Key voices: @veto_agent, @kabilankb2003, @amjad135, @TheAIEdgeAI

3. **Deep Research (5 parallel agents)** — Evaluated 5 project ideas:
   - #1 Vision Scanner: Best risk-adjusted (8.2/10) but user chose different path
   - #2 Anime Companion: User already building AniChan, skipped
   - #3 IoT Edge Monitor: Niche market (5.8/10)
   - #4 Offline Translator: Dead — can't beat free Google Translate (2.1/10)
   - #5 Privacy AI Assistant: Can't compete with Apple/Google/Samsung (4.2/10)

4. **Google AI Edge Gallery / Agent Skills** — Deep dive into how it works:
   - Architecture: Gemma 4 on-device → function calling → JS skills in hidden WebView
   - Skill format: SKILL.md + scripts/index.html
   - window['ai_edge_gallery_get_result'] async function pattern
   - Open source: github.com/google-ai-edge/gallery (Apache 2.0)
   - User saw a demo video and wants to build something similar

5. **TurboQuant Research**:
   - Google's KV cache compression: 16-bit → 3-bit, 6x memory reduction, 8x speed
   - Zero accuracy loss, no retraining, works on any transformer
   - NOT shipped with Gemma 4 — separate algorithm
   - NOT in official llama.cpp yet — community forks exist (TheTom, spiritbuun)
   - Decision: skip for MVP, design architecture to support it later

6. **Project Decision**: Build `react-native-gemma-agent` — an NPM SDK
   - SDK > App for interviews (senior engineer signal)
   - Zero cost to build (all open source, on-device inference)
   - Demo app built using the SDK as proof
   - LinkedIn content strategy: document the journey

7. **Documentation Created**:
   - `docs/PLAN.md` — Full sprint plan (Phase 0-10 with tasks)
   - `docs/ARCHITECTURE.md` — System architecture, data flow, component design
   - `docs/TEST_CASES.md` — Manual E2E test cases per phase
   - `docs/SESSION_LOG.md` — This file
   - `docs/ADR/` — Folder ready for architectural decision records
   - `docs/LINKEDIN_CONTENT.md` — LinkedIn posts for each milestone
   - `docs/RESEARCH_SUMMARY.md` — All research findings consolidated

### Key Decisions Made
- **SDK over App** — build the library, then a demo app using it
- **Android first** — skip iOS until Swift API stabilizes
- **llama.rn as primary engine** — with fallback to executorch/cactus
- **Text-only first** — skip multimodal vision for MVP
- **No TurboQuant in MVP** — design for it, ship without it
- **Google's skill format** — follow the SKILL.md + index.html pattern

### What Was NOT Done
- No code written (research + docs only)
- Phase 0 spike not started (Gemma 4 + llama.rn validation)
- No ADR files created yet (will be created as decisions are made during build)

---

---

## Session 2 — 2026-04-05

### What Was Done

**Phase 0 Spike — Scaffolding (code written, awaiting device test):**

1. **Research (llama.rn + Gemma 4 compatibility)**:
   - Ran /last30days and deep-research with 5 parallel web searches
   - Confirmed: llama.rn 0.12.0-rc.4 synced to llama.cpp b8665 (Gemma 4 tokenizer fix merged Apr 3)
   - Confirmed: Gemma 4 E2B GGUF available from unsloth (Q4_K_M: 3.11 GB), ggml-org (Q8_0: 4.97 GB)
   - Found: react-native-executorch does NOT support Gemma 4 (1yr old, .pte format)
   - Found: Cactus SDK switched to proprietary .cact format — not viable
   - Found: Gemma 4 uses non-standard function call tokens (`<|tool_call>`) — NOT plain JSON
   - Found: llama.cpp b8665 added a specialized Gemma 4 parser (PR #21418)
   - Found: Model is 3.11 GB not 1.5 GB — need 8GB+ RAM devices

2. **SDK Package Structure**:
   - Created root `package.json` (react-native-gemma-agent v0.1.0)
   - Created `tsconfig.json` with strict TypeScript
   - Created `src/index.ts` placeholder
   - Created `.gitignore`

3. **Example App (Spike)**:
   - Created `example/` via `@react-native-community/cli init` (RN 0.84.1)
   - New Architecture enabled (newArchEnabled=true)
   - Installed `llama.rn@0.12.0-rc.4` — **Android build successful** (158 tasks, 1m49s)
   - Installed `react-native-fs` for model file management
   - Added `android:largeHeap="true"` to AndroidManifest (3GB model)
   - Added ProGuard rules for llama.rn
   - Built spike UI (`App.tsx`):
     - Model load with progress callback
     - Token streaming inference with messages API
     - Performance metrics display (load time, tok/s, GPU status)
     - Benchmark button (pp/tg speed test)
     - Detailed log viewer

4. **ADR Written**:
   - `docs/ADR/001-inference-engine.md` — documents llama.rn choice with full rationale

### Key Decisions Made
- **llama.rn 0.12.0-rc.4** over stable 0.11.5 (stable lacks Gemma 4 support)
- **unsloth GGUF** over ggml-org (more quantization options, better quality)
- **Target 8GB+ RAM** (3.11 GB model + KV cache + app won't fit in 6GB comfortably)
- **Q4_K_M as primary, Q3_K_M as fallback** for lower-RAM devices

5. **Model Download & Device Setup**:
   - Downloaded `gemma-4-E2B-it-Q4_K_M.gguf` (3.11 GB) from `unsloth/gemma-4-E2B-it-GGUF` via HuggingFace API
   - Emulator had only 2 GB RAM / 6 GB disk — insufficient for 3.1 GB model
   - Updated AVD config: RAM 2048→8192 MB, disk 6→16 GB, CPU cores 1→4
   - Wiped data + cold boot for partition resize to take effect
   - Pushed model via `adb push` (396 MB/s, 7.5s)
   - Updated App.tsx to check `/data/local/tmp/` as fallback model path

6. **SPIKE VALIDATED**:
   - App launched on emulator, model loaded successfully
   - Inference works — answered "What's the capital of India?" correctly and fast
   - Phase 0 exit criteria MET

### Key Decisions Made
- **llama.rn 0.12.0-rc.4** over stable 0.11.5 (stable lacks Gemma 4 support)
- **unsloth GGUF** over ggml-org (more quantization options, better quality)
- **Target 8GB+ RAM** (3.11 GB model + KV cache + app won't fit in 6GB comfortably)
- **Q4_K_M as primary, Q3_K_M as fallback** for lower-RAM devices

### What Was NOT Done
- Exact performance metrics (tok/s, load time) not recorded from app UI — do this first next session
- Function call format investigation (Gemma 4's `<|tool_call>` format vs JSON)
- Phases 1-10 (now unblocked)
- Physical device test (tested on emulator only — physical device test is a nice-to-have)

## Session 3 — 2026-04-05

### Spike Metrics Recorded

**Environment**: Medium Phone API 36 emulator, 8 GB RAM, CPU-only (no GPU backend)

| Metric | Value | Notes |
|--------|-------|-------|
| Model | gemma4 E2B Q4_K_M | 3.09 GB, 4.6B params, nEmbd=1536 |
| Load time (warm) | 2.2s | Model may have been cached in memory |
| Load time (cold) | 6.7s | After app restart, clean load |
| GPU offload | NO | Emulator lacks GPU backend |
| Generation speed | **30.0 tok/s** | 255 tokens generated (CPU-only) |
| Prompt eval speed | **60.2 tok/s** | 38 tokens in 631ms |
| Bench | FAILED | RC bug: `toFixed` of undefined — llama.rn bench returns undefined speedPp/speedTg on emulator |
| Response quality | Correct | "What is 2+2?" → "4", Rayleigh scattering explanation was accurate |

**Physical device projection**: Samsung Z Fold 7 (Snapdragon 8 Elite, 12GB RAM) should see GPU offload → estimated 60-120+ tok/s generation.

### What Was Done

1. **Spike Metrics Captured** — Ran the spike app on emulator, recorded load time, generation speed (30 tok/s), prompt eval speed (60.2 tok/s). Bench failed (llama.rn RC bug).

2. **Tool Call Investigation (ADR-002)** — Deep-dived into llama.rn's tool_calls API:
   - llama.rn **automatically parses** Gemma 4's `<|tool_call>` tokens via Jinja templates + PEG parser
   - `result.tool_calls` returns structured `{ type: 'function', function: { name, arguments } }`
   - Streaming `TokenData` also has `tool_calls` field
   - OpenAI-compatible tool format works out of the box
   - Wrote `docs/ADR/002-function-call-format.md`

3. **Tool Call Validation** — Added "Tools" button to spike app, tested with `get_weather` tool:
   - Sent "What is the weather in Tokyo?" with tool definition
   - Gemma 4 generated chain-of-thought reasoning then called `get_weather({"location":"Tokyo"})`
   - **`result.tool_calls` auto-populated by llama.rn — CONFIRMED WORKING**
   - This eliminates the need for a custom FunctionCallParser (Phase 5 simplified)

4. **Phase 1: ModelManager** — Created `src/ModelManager.ts`:
   - Download from HuggingFace with progress callback
   - Resume support via HTTP Range headers (partial file preserved on failure)
   - Model discovery at multiple paths (documents, /data/local/tmp, caches)
   - Status tracking with listener pattern
   - Storage space check before download
   - Custom model path support (for pre-downloaded models)

5. **Phase 2: InferenceEngine** — Created `src/InferenceEngine.ts`:
   - Wraps llama.rn's `initLlama` and `completion` APIs
   - `generate()` accepts messages + tools, returns structured `CompletionResult`
   - Token streaming via callback with `TokenEvent`
   - Tool call passthrough from llama.rn's native parser
   - Bench support with null-safe fallback
   - `stopGeneration()` and `unload()` lifecycle methods

6. **Types & Exports** — Created `src/types.ts` with all SDK types, updated `src/index.ts` to export `ModelManager`, `InferenceEngine`, and all types. Added `react-native-fs` as peer dependency.

### Key Decisions Made
- **No custom FunctionCallParser** for happy path — llama.rn handles it natively (ADR-002)
- **Fallback parser still planned** for Phase 5 — scan `result.text` for JSON blocks if `tool_calls` is empty
- **Gemma 4 does chain-of-thought** before tool calls — shows `<|channel>thought` with step-by-step reasoning

### What Was NOT Done
- Phase 3 (SkillRegistry) — next priority
- Phase 4 (WebView Sandbox) — after SkillRegistry
- Physical device test (only tested on emulator)
- TypeScript build verification (no node_modules in SDK root — need to install deps)

---

## Next Session — What To Pick Up

### Priority 1: Phase 3 — SkillRegistry
1. Create `src/SkillRegistry.ts`
2. Define skill manifest format (SKILL.md parsing)
3. Implement `registerSkill()`, `unregisterSkill()`, `getSkills()`
4. Implement `generateSystemPromptFragment()` — the text injected into LLM system prompt

### Priority 2: Phase 4 — WebView Sandbox
1. Install `react-native-webview`
2. Create `src/SkillSandbox.tsx` — hidden WebView component
3. Implement `execute(skill, params)` → Promise<SkillResult>
4. Handle timeouts and errors

### Priority 3: Phase 5 — FunctionCallParser (simplified)
1. Thin adapter that reads `result.toolCalls` from InferenceEngine
2. Validates tool call against SkillRegistry
3. Fallback: scan `result.text` for JSON blocks if `toolCalls` is empty

### Priority 4: Phase 6 — AgentOrchestrator
1. Wire everything together: InferenceEngine → FunctionCallParser → SkillSandbox → loop

### Files to Read First
```
docs/SESSION_LOG.md (this file)
docs/PLAN.md
docs/ADR/002-function-call-format.md
src/ModelManager.ts
src/InferenceEngine.ts
src/types.ts
```
