# Research Summary — react-native-gemma-agent

> Consolidated research from Session 1. Reference this file for technical decisions.

---

## Gemma 4 Model Family

| Model | Params (effective) | Total Params | RAM (Q4) | Use Case |
|-------|-------------------|-------------|----------|----------|
| E2B | 2.3B | 5.1B | ~1.5 GB | Phones, RPi, IoT — OUR TARGET |
| E4B | 4B | ~8B | ~3 GB | High-end phones, tablets |
| 26B MoE | 3.8B active | 26B | ~14 GB | Desktop, server |
| 31B Dense | 31B | 31B | ~18 GB | Server, high-end desktop |

### E2B Benchmarks
| Benchmark | E2B | Gemma 3 27B | Notes |
|-----------|-----|-------------|-------|
| MMLU Pro | 60.0% | — | General knowledge |
| MMMU Pro | 44.2% | — | Multimodal vision |
| LiveCodeBench v6 | 44.0% | 29.1% | Code generation |
| AIME 2026 | 37.5% | 20.8% | Math reasoning |

### Key Specs
- **Context window**: 128K tokens (E2B), 256K (larger models)
- **Multimodal**: Text + Image + Audio (E2B/E4B only for audio)
- **Languages**: 140+
- **License**: Apache 2.0
- **Function calling**: Native support, structured JSON output
- **On-device speed**: 133 tok/s prefill, 7.6 tok/s decode on RPi 5 CPU
- **Arm optimized**: 5.5x prefill speedup, 1.6x decode speedup on mobile
- **Qualcomm NPU**: 3,700 prefill tok/s, 31 decode tok/s

---

## React Native Inference Libraries

| Library | Engine | Gemma 4 Support | Multimodal | Notes |
|---------|--------|----------------|------------|-------|
| **llama.rn** | llama.cpp | Likely (GGUF) | Yes (mmproj) | Best bet. Requires New Architecture. GPU accel on both platforms. |
| **react-native-executorch** | ExecuTorch | Partial | Whisper+CLIP | By Software Mansion. Supports Qwen/Llama/SmolLM. Gemma 4 may need conversion. |
| **Cactus** | Custom | Yes (claims Gemma) | Unknown | Y Combinator-backed. Sub-50ms TTFT. RN/Flutter/KMP bindings. |
| **expo-llm-mediapipe** | MediaPipe | Yes (native Gemma) | Unknown | Expo-compatible. Uses Google's MediaPipe. |
| **llama.rn (llamarn)** | llama.cpp | Same as llama.rn | Unknown | Alternative binding, less maintained. |

### Primary choice: llama.rn
- Most stars, most active
- Wraps llama.cpp which updates fast
- GPU acceleration (Metal on iOS, Hexagon NPU on Android)
- GGUF format (HuggingFace has Gemma 4 GGUF via Unsloth)
- Requires New Architecture (v0.10+)

### Model format: GGUF Q4_K_M
- Best quality-per-bit for mobile
- Gemma 4 E2B Q4_K_M estimated ~1.5 GB
- Available from Unsloth on HuggingFace

---

## TurboQuant

| Aspect | Detail |
|--------|--------|
| What | KV cache compression (NOT model weight compression) |
| Compression | 16-bit → 3-bit (6x reduction) |
| Speed | Up to 8x faster attention on H100 |
| Accuracy | Zero loss across 5 long-context benchmarks |
| Retraining | None required — data-oblivious |
| Works on | Any transformer model (Gemma, Llama, Mistral, etc.) |
| Published | March 25, 2026 |
| Conference | ICLR 2026 (late April) |
| Official code | NOT released by Google |
| llama.cpp | NOT merged. Community forks: TheTom (Metal), spiritbuun (CUDA) |
| Mobile | Unverified on mobile GPUs. Metal works on Mac. |
| Impact for us | 4K → 24K token conversations on same RAM |
| Decision | Skip for MVP. Design architecture to support later. |

---

## Google AI Edge Gallery — Agent Skills Architecture

### How It Works
1. Model reviews skill names/descriptions in system prompt
2. User asks a question
3. Model outputs a tool call (structured JSON)
4. App detects tool call, routes to correct skill
5. For JS skills: loads `scripts/index.html` into hidden WebView
6. Calls `window['ai_edge_gallery_get_result'](jsonParams)`
7. Skill executes (can use fetch(), web APIs, etc.)
8. Result returned to model via postMessage bridge
9. Model formulates natural language answer

### Skill Types
- **Text-only**: Just SKILL.md with instructions (persona/behavior change)
- **JS skills**: SKILL.md + scripts/index.html (custom logic, API calls)
- **Native skills**: Map to device intents (email, SMS) via `run_intent`

### Key Files
- `SKILL.md`: Frontmatter (name, description, params) + LLM instructions
- `scripts/index.html`: Async function exposed on window object
- `assets/`: Optional static files

### Source
- GitHub: github.com/google-ai-edge/gallery (Apache 2.0)
- App: 91% Kotlin (Android), iOS support exists
- Written in native, NOT React Native

---

## Competitive Landscape

### Who else is doing on-device LLM in React Native?
- **Nobody has an agent + skill SDK.** This is the gap.
- llama.rn, executorch, Cactus provide raw inference — no agent framework
- Google AI Edge Gallery has the agent pattern but is native Kotlin/Swift, not RN
- Enclave AI, Private AI are apps, not SDKs

### Our differentiator
- First React Native SDK for on-device AI agents
- Pluggable skill system (Google's pattern, RN implementation)
- NPM installable — `useGemmaAgent()` in 10 lines
- Zero cloud costs (inference on device)
- Open source (MIT)

---

## Sources (Key References)

- [Google Blog — Gemma 4](https://blog.google/innovation-and-ai/technology/developers-tools/gemma-4/)
- [Google Developers — Agent Skills on Edge](https://developers.googleblog.com/bring-state-of-the-art-agentic-skills-to-the-edge-with-gemma-4/)
- [Android Developers — AICore Preview](https://android-developers.googleblog.com/2026/04/AI-Core-Developer-Preview.html)
- [Android Developers — Gemma 4 Agentic Intelligence](https://android-developers.googleblog.com/2026/04/gemma-4-new-standard-for-local-agentic-intelligence.html)
- [GitHub — google-ai-edge/gallery](https://github.com/google-ai-edge/gallery)
- [GitHub — llama.rn](https://github.com/mybigday/llama.rn)
- [GitHub — react-native-executorch](https://github.com/software-mansion/react-native-executorch)
- [Google Research — TurboQuant](https://research.google/blog/turboquant-redefining-ai-efficiency-with-extreme-compression/)
- [llama.cpp Discussion #20969 — TurboQuant](https://github.com/ggml-org/llama.cpp/discussions/20969)
- [HuggingFace — Gemma 4](https://huggingface.co/blog/gemma4)
- [NVIDIA — Gemma 4 on Edge](https://developer.nvidia.com/blog/bringing-ai-closer-to-the-edge-and-on-device-with-gemma-4/)
- [Arm — Gemma 4 on Arm](https://newsroom.arm.com/blog/gemma-4-on-arm-optimized-on-device-ai)
