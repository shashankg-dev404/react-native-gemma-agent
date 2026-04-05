# ADR-001: Inference Engine — llama.rn

## Status
Accepted (2026-04-05)

## Context
The SDK needs to run Gemma 4 E2B inference on Android devices. Several React Native inference libraries exist. We need one that:
- Supports Gemma 4 architecture (released April 2, 2026)
- Uses GGUF format (industry standard for quantized models)
- Works with React Native New Architecture
- Is actively maintained
- Is free and open source

## Decision
Use **llama.rn v0.12.0-rc.4** as the primary inference engine.

Key facts:
- Synced to llama.cpp b8665 (includes Gemma 4 tokenizer fix from Apr 3)
- 0.12.0-rc.2 explicitly fixed "TranslateGemma content parts support"
- Requires New Architecture (since v0.10) — we're using RN 0.84.1
- Supports GPU offload, flash attention, Jinja templates, tool calling
- The `completion()` API supports `messages` format with `tool_calls` in results
- `bench()` API gives us performance metrics out of the box

Model: **unsloth/gemma-4-E2B-it-GGUF** Q4_K_M (3.11 GB)
- Better quantization quality than ggml-org conversion
- 18 quantization variants available (2-bit to BF16)

## Consequences

### Positive
- llama.rn is the most mature RN inference library with the freshest llama.cpp
- GGUF format means any model that llama.cpp supports will work
- Built-in tool call parsing via Jinja templates
- GPU offload support for faster inference
- Active development (4 RC releases in 2 weeks)

### Negative
- Using a pre-release (RC) version — may have bugs
- 3.11 GB model is larger than our original 1.5 GB estimate
- Requires 8GB+ RAM devices for comfortable Q4_K_M operation

### Risks
- RC version could have breaking changes before stable release
- Gemma 4's non-standard function call format (`<|tool_call>`) may need custom parsing if Jinja support is incomplete
- No community benchmarks on Android phones yet (model is 3 days old)

## Alternatives Considered
| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| llama.rn 0.12.0-rc.4 | Gemma 4 support, GGUF, GPU, mature | Pre-release | **Chosen** |
| react-native-executorch | Software Mansion backed | No Gemma 4, .pte format, 1yr old stable | Rejected |
| Cactus SDK | Sub-50ms TTFT, Y Combinator | Proprietary .cact format, freemium | Rejected |
| @callstack/ai | Vercel AI SDK compat | Wraps llama.rn (extra layer), older llama.cpp | Rejected — may revisit for API design inspiration |
| @novastera-oss/llamarn | Vulkan GPU support | Less community adoption | Not tested |
