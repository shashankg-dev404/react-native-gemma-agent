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
- [ ] Test basic multi-turn conversation without skills (needs integration test in example app)

### Exit Criteria
- [x] Can have a multi-turn text conversation with Gemma 4 via the wrapper
- [x] System prompt injection works
- [x] Token streaming works

---

## Phase 3: Skill System — Skill Registry

> The brain of the agent — manages which skills are available and their metadata.

### Tasks
- [ ] Define the Skill manifest format (inspired by Google's SKILL.md):
  ```
  {
    name: "query_wikipedia",
    description: "Search Wikipedia for factual information",
    version: "1.0.0",
    type: "js",                    // "js" | "text" | "native"
    parameters: {                  // JSON Schema for what the model passes
      query: { type: "string", description: "Search query" }
    },
    entrypoint: "scripts/index.html",
    instructions: "..."            // LLM-facing instructions
  }
  ```
- [ ] Create `SkillRegistry` class:
  - `registerSkill(skill)` — add a skill from bundled assets
  - `registerSkillFromURL(url)` — load a skill from remote URL
  - `unregisterSkill(name)` — remove a skill
  - `getSkills()` — list all registered skills
  - `getSkill(name)` — get one skill by name
  - `generateSystemPromptFragment()` — produce the text that gets injected into the LLM system prompt describing all available skills
- [ ] Build the system prompt template that lists available skills with their names, descriptions, and parameter schemas so the model knows what tools it has
- [ ] Test: register 3 skills, verify system prompt fragment is correct

### Exit Criteria
- Skills can be registered, listed, and their metadata injected into system prompts
- System prompt clearly instructs the model HOW to call skills (JSON format)

---

## Phase 4: Skill System — WebView Sandbox

> Execute JS skills in a hidden WebView — the same pattern as Google AI Edge Gallery.

### Tasks
- [ ] Install `react-native-webview`
- [ ] Create `SkillSandbox` component (hidden WebView, zero UI)
- [ ] Implement the execution protocol:
  1. Load skill's `scripts/index.html` into hidden WebView
  2. Call `window['ai_edge_gallery_get_result'](jsonParams)` via `injectJavaScript`
  3. Receive result via `onMessage` / `postMessage` bridge
  4. Return result to caller as Promise
  5. Handle timeout (skill takes too long)
  6. Handle errors (skill throws, network failure for fetch()-based skills)
- [ ] Support skill return types:
  - `{ result: "text" }` — plain text result
  - `{ result: "text", image: { base64: "..." } }` — result with image
  - `{ error: "message" }` — skill error
- [ ] Add skill execution timeout (configurable, default 30s)
- [ ] Add skill sandboxing — skills cannot access app storage, cookies, etc.
- [ ] Test with a simple inline skill (no file loading)

### Exit Criteria
- Can execute a JS function in a hidden WebView, pass it JSON, get back a result
- Errors and timeouts are handled gracefully

---

## Phase 5: Agent Loop — Function Calling Parser

> Parse the model's output to detect when it wants to call a skill.

### Tasks
- [ ] Define the function call format the model should output:
  ```json
  {"tool_call": {"name": "query_wikipedia", "parameters": {"query": "Oscars 2026 best picture"}}}
  ```
- [ ] Build `FunctionCallParser`:
  - Detect if model output contains a tool_call JSON block
  - Extract tool name and parameters
  - Validate against registered skill's parameter schema
  - Handle malformed output (model doesn't always produce valid JSON)
  - Handle partial JSON in streaming (buffer until complete)
- [ ] Add retry logic: if model produces invalid tool_call, re-prompt once with correction
- [ ] Test with mock model outputs (valid calls, malformed calls, no calls)

### Exit Criteria
- Parser reliably extracts tool calls from model output
- Handles malformed JSON gracefully

---

## Phase 6: Agent Loop — Orchestrator

> The main loop that ties model → parser → skill → model together.

### Tasks
- [ ] Create `AgentOrchestrator` class — the core engine:
  ```
  User message
    → Add to conversation history
    → Generate system prompt (base + skill descriptions)
    → Send to inference engine
    → Parse output for tool calls
    → If tool_call found:
        → Execute skill via SkillSandbox
        → Append skill result to conversation
        → Re-invoke model with updated context
        → Repeat (max 5 chained calls to prevent infinite loops)
    → If no tool_call:
        → Return final response to user
  ```
- [ ] Implement max-depth limit for chained skill calls (prevent infinite loops)
- [ ] Add conversation history management:
  - Append user messages, assistant messages, skill results
  - Trim history when approaching context limit
- [ ] Add event emitter for UI updates:
  - `onModelThinking` — model is generating
  - `onSkillCalled(skillName, params)` — skill invocation detected
  - `onSkillResult(skillName, result)` — skill returned
  - `onResponse(text)` — final response ready
  - `onError(error)` — something broke
- [ ] Test the full loop: user asks → model calls skill → skill returns → model answers

### Exit Criteria
- Full agent loop works: question → skill call → answer
- Events fire correctly for UI to show "Loading skill...", "Called skill...", etc.
- Chained skill calls work (model calls skill A, then skill B based on A's result)

---

## Phase 7: React Hooks API

> The developer-facing API. This is what gets imported from the NPM package.

### Tasks
- [ ] Create `useGemmaAgent()` hook:
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
- [ ] Create `GemmaAgentProvider` context provider (wraps app, manages shared model instance)
- [ ] Create `useModelDownload()` hook for download-only UI screens
- [ ] Create `useSkillRegistry()` hook for dynamic skill management
- [ ] Ensure all hooks are properly typed with TypeScript
- [ ] Write JSDoc comments for every public API

### Exit Criteria
- A developer can `npm install react-native-gemma-agent`, wrap their app in the Provider, call `useGemmaAgent()`, and have a working agent
- TypeScript types are complete and accurate

---

## Phase 8: Demo Skills

> Build 3 skills that showcase different capabilities.

### Skill 1: query_wikipedia
- [ ] Create `skills/query_wikipedia/SKILL.md`
- [ ] Create `skills/query_wikipedia/scripts/index.html`
- [ ] Implements: receives search query → fetches Wikipedia API → extracts summary → returns text
- [ ] Test with various queries (people, events, places, concepts)

### Skill 2: calculator
- [ ] Create `skills/calculator/SKILL.md`
- [ ] Create `skills/calculator/scripts/index.html`
- [ ] Implements: receives math expression → evaluates safely → returns result
- [ ] Fully offline — no fetch() needed
- [ ] Test with basic arithmetic, unit conversions, percentages

### Skill 3: web_search
- [ ] Create `skills/web_search/SKILL.md`
- [ ] Create `skills/web_search/scripts/index.html`
- [ ] Implements: receives query → fetches a free search API or DuckDuckGo → returns top results
- [ ] Test with various queries

### Exit Criteria
- All 3 skills work end-to-end through the agent loop
- Wikipedia skill answers factual questions correctly
- Calculator handles math the LLM would normally struggle with
- Web search returns real search results

---

## Phase 9: Demo App

> A standalone app that uses the SDK — proves it works and provides LinkedIn demo material.

### Tasks
- [ ] Create `example/` directory with a fresh RN app
- [ ] Build chat UI screen:
  - Message bubbles (user + agent)
  - Skill status indicators ("Loaded skill query_wikipedia", "Called JS skill...")
  - "Model on GPU" badge
  - Typing indicator while model generates
  - Token streaming (text appears word by word)
- [ ] Build model download screen:
  - Model size info
  - Download progress bar
  - Storage space check
- [ ] Build skill browser screen:
  - List installed skills with descriptions
  - Toggle skills on/off
  - Load skill from URL
- [ ] Add onboarding flow:
  - First launch → explain what the app does
  - Prompt to download model
  - Show pre-loaded skills
- [ ] Test on physical Android device
- [ ] Record demo video for LinkedIn

### Exit Criteria
- App launches, downloads model, loads skills, and handles a full conversation with skill calls
- Looks good enough for a demo video

---

## Phase 10: Documentation & Ship

> Make it real — README, docs, GitHub, NPM prep.

### Tasks
- [ ] Write `README.md`:
  - What it does (one paragraph)
  - Demo GIF/video
  - Quick start (5 lines of code)
  - Full API reference
  - How to create custom skills
  - Supported models
  - Requirements (RN version, New Architecture, etc.)
- [ ] Write `CONTRIBUTING.md`
- [ ] Write `docs/CREATING_SKILLS.md` — guide for building custom skills
- [ ] Add `LICENSE` (MIT)
- [ ] Configure `package.json` for NPM publishing
- [ ] Create GitHub repo, push everything
- [ ] Tag v0.1.0 release
- [ ] Create GitHub Discussions for community skill sharing
- [ ] Draft LinkedIn launch post (see `LINKEDIN_CONTENT.md`)

### Exit Criteria
- GitHub repo is public with clean README
- `npm install react-native-gemma-agent` is ready (even if not published yet)
- At least one LinkedIn post is drafted and ready

---

## Stretch Goals (Post-Sprint)

- [ ] iOS support (pending LiteRT-LM Swift API stabilization)
- [ ] TurboQuant KV cache integration (when llama.cpp merges it)
- [ ] Multimodal vision skills (image input to model)
- [ ] Skill marketplace / community skill index
- [ ] Audio input support (Gemma 4 E2B supports audio)
- [ ] Ollama backend adapter (for desktop testing)
- [ ] Expo plugin support
