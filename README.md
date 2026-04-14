# react-native-gemma-agent

The first React Native SDK for building **on-device AI agents** powered by Google's Gemma 4. Run a complete agent loop — inference, tool calling, and skill execution — entirely on the user's phone with zero cloud dependency.

## Demo

https://github.com/user-attachments/assets/576b1419-78d0-43cf-a36a-04a4ba9e5a05

## Why This Exists

Every major AI framework (LangChain, CrewAI, AutoGen) assumes a cloud LLM. But mobile apps need agents that work **offline**, respect **privacy**, and cost **zero per inference**. This SDK brings the agentic pattern — model thinks, picks a tool, executes it, responds — entirely on-device using Gemma 4's native function calling.

Inspired by [Google AI Edge Gallery's Agent Skills](https://github.com/google-ai-edge/gallery), rebuilt as a React Native SDK that any developer can drop into their app.

## What's New in v0.2.0

### On-Device Knowledge Base — Your App Becomes an AI Notebook

The agent can now **save, search, and recall notes** entirely on-device. No cloud. No third-party app. No API keys. Users tell the agent to remember something, and it persists across conversations and app restarts.

```
User: "Remember that my wifi password is swordfish"
Agent: [saves note on-device] → "Got it, saved your wifi password."

User: "What's my wifi password?"
Agent: [reads from saved notes] → "Your wifi password is swordfish."
```

Under the hood, notes are stored as markdown files in app-local storage with BM25 search indexing. The note index is injected into the system prompt so the agent is always aware of what it knows — no RAG pipeline, no vector database, no external dependencies.

**Use cases**: personal preferences, saved facts, flight details, shopping lists, study notes, bookmarks — anything the user wants their AI to remember.

### Skill Categories — Organize Skills, Save Context Tokens

Group skills by category (`'finance'`, `'travel'`, `'utility'`) and switch active categories at runtime. Only active categories consume context window tokens. With a 4K context window, this is the difference between 5 usable turns and 15.

```typescript
const { setActiveCategories } = useGemmaAgent();
setActiveCategories(['travel', 'utility']); // only these skills loaded into context
```

### Context Window Monitoring — Know Before You Run Out

Live context usage tracking with a configurable warning callback. The example app shows a color-coded progress bar (green → yellow → red) so users know when to clear chat.

```typescript
<GemmaAgentProvider
  agentConfig={{
    contextWarningThreshold: 0.8,
    onContextWarning: (usage) => Alert.alert(`Context ${usage.percent}% full`),
  }}
>
```

## What It Does

- Runs **Gemma 4 E2B** (2.3B effective params, 4.6B total MoE) on-device via llama.rn
- **Agent loop**: model generates -> detects tool calls -> executes skills -> feeds results back -> responds naturally
- **On-device knowledge base**: save, search, and recall notes — persistent AI memory with zero cloud dependency
- **JS Skill Sandbox**: execute skills in a hidden WebView (same pattern as Google AI Edge Gallery)
- **Native Skills**: run skills directly in React Native context with full access to device APIs (GPS, calendar, health, gallery, etc.)
- **Skill categories**: group skills and selectively load only what's needed per screen or context
- **Context monitoring**: live token usage tracking with configurable warning threshold
- **BM25 Skill Routing** (opt-in): smart pre-filtering when you have many skills — only sends the most relevant tools to the model per query
- **React Hooks API**: `useGemmaAgent()`, `useModelDownload()`, `useSkillRegistry()`, `useKnowledgeStore()`
- **Streaming**: token-by-token output for real-time UI updates
- Fully typed with TypeScript

## Quick Start

```tsx
import {
  GemmaAgentProvider,
  useGemmaAgent,
  useModelDownload,
  KnowledgeStore,
} from 'react-native-gemma-agent';
import {
  calculatorSkill,
  queryWikipediaSkill,
  createLocalNotesSkill,
} from 'react-native-gemma-agent/skills';

// Set up knowledge base
const knowledgeStore = new KnowledgeStore();
const localNotesSkill = createLocalNotesSkill(knowledgeStore);

// 1. Wrap your app
function App() {
  return (
    <GemmaAgentProvider
      model={{
        repoId: 'unsloth/gemma-4-E2B-it-GGUF',
        filename: 'gemma-4-E2B-it-Q4_K_M.gguf',
      }}
      skills={[calculatorSkill, queryWikipediaSkill, localNotesSkill]}
      knowledgeStore={knowledgeStore}
      systemPrompt="You are a helpful assistant."
    >
      <ChatScreen />
    </GemmaAgentProvider>
  );
}

// 2. Use the hooks
function ChatScreen() {
  const { sendMessage, messages, streamingText, isProcessing, activeSkill, loadModel } = useGemmaAgent();
  const { download, progress } = useModelDownload();

  // Download model (3.1 GB, one-time)
  // await download();

  // Load into memory
  // await loadModel();

  // Chat with agent
  // const response = await sendMessage("What is 234 * 567?");
  // Agent calls calculator skill -> returns "132678"

  // const response = await sendMessage("Remember my wifi password is swordfish");
  // Agent saves note on-device -> "Got it, saved your wifi password."
}
```

## Requirements

| Requirement | Minimum |
|---|---|
| React Native | 0.76+ (New Architecture required) |
| Android | API 26 (8.0) |
| Device RAM | 8 GB+ recommended |
| Disk Space | ~3.5 GB (for model file) |
| llama.rn | 0.12.0-rc.3+ |

## Installation

```bash
npm install react-native-gemma-agent

# Peer dependencies
npm install llama.rn react-native-fs react-native-webview
```

**Android Setup:**

Add to `android/app/src/main/AndroidManifest.xml`:
```xml
<application android:largeHeap="true" ...>
```

## API Reference

### GemmaAgentProvider

Wrap your app to initialize the SDK. Creates all internal instances and renders the hidden WebView sandbox for JS skill execution.

```tsx
<GemmaAgentProvider
  model={{ repoId: string, filename: string, expectedSize?: number }}
  skills={SkillManifest[]}                // Skills to register on mount
  systemPrompt={string}                   // Base system prompt
  engineConfig={InferenceEngineConfig}    // Optional engine tuning
  agentConfig={AgentConfig}               // Optional agent config
  knowledgeStore={KnowledgeStore}         // Optional shared knowledge store (v0.2.0)
>
  {children}
</GemmaAgentProvider>
```

### useGemmaAgent()

Main hook for chat interactions. Returns everything you need to build a chat UI.

```tsx
const {
  sendMessage,        // (text: string, onEvent?) => Promise<string>
  messages,           // ReadonlyArray<Message> - conversation history
  streamingText,      // string - tokens streamed so far (live typing effect)
  isProcessing,       // boolean - is the agent thinking/executing?
  isModelLoaded,      // boolean - model loaded and ready?
  modelStatus,        // ModelStatus - lifecycle state
  activeSkill,        // string | null - skill currently executing
  error,              // string | null - last error
  contextUsage,       // { used, total, percent } - context window consumption
  activeCategories,   // string[] | undefined - active skill categories (v0.2.0)
  setActiveCategories,// (categories: string[] | undefined) => void (v0.2.0)
  loadModel,          // (onProgress?) => Promise<number> - returns load time ms
  unloadModel,        // () => Promise<void>
  reset,              // () => void - clear conversation history
  resetConversation,  // () => void - clear history + reset context tracking (v0.2.0)
} = useGemmaAgent();
```

**How it works under the hood:**
1. You call `sendMessage("What is 234 * 567?")`
2. SDK sends the message to Gemma 4 running on-device
3. Model decides to call the `calculator` skill with `{expression: "234 * 567"}`
4. SDK executes the skill, gets the result `"132678"`
5. SDK feeds the result back to the model
6. Model generates a natural response: "234 * 567 equals 132,678"
7. `messages` updates with the full conversation, `sendMessage` returns the response text

During this process, `streamingText` updates token-by-token, `activeSkill` shows which skill is running, and `isProcessing` stays true until done.

### useModelDownload()

Hook for model download management. The model is ~3.1 GB and needs to be downloaded once.

```tsx
const {
  download,        // () => Promise<string> - returns file path
  cancelDownload,  // () => void
  checkModel,      // () => Promise<boolean> - is model on device?
  setModelPath,    // (path: string) => Promise<void> - custom path
  deleteModel,     // () => Promise<void>
  progress,        // DownloadProgress | null - { bytesDownloaded, totalBytes, percent }
  status,          // ModelStatus
  checkStorage,    // () => Promise<{ available, required, sufficient }>
} = useModelDownload();
```

Downloads support **resume** — if the app is killed mid-download, calling `download()` again continues from where it left off.

### useSkillRegistry()

Hook for dynamic skill management at runtime.

```tsx
const {
  registerSkill,    // (skill: SkillManifest) => void
  unregisterSkill,  // (name: string) => void
  skills,           // SkillManifest[] - currently registered skills
  hasSkill,         // (name: string) => boolean
  clear,            // () => void - remove all skills
} = useSkillRegistry();
```

### useKnowledgeStore()

Direct access to the on-device note store. Use this to build custom UI around saved notes — listing, editing, or deleting notes outside the chat flow.

```tsx
const {
  notes,         // NoteIndexEntry[] - all saved notes
  saveNote,      // (title, content, tags?) => Promise<void>
  getNote,       // (title) => Promise<Note | null>
  searchNotes,   // (query) => Promise<SearchResult[]>
  deleteNote,    // (title) => Promise<boolean>
  refresh,       // () => Promise<void> - re-read from storage
} = useKnowledgeStore();

// Build a "My Notes" screen
notes.map(note => <Text>{note.title} — {note.preview}</Text>);
```

Notes are stored as individual markdown files in app-local storage (`{app-dir}/gemma-agent-notes/`). Each note has YAML frontmatter (title, tags, created, modified) and markdown body. Storage is capped at 5 MB with a warning at 100 KB to keep system prompt injection performant.

## Creating Custom Skills

The SDK supports two skill types: **native** (runs in React Native context) and **js** (runs in a sandboxed WebView).

### Native Skill (runs in RN context, fully offline)

Native skills have **full access to everything React Native can access** — GPS, camera, calendar, health data, file system, Bluetooth, etc. Use these when your skill needs device APIs.

```typescript
import type { SkillManifest } from 'react-native-gemma-agent';

const locationSkill: SkillManifest = {
  name: 'get_current_location',
  description: 'Get the user GPS coordinates and city name',
  version: '1.0.0',
  type: 'native',
  requiresNetwork: false,
  parameters: {
    accuracy: { type: 'string', description: 'high or low accuracy', enum: ['high', 'low'] },
  },
  execute: async (params) => {
    // Use any React Native library here
    // e.g., react-native-geolocation, expo-location, etc.
    const pos = await getCurrentPosition(params.accuracy);
    return { result: JSON.stringify({ lat: pos.lat, lng: pos.lng, city: pos.city }) };
  },
};
```

**Use cases for native skills:**
- **Travel app**: GPS location -> find nearby attractions
- **Fitness app**: HealthKit/Google Fit data -> AI coaching
- **Calendar app**: Calendar events -> AI scheduling
- **Photo app**: Camera Roll access -> AI-powered organization
- **Smart home**: Bluetooth/WiFi device control -> voice commands

The model calls these skills naturally when the user's question matches the skill description. You just register them — the SDK handles everything else.

### JS Skill (runs in sandboxed WebView, can use fetch)

JS skills run in an isolated WebView — they can make HTTP requests but can't access device APIs. Use these for web-based data fetching.

```typescript
const weatherSkill: SkillManifest = {
  name: 'get_weather',
  description: 'Get current weather for a location',
  version: '1.0.0',
  type: 'js',
  requiresNetwork: true,
  parameters: {
    location: { type: 'string', description: 'City name' },
  },
  requiredParameters: ['location'],
  html: `<!DOCTYPE html>
<html><body><script>
window['ai_edge_gallery_get_result'] = async function(jsonData) {
  const params = JSON.parse(jsonData);
  const res = await fetch('https://wttr.in/' + params.location + '?format=j1');
  const data = await res.json();
  return JSON.stringify({
    result: data.current_condition[0].weatherDesc[0].value +
            ', ' + data.current_condition[0].temp_C + ' C'
  });
};
</script></body></html>`,
};
```

### SkillManifest Reference

```typescript
type SkillManifest = {
  name: string;              // Unique identifier (used in tool calls)
  description: string;       // What it does (model reads this to decide when to use it)
  version: string;
  type: 'native' | 'js';
  requiresNetwork?: boolean; // SDK checks connectivity before execution
  category?: string;         // Skill category for grouping (v0.2.0)
  parameters: Record<string, SkillParameter>;
  requiredParameters?: string[];
  html?: string;             // Required for 'js' skills
  execute?: (params) => Promise<SkillResult>;  // Required for 'native' skills
  instructions?: string;     // Extra instructions for the model
};
```

## Built-in Skills

| Skill | Type | Network | Category | Description |
|---|---|---|---|---|
| `localNotesSkill` | native | No | memory | **On-device knowledge base** — save, search, recall notes |
| `calculatorSkill` | native | No | utility | Evaluate math expressions (fully offline) |
| `queryWikipediaSkill` | js | Yes | research | Search and summarize Wikipedia articles |
| `webSearchSkill` | js | Yes | research | Web search via SearXNG |
| `deviceLocationSkill` | native | No | device | GPS location with offline city lookup (60 cities) |
| `readCalendarSkill` | native | No | device | Read device calendar events for any day |

```typescript
// Core skills (no extra dependencies)
import {
  calculatorSkill,
  queryWikipediaSkill,
  webSearchSkill,
  createLocalNotesSkill,  // v0.2.0 — needs a KnowledgeStore instance
} from 'react-native-gemma-agent/skills';

// Knowledge base setup
import { KnowledgeStore } from 'react-native-gemma-agent';
const store = new KnowledgeStore();
const localNotesSkill = createLocalNotesSkill(store);

// Device skills (require additional packages)
import { deviceLocationSkill } from 'react-native-gemma-agent/skills/deviceLocation';
// requires: @react-native-community/geolocation

import { readCalendarSkill } from 'react-native-gemma-agent/skills/readCalendar';
// requires: react-native-calendar-events
```

## BM25 Skill Routing (Opt-in)

When you have more than ~10 skills, sending all tool definitions to the model on every query wastes context tokens and reduces accuracy. The SDK includes an opt-in **BM25 pre-filter** that scores skills against the user's query and only sends the top-N most relevant ones.

```tsx
<GemmaAgentProvider
  agentConfig={{
    skillRouting: 'bm25',          // 'all' (default) or 'bm25'
    maxToolsPerInvocation: 5,      // Only with 'bm25'. Default: 5
  }}
>
```

| Mode | Behavior | Best for |
|---|---|---|
| `'all'` (default) | All registered skills sent every time | <10 skills |
| `'bm25'` | Top-N skills selected per query using BM25 scoring | 10+ skills |

BM25 is a standard information retrieval algorithm (term frequency + inverse document frequency). It runs in <1ms, uses no extra memory, and needs no ML model.

## How the Agent Loop Works

```
User: "What is the population of Tokyo?"
  |
  v
[Gemma 4 on-device inference]
  |
  v
Model outputs tool_call: query_wikipedia({ query: "Tokyo population" })
  |
  v
[SkillSandbox executes Wikipedia skill in hidden WebView]
  |
  v
Skill returns: "Tokyo has a population of approximately 14 million"
  |
  v
[Model re-invoked with skill result in context]
  |
  v
"The population of Tokyo is approximately 14 million people."
```

The agent can chain multiple skills in sequence (max depth configurable, default 5). For example: "Look up Tokyo's population on Wikipedia, then calculate 15% of it" calls Wikipedia first, then calculator.

## Architecture

```
GemmaAgentProvider
  |-- ModelManager        (download, store, locate GGUF models)
  |-- InferenceEngine     (llama.rn wrapper, streaming, tool call passthrough)
  |-- SkillRegistry       (register/manage skills, categories, convert to OpenAI tool format)
  |-- AgentOrchestrator   (agent loop: infer -> tool call -> skill exec -> re-invoke)
  |-- KnowledgeStore      (on-device markdown notes with BM25 search)
  |-- SkillSandbox        (hidden WebView for JS skill execution)
  |-- BM25Scorer          (opt-in skill pre-filtering by query relevance)
```

## Configuration

### InferenceEngineConfig

Control model loading and inference behavior.

```typescript
{
  contextSize: 4096,    // Context window in tokens (default: 4096, max: 128K)
  batchSize: 512,       // Batch size for prompt processing
  threads: 4,           // CPU threads for inference
  flashAttn: 'auto',    // Flash attention: 'auto' | 'on' | 'off'
  useMlock: true,       // Lock model in memory (prevents swapping)
  gpuLayers: -1,        // GPU layers to offload (-1 = all available)
}
```

### AgentConfig

Control agent behavior.

```typescript
{
  maxChainDepth: 5,                // Max sequential skill calls per message
  skillTimeout: 30000,             // Timeout per skill execution (ms)
  systemPrompt: '...',             // Base system prompt
  skillRouting: 'all',             // 'all' or 'bm25'
  maxToolsPerInvocation: 5,        // Top-N skills per query (bm25 only)
  activeCategories: ['utility'],   // Only load these skill categories (v0.2.0)
  contextWarningThreshold: 0.8,    // Fire warning at 80% context usage (v0.2.0)
  onContextWarning: (usage) => {}, // Callback when threshold crossed (v0.2.0)
}
```

## Context Window & Memory

The model's "memory" is its **context window** — a rolling buffer of the current conversation. Understanding this is key to building good experiences:

| Setting | Default | Range | Tradeoff |
|---|---|---|---|
| `contextSize` | 4096 tokens | 2048 - 131072 | More context = more RAM + slower prompt eval |

**Practical limits at 4096 tokens (~3000 words):**
- ~15-20 back-and-forth exchanges before oldest messages get pushed out
- Each registered skill costs ~50-100 tokens (tool definitions in prompt)
- With 3 skills: ~200 tokens used, ~3900 left for conversation
- With 10 skills: ~700 tokens used, ~3400 left
- With 30 skills: ~2100 tokens used, only ~2000 left for conversation

**Persistent memory via Knowledge Base** (v0.2.0): The `local_notes` skill gives the agent persistent memory across conversations and app restarts. Notes are stored on-device and their index is injected into the system prompt automatically. Without `local_notes`, the model only remembers the current conversation.

**Increasing context**: You can set `contextSize: 8192` or higher. Gemma 4 E2B supports up to 128K. But more context means more RAM usage and slower prompt processing. On a phone with 8GB RAM, 4096-8192 is the sweet spot.

## Model Setup

**Option A: Push via ADB (development)**
```bash
# Download model
huggingface-cli download unsloth/gemma-4-E2B-it-GGUF \
  gemma-4-E2B-it-Q4_K_M.gguf --local-dir ./models

# Push to device
adb push ./models/gemma-4-E2B-it-Q4_K_M.gguf /data/local/tmp/
```

**Option B: In-app download**
```tsx
const { download, progress, checkStorage } = useModelDownload();

// Check storage first
const storage = await checkStorage();
if (!storage.sufficient) {
  alert(`Need ${storage.required} bytes, only ${storage.available} available`);
  return;
}

// Download with progress
await download();
// progress.percent updates 0-100
```

## Performance

Tested on Medium Phone API 36 emulator (CPU-only, 8 GB RAM):

| Metric | Value |
|---|---|
| Model | Gemma 4 E2B Q4_K_M (3.09 GB, 4.6B params) |
| Cold load | 6.7s |
| Warm load | 2.2s |
| Generation speed | 30.0 tok/s (CPU-only) |
| Prompt eval | 60.2 tok/s |

Physical devices with GPU offloading (Snapdragon 8 Elite, Dimensity 9300, etc.) should see **60-120+ tok/s** generation speed.

## Supported Models

Currently tested with:
- **Gemma 4 E2B-it Q4_K_M** (3.09 GB) — recommended
- **Gemma 4 E2B-it Q3_K_M** (~2.3 GB) — for lower-RAM devices (6GB)

Any GGUF model compatible with llama.rn should work, but function calling (tool use) is only tested with Gemma 4.

## Roadmap

- [x] Context usage monitoring API (`contextUsage` in `useGemmaAgent()`)
- [x] BM25 skill routing (opt-in pre-filter)
- [x] Network awareness (`requiresNetwork` flag on skills)
- [x] GPS and calendar device skills
- [x] On-device knowledge base — persistent AI memory via `local_notes` skill (v0.2.0)
- [x] Skill categories for grouping and selective loading (v0.2.0)
- [x] Context window warnings with configurable threshold (v0.2.0)
- [ ] Semantic vector routing (embedding-based tool selection, 97%+ accuracy)
- [ ] iOS support
- [ ] TurboQuant KV cache (6x longer conversations)
- [ ] Multimodal vision skills (camera input)
- [ ] Audio input (Gemma 4 supports audio)
- [ ] Skill marketplace
- [ ] Expo plugin

## License

MIT
