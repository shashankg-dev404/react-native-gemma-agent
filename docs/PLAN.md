# react-native-gemma-agent — 2-Day Sprint Plan

> **Goal**: Ship a working React Native SDK that lets any developer add on-device Gemma 4 AI agents with a JS skill system to their app. Publish to GitHub with a demo app.

---

## Phase 0: Spike — Validate Gemma 4 on React Native

> The entire sprint depends on this. If Gemma 4 E2B doesn't run via llama.rn, we pivot.

### Tasks
- [x] Create a fresh React Native project with New Architecture enabled (RN 0.84.1, newArchEnabled=true)
- [x] Install `llama.rn` (0.12.0-rc.4) and verify it builds on Android (BUILD SUCCESSFUL)
- [x] Download Gemma-4-E2B-it GGUF (Q4_K_M, 3.11 GB) from HuggingFace (unsloth)
- [x] Push the GGUF to Android device storage (adb push to /data/local/tmp/)
- [x] Load the model in llama.rn and run a single text inference — WORKING
- [x] Measure: load time (2.2s warm / 6.7s cold), tokens/sec (30.0 tok/s generation, 60.2 tok/s prompt eval), GPU: NO (emulator)
- [x] ~~If llama.rn fails → try `react-native-executorch`~~ (N/A — llama.rn works)
- [x] ~~If executorch fails → try `Cactus`~~ (N/A — researched: not viable)
- [x] Document which engine works in `ADR/001-inference-engine.md`

### Exit Criteria — MET
- [x] One successful inference response from Gemma 4 E2B on Android emulator (8GB RAM, ARM64)
- [x] Measured tokens/sec and RAM usage logged (Session 3: 30.0 tok/s gen, 60.2 tok/s PP)

### Risks — Retired
- ~~Gemma 4 GGUF conversion may have bugs~~ — works fine (unsloth Q4_K_M)
- ~~llama.rn may not support Gemma 4's architecture~~ — confirmed working via llama.cpp b8665
- ~~If all three engines fail~~ — llama.rn succeeded on first try

---

## Phase 1: Core SDK — Model Manager

> Abstract model downloading, loading, and lifecycle management.

### Tasks
- [x] Create `ModelManager` class that handles:
  - Model download from HuggingFace (with progress callback)
  - Model file storage in app-local directory
  - Model loading into memory
  - Model unloading / cleanup
  - Model status tracking (not_downloaded → downloading → ready → loaded → error)
- [x] Implement download with resume support (files are 1.5GB+)
- [x] Add model verification (checksum after download) — checksum field in ModelConfig, storage check
- [x] Handle edge cases: insufficient storage, insufficient RAM, download interrupted
- [x] Expose `ModelManager` as importable from the SDK

### Exit Criteria
- [x] Can download Gemma 4 E2B GGUF and load it ready for inference via code

---

## Phase 2: Core SDK — Inference Engine Wrapper

> Wrap the chosen inference library (llama.rn / executorch / cactus) behind a clean interface.

### Tasks
- [x] Create `InferenceEngine` class with `loadModel`, `generate`, `stopGeneration`, `getInfo`, `unload`, `bench`
- [x] Implement for llama.rn (from Phase 0)
- [x] Add system prompt injection (messages array supports system role)
- [x] Add structured output mode — llama.rn's `tools` + `tool_choice` params handle this natively
- [x] Add conversation history management (message array → prompt formatting via llama.rn Jinja)
- [x] Add token streaming support (onToken callback with TokenEvent)
- [x] Test basic multi-turn conversation without skills (needs integration test in example app)

### Exit Criteria
- [x] Can have a multi-turn text conversation with Gemma 4 via the wrapper
- [x] System prompt injection works
- [x] Token streaming works

---

## Phase 3: Skill System — Skill Registry

> The brain of the agent — manages which skills are available and their metadata.

### Tasks
- [x] Define the Skill manifest format — `SkillManifest` type in `types.ts` (name, description, version, type, parameters, html, execute, instructions)
- [x] Create `SkillRegistry` class (`src/SkillRegistry.ts`):
  - `registerSkill(skill)` with validation
  - `unregisterSkill(name)`, `getSkills()`, `getSkill(name)`, `hasSkill(name)`
  - `toToolDefinitions()` — converts to OpenAI-compatible format for llama.rn
- [x] Tool definitions passed via llama.rn's `tools` parameter (Jinja template handles prompt formatting — no manual system prompt fragment needed)
- [x] Test: register 3 skills, verify tool definitions are correct

### Exit Criteria
- [x] Skills can be registered, listed, and converted to tool definitions
- [x] llama.rn receives skills in OpenAI-compatible format

---

## Phase 4: Skill System — WebView Sandbox

> Execute JS skills in a hidden WebView — the same pattern as Google AI Edge Gallery.

### Tasks
- [x] `react-native-webview` already in peerDependencies
- [x] Create `SkillSandbox` component (`src/SkillSandbox.tsx`) — hidden WebView, forwardRef/useImperativeHandle
- [x] Implement execution protocol:
  - Loads skill HTML into WebView with injected bridge script
  - Calls `window['ai_edge_gallery_get_result'](params)` 
  - Result returned via `ReactNativeWebView.postMessage` bridge
  - Promise-based API: `execute(html, params, timeout)`
- [x] Support skill return types: `{ result }`, `{ result, image }`, `{ error }`
- [x] Skill execution timeout (configurable, default 30s)
- [x] Sandboxing: `domStorageEnabled={false}`, `incognito` mode
- [x] Test with a simple inline skill (no file loading)

### Exit Criteria
- [x] Can execute a JS function in a hidden WebView, pass it JSON, get back a result
- [x] Errors and timeouts are handled gracefully

---

## Phase 5: Agent Loop — Function Calling Parser

> Parse the model's output to detect when it wants to call a skill.

### Tasks
- [x] Primary: `validateToolCalls()` — reads llama.rn's auto-parsed `result.toolCalls`, validates against SkillRegistry
- [x] Fallback: `extractToolCallsFromText()` — scans raw text for JSON blocks via brace-depth tracking
  - Handles `{"tool_call": {...}}` and `{"name": "...", "arguments": {...}}` patterns
- [x] `ParsedToolCall` type: name, parameters, skill reference, original tool call ID
- [x] Test with mock model outputs (valid calls, malformed calls, no calls)

### Exit Criteria
- [x] Parser validates tool calls from llama.rn's native parser
- [x] Fallback scans raw text when native parser misses
- [x] Handles malformed JSON gracefully

---

## Phase 6: Agent Loop — Orchestrator

> The main loop that ties model → parser → skill → model together.

### Tasks
- [x] Create `AgentOrchestrator` class (`src/AgentOrchestrator.ts`):
  - `sendMessage(text, onEvent)` → full agent loop with tool execution
  - Supports JS skills (via SkillExecutor callback) and native skills (direct execute)
  - Immutable conversation history management
- [x] Max-depth limit (default 5, configurable via `AgentConfig.maxChainDepth`)
- [x] Event system via callback: `thinking`, `token`, `skill_called`, `skill_result`, `response`, `error`
- [x] `setSkillExecutor()` — decouples orchestrator from React component tree
- [x] Test the full loop: user asks → model calls skill → skill returns → model answers

### Exit Criteria
- [x] Full agent loop built: inference → tool call → skill exec → re-invoke
- [x] Events fire for UI updates
- [x] E2E test on device (needs demo skills + example app update)

---

## Phase 7: React Hooks API

> The developer-facing API. This is what gets imported from the NPM package.

### Tasks
- [x] Create `useGemmaAgent()` hook:
  ```typescript
  const {
    sendMessage,      // (text: string) => void
    messages,         // conversation history array
    isLoading,        // model is generating
    isModelReady,     // model loaded and ready
    activeSkill,      // currently executing skill name or null
    modelStatus,      // 'not_downloaded' | 'downloading' | 'ready' | 'loaded' | 'error'
    downloadProgress, // 0-100 during model download
    error,            // last error
  } = useGemmaAgent({
    model: 'gemma-4-e2b-it',
    skills: [wikipediaSkill, calculatorSkill],
    systemPrompt: 'You are a helpful assistant...',
    maxSkillChainDepth: 5,
    onSkillCalled: (name, params) => {},
    onSkillResult: (name, result) => {},
  });
  ```
- [x] Create `GemmaAgentProvider` context provider (`src/GemmaAgentProvider.tsx`)
  - Owns all SDK instances (ModelManager, InferenceEngine, SkillRegistry, AgentOrchestrator)
  - Renders hidden SkillSandbox, wires executor via useLayoutEffect
- [x] Create `useModelDownload()` hook (`src/useModelDownload.ts`)
- [x] Create `useSkillRegistry()` hook (`src/useSkillRegistry.ts`)
- [x] All hooks properly typed with TypeScript
- [x] Write JSDoc comments for every public API

### Exit Criteria
- [x] Developer wraps app in Provider, calls useGemmaAgent(), has working agent API
- [x] TypeScript types are complete and accurate

---

## Phase 8: Demo Skills

> Build 3 skills that showcase different capabilities.

### Skill 1: query_wikipedia
- [x] Created `skills/queryWikipedia.ts` — JS/WebView skill
- [x] Fetches Wikipedia REST API `/page/summary/` with search API fallback
- [x] Test with various queries (people, events, places, concepts)

### Skill 2: calculator
- [x] Created `skills/calculator.ts` — native skill (fully offline)
- [x] Safe math eval: input sanitized to digits + operators only, then `Function` constructor
- [x] Handles `^` → `**` exponentiation conversion
- [x] Test with basic arithmetic, unit conversions, percentages

### Skill 3: web_search
- [x] Created `skills/webSearch.ts` — JS/WebView skill
- [x] Uses DuckDuckGo Instant Answer API (free, no API key)
- [x] Test with various queries

### Exit Criteria
- [x] All 3 skills built with proper SkillManifest format
- [x] E2E test through agent loop on device

---

## Phase 9: Demo App

> A standalone app that uses the SDK — proves it works and provides LinkedIn demo material.

### Tasks
- [x] Rewrote `example/App.tsx` to use SDK hooks (GemmaAgentProvider, useGemmaAgent, useModelDownload)
- [x] Chat bubble UI: user/assistant message bubbles, streaming text with green dot indicator
- [x] Skill status: yellow "Running skill: X" badge with spinner during execution
- [x] Metrics bar: load time, skill count, active skill
- [x] Model controls: "Load Model" (finds local file), "Download" (from HuggingFace)
- [x] Download progress bar
- [x] Log viewer tab (skill calls, errors, timing info)
- [x] Registered all 3 demo skills (calculator, wikipedia, web_search)
- [x] Updated metro.config.js to resolve SDK source from parent directory
- [x] Installed react-native-webview in example app
- [x] Test on Android emulator/device
- [x] Record demo video for LinkedIn

### Exit Criteria
- [x] App uses SDK hooks, registers skills, shows chat with skill status
- [x] E2E test on device

---

## Phase 10: Documentation & Ship

> Make it real — README, docs, GitHub, NPM prep.

### Tasks
- [x] Write `README.md` — quick start, API reference, custom skill guide, architecture, model setup, performance
- [x] Add `LICENSE` (MIT)
- [x] `package.json` already configured for NPM (main, module, types, files, peerDependencies)
- [x] GitHub repo already created (shashankg-dev404/react-native-gemma-agent)
- [x] Commit and push all code
- [x] Tag v0.1.0 release
- [x] Published to npm: `npm install react-native-gemma-agent`
- [x] Repo made public
- [x] Draft LinkedIn launch post (see `LINKEDIN_CONTENT.md`)

### Exit Criteria
- [x] README covers full API, quick start, custom skills
- [x] Code pushed to GitHub
- [x] Published on npm as v0.1.0
- [x] At least one LinkedIn post drafted

---

## Phase 11: Skill Quality & Network Awareness

> Clean up garbled data feeding into model context, improve web search, add network awareness.

### Tasks
- [x] **Strip LaTeX from Wikipedia skill** — Remove `$...$` delimiters and common LaTeX markup (`\displaystyle`, `{\text{...}}`, etc.) from Wikipedia API responses before returning to model. Garbled LaTeX wastes tokens and confuses output.
- [x] **Swap web search to SearXNG** — Replace DuckDuckGo Instant Answer API (unreliable for broad queries) with a public SearXNG instance. DDG only returns pre-computed instant answers; SearXNG provides actual search results.
- [x] **Add `requiresNetwork` flag to SkillManifest** — New optional boolean field. SDK checks device connectivity before executing skills with `requiresNetwork: true`. Returns clean error "No internet connection" instead of a timeout. Skills with `requiresNetwork: false` or unset skip the check.
- [x] Update built-in skills: calculator (`requiresNetwork: false`), wikipedia (`requiresNetwork: true`), web_search (`requiresNetwork: true`)

### Exit Criteria
- [x] Wikipedia responses contain no LaTeX artifacts
- [x] Web search returns actual results for broad queries
- [x] Offline skill calls skip network skills with clear error message

---

## Phase 12: BM25 Skill Pre-filter (Opt-in)

> Smart skill routing for developers with many skills. Opt-in via config flag.

### Background (from research)
With ~50 tools, LLMs maintain 84-95% accuracy. At ~200 tools, accuracy drops to 41-83%. Token cost explodes 50-100x with naive "load all tools." For our 4096-token context, each skill costs ~50-100 tokens. Practical limit is ~10-15 skills without filtering.

### Approach
BM25 (Best Matching 25) is a term frequency / inverse document frequency algorithm with length normalization. Pure math, no ML model, ~100 lines of TypeScript. Scores each skill's `name + description + parameter descriptions` against the user's query. Top-N skills sent to model.

### Tasks
- [x] Implement `BM25Scorer` class in `src/BM25Scorer.ts`:
  - Build inverted index from skill descriptions on registration
  - `score(query: string, skills: SkillManifest[])` → ranked skill list
  - Tokenize by whitespace + lowercasing (simple, no stemming needed for MVP)
- [x] Add `skillRouting` config to `AgentConfig`: `'all' | 'bm25'` (default: `'all'`)
- [x] Add `maxToolsPerInvocation` config to `AgentConfig` (default: 5, only used with `bm25`)
- [x] Wire into `AgentOrchestrator.sendMessage()`: when `bm25`, score skills against user query, pass top-N to `engine.generate()`
- [x] Export `BM25Scorer` for developers who want standalone access
- [x] Update `GemmaAgentProvider` to accept new config fields

### API
```typescript
<GemmaAgentProvider
  agentConfig={{
    skillRouting: 'bm25',          // default: 'all'
    maxToolsPerInvocation: 5,      // only used with 'bm25'
  }}
>
```

### Exit Criteria
- [x] With `skillRouting: 'all'` — current behavior, all skills sent
- [x] With `skillRouting: 'bm25'` — only top-N skills sent per query
- [x] Unit tests: calculator ranked first for "what is 2+2", wikipedia first for "search Einstein"
- [x] Zero overhead when disabled

---

## Phase 13: Context Usage API

> Let developers monitor context window consumption.

### Tasks
- [x] Add `getContextUsage()` method to `InferenceEngine`:
  - Returns `{ used: number, total: number, percent: number }` in tokens
  - Uses last generation's prompt+predicted tokens as estimate
- [x] Add `contextUsage` field to `UseGemmaAgentReturn` (from `useGemmaAgent()`)
- [ ] Add `onContextWarning` callback to `AgentConfig` — fires when context usage exceeds threshold (default: 80%) _(planned for v0.2 — Phase 17)_
- [ ] Expose in the example app's metrics bar _(planned for v0.2 — Phase 17)_

### Exit Criteria
- [x] Developer can query remaining context at any time
- [ ] Warning fires before context fills up _(planned for v0.2 — Phase 17)_

---

## Phase 14: Unit & Integration Tests

> Deterministic tests that run without the model. Validates SDK logic, not LLM quality.

### Tier 1: Component Unit Tests
- [x] `BM25Scorer`: ranks calculator first for math, wikipedia first for factual queries (11 tests)
- [x] `FunctionCallParser`: extracts valid tool calls, handles malformed JSON, handles empty input (12 tests)
- [x] `SkillRegistry`: validates skill manifests, rejects invalid skills, converts to tool definitions (10 tests)
- [x] LaTeX stripping: removes `$...$`, `\displaystyle`, etc. (14 tests)
- [x] `requiresNetwork` check: blocks network skills when offline (2 tests in orchestrator suite)

### Tier 2: Mocked Trajectory Tests (mock `InferenceEngine.generate()`)
- [x] Orchestrator: model calls tool → executes skill → feeds result back → model responds
- [x] Orchestrator: skill fails → model gets error string → responds gracefully
- [x] Orchestrator: max chain depth reached → stops and responds with fallback
- [x] Orchestrator: no tool calls → returns direct response (no skill execution)
- [x] Orchestrator: thinking text NOT stored in assistant message content
- [x] Orchestrator: BM25 routing sends only top-N skills to engine (3 tests)

### Exit Criteria
- [x] All tests pass with `npx jest` (no device needed) — 60 tests, 5 suites
- [x] Tests run in <5 seconds — ~2s

---

---

# v0.2.0 — Skill Categories, Knowledge Base, Context Warnings

> **Goal**: Make the SDK production-ready for apps with many skills. Add skill categories for organizing large skill sets, an on-device knowledge base for persistent agent memory, and proactive context window warnings.

---

## Phase 15: Skill Categories

> Developers group skills by category. SDK only loads the active category into context, reducing token usage to zero for inactive skills. Pairs naturally with BM25 for large skill sets.

### Tasks
- [x] Add `category` field to `SkillManifest` type (optional string, e.g. `'finance'`, `'travel'`, `'productivity'`)
- [x] Add `activeCategories` config to `AgentConfig` (optional `string[]` — when set, only skills matching a listed category are sent to the model)
- [x] Update `SkillRegistry`:
  - `getSkillsByCategory(category: string)` — returns skills in a category
  - `getCategories()` — returns all registered category names
  - `toToolDefinitions()` respects `activeCategories` filter before converting
- [x] Update `AgentOrchestrator.sendMessage()`:
  - When `activeCategories` is set, filter skills before BM25 scoring or direct pass-through
  - Category filter applies *before* BM25 (reduces candidate pool, then BM25 ranks within it)
- [x] Add `setActiveCategories(categories: string[])` method to `GemmaAgentProvider` context
- [x] Expose `activeCategories` and `setActiveCategories` from `useGemmaAgent()` hook
- [x] Skills without a `category` field are treated as `'uncategorized'` and always included unless `activeCategories` explicitly excludes them
- [x] Update built-in skills: calculator → `'utility'`, wikipedia → `'research'`, web_search → `'research'`

### API
```typescript
// Skill definition
const financeSkill: SkillManifest = {
  name: 'stock_price',
  category: 'finance',  // NEW
  // ...
};

// Provider config
<GemmaAgentProvider
  agentConfig={{
    activeCategories: ['finance', 'utility'],  // only these categories loaded
    skillRouting: 'bm25',                       // BM25 ranks within active categories
  }}
>

// Runtime switching
const { setActiveCategories } = useGemmaAgent();
setActiveCategories(['travel', 'utility']);
```

### Exit Criteria
- [x] Skills with categories are filtered correctly — only active categories reach the model
- [x] Uncategorized skills are included by default
- [x] Category filter composes with BM25 routing (filter first, then rank)
- [x] Runtime category switching works via hook
- [x] Zero overhead when `activeCategories` is not set (all skills pass through)

### Tests
- [x] Unit: register 10 skills across 3 categories, verify filtering returns correct subsets
- [x] Unit: uncategorized skills included when `activeCategories` is set
- [x] Unit: BM25 + category filter composes correctly (ranked results only from active categories)
- [x] Unit: `setActiveCategories([])` sends no skills (edge case)
- [x] Unit: `getCategories()` returns deduplicated category list

---

## Phase 16: On-Device Knowledge Base Skill

> A native skill (`local_notes`) that lets the agent read/write markdown notes on-device. The agent accumulates knowledge over time — saved answers, user preferences, learned facts. No RAG needed at small scale; the note index is injected into the system prompt.

### Background
Inspired by Karpathy's "LLM Knowledge Bases" pattern. At small scale (<50 notes, <100KB total), injecting a flat index into the system prompt is simpler and more reliable than vector search. Fully private — nothing leaves the device.

### Tasks
- [x] Create `KnowledgeStore` class (`src/KnowledgeStore.ts`):
  - `saveNote(title: string, content: string, tags?: string[])` — writes markdown file to app-local storage
  - `getNote(title: string)` — reads a note by title
  - `searchNotes(query: string)` — BM25 search across note titles + content (reuse `BM25Scorer`)
  - `listNotes()` — returns all note titles with tags and last-modified date
  - `deleteNote(title: string)` — removes a note
  - `getIndex()` — returns a compact string index of all notes (title + tags + first line) for system prompt injection
- [x] Storage format: one `.md` file per note in `{app-storage}/gemma-agent-notes/`
  - Filename: slugified title (e.g., `user-prefers-metric-units.md`)
  - YAML frontmatter: `title`, `tags`, `created`, `modified`
  - Body: markdown content
- [x] Create `local_notes` native skill (`skills/localNotes.ts`):
  - Type: `'native'` (no WebView needed)
  - Parameters: `{ action: 'save' | 'read' | 'search' | 'list' | 'delete', title?: string, content?: string, query?: string, tags?: string[] }`
  - Calls `KnowledgeStore` methods based on `action`
  - `requiresNetwork: false`
  - `category: 'memory'`
- [x] System prompt injection:
  - `AgentOrchestrator` checks if `local_notes` skill is registered
  - If yes, appends note index from `KnowledgeStore.getIndex()` to system prompt as `\n\n## Your Notes\n{index}`
  - Index refreshed at the start of each `sendMessage()` call (cheap — just reads filenames + frontmatter)
- [x] Add `knowledgeStore` instance to `GemmaAgentProvider` context
- [x] Expose `useKnowledgeStore()` hook for developers who want direct access:
  ```typescript
  const { notes, saveNote, searchNotes, deleteNote } = useKnowledgeStore();
  ```
- [x] Storage size guard: warn if total notes exceed 100KB (approaching system prompt token budget)

### API
```typescript
// Auto-registered when included in skills array
import { localNotesSkill } from 'react-native-gemma-agent/skills';

<GemmaAgentProvider skills={[localNotesSkill, calculatorSkill]}>
  {/* Agent can now save/read notes on device */}
</GemmaAgentProvider>

// Direct access
const { notes, saveNote } = useKnowledgeStore();
await saveNote('User Preferences', 'Prefers metric units, dark mode', ['prefs']);
```

### Agent Interaction Example
```
User: "Remember that my flight is on April 15th, Delta DL1234"
Agent: [calls local_notes.save with title="Flight Info", content="April 15th, Delta DL1234"]
Agent: "Got it! I've saved your flight details."

User: "When is my flight?"
Agent: [sees "Flight Info" in system prompt notes index]
Agent: [calls local_notes.read with title="Flight Info"]
Agent: "Your flight is April 15th, Delta DL1234."
```

### Exit Criteria
- [x] Agent can save notes via natural language ("remember that...")
- [x] Agent can recall notes via natural language ("when is my...")
- [x] Notes persist across app restarts (file-based storage)
- [x] Note index appears in system prompt when skill is registered
- [x] BM25 search across notes works for retrieval
- [x] Storage guard warns at 100KB

### Tests
- [x] Unit: `KnowledgeStore` — save, read, search, list, delete operations (16 tests)
- [x] Unit: `getIndex()` returns compact format with title + tags + first line
- [x] Unit: BM25 search ranks relevant notes higher
- [x] Unit: slugified filenames handle special characters
- [x] Unit: storage size guard triggers at threshold
- [x] Integration: `local_notes` skill executes correctly through `AgentOrchestrator` (mocked engine, 13 tests)

---

## Phase 17: Context Warning Callback & Metrics

> Proactive context window monitoring. Fires a callback when usage exceeds a configurable threshold. Exposes context usage in the example app's metrics bar.

### Tasks
- [ ] Add `onContextWarning` callback to `AgentConfig`:
  ```typescript
  onContextWarning?: (usage: { used: number; total: number; percent: number }) => void;
  ```
- [ ] Add `contextWarningThreshold` to `AgentConfig` (default: `0.8` = 80%)
- [ ] Wire into `AgentOrchestrator.sendMessage()`:
  - After each generation, check `engine.getContextUsage()`
  - If `percent >= contextWarningThreshold`, fire `onContextWarning` once per threshold crossing (don't spam on every message)
  - Also emit an `'context_warning'` event through the existing event callback system
- [ ] Add `contextUsage` to `useGemmaAgent()` return (already partially done — verify it updates after each message)
- [ ] Update example app:
  - Show context usage bar in metrics section (green → yellow at 60% → red at 80%)
  - Show "Context: 2,048 / 4,096 tokens (50%)" label
  - Flash warning badge when `onContextWarning` fires
- [ ] Add `resetConversation()` method to `useGemmaAgent()` — clears history to reclaim context (convenience for when warning fires)

### API
```typescript
<GemmaAgentProvider
  agentConfig={{
    contextWarningThreshold: 0.8,
    onContextWarning: (usage) => {
      console.warn(`Context ${usage.percent}% full`);
      // Developer can auto-summarize, clear history, or alert user
    },
  }}
>
```

### Exit Criteria
- [ ] Warning fires exactly once when crossing threshold (not on every message after)
- [ ] Warning does not fire if usage stays below threshold
- [ ] Example app shows live context usage bar
- [ ] `resetConversation()` clears history and resets context tracking
- [ ] Event system emits `'context_warning'` event

### Tests
- [ ] Unit: warning fires when crossing 80% threshold
- [ ] Unit: warning does not re-fire on subsequent messages above threshold
- [ ] Unit: warning fires again after reset + re-crossing
- [ ] Unit: custom threshold (e.g., 0.5) works correctly
- [ ] Unit: `resetConversation()` clears messages and context usage

---

## Phase 18: v0.2.0 Tests & Release

> Final test pass, version bump, publish.

### Tasks
- [ ] Run full test suite (`npx jest`) — all existing + new tests pass
- [ ] Update `README.md`:
  - Add "Skill Categories" section with example
  - Add "Knowledge Base" section with example
  - Add "Context Monitoring" section
  - Update API reference table
- [ ] Version bump to `0.2.0` in `package.json`
- [ ] Update `CHANGELOG.md` (create if not exists)
- [ ] Build TypeScript (`npx tsc`)
- [ ] Publish to npm
- [ ] Tag `v0.2.0` release on GitHub
- [ ] Update `docs/SESSION_LOG.md`

### Exit Criteria
- [ ] All tests pass (existing 60 + new ~25 = ~85 tests)
- [ ] README documents all v0.2.0 features
- [ ] Published to npm as v0.2.0
- [ ] GitHub release tagged

---

## Stretch Goals (Post v0.2.0)

- [ ] **Semantic vector routing** (v0.3+) — lightweight on-device embedding model (all-MiniLM-L6, 23MB) for 97%+ tool selection accuracy. Research shows 99.6% token reduction with 97.1% hit rate at K=3.
- [ ] iOS support (pending LiteRT-LM Swift API stabilization)
- [ ] TurboQuant KV cache integration (when llama.cpp merges it)
- [ ] Multimodal vision skills (image input to model)
- [ ] Skill marketplace / community skill index
- [ ] Audio input support (Gemma 4 E2B supports audio)
- [ ] Ollama backend adapter (for desktop testing)
- [ ] Expo plugin support
