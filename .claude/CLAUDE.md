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
- Keep files under 300 lines — split if larger
- No comments for obvious code. Comments only for "why", never "what"
- Error messages must be user-facing friendly (developers using the SDK are the "users")

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
