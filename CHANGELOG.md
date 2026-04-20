# Changelog

## [0.3.0] - 2026-04-21

### Added

- AI SDK V3 provider at the `react-native-gemma-agent/ai` subpath. `createGemmaProvider(registry, engine)` returns a Vercel AI SDK V3 language model that streams through the same skill-aware tool loop as `useGemmaAgent`.
- `useLLM()` hook for declarative one-shot generation. Wraps the engine with React state plumbing.
- `generateStructured()` for schema-validated output. Accepts a Zod v3 schema or raw JSON Schema and parses-and-retries against plain chat output. `toJsonSchema()` and `isZodSchema()` helpers are exported alongside.
- Multi-model catalog: `BUILT_IN_MODELS`, `getModelEntry`, `listModels`, `resolveModelConfig`, `modelConfigFromEntry`. `GemmaAgentProviderProps.model` now accepts a string ID for any catalog entry as well as a full `ModelConfig`.
- CLI bin: `npx react-native-gemma-agent pull <model-id>` downloads a catalog GGUF to disk for `adb push`.
- New types: `ResponseFormat`, `ModelRegistryEntry`, `UseLLMConfig`, `UseLLMReturn`, `StructuredOutputSchema`, `GenerateStructuredInput`, `GenerateStructuredResult`.

### Changed

- `llama.rn` peer minimum is now `0.12.0-rc.8` (was `0.12.0-rc.3`), upper bound `<0.13.0`. Users on earlier rc builds must bump or the install warns; strict pnpm and yarn 2 will fail. Required for the upstream sampler and streaming fixes.
- `ParsedToolCall.skill` widened from `SkillManifest` to `SkillManifest | null`. The null branch only fires when the new `extraToolNames` option is passed, but strict TypeScript consumers reading `call.skill.name` see a TS2531.
- `exports` map added. Only `.`, `./ai`, and `./package.json` are public. Deep imports like `react-native-gemma-agent/lib/*` or `/src/*` now error with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- `InferenceEngine` no longer falls back to `['<end_of_turn>', '<eos>']` when no `stop` is supplied. With `jinja: true` (always on), llama.rn reads the EOS tokens from the GGUF chat-template metadata. Catalog models are unaffected; custom GGUFs with a misconfigured `eos_token_id` may need an explicit `stop` array.

### Fixed

- Structured output via `responseFormat: { type: 'json_schema' }` no longer crashes with `std::exception`. The schema is injected into the system prompt and the output is parsed, validated, and re-asked on failure. The native `responseFormat` passthrough remains wired for the day upstream `llama.cpp` ships the sampler fix. See `docs/ADR/009-structured-output.md`.
- `reasoning_format` from a registry entry now propagates through `useGemmaAgent` to llama.rn, so reasoning models such as Qwen 3.5 strip thinking tokens correctly.

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
