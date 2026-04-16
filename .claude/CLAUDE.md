# CLAUDE.md — react-native-gemma-agent

## Project Overview

Building `react-native-gemma-agent` — the first React Native NPM SDK for on-device AI agents powered by Google's Gemma 4. The SDK provides a pluggable JS skill system (inspired by Google AI Edge Gallery's Agent Skills) running entirely on-device.

**Source of truth**: All plans, architecture, research, and session history live in `docs/`.

---

## Critical Rules

### 1. Research Before Guessing — ASK PERMISSION FIRST

If a task from `docs/PLAN.md` or a user request requires knowledge you don't confidently have (e.g., llama.rn API specifics, Gemma 4 GGUF conversion steps, react-native-webview injection patterns, a library's latest API), **DO NOT guess or hallucinate**.

Instead:
- **STOP** and tell the user: "I don't have full knowledge of [X]. Should I run `/last30days` and/or `/deep-research` to get current information?"
- **WAIT** for the user's explicit permission before running either skill.
- **NEVER** run `/last30days` or `/deep-research` without the user saying yes.

This applies to:
- Library APIs that may have changed (llama.rn, react-native-webview, executorch)
- Model formats and conversion tools (GGUF, LiteRT, ExecuTorch)
- Platform-specific behavior (Android GPU delegation, iOS Metal, memory management)
- Any external tool, service, or API you're not 100% certain about

### 2. Session Continuity

At the **start of every session**, read these files in order:
1. `docs/SESSION_LOG.md` — what was done, what to do next
2. `docs/PLAN.md` — current phase and task status
3. `docs/ARCHITECTURE.md` — system design decisions

At the **end of every session**, update:
1. `docs/SESSION_LOG.md` — append new session entry with what was done, decisions made, and what to pick up next
2. `docs/PLAN.md` — check off completed tasks

### 3. ADR for Every Non-Obvious Decision

When making a technical decision that isn't obviously the only choice (e.g., choosing llama.rn over executorch, choosing a specific prompt format for function calling, choosing how to handle model downloads), create an ADR in `docs/ADR/` using the `000-template.md` format.

Name format: `NNN-short-title.md` (e.g., `001-inference-engine.md`)

### 4. Test Cases for Every Testable Feature

When completing a phase that has user-visible behavior, verify the corresponding test cases in `docs/TEST_CASES.md` are still accurate. If the implementation changed the expected behavior, update the test cases.

### 5. No Over-Engineering

This is a 2-day sprint. Follow these rules strictly:
- No abstractions for hypothetical future features
- No dependency unless absolutely necessary
- No premature optimization
- If it works and it's readable, it's good enough
- Three similar lines of code > a premature abstraction
- Skip TypeScript generics gymnastics — simple explicit types are fine

### 6. Android First, iOS Later

- All development and testing targets Android
- Do NOT write iOS-specific code unless explicitly asked
- Do NOT test on iOS simulator
- iOS support is a stretch goal (post-sprint)

### 7. Code Style

- TypeScript for all SDK code
- Functional components with hooks (no class components)
- Named exports (no default exports)
- File naming: `PascalCase.tsx` for components, `camelCase.ts` for utilities
- Keep files under 300 lines, split if larger
- No comments for obvious code. Comments only for "why", never "what"
- Error messages must be user-facing friendly (developers using the SDK are the "users")

### 7a. Don't Leave AI Fingerprints on the Code

Code should read like a human engineer wrote it. A reviewer skimming the diff should never be able to say "this was AI-generated". Follow these rules strictly:

**Comments**
- DO NOT write comments explaining obvious code. Bad examples to avoid:
  - `// increment counter`
  - `// return the result`
  - `// loop through the array`
  - `// check if user is null`
- Comments belong ONLY on non-obvious "why" (a workaround for a specific bug, a hidden invariant, a subtle constraint). If removing the comment wouldn't confuse a future reader, don't write it.
- DO NOT add JSDoc blocks to internal helpers. Reserve JSDoc for exported public API surfaces.
- DO NOT write multi-paragraph docstrings. One short sentence max on public exports.
- DO NOT leave planning/narration comments like `// Step 1: validate input`, `// Now we process the results`, `// This handles the edge case where...`.
- DO NOT leave "removed" breadcrumb comments (`// removed old logic`, `// was: foo()`). Just delete the code.

**Style consistency**
- Match the EXISTING code style in the repo (tabs vs spaces, quote style, semicolons, import order, arrow-fn vs named-fn). When in doubt, open the nearest sibling file and mirror it.
- DO NOT reformat or reorder imports in files you're not otherwise touching.
- DO NOT switch between `const`/`let`/arrow/function styles within a file. Pick the one the file already uses.

**Naming consistency**
- Use the same variable name for the same concept across the repo. If messages are called `messages` in `AgentOrchestrator.ts`, they are `messages` everywhere, not `msgs` or `conversationHistory` or `chatLog`.
- Constants stay in one place (`DEFAULT_CONFIG`, `SDK_VERSION`, etc.). Don't redefine the same constant in multiple files.
- Don't invent new names for things that already have names in the types (`SkillManifest`, `ToolCall`, `ContextUsage`, `AgentEvent`). Reuse.

**Writing style (commits, PR descriptions, docs, error messages, any prose a human will read)**
- AVOID em-dashes (—). Use a comma, colon, period, or parentheses instead.
- AVOID AI-tell words: `delve`, `leverage`, `moreover`, `furthermore`, `comprehensive`, `seamless`, `robust`, `utilize` (just say "use"), `facilitate`, `in order to` (just say "to"), `it's worth noting that`, `essentially`, `meticulously`, `intricate`, `vibrant`, `tapestry`, `realm`, `landscape`, `navigate the complexities of`.
- AVOID marketing puffery: "production-ready", "enterprise-grade", "powerful", "cutting-edge", "state-of-the-art", "best-in-class".
- AVOID listicle formatting in commit bodies. Write short sentences like a human would.
- AVOID emojis in code, commits, and docs unless the user explicitly asks.
- Commit messages are lowercase after the type prefix, under 70 chars on the subject line, and describe the change factually. Example good: `feat: extract runToolLoop from AgentOrchestrator`. Example bad: `feat: Comprehensively refactored the orchestrator to seamlessly support — you guessed it — the new V3 adapter! 🚀`

**Code shape**
- DO NOT over-abstract. Three similar lines of code is better than a premature helper. Don't introduce a `Strategy` / `Factory` / `Builder` when a function will do.
- DO NOT add defensive code for things that can't happen (null-checking a value you just constructed, try/catch around pure functions that don't throw).
- DO NOT add `readonly` / `Readonly<T>` / `as const` everywhere for show. Use them when immutability is actually load-bearing.
- DO NOT ship dead code "in case we need it later". Delete it.
- DO NOT log every step. Production code is quiet; only log at boundaries or on errors.
- If you split a function, the split should be motivated by reuse or readability at the call site, not by line count.

**Tests**
- Test names describe behaviour, not implementation: `rejects empty query` beats `test_validateInput_case_3`.
- DO NOT add tests that assert the mock was called with the exact mock you just passed in. Test behaviour.

**When in doubt**
- Open 3 sibling files. Match what they do. If you're still unsure, ask Shashank rather than guessing.

### 8. Git Workflow

- Commit after each completed phase (not after each task)
- Commit message format: `feat: Phase N — short description`
- Branch: `main` (no feature branches for a 2-day sprint)
- Tag releases: `v0.1.0` when shipping

### 9. LinkedIn Content Awareness

After completing a phase that would make a good demo, remind the user:
- "This would be a good moment to record a demo video for LinkedIn"
- Reference the specific post draft in `docs/LINKEDIN_CONTENT.md`
- The user cares about documenting the journey — help them not forget

---

## Project Structure (Target)

```
react-native-gemma-agent/
├── .claude/
│   └── CLAUDE.md              ← This file
├── docs/
│   ├── ADR/                   ← Architectural Decision Records
│   ├── PLAN.md                ← Sprint plan with phases and tasks
│   ├── ARCHITECTURE.md        ← System design
│   ├── TEST_CASES.md          ← Manual E2E test cases
│   ├── SESSION_LOG.md         ← Session tracking for Claude
│   ├── LINKEDIN_CONTENT.md    ← Pre-drafted LinkedIn posts
│   └── RESEARCH_SUMMARY.md    ← Consolidated research
├── src/                       ← SDK source code
│   ├── GemmaAgentProvider.tsx
│   ├── useGemmaAgent.ts
│   ├── useModelDownload.ts
│   ├── useSkillRegistry.ts
│   ├── AgentOrchestrator.ts
│   ├── ModelManager.ts
│   ├── InferenceEngine.ts
│   ├── SkillRegistry.ts
│   ├── SkillSandbox.tsx
│   ├── FunctionCallParser.ts
│   ├── types.ts
│   └── index.ts               ← Public API exports
├── skills/                    ← Built-in demo skills
│   ├── query_wikipedia/
│   ├── calculator/
│   └── web_search/
├── example/                   ← Demo app (uses the SDK)
├── package.json
├── tsconfig.json
├── README.md
└── LICENSE
```

---

## Key Technical Context

- **Model**: Gemma 4 E2B-it (2.3B effective params, ~1.5GB Q4_K_M GGUF)
- **Inference**: llama.rn (primary), react-native-executorch or Cactus (fallback)
- **Skills**: JS executed in hidden react-native-webview, following Google's `ai_edge_gallery_get_result` pattern
- **Function calling**: Model outputs `{"tool_call": {"name": "...", "parameters": {...}}}`, parsed by FunctionCallParser
- **React Native**: New Architecture required (for llama.rn compatibility)
- **Target devices**: Android 8.0+ with 6GB+ RAM
- **TurboQuant**: Not in MVP. Architecture designed to support it when llama.cpp merges it.

---

## User Profile

- **Name**: Shashank
- **Expertise**: Experienced React Native developer
- **Other project**: AniChan (anime app, separate repo at ~/Desktop/AniChan)
- **Communication style**: Wants ruthless honesty — no sugarcoating, call out bad ideas, test until bulletproof
- **Goal**: Ship SDK to GitHub, build LinkedIn presence as "on-device AI for React Native" person
- **Constraint**: Zero budget — everything must be free/open-source
