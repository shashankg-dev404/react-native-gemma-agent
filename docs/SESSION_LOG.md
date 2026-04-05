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

## Session 4 — 2026-04-06

### What Was Done

**Phases 3-6 — Full Agent Loop Built:**

1. **Types Update** — Added to `src/types.ts`:
   - `SkillType`, `SkillParameter`, `SkillManifest` — skill definition types
   - `SkillResult` — result from skill execution
   - `AgentEvent` — discriminated union for real-time UI events
   - `AgentConfig` — orchestrator configuration

2. **Phase 3: SkillRegistry** — Created `src/SkillRegistry.ts`:
   - `registerSkill(skill)` with validation (JS skills need `html`, native need `execute`)
   - `unregisterSkill()`, `getSkill()`, `getSkills()`, `hasSkill()`
   - `toToolDefinitions()` — converts skills to OpenAI-compatible ToolDefinition[] for llama.rn
   - No system prompt fragment needed — llama.rn handles tool format via Jinja templates

3. **Phase 4: SkillSandbox** — Created `src/SkillSandbox.tsx`:
   - Hidden WebView component with `forwardRef`/`useImperativeHandle`
   - `execute(html, params, timeout)` → `Promise<SkillResult>`
   - Injects bridge script calling `window['ai_edge_gallery_get_result']`
   - Result returned via `ReactNativeWebView.postMessage` bridge
   - Timeout handling, incognito mode, domStorage disabled

4. **Phase 5: FunctionCallParser** — Created `src/FunctionCallParser.ts`:
   - `validateToolCalls()` — validates llama.rn's auto-parsed `result.toolCalls` against registry
   - `extractToolCallsFromText()` — fallback: scans raw text for JSON blocks via brace-depth tracking
   - Handles both `{"tool_call": {...}}` and `{"name": "...", "arguments": {...}}` patterns

5. **Phase 6: AgentOrchestrator** — Created `src/AgentOrchestrator.ts`:
   - Full agent loop: inference → tool call check → skill exec → re-invoke model
   - `sendMessage(text, onEvent)` → returns final response text
   - Events: `thinking`, `token`, `skill_called`, `skill_result`, `response`, `error`
   - Max chain depth (default 5), configurable skill timeout
   - Supports JS skills (via SkillSandbox) and native skills (direct callback)
   - `setSkillExecutor()` — React layer wires SkillSandbox's execute here

6. **InferenceEngine Fix** — Updated `generate()` to pass through `tool_calls`, `tool_call_id`, `name` fields in messages for multi-turn tool protocol

7. **Exports Updated** — `src/index.ts` exports all new classes, types, and functions

### Key Decisions Made
- **Two skill types**: `'js'` (WebView HTML) and `'native'` (RN callback) — simple, no SKILL.md parsing for MVP
- **No system prompt injection for tools** — llama.rn handles tool formatting natively via Jinja templates, so SkillRegistry just converts to ToolDefinition[]
- **SkillExecutor pattern** — AgentOrchestrator takes a callback function instead of directly owning the WebView, decoupling class logic from React component tree

8. **Phase 7: React Hooks API** — Created 4 files:
   - `GemmaAgentProvider.tsx` — Context provider owning all SDK instances, renders hidden SkillSandbox, wires executor via useLayoutEffect
   - `useGemmaAgent.ts` — Main hook: sendMessage, messages, isProcessing, activeSkill, loadModel, unloadModel, reset, error
   - `useModelDownload.ts` — Download hook: download, cancel, progress, checkModel, setModelPath, deleteModel, checkStorage
   - `useSkillRegistry.ts` — Skill management: registerSkill, unregisterSkill, skills list, hasSkill, clear

9. **Phase 8: Demo Skills** — Created 3 skills under `skills/`:
   - `calculator.ts` — native skill, offline, safe math eval with `Function` constructor (only digits + operators allowed)
   - `queryWikipedia.ts` — JS/WebView skill, fetches Wikipedia REST API with search fallback
   - `webSearch.ts` — JS/WebView skill, uses DuckDuckGo Instant Answer API (free, no API key)
   - `skills/index.ts` — re-exports all three

10. **Exports Updated** — `src/index.ts` now exports all hooks, provider, and types from Phase 7

### Key Decisions Made (continued)
- **GemmaAgentProvider owns all instances** — created once via useRef, stable across re-renders
- **SkillSandbox wired via useLayoutEffect** — guarantees executor is available before any user interaction
- **Calculator as native skill** — demonstrates both skill types (native vs JS/WebView)
- **DuckDuckGo for web search** — free, no API key, JSON API with CORS support

### What Was NOT Done
- Phase 9 (Demo App update — use SDK hooks in example/App.tsx)
- Phase 10 (README, GitHub, NPM prep)
- TypeScript build verification (no node_modules in SDK root)
- Integration test on device

---

## Next Session — What To Pick Up

### Priority 1: Phase 9 — Demo App
1. Update `example/App.tsx` to use the SDK hooks (GemmaAgentProvider, useGemmaAgent, useModelDownload)
2. Install react-native-webview in example app
3. Register demo skills (calculator, wikipedia, web_search)
4. Build chat UI with skill status indicators
5. Test on emulator

11. **Phase 9: Demo App Rewrite** — Rewrote `example/App.tsx`:
   - Uses `GemmaAgentProvider`, `useGemmaAgent`, `useModelDownload` from SDK
   - Chat bubble UI with streaming text, skill status badges, metrics bar
   - Registers all 3 demo skills (calculator, wikipedia, web_search)
   - "Load Model" / "Download" buttons for model lifecycle
   - Log viewer tab for debugging skill calls
   - Updated `metro.config.js` to resolve SDK source from parent dir
   - Installed `react-native-webview` in example app

12. **Phase 10: README & Ship Prep**:
   - Wrote comprehensive `README.md` — quick start, API reference, custom skill guide, architecture, model setup, performance benchmarks
   - Created `LICENSE` (MIT)

### What Needs Manual Testing
- Android build (`cd example && npx react-native run-android`)
- Full agent loop: load model -> send message -> model calls skill -> skill returns -> model answers
- Try: "What is 234 * 567?" (calculator), "Search Wikipedia for quantum computing" (wikipedia)
- Verify skill status badge shows during execution
- Verify streaming text works

---

## Next Session — What To Pick Up

### Bug Fixes Applied During Device Testing

13. **Fixed: `type must be string, but is null` crash** — The crash happened on the second model invocation (after tool call + result appended to history). Root cause: llama.rn's native bridge receiving null/undefined fields in messages JSON.
   - `InferenceEngine.ts`: `tool_calls[].id` now always has a fallback string. `arguments` defaults to `'{}'`. Message mapper re-maps tool_calls to ensure no null fields.
   - `AgentOrchestrator.ts`: `tool_call_id` on tool role messages gets a generated fallback if missing.
   - **STATUS: FIXED** — calculator skill now returns correct result.

14. **Fixed: Input box hidden under nav bar** — Replaced RN's `SafeAreaView` with `react-native-safe-area-context`. Added `KeyboardAvoidingView`.

15. **OPEN BUG: Thinking text shows as chat bubble** — Gemma 4's chain-of-thought reasoning (`<|channel>thought\n...`) appears as a regular assistant message in the chat. The text like "The user is asking for a multiplication..." shows alongside the actual answer.
   - **Root cause**: `AgentOrchestrator.ts` line ~132 stores `result.content` as the assistant message content when making a tool call. llama.rn's `result.content` includes the thinking text.
   - **Attempted fix 1**: Filter streaming tokens by special token strings → Failed (tokens arrive char-by-char, not as complete strings)
   - **Attempted fix 2**: Buffer first 7 tokens to detect "thought" prefix → Partially worked for streaming but the real issue is the stored message in `orchestrator.conversation` history
   - **Proposed fix A (SDK layer)**: Set `content: ''` on assistant messages that have `tool_calls`. Risk: may break Jinja template on next invocation.
   - **Proposed fix B (App/Hook layer)**: Filter out assistant messages that have `tool_calls` from the rendered chat: `messages.filter(m => m.role === 'user' || (m.role === 'assistant' && !m.tool_calls?.length))`
   - **Proposed fix C (SDK layer)**: Add a `reasoning` field to `Message` type. Store thinking in `reasoning`, keep `content` clean. The Orchestrator strips thinking from content before storing.
   - Full bug report saved in memory: `bug_thinking_in_chat.md`

16. **SDK now exposes `reasoning` separately** — Added `reasoning: string | null` to `CompletionResult`, `AgentEvent.response`, and `UseGemmaAgentReturn` types. Developers can show/hide thinking as they choose.

---

## Session 5 — 2026-04-06

### What Was Done

**P0 Bug Fix: Thinking text in chat bubbles — FIXED**

17. **Fixed: Thinking text no longer shows as chat bubble** — 3-layer fix:
   - **AgentOrchestrator.ts**: Set `content: ''` on assistant messages with `tool_calls`. Thinking text was stored in content and rendered as a chat bubble. Empty string is safe for llama.rn's Jinja template (OpenAI format expects null/empty content on tool-call assistant messages).
   - **App.tsx**: Added filter to skip assistant messages with `tool_calls` from rendering: `(m.role === 'assistant' && !m.tool_calls?.length)`. Defense-in-depth — no empty bubbles.
   - **useGemmaAgent.ts**: Added `thinking` event handler that resets streaming state (`streamingText`, `tokenBuffer`, `seenContent`) at the start of each generation loop. Combined with existing "thought" prefix buffer detection.

### Files Modified
- `src/AgentOrchestrator.ts` — line ~128: `content: ''` for tool-call messages
- `src/useGemmaAgent.ts` — added `thinking` case in event switch
- `example/App.tsx` — added `!m.tool_calls?.length` filter on message rendering

---

18. **Device testing completed** — Shashank tested on device:
   - Calculator skill: WORKING (correct results)
   - Wikipedia skill: WORKING (LaTeX artifacts in output — `$E=mc^2$`)
   - Web search (DDG): PARTIAL — fails on broad queries like "latest React Native news", works for well-known topics like "climate change". DDG Instant Answer API only has pre-computed answers.
   - Chained skills (wiki + calculator): WORKING — Tokyo population + 15% calculation correct
   - No-results handling: WORKING — "uwueehwe67272" returns graceful message
   - Model outputs markdown bold (`**text**`) rendered as raw text — cosmetic, app's job to render

19. **Research: Smarter Skill Handling** — Ran /last30days + 5 web searches:
   - At ~50 tools, accuracy 84-95%. At ~200 tools, drops to 41-83%.
   - Each skill costs ~50-100 tokens. Practical limit: 10-15 skills at 4096 context.
   - Approaches evaluated: semantic vector routing (97% accuracy, needs embedding model), MemTool (0-60% on small models), small router model (2x memory), BM25 keyword scoring (85-90%, zero overhead), skill categories (manual, zero cost).
   - Decision: BM25 pre-filter as opt-in for v0.1.0, skill categories for v0.2.
   - Sources: arxiv.org/abs/2507.21428 (MemTool), arxiv.org/html/2603.20313 (semantic MCP tool selection), r/LocalLLaMA (1B routing model)

20. **Feature decisions for v0.1.0:**
   - Strip LaTeX from Wikipedia skill
   - Swap DDG with SearXNG for web search
   - Add `requiresNetwork: boolean` to SkillManifest
   - BM25 skill pre-filter (opt-in via `skillRouting: 'bm25'`)
   - Context usage API (`getRemainingContext()`)
   - Unit tests (deterministic + mocked trajectory)

21. **Eval testing discussion** — Agreed on practical eval tiers:
   - Tier 1: Deterministic unit tests (BM25 scoring, parser, registry, LaTeX) — runs in CI
   - Tier 2: Mocked trajectory tests (mock InferenceEngine, test orchestrator loop) — runs in CI
   - Tier 3: On-device eval harness (stretch goal) — manual run on phone
   - Skipped: LLM-as-Judge (costs money), agent simulation (overkill), LangSmith (no production data)

22. **Documentation updated:**
   - `docs/PLAN.md` — added Phase 11 (skill quality), Phase 12 (BM25), Phase 13 (context API), Phase 14 (tests)
   - `README.md` — comprehensive rewrite with: context window details, skill limits, native skill use cases (location/calendar/health/gallery), BM25 routing, configuration reference, memory model explanation
   - Bug memory updated to FIXED
   - SDK technical details saved to memory

### Files Modified
- `docs/PLAN.md` — Phases 11-14 added, stretch goals updated
- `README.md` — comprehensive rewrite with technical details
- `~/.claude/.../memory/bug_thinking_in_chat.md` — updated to FIXED
- `~/.claude/.../memory/sdk_technical_details.md` — new: key SDK facts for docs
- `~/.claude/.../memory/MEMORY.md` — updated index

---

---

## Session 6 — 2026-04-06

### What Was Done

**Phases 11-14 — Feature completion + tests:**

23. **Phase 11: Skill Quality & Network Awareness**
   - `skills/queryWikipedia.ts`: Added `stripLatex()` function in WebView HTML — strips `$...$` display/inline math, `\frac`, `\text`, `\sqrt`, `\displaystyle`, common symbols (×, ≈, ±), and leftover braces. Version bumped to 1.1.0.
   - `skills/webSearch.ts`: Replaced DuckDuckGo Instant Answer API with SearXNG JSON API. Uses 3 public instances with automatic fallback (searx.be primary). Returns title + URL + snippet for top 5 results. Version bumped to 2.0.0.
   - `src/types.ts`: Added `requiresNetwork?: boolean` to `SkillManifest`
   - `src/AgentOrchestrator.ts`: Added `checkConnectivity()` — HEAD request to google.com/generate_204 with 3s timeout. Checks before executing any skill with `requiresNetwork: true`. Returns "No internet connection" error if offline.
   - Updated all 3 skills: calculator (`requiresNetwork: false`), wikipedia (`true`), web_search (`true`)

24. **Phase 12: BM25 Skill Pre-filter**
   - Created `src/BM25Scorer.ts` (~100 lines): BM25 scoring with k1=1.5, b=0.75. Tokenizes skill name+description+parameters+instructions, builds inverted index, scores queries. `topN()` convenience method.
   - `src/types.ts`: Added `skillRouting?: 'all' | 'bm25'` and `maxToolsPerInvocation?: number` to `AgentConfig`. Added `ContextUsage` type.
   - `src/AgentOrchestrator.ts`: Added `getToolsForQuery()` — when routing is 'bm25' and skill count exceeds max, scores skills against user query and sends only top-N to model. Falls through to 'all' when skill count is within limit.
   - `src/index.ts`: Exports `BM25Scorer` and `ContextUsage`

25. **Phase 13: Context Usage API**
   - `src/InferenceEngine.ts`: Added `getContextUsage()` — returns `{ used, total, percent }` based on last generation's prompt+predicted tokens vs configured context size. Tracks `_lastPromptTokens` and `_lastPredictedTokens`.
   - `src/useGemmaAgent.ts`: Added `contextUsage` state, updated after each `sendMessage()`. Exposed in return value.

26. **Phase 14: Unit & Integration Tests**
   - Set up Jest with ts-jest (`jest.config.js`, added test script to package.json)
   - 5 test suites, 60 tests, all passing in ~2s:
     - `BM25Scorer.test.ts` (11 tests): ranking accuracy (math→calculator, factual→wikipedia, current→web_search), topN limits, empty inputs, re-indexing
     - `FunctionCallParser.test.ts` (12 tests): validateToolCalls (known/unknown/malformed/empty/multiple), extractToolCallsFromText (tool_call pattern, name/arguments pattern, no JSON, malformed, unknown, empty, multiple)
     - `SkillRegistry.test.ts` (10 tests): register/unregister, validation (JS needs html, native needs execute), getSkills, clear, toToolDefinitions format
     - `stripLatex.test.ts` (14 tests): inline/display math, \frac, \text, \sqrt, \displaystyle, symbols, braces, empty string, plain text passthrough
     - `AgentOrchestrator.test.ts` (13 tests): direct response, tool call→result→response trajectory, skill failure, max chain depth, thinking text suppression, concurrent send rejection, reset, BM25 routing (top-N filtering, all mode, count ≤ max), network awareness (offline blocks network skills, offline allows offline skills)

### Files Created
- `src/BM25Scorer.ts`
- `src/__tests__/BM25Scorer.test.ts`
- `src/__tests__/FunctionCallParser.test.ts`
- `src/__tests__/SkillRegistry.test.ts`
- `src/__tests__/stripLatex.test.ts`
- `src/__tests__/AgentOrchestrator.test.ts`
- `jest.config.js`

### Files Modified
- `src/types.ts` — requiresNetwork, skillRouting, maxToolsPerInvocation, ContextUsage
- `src/AgentOrchestrator.ts` — BM25 routing, connectivity check, BM25Scorer import
- `src/InferenceEngine.ts` — getContextUsage(), token tracking
- `src/useGemmaAgent.ts` — contextUsage state + return
- `src/index.ts` — BM25Scorer + ContextUsage exports
- `skills/queryWikipedia.ts` — LaTeX stripping, requiresNetwork, version 1.1.0
- `skills/webSearch.ts` — SearXNG with fallback instances, requiresNetwork, version 2.0.0
- `skills/calculator.ts` — requiresNetwork: false
- `package.json` — test script, jest/ts-jest devDependencies

---

## Next Session — What To Pick Up

### Ready for Device Testing
1. Build and test on Android: `cd example && npx react-native run-android`
2. Test Wikipedia skill — verify no LaTeX artifacts in responses
3. Test web search — verify SearXNG returns real results for broad queries
4. Test offline: enable airplane mode, try calculator (should work), try wikipedia (should get "No internet" error)
5. Test BM25 routing: would need to enable via config change in App.tsx
6. Commit and push all code, tag v0.1.0
