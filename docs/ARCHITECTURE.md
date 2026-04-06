# Architecture — react-native-gemma-agent

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        React Native App                         │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                   GemmaAgentProvider                       │  │
│  │                  (Context Provider)                        │  │
│  │                                                           │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐   │  │
│  │  │useGemmaAgent│  │useModelDown- │  │useSkillRegistry│   │  │
│  │  │    Hook     │  │  load Hook   │  │     Hook       │   │  │
│  │  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘   │  │
│  │         │                │                   │            │  │
│  │  ┌──────▼────────────────▼───────────────────▼────────┐   │  │
│  │  │              AgentOrchestrator                      │   │  │
│  │  │                                                     │   │  │
│  │  │  ┌─────────────┐  ┌──────────────┐  ┌───────────┐  │   │  │
│  │  │  │  Inference   │  │  Function    │  │   Skill   │  │   │  │
│  │  │  │  Engine      │  │  Call Parser │  │  Router   │  │   │  │
│  │  │  │  Wrapper     │  │              │  │           │  │   │  │
│  │  │  └──────┬───────┘  └──────────────┘  └─────┬─────┘  │   │  │
│  │  │         │                                   │        │   │  │
│  │  └─────────┼───────────────────────────────────┼────────┘   │  │
│  │            │                                   │            │  │
│  └────────────┼───────────────────────────────────┼────────────┘  │
│               │                                   │                │
│  ┌────────────▼───────────┐          ┌────────────▼────────────┐  │
│  │     Model Manager      │          │     Skill Sandbox       │  │
│  │                        │          │   (Hidden WebView)      │  │
│  │  - Download from HF    │          │                         │  │
│  │  - Store locally       │          │  ┌───────────────────┐  │  │
│  │  - Load / unload       │          │  │ query_wikipedia/  │  │  │
│  │  - Status tracking     │          │  │  scripts/         │  │  │
│  │                        │          │  │   index.html      │  │  │
│  └────────────┬───────────┘          │  └───────────────────┘  │  │
│               │                      │  ┌───────────────────┐  │  │
│  ┌────────────▼───────────┐          │  │ calculator/       │  │  │
│  │   Native Bridge        │          │  │  scripts/         │  │  │
│  │   (llama.rn /          │          │  │   index.html      │  │  │
│  │    executorch /         │          │  └───────────────────┘  │  │
│  │    cactus)              │          │  ┌───────────────────┐  │  │
│  └────────────┬───────────┘          │  │ web_search/       │  │  │
│               │                      │  │  scripts/         │  │  │
│  ┌────────────▼───────────┐          │  │   index.html      │  │  │
│  │   On-Device GPU/NPU    │          │  └───────────────────┘  │  │
│  │   Gemma 4 E2B (Q4)     │          └─────────────────────────┘  │
│  │   ~1.5 GB VRAM         │                                       │
│  └─────────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Agent Loop — Data Flow

This is the core intelligence of the SDK. Every user message goes through this loop.

```
Step 1: USER MESSAGE
  │  "Check Wikipedia about Oscars 2026, who won best picture?"
  │
  ▼
Step 2: BUILD PROMPT
  │  System prompt (base instructions + skill descriptions)
  │  + Conversation history
  │  + New user message
  │
  ▼
Step 3: INFERENCE
  │  Gemma 4 E2B processes on-device (GPU/NPU)
  │  Streams tokens back
  │
  ▼
Step 4: PARSE OUTPUT
  │  FunctionCallParser checks: is the output a tool_call?
  │
  ├── NO tool_call ──► Return response to user. Done.
  │
  └── YES tool_call found:
      │  {"tool_call": {"name": "query_wikipedia", "parameters": {"query": "Oscars 2026"}}}
      │
      ▼
Step 5: EXECUTE SKILL
  │  SkillRouter finds "query_wikipedia" in SkillRegistry
  │  SkillSandbox loads query_wikipedia/scripts/index.html in hidden WebView
  │  Calls window['ai_edge_gallery_get_result']('{"query":"Oscars 2026"}')
  │  Waits for result (with timeout)
  │
  ▼
Step 6: INJECT RESULT
  │  Skill result appended to conversation:
  │  [SKILL_RESULT: query_wikipedia returned "The Brutalist won Best Picture at 2026 Oscars..."]
  │
  ▼
Step 7: RE-INVOKE MODEL
  │  Go back to Step 3 with updated conversation
  │  Model now has the Wikipedia data and formulates a natural language answer
  │  (Max 5 chained calls to prevent infinite loops)
  │
  ▼
Step 8: FINAL RESPONSE
  │  "According to Wikipedia, The Brutalist won Best Picture at the 2026 Academy Awards."
  │  Return to user. Done.
```

---

## Component Architecture

### 1. GemmaAgentProvider

**Type**: React Context Provider
**Responsibility**: Singleton management of model instance and skill registry across the app.

```
GemmaAgentProvider
├── Creates and owns: ModelManager (single instance)
├── Creates and owns: SkillRegistry (single instance)
├── Creates and owns: AgentOrchestrator (single instance)
├── Provides via context: all hooks (useGemmaAgent, useModelDownload, useSkillRegistry)
└── Props:
    ├── model: string (model identifier, e.g., 'gemma-4-e2b-it')
    ├── modelUrl?: string (custom download URL)
    ├── skills?: Skill[] (initial skills to register)
    ├── systemPrompt?: string (base system prompt)
    └── config?: AgentConfig (max chain depth, timeouts, etc.)
```

### 2. ModelManager

**Type**: Class (not a React component)
**Responsibility**: Model lifecycle — download, store, load, unload.

```
ModelManager
├── State: ModelStatus ('not_downloaded' | 'downloading' | 'ready' | 'loaded' | 'error')
├── download(url, onProgress) → Promise<void>
├── load() → Promise<void>
├── unload() → void
├── getStatus() → ModelStatus
├── getModelPath() → string
├── getModelInfo() → { size, quantization, ramUsage }
├── deleteModel() → void
└── Storage: app-local filesystem (not shared, not backed up)
```

**Key decisions**:

- Model files stored in app's cache/documents directory (not bundled in APK)
- Download supports resume (HTTP Range headers)
- Only one model loaded at a time (memory constraint)
- Auto-unload on app background (iOS memory pressure) — configurable

### 3. InferenceEngine (Interface)

**Type**: Abstract interface
**Responsibility**: Wrap the native inference library behind a consistent API.

```
InferenceEngine (interface)
├── loadModel(modelPath: string) → Promise<void>
├── generate(prompt: string, options: GenerateOptions) → AsyncGenerator<string>
├── stopGeneration() → void
├── getInfo() → { loaded: boolean, tokensPerSec: number, ramUsageMB: number }
└── unload() → void

Implementations:
├── LlamaRnEngine    (wraps llama.rn)
├── ExecuTorchEngine (wraps react-native-executorch)  [fallback]
└── CactusEngine     (wraps Cactus SDK)               [fallback]
```

**Why an interface**: If llama.rn breaks or a better engine appears, we swap the implementation without changing any SDK consumer code.

### 4. SkillRegistry

**Type**: Class
**Responsibility**: Manage available skills and generate system prompt fragments.

```
SkillRegistry
├── register(skill: SkillManifest) → void
├── registerFromURL(url: string) → Promise<void>
├── unregister(name: string) → void
├── get(name: string) → SkillManifest | null
├── getAll() → SkillManifest[]
├── generateSystemPromptFragment() → string
└── validateSkill(skill: SkillManifest) → ValidationResult
```

**System prompt fragment format** (what gets injected into the LLM):

```
You have access to the following tools. To use a tool, respond with a JSON object:
{"tool_call": {"name": "<tool_name>", "parameters": {<params>}}}

Available tools:

1. query_wikipedia
   Description: Search Wikipedia for factual information about any topic.
   Parameters: { "query": string }

2. calculator
   Description: Evaluate mathematical expressions accurately.
   Parameters: { "expression": string }

3. web_search
   Description: Search the web for current information.
   Parameters: { "query": string }

When you don't need a tool, respond normally with text.
When you need information you don't have, use the appropriate tool.
You may chain multiple tool calls if needed.
```

### 5. SkillSandbox

**Type**: React Component (renders hidden WebView)
**Responsibility**: Execute JS skills in an isolated WebView environment.

```
SkillSandbox
├── Renders: <WebView> with { opacity: 0, height: 0, pointerEvents: 'none' }
├── execute(skill: SkillManifest, params: object) → Promise<SkillResult>
│   ├── Loads skill's index.html into WebView
│   ├── Injects call to window['ai_edge_gallery_get_result'](JSON.stringify(params))
│   ├── Listens for postMessage response
│   ├── Parses result: { result?: string, error?: string, image?: { base64: string } }
│   └── Resolves/rejects Promise
├── timeout: configurable (default 30s)
├── Security: no access to localStorage, cookies, or app state
└── Cleanup: WebView source reset after each execution
```

**Execution protocol** (JS injected into WebView):

```javascript
(async () => {
  try {
    const fn = window["ai_edge_gallery_get_result"];
    if (!fn) throw new Error("Skill function not found");
    const result = await fn(JSON.stringify(PARAMS));
    window.ReactNativeWebView.postMessage(
      JSON.stringify({
        type: "skill_result",
        data: JSON.parse(result),
      }),
    );
  } catch (e) {
    window.ReactNativeWebView.postMessage(
      JSON.stringify({
        type: "skill_error",
        error: e.message,
      }),
    );
  }
})();
```

### 6. FunctionCallParser

**Type**: Pure function module
**Responsibility**: Detect and extract tool calls from model output.

```
FunctionCallParser
├── parse(output: string) → ParseResult
│   ├── { type: 'text', content: string }          — no tool call, regular response
│   ├── { type: 'tool_call', name, parameters }    — valid tool call detected
│   └── { type: 'malformed', raw: string }          — attempted tool call but invalid JSON
├── parseStreaming(tokenBuffer: string) → ParseResult | null
│   └── Buffers tokens until complete JSON detected or text confirmed
└── extractJSON(text: string) → object | null
    └── Finds first valid JSON block in text (handles model preamble/postamble)
```

**Parsing strategy**:

1. Check if output contains `{"tool_call":` pattern
2. Extract the JSON block (handle surrounding text)
3. Validate against registered skill's parameter schema
4. If malformed, return `malformed` type so orchestrator can retry

### 7. AgentOrchestrator

**Type**: Class
**Responsibility**: The brain — coordinates the full agent loop.

```
AgentOrchestrator
├── Depends on: InferenceEngine, SkillRegistry, SkillSandbox, FunctionCallParser, BM25Scorer
├── sendMessage(text: string, onEvent?) → Promise<string>
│   └── Fires events: thinking | skill_called | skill_result | token | response | error
├── conversationHistory: Message[]
├── config:
│   ├── maxChainDepth: number (default 5)
│   ├── skillTimeout: number (default 30000ms)
│   ├── skillRouting: 'all' | 'bm25' (default 'all')
│   └── maxToolsPerInvocation: number (default 5, only with 'bm25')
├── Network awareness:
│   └── checkConnectivity() — HEAD request to google.com/generate_204 (3s timeout)
│       Skills with requiresNetwork: true are blocked offline with clean error
├── BM25 routing:
│   └── getToolsForQuery(query) — scores skills against user query, sends top-N
├── reset() → void (clear conversation)
└── getConversation() → ReadonlyArray<Message>
```

### 8. BM25Scorer

**Type**: Class
**Responsibility**: Pre-filter skills by relevance to user query. Opt-in via `skillRouting: 'bm25'`.

```
BM25Scorer
├── buildIndex(skills: SkillManifest[]) — tokenizes name+description+parameters+instructions
├── score(query: string) → Array<{ skill, score }> — ranked by BM25 score
├── topN(query: string, n: number) → top N skills
├── Parameters: k1=1.5, b=0.75
└── Tokenizer: lowercase + strip non-alphanumeric + filter tokens < 2 chars
```

Pure math, ~100 lines, zero overhead when disabled.

---

## Skill Format Specification

### Directory Structure

```
my-skill/
├── SKILL.md              ← Required: metadata + LLM instructions
├── scripts/
│   └── index.html        ← Required for JS skills: execution logic
└── assets/               ← Optional: images, data files
    └── icon.png
```

### SKILL.md Format

```markdown
---
name: query_wikipedia
description: Search Wikipedia for factual information about any topic
version: 1.0.0
type: js
parameters:
  query:
    type: string
    description: The search query to send to Wikipedia
    required: true
---

# Instructions

When the user asks a factual question that you're not confident about,
use this skill to look up the answer on Wikipedia.

Call this skill with a clear, concise search query.
The skill will return a summary of the Wikipedia article.

Use the returned information to answer the user's question naturally.
If no results are found, tell the user and try to answer from your knowledge.
```

### index.html Template

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
  </head>
  <body>
    <script>
      window["ai_edge_gallery_get_result"] = async function (jsonData) {
        const params = JSON.parse(jsonData);

        // Your skill logic here
        // Can use fetch(), DOM APIs, any web API
        // Must return JSON string with { result: "..." } or { error: "..." }

        try {
          const response = await fetch(
            `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(params.query)}`,
          );
          const data = await response.json();
          return JSON.stringify({
            result: `${data.title}: ${data.extract}`,
          });
        } catch (e) {
          return JSON.stringify({
            error: `Wikipedia lookup failed: ${e.message}`,
          });
        }
      };
    </script>
  </body>
</html>
```

---

## Memory Budget (Target Device: 6GB RAM Android)

```
Total Device RAM:          6,144 MB
├── OS + Background Apps:  ~2,500 MB
├── RN App Runtime:          ~200 MB
├── Gemma 4 E2B (Q4_K_M): ~1,500 MB
├── KV Cache (standard):     ~500 MB  (~4K tokens)
├── KV Cache (TurboQuant):   ~100 MB  (~4K tokens, future)
├── WebView (Skill Sandbox):  ~50 MB
└── Buffer/Headroom:         ~394 MB
                           ─────────
Available:                  6,144 MB ✓
```

---

## Technology Choices

| Component        | Choice                                           | Rationale                               |
| ---------------- | ------------------------------------------------ | --------------------------------------- |
| Framework        | React Native (New Architecture)                  | User's expertise, cross-platform        |
| Model inference  | llama.rn (primary), Cactus/ExecuTorch (fallback) | Best RN support for GGUF models         |
| Model format     | GGUF Q4_K_M                                      | Best quality-per-bit for mobile         |
| Skill execution  | react-native-webview (hidden)                    | Matches Google's pattern, battle-tested |
| State management | React Context + useReducer                       | No external deps, sufficient for SDK    |
| Local storage    | react-native-fs                                  | Model file management                   |
| Language         | TypeScript                                       | Type safety for SDK consumers           |
| Minimum Android  | API 26 (Android 8.0)                             | llama.rn requirement                    |
| Minimum iOS      | iOS 15+                                          | When iOS support added (stretch goal)   |

---

## Security Considerations

- **Model runs on-device**: No user data leaves the phone for inference
- **Skills in sandboxed WebView**: Cannot access app storage, React Native bridge, or native APIs
- **Skills CAN make network requests**: `fetch()` works in WebView. Skills that call external APIs (Wikipedia, weather) require internet. This is by design — the model is private, skills are the controlled bridge to the internet
- **Skill source trust**: Skills loaded from URLs should be treated as untrusted code. Future: add skill signing/verification
- **No telemetry**: SDK collects zero analytics. The developer's app may, but the SDK does not

---

## Built-in Skills (v0.1.0)

| Skill | Type | Network | Source |
|---|---|---|---|
| `calculator` | native | No | `skills/calculator.ts` |
| `query_wikipedia` | js/WebView | Yes | `skills/queryWikipedia.ts` — LaTeX stripped |
| `web_search` | js/WebView | Yes | `skills/webSearch.ts` — SearXNG with 3 fallback instances |
| `device_location` | native | No | `skills/deviceLocation.ts` — GPS + offline city lookup (60 cities) |
| `read_calendar` | native | No | `skills/readCalendar.ts` — device calendar events |

## Context Usage API

```
InferenceEngine.getContextUsage() → { used: number, total: number, percent: number }
```

Tracks prompt + predicted tokens from last generation vs configured context size. Exposed via `useGemmaAgent().contextUsage`.

## Future Architecture (Post-Sprint)

```
v0.2: TurboQuant KV cache (6x longer conversations)
v0.2: On-device knowledge base skill, skill categories
v0.3: Multimodal input (camera → model → skill)
v0.4: iOS support
v0.5: Skill marketplace (browse/install community skills)
v0.6: Multiple model support (Gemma 4 E4B, Phi-4, Qwen)
v1.0: Stable API, Expo plugin
```
