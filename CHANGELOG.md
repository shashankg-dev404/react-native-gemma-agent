# Changelog

## [0.2.0] — 2026-04-14

### Added

- **On-Device Knowledge Base** — `local_notes` native skill with `KnowledgeStore` for persistent on-device note storage. Save, read, search, list, and delete notes via natural language. Notes survive app restarts and are injected into the system prompt so the agent always knows what it knows. Zero cloud dependency.
- **`useKnowledgeStore()` hook** — direct access to the note store for building custom note UIs outside the chat flow.
- **Skill Categories** — optional `category` field on `SkillManifest`. Set `activeCategories` on `AgentConfig` to load only specific categories into context, reducing token usage.
- **`setActiveCategories()` runtime API** — switch active skill categories on the fly via `useGemmaAgent()`.
- **Context Window Warnings** — `onContextWarning` callback and `contextWarningThreshold` config. Fires once when context usage crosses the threshold (default 80%).
- **`resetConversation()`** — clears conversation history and resets context tracking. Use when context warning fires.
- **Context usage bar** in example app — live green/yellow/red progress bar showing token consumption.
- `KnowledgeStore`, `useKnowledgeStore`, `Note`, `NoteMetadata`, `NoteIndexEntry` exports.

### Changed

- System prompt updated to suppress chain-of-thought leaking on small models.
- Tool definitions no longer concatenate `instructions` into the description — saves ~30-50 tokens per tool.
- Empty response fallback: if the model produces empty content after a tool call (thinking-only response), the SDK uses the tool result as the response instead of showing a blank bubble.
- `InferenceEngine.mapResult()` uses `||` instead of `??` for `content` fallback, so empty string properly falls through to `text`.
- Example app now registers 6 skills (added `local_notes`).

### Fixed

- Empty response after tool calls when model puts entire answer into thinking tokens.
- Chain-of-thought reasoning (numbered steps, tool evaluation) leaking into chat responses.

## [0.1.1] — 2026-04-06

### Added

- TypeScript build pipeline (`tsconfig.build.json`, `prepublishOnly` script).

### Fixed

- TypeScript compilation errors for npm consumers.

## [0.1.0] — 2026-04-06

Initial release.

- Gemma 4 E2B on-device inference via llama.rn
- Agent loop with function calling (tool call detection, skill execution, re-invocation)
- JS skill sandbox (hidden WebView, Google AI Edge Gallery pattern)
- Native skill support (full device API access)
- Built-in skills: calculator, Wikipedia, web search, GPS location, calendar
- BM25 skill routing (opt-in)
- Network awareness (`requiresNetwork` flag)
- React hooks: `useGemmaAgent()`, `useModelDownload()`, `useSkillRegistry()`
- Token streaming
- Context usage API
- Full TypeScript types
