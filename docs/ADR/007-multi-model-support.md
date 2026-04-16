# ADR-007: Multi-Model Support

## Status
Accepted

## Context
The SDK was initially built around Gemma 4 E2B, but llama.rn with `jinja: true` handles chat templates, tool calling, and stop tokens for any model that ships a proper chat template in its GGUF. The only Gemma-specific code was a hardcoded stop token default (`['<end_of_turn>', '<eos>']`). Users want to run Qwen, Llama, SmolLM, and other models without SDK changes.

Key constraints:
- Must work with llama.rn's Jinja template engine (no custom prompt formatting per model)
- Some models don't support native tool calling (SmolLM 2, Llama 3.2 1B)
- Different models have different context sizes, RAM requirements, and reasoning formats
- Package name stays `react-native-gemma-agent` for SEO (Gemma is the primary model)

## Decision

### 1. Static model registry (`ModelRegistry.ts`)
A `BUILT_IN_MODELS` record maps string IDs (e.g., `'qwen-3.5-4b'`) to `ModelRegistryEntry` objects containing: HF repo, filename, context size, min RAM, tool calling support, reasoning format, and NPU eligibility.

Helper functions: `getModelEntry()`, `listModels()`, `resolveModelConfig()`.

### 2. Remove hardcoded stop tokens
The `['<end_of_turn>', '<eos>']` default in InferenceEngine was the only Gemma-specific assumption. With `jinja: true`, llama.rn reads stop tokens from the GGUF's embedded chat template. No fallback needed.

### 3. Accept `string | ModelConfig` everywhere
`GemmaAgentProvider` model prop and `useLLM` model config now accept either a registry ID string or a custom `ModelConfig` object. String IDs are resolved via `resolveModelConfig()`.

### 4. Model selection rationale

Included (confirmed GGUF + llama.cpp/llama.rn compatibility):

| Model ID | Params | Tool Calling | Why |
|---|---|---|---|
| `gemma-4-e2b-it` | 2.3B eff | Yes | Primary model, multimodal, audio support |
| `gemma-4-e4b-it` | 4.5B eff | Yes | Larger Gemma variant |
| `qwen-3.5-0.8b` | 0.8B | Yes | Smallest model with tool calling |
| `qwen-3.5-4b` | 4B | Yes | Best quality/size balance for mobile |
| `llama-3.2-1b` | 1B | No | Ultra-lightweight chat only |
| `llama-3.2-3b` | 3B | Yes | Good tool calling (67% BFCL V2) |
| `smollm2-1.7b` | 1.7B | No | Fully open (HuggingFace), chat only |

Excluded:

| Model | Reason |
|---|---|
| Hammer 2.1 | Does not exist as a published model on HuggingFace |
| MobileLLM-Pro (Meta) | Custom architecture, no confirmed GGUF/llama.cpp support |
| GLM 5.1 (THUDM) | Smallest variant is 744B total (40B active), not mobile-feasible |

### 5. Tool calling strategy
The registry's `toolCalling` boolean tells consumers whether the model supports native tool calls. For Phase 21, models with `toolCalling: false` work with `useLLM` (pure chat) but will not produce tool calls in agent workflows. Text-based fallback via `extractToolCallsFromText()` is deferred.

## Consequences

### Positive
- Users can swap models with one prop change: `model="qwen-3.5-4b"`
- No Gemma-specific code remains in the inference path
- Registry is extensible: users can pass custom `ModelConfig` for unlisted models

### Negative
- Expected GGUF filenames in the registry may drift as HF repos update quant naming
- Models without tool calling can't use the skill system

### Risks
- Untested quant variants may produce poor output (registry defaults to Q4_K_M, which is well-tested across all listed models)

## Alternatives Considered
| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Static config record | Simple, no runtime overhead, matches "no over-engineering" rule | Can't validate at build time | Chosen |
| Registry class with validation | Type-safe, can verify HF repo exists | Over-engineered for 7 entries | Rejected |
| Per-model prompt formatter | Full control over each model's prompt | Defeats the purpose of jinja: true | Rejected |
