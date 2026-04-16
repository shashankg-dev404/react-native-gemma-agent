# Phase 19 Competitor Analysis — `react-native-executorch`

- **Repo**: https://github.com/software-mansion/react-native-executorch (monorepo, `packages/react-native-executorch/`)
- **Analyzed from**: `main` branch, 2026-04-16
- **License**: need to verify per file before porting; repo root is Software Mansion — historically permissive.
- **Weekly DL (per our PLAN.md)**: 6,762

## Critical finding: NO Vercel AI SDK provider in source

The PLAN.md competitor table marks executorch as "has adapter? via AI SDK". **That is outdated — the current codebase does not ship a `LanguageModelV3` provider.** Confirmed by:

```
grep -rln "LanguageModelV\|@ai-sdk/provider" /tmp/phase19-research/executorch/
# (no matches, excluding node_modules)

grep -rn "ai-sdk" /tmp/phase19-research/executorch/packages/react-native-executorch/
# (no matches)
```

The only AI-SDK-adjacent surface in this package is **`useLLM`** — their declarative hook that competes with our Phase 20 target, not Phase 19. `useLLM` is not an AI SDK provider; it owns its own tool-calling, chat history, and streaming protocol internally.

This reshapes Phase 19 in three important ways:
1. The only competitor that ships `LanguageModelV3` is `@react-native-ai/llama` + `@react-native-ai/mlc`. We are catching up to **one** org, not multiple.
2. For the AI SDK audience specifically, executorch users are **unserved** — the AI SDK migration path from executorch is a real opportunity.
3. `useLLM` is the true competitor for Phase 20. We should study it in parallel, not in Phase 19.

The rest of this document analyzes `useLLM` and `LLMController` — the primitives an AI SDK wrapper would have to be built over, if someone were to build one on top of executorch.

## Architecture: how `useLLM` bridges RN native → JS

1. **Native binding**: `global.loadLLM(modelPath, tokenizerPath, capabilities)` is exposed via a global JSI binding (LLMController.ts:128-132). Returns a `nativeModule` with methods `generate`, `generateMultimodal`, `reset`, `interrupt`, `setTemperature`, `setTopp`, `getMaxContextLength`, `getGeneratedTokenCount`, `getPromptTokenCount`, `getVisualTokenCount`, `countTextTokens`, `unload`, `setCountInterval`, `setTimeInterval`.
2. **JS controller**: `LLMController` holds one native module handle, owns the conversation history, rendered chat template, and tool-call config (LLMController.ts:19-72).
3. **Chat template**: applied in JS via `@huggingface/jinja`'s `Template` class (LLMController.ts:3, 430-457). They extract `eos_token`, `bos_token`, `pad_token`, `image_token` from the tokenizer config and pass them into the template. Same approach llama.rn uses natively; here it's in JS.
4. **Token streaming**: the native `generate` call takes an `onToken` callback; JS-side `filterSpecialTokens` strips EOS/PAD before propagating (LLMController.ts:134-145, 204-219).
5. **Tool calling**: entirely JS-side string parsing. After a full response, `parseToolCall` regex-scans for the first `[...]` block, `JSON.parse`es it, looks for `name` + `arguments`, and invokes `toolsConfig.executeToolCallback(toolCall)` if matched (utils/llm.ts:15-46, LLMController.ts:403-417).
6. **Structured output**: `fixAndValidateStructuredOutput` in `utils/llm.ts:99-116` uses `jsonrepair` + Zod / jsonschema validator to recover malformed JSON — this is a nice pattern.

## `useLLM` shape

```ts
const llm = useLLM({ model: { modelSource, tokenizerSource, tokenizerConfigSource, capabilities } })
// returns:
{
  messageHistory, response, token,
  isReady, isGenerating, downloadProgress, error,
  configure({ chatConfig, toolsConfig, generationConfig }),
  generate(messages, tools?),
  sendMessage(message, media?),
  deleteMessage(index),
  interrupt,
  getGeneratedTokenCount,
  getPromptTokenCount,
  getTotalTokenCount,
}
```

- Hook is **singleton per-module** — each `useLLM({ ... })` call creates a fresh `LLMController` instance; mounting two components both calling `useLLM` creates two native modules. Memory cost doubles.
- **Does not** use React Context — so using it in multiple components in a single tree is dangerous unless deliberately memoized.
- **`capabilities`** drives the native binding (e.g. multimodal). TS overload gives a `LLMTypeMultimodal<C>` result when capabilities is provided (useLLM.ts:20-27).

## Tool-calling bridge

- AI SDK-compatible shape: NO. It has its own `ToolsConfig` type with `displayToolCalls` + `executeToolCallback`.
- Tool calls are **strictly JSON arrays** (`[{ name, arguments }]`) parsed from model text — no support for tagged tool-call tokens (Qwen/DeepSeek/Gemma all use different delimiters).
- `parseToolCall` matches `\\[(.|\\s)*\\]` — greedy — so any bracket pair in the response breaks it. No fallback. No streaming tool calls.
- Tool results are inserted into conversation as `{ role: 'assistant', content: toolResponse }` (LLMController.ts:410-415) — **not** `role: 'tool'`. Non-standard and prevents accurate chat-template rendering.

## Streaming mechanics

- Per-token callback from native; JS `setResponse(prev => prev + token)` is called per token to accumulate.
- `token` + `response` exposed as React state. This means **every token triggers a React render** — expensive on long responses, a known perf foot-gun.
- No `ReadableStream`, no AsyncIterable.
- `interrupt()` calls `nativeModule.interrupt()`.

## What's good — worth copying or forking

1. **`jsonrepair` + Zod validator pattern** (utils/llm.ts:99-116) — exactly the fallback path we need for Phase 23 (`generateStructured`) when llama.rn grammar constrained decoding isn't available. Small utility, permissively licensed.
2. **`LLMController`'s clean separation of chat template / history / tools config** (LLMController.ts:157-191) — mirrors our `AgentOrchestrator` shape. Validates our current structure.
3. **`capabilities`-gated TS overloads on `useLLM`** (useLLM.ts:20-27) — nice DX pattern for our Phase 20 `useLLM`.

## Pain points — top issues (top issues across repo, filtered to LLM)

Searched `gh search issues --repo software-mansion/react-native-executorch` sorted by comments / reactions.

| Rank | Issue | Title | Sev | One-liner |
|---|---|---|---|---|
| 1 | [#1020](https://github.com/software-mansion/react-native-executorch/issues/1020) | RF-DETR inappropriate resolution causing slowdown | Low (vision, not LLM) | Not LLM-relevant; top in comment count though. |
| 2 | [#373](https://github.com/software-mansion/react-native-executorch/issues/373) | Support FP16, BF16 in ET bindings | Med | Quantization rigidity — they only support the quant formats ExecuTorch bakes in. We dodge this via GGUF. |
| 3 | [#935](https://github.com/software-mansion/react-native-executorch/issues/935) | Adding support for Qwen 3.5 | High | `blocked` label. Adding a new model means re-exporting `.pte`, updating tokenizer config, often a separate binary release — this is our Phase 21 win. |
| 4 | [#1062](https://github.com/software-mansion/react-native-executorch/issues/1062) | Gemma4 support | High | Open. No Gemma 4 yet in executorch. |
| 5 | [#482](https://github.com/software-mansion/react-native-executorch/issues/482) | Add support for LLaVA (multimodal) ExecuTorch models | Med | Multimodal beyond their shipped LLMs is painful. |
| 6 | [#721](https://github.com/software-mansion/react-native-executorch/issues/721) | Investigate different quant schemes/settings for both Whisper and LLMs | Med | Users want control over quant — they can't in executorch, they can in GGUF. |

## What we can do better (Phase 19 + adjacent)

1. **Position against their fixed-model catalog**: in docs, call out "swap model file on device, no native rebuild" — executorch requires a different `.pte` plus toolchain.
2. **Offer the AI SDK path they don't have** — executorch users who need `streamText` / `generateObject` / `useChat` have no option in-package; we do. Migration doc in Phase 19 should show how to drop in our provider for their `useLLM` usage.
3. **Don't repeat their `parseToolCall` regex approach** — we already use llama.rn's native parser. That's a moat.
4. **Stream tool calls** — executorch can't stream them (full-response JSON scan). We can, and should, via `tool-input-delta` stream parts.
5. **Avoid per-token React renders in Phase 20's `useLLM`** — their design burns CPU. Use refs + `useSyncExternalStore` or throttle via RAF.
