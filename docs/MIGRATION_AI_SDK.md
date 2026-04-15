# Migrating to `react-native-gemma-agent/ai`

This guide is for developers coming from `@react-native-ai/llama` or
`react-native-executorch` who want to use the Vercel AI SDK with an
on-device model. The provider implements `LanguageModelV3` and ships
under a subpath so consumers who don't use the AI SDK pay no install
cost.

## Install

```bash
npm install react-native-gemma-agent
npm install ai @ai-sdk/react @ai-sdk/provider
# RN globals required by `streamText`:
npm install web-streams-polyfill @stardazed/streams-text-encoding @ungap/structured-clone
```

Polyfills must load before any AI SDK import. Add them at the top of
`index.js`:

```js
import structuredClone from '@ungap/structured-clone';
import { polyfillGlobal } from 'react-native/Libraries/Utilities/PolyfillFunctions';
import { TextEncoderStream, TextDecoderStream } from '@stardazed/streams-text-encoding';
import { ReadableStream, WritableStream, TransformStream } from 'web-streams-polyfill';

if (!('structuredClone' in global)) polyfillGlobal('structuredClone', () => structuredClone);
polyfillGlobal('TextEncoderStream', () => TextEncoderStream);
polyfillGlobal('TextDecoderStream', () => TextDecoderStream);
polyfillGlobal('ReadableStream', () => ReadableStream);
polyfillGlobal('WritableStream', () => WritableStream);
polyfillGlobal('TransformStream', () => TransformStream);
```

Hermes 0.76+ ships `ReadableStream` and `TextEncoder` natively, but
bare RN still needs all four globals.

## Provider factory

```ts
import { createGemmaProvider } from 'react-native-gemma-agent/ai';
import { InferenceEngine, SkillRegistry, ModelManager } from 'react-native-gemma-agent';

const engine = new InferenceEngine();
const registry = new SkillRegistry();
const modelManager = new ModelManager({ repoId, filename });

const gemma = createGemmaProvider({
  engine,
  registry,
  modelManager,                  // optional; enables prepare() auto-load
  knowledgeStore: notesStore,    // optional; enables local_notes splice
  skillExecutor: sandboxRef.current!.execute, // WebView-backed executor
  defaults: {
    skillRouting: 'bm25',
    maxToolsPerInvocation: 3,
    maxChainDepth: 5,
  },
});
```

`gemma(modelId)` and `gemma.languageModel(modelId)` both return a
`LanguageModelV3`. Per-call defaults shallow-merge over provider-level
defaults.

### Loading the model

```ts
const model = gemma('gemma-4-e2b');
await model.prepare();                 // uses ModelManager auto-load
// or
await model.prepare('/sdcard/model.gguf'); // explicit path
```

`prepare()` is a no-op when the engine already has a model loaded.

## Using `streamText`

```ts
import { streamText } from 'ai';

const result = streamText({
  model: gemma('gemma-4-e2b'),
  messages,
  abortSignal: controller.signal,
  providerOptions: {
    gemma: {
      skillRouting: 'bm25',
      activeCategories: ['research'],
      maxChainDepth: 4,
    },
  },
});

for await (const chunk of result.fullStream) {
  console.log(chunk);
}
```

## Using `useChat` with an in-process transport

There is no HTTP route on-device. Wire `useChat` to a custom
`ChatTransport` that drives `streamText` directly:

```ts
import { streamText, type ChatTransport, type UIMessage } from 'ai';
import { useChat } from '@ai-sdk/react';

const transport: ChatTransport<UIMessage> = {
  async sendMessages({ messages, abortSignal }) {
    const result = streamText({
      model: gemma('gemma-4-e2b'),
      messages,
      abortSignal,
    });
    return result.toUIMessageStream({ originalMessages: messages });
  },
  async reconnectToStream() { return null; },
};

function Chat() {
  const { messages, sendMessage, stop, status } = useChat({ transport });
  // ...
}
```

A working tab lives at `example/src/AiSdkChatTab.tsx`.

## Day-one fixes vs the existing on-device providers

| Bug in upstream provider | Issue | Our adapter |
|---|---|---|
| `tool-input-start / -delta / -end` never emitted; `useChat` can't render live tool-arg decode | — | Emitted from `TokenData.tool_calls` progressive updates, then the final `tool-call`. |
| Tool `inputSchema` silently dropped — model knows tool names but not param shapes | [callstackincubator/ai#201](https://github.com/callstackincubator/ai/issues/201) | Explicit `inputSchema → parameters` rename at the V3 → llama.rn boundary. |
| `options.abortSignal` ignored; only `stream.cancel()` works | [callstackincubator/ai#199](https://github.com/callstackincubator/ai/issues/199) | `abortSignal.addEventListener('abort', () => engine.stopGeneration())` in both `doGenerate` and `doStream`, mirrored on `ReadableStream.cancel`. |

## Provider-executed skills vs consumer-executed tools

Two tool sources coexist in one turn:

- **Skills** registered via `SkillRegistry` run **provider-executed**.
  The adapter runs the tool loop internally, emits `tool-call` and
  `tool-result` parts (both with `providerExecuted: true`), and never
  asks the consumer to supply an `execute` callback.
- **Tools** passed to `streamText({ tools })` are
  **consumer-executed**. The adapter forwards them to the model in the
  same call. When the model calls one, the loop terminates after the
  `tool-call` part with no `tool-result` — the consumer's `execute`
  runs in `streamText`, and the result returns to the loop on the next
  `sendMessage`.

On **name collision**, the skill wins and the adapter emits a
`stream-start` warning naming the dropped consumer tool.

## `providerOptions.gemma`

```ts
type GemmaProviderOptions = {
  activeCategories?: string[];
  skillRouting?: 'all' | 'bm25';
  maxToolsPerInvocation?: number;
  maxChainDepth?: number;
  enable_thinking?: boolean;
  reasoning_format?: 'none' | 'deepseek' | 'qwen';
};
```

All overrides are per-call. Defaults come from
`GemmaLanguageModelDefaults` passed to the provider factory.

## `providerMetadata.gemma` (attached to every `finish` part)

```ts
type GemmaProviderMetadata = {
  timings: {
    promptMs: number;
    promptPerSecond: number;
    predictedMs: number;
    predictedPerSecond: number;
  };
  contextUsage: { used: number; total: number; percent: number };
};
```

This is richer observability than any other on-device RN provider
ships today. Read it in `onFinish` callbacks.

## From `@react-native-ai/llama`

```diff
- import { createLlamaProvider } from '@react-native-ai/llama/ai-sdk';
- const llama = createLlamaProvider({ ... });
- const model = llama('meta-llama-3.2-3b-it', { contextSize: 4096 });
+ import { createGemmaProvider } from 'react-native-gemma-agent/ai';
+ const gemma = createGemmaProvider({ engine, registry, modelManager });
+ const model = gemma('gemma-4-e2b');
```

Migration notes:

- Pass our `InferenceEngine` instead of llama.cpp init args. Engine
  config (context size, batch size, GPU layers) is set on
  `new InferenceEngine(config)`.
- Skills register on the `SkillRegistry` and run provider-executed; you
  don't need to declare them as AI SDK `tools`. Existing AI SDK tools
  with `execute` continue to work alongside skills.
- `tool-input-*` parts are emitted, so live tool-arg rendering in
  `useChat` works.
- `abortSignal` is honored.

## From `react-native-executorch`

```diff
- import { useLLM } from 'react-native-executorch';
- const llm = useLLM({ modelSource: ... });
- await llm.generate(prompt);
+ import { createGemmaProvider } from 'react-native-gemma-agent/ai';
+ import { generateText } from 'ai';
+ const gemma = createGemmaProvider({ engine, registry, modelManager });
+ await generateText({ model: gemma('gemma-4-e2b'), prompt });
```

`react-native-executorch` does not ship an AI SDK adapter at all.
Migrating gives you `streamText`, `useChat`, and tools with a single
provider import. The on-device skill system, BM25 routing, knowledge
store, and category filtering come along for free.

`useLLM`-style declarative parity is Phase 20.

## Known gaps in Phase 19

- **`toolChoice: 'required'` and `toolChoice: { type: 'tool' }`** are
  downgraded to `'auto'` with a `stream-start` warning. Forced and
  per-tool selection are not yet supported.
- **`FilePart` in the prompt is dropped** with a `stream-start`
  warning. Multimodal input lands in Phase 29.
- **`generateObject` / `responseFormat`** is passthrough-only in this
  release. The full `jsonrepair` + Zod validation loop arrives in
  Phase 23. Use `generateText` with a manual JSON parse if you need
  structured output today.
- **Embedding, rerank, and speech models** are out of scope. Provider
  exposes `languageModel` only.
- **iOS** parity arrives in Phase 24.
