# Session Log — react-native-gemma-agent

> Load this file at the start of every new session. It's the handoff.
> Kept short on purpose — git log is the canonical record of what shipped.

---

## Start-of-session checklist

Read these in order before touching anything:

1. `.claude/CLAUDE.md` — project rules (rule 1 research-permission, rule 5 no-over-engineering, rule 6 Android-first, rule 7a no-AI-fingerprints).
2. This file — where we are.
3. `docs/PLAN.md` — phase status (esp. Phase 23).
4. `docs/ADR/009-structured-output.md` — amended 2026-04-18 to prompt-injection-first; reversibility documented.
5. `docs/TEST_CASES.md` — TC-23.1 / TC-23.2 expected behavior under option B.
6. `src/StructuredOutput.ts` — the primitive. B implementation lives here.
7. `example/src/AiSdkChatTab.tsx` — TC-23.2 button.

Then run `git status && git log --oneline -10 && git diff --stat` to confirm the tree state matches the "Branch state" section below.

---

## Shipped history (git is the source of truth)

- **v0.1.0** — initial SDK: Gemma 4 E2B + llama.rn + SkillRegistry + hidden WebView sandbox + function-calling orchestrator + example app.
- **v0.2.0** — dev UX: streaming, context-usage callbacks, KV-cache accounting, multi-turn regression fixes.
- **v0.3.0 (not yet tagged)** — Phase 19 Vercel AI SDK adapter, Phase 20 `useLLM` declarative hook, Phase 21 multi-model catalog, Phase 22 catalog hardening + pinned llama.rn, Phase 23 structured output API.

For anything beyond "what's the current state," run `git log` and read the commit bodies. Don't recreate their contents here.

---

## Upstream blocker discovered 2026-04-18 (essential context — do not trim)

Phase 23's native `response_format: json_schema` forwarding to `llama.rn` crashes with `std::exception` during `initSampling` on any model whose chat-template `generation_prompt` tokens don't satisfy the grammar root. Affects Gemma 4, Qwen 3.5, LFM2.

Root cause (diagnosed via native instrumentation of `node_modules/llama.rn/cpp/jsi/` on 2026-04-18, patches since reverted):

1. **Object-slicing in `llama.cpp`'s `common/sampling.cpp:285`.** `catch (std::exception &e) { ... throw e; }` throws a copy of the base class, erasing the derived type and the real error message. Everything downstream sees the literal string `"std::exception"`.
2. **Prefill regression from llama.cpp PR #20424 (merged 2026-03-19).** The grammar sampler gets fed the chat template's `generation_prompt` tokens (Gemma 4's `<start_of_turn>model\n`, etc.). A JSON-Schema-derived grammar requires the first token to be `{`; those prefix tokens don't satisfy it, `llama_sampler_accept` throws inside the slicing catch, caller sees the bare `std::exception`.

Upstream tracking: [ggml-org/llama.cpp#21571](https://github.com/ggml-org/llama.cpp/issues/21571), [#21600](https://github.com/ggml-org/llama.cpp/issues/21600), [#21017](https://github.com/ggml-org/llama.cpp/issues/21017). Candidate PR [#20778](https://github.com/ggml-org/llama.cpp/pull/20778) is stale and would silence the crash rather than restore strict decoding. llama.rn rc.9 still vendors the buggy sampler.

When llama.rn ships a build with the upstream fix, **flipping back to grammar-first takes one line in `src/StructuredOutput.ts`** (restore the `responseFormat: { type: 'json_schema', schema, strict }` object on the `engine.generate()` call). The engine-side passthrough in `InferenceEngine.ts` was intentionally kept wired for exactly this day. ADR-009's "Amendment (2026-04-18)" documents this.

Note on logcat: `cpp/jsi/RNLlamaJSI.cpp`'s `log()` function uses the hardcoded tag `"RNWhisperJSI"` (copy-paste leftover from whisper.rn, line 40 and line 46, still in rc.9). To filter llama.rn native errors, use BOTH `RNLlamaJSI:V` AND `RNWhisperJSI:V`. Worth a two-char PR to `mybigday/llama.rn` someday.

---

## 2026-04-18 — option B implementation (current session)

**Story in one paragraph.** Path A session diagnosed the upstream bug. Research session surveyed B/C/D options (B = bypass native grammar, C = ship blocked, D = speculative patch). Shashank initially picked C and I committed it as `ee497db chore: cut v0.3.0 with TC-23.x blocked on upstream llama.cpp`. On reflection Shashank reversed that ("by mistake told you to execute option C"). I verified `origin/v0.3.0` doesn't exist (nothing pushed), ran `git reset --hard HEAD~1` to drop the C commit, then implemented option B. Both TC-23.1 and TC-23.2 now pass on device.

### What option B changes

Schema injected into the system prompt, engine called as plain chat, output run through parse + validate + retry. Native `responseFormat` passthrough in `InferenceEngine.ts` is NOT stripped — it stays wired for the day upstream fixes the bug.

- **`src/StructuredOutput.ts`** (~21 lines): removed `responseFormat: { type: 'json_schema', ... }` from the `engine.generate()` call, added `buildSystemPromptWithSchema(base, schema)` helper that appends a `"Respond with a single JSON object conforming to this JSON Schema:\n\n<schema>"` block to the (default or caller-supplied) system prompt. Retry loop / fence stripping / Zod validation untouched.
- **`src/__tests__/StructuredOutput.test.ts`**: first-attempt test flipped to assert `responseFormat === undefined` on engine options AND system message contains `"JSON Schema"` + field names. Added one new case "preserves caller-supplied systemPrompt alongside injected schema."
- **`src/__tests__/GemmaLanguageModel.test.ts`**: `doGenerate with responseFormat=json` test flipped to assert engine sees no `responseFormat` and the system message contains the schema JSON. "Warns and ignores tools" case unchanged.
- **`docs/ADR/009-structured-output.md`**: amended with 2026-04-18 section — flip rationale, upstream bug links, reversibility note, behavioral trade-offs (~1.5–2× latency on retries, +100–400 tokens from schema-in-prompt, weaker `strict` semantics — API unchanged, guarantee moves from "model cannot emit violating tokens" to "output is validated and re-asked if wrong").
- **`docs/TEST_CASES.md`**: TC-23.1 / TC-23.2 expected behavior rewritten — `attempts` of 1 or 2 both count as pass; `std::exception` warning added as a "should not happen under B, means regression" sanity check.
- **`example/src/AiSdkChatTab.tsx`**: added the TC-23.2 button (green, below the routing chips). Calls `generateObject({ model: provider('gemma-4-e2b'), schema: TC_23_2_SCHEMA, prompt: TC_23_2_PROMPT })`. Renders result / error inline.

### On-device results today

| # | Status | Notes |
|---|---|---|
| TC-23.1 | **PASS** | `attempts === 1`. Prompt "Dinner with Priya and Arjun on Saturday 8pm at Bombay Canteen" → `{ title, date: "Saturday 8pm", location: "Bombay Canteen", attendees: ["Priya","Arjun"] }`. Model emitted an extra `location` field not in the schema; Zod v4's default `.loose()` mode kept it. Not a bug — known trade-off under B; use `.strict()` on the Zod schema if you want extras rejected. |
| TC-23.2 | **PASS** | `{ cityName: "Mumbai", population: 20411000, country: "India" }`. `population` came back as a number (no string-drift). Full Vercel `generateObject` round-trip through `createGemmaProvider` → `doGenerateStructured` → `generateStructured` works. |
| TC-21.1 | **PENDING** | Regression guard — Gemma 4 + `query_wikipedia` skill. Not run yet this session. |
| TC-21.2 | **PENDING** | Regression guard — Qwen 3.5 reasoning stripping. Not run yet. |
| TC-21.3 | **PENDING** | Regression guard — SmolLM2 no-tool-calling. Not run yet. |
| TC-22.1 / 22.2 / 22.3 | Skip | CLI / loading only, no code touched. |

### My-side checks (all green)

- `npx tsc --noEmit`: clean.
- `npm test`: 239/239 across 19 suites. Previous was 238; +1 from the new "preserves caller systemPrompt" case.
- `npm run build`: clean.
- Example app tsconfig reports one pre-existing error (`aiTool({ parameters: ... })` on line 44 of `AiSdkChatTab.tsx`, AI SDK v3-vs-v4 API drift) — not from this session, has been tolerated since Phase 19.

### node_modules state

Clean. `example/node_modules/llama.rn/cpp/jsi/*.cpp` has zero `TC23` instrumentation markers. Path A's diagnostic patches were reverted before the C cut and never reinstalled.

---

## 2026-04-20 — option B regression sweep + commits

TC-21.x re-run on `Pixel_9_Pro(AVD) - 16`, Chat tab. All three pass under option B.

| # | Model | Status |
|---|---|---|
| TC-21.1 | gemma-4-e2b-it | PASS. Skill-calling path (calculator) fires as expected. |
| TC-21.2 | qwen-3.5-4b | PASS. Reasoning trace stays out of the visible bubble. |
| TC-21.3 | smollm2-1.7b | PASS. No `tool_call` leak, no skill invocation, no crash. Mumbai prompt produced a fabricated time (SmolLM2 1.7B factual-recall limitation); Saturn prompt produced a correct fact. Added a watch-out note to TC-21.3 making explicit that factual hallucinations are out of scope for the tool-call boundary guard. |

Committed the B pivot as four commits on `v0.3.0` (still local-only):

1. `fix: structured output via prompt injection` — `src/StructuredOutput.ts` + the two test files + ADR-009 amendment + TC-23.x / TC-21.3 test-case updates.
2. `chore: bump package.json to 0.3.0`.
3. `chore: TC-23.2 generateObject button in example app` — `example/src/AiSdkChatTab.tsx`.
4. `docs: session log for option B pivot` — this file.

No tag cut. No push. Awaits explicit publish-ready signal.

---

## Branch state at end of session

- **Branch:** `v0.3.0` (local only, `origin/v0.3.0` doesn't exist, nothing pushed).
- **HEAD (before this session's commits):** `ed4416e fix: wire reasoning_format from registry through to llama.rn`.
- **HEAD (after):** the four commits above layered on top of `ed4416e`.
- **Reflog recoverable:** `ee497db chore: cut v0.3.0 with TC-23.x blocked on upstream llama.cpp` — the reverted C cut. Available for ~30 days via `git reflog` if we need to flip back.
- **Working tree after commits:** clean except `.playwright-cli/` and `marketing.md` (untracked, unrelated, do not touch).

---

## What to pick up next

Regression sweep and commits done 2026-04-20. The v0.3.0 branch now carries option B end-to-end. Nothing is pushed.

1. **Decide on publish.** When Shashank says publish-ready: tag `v0.3.0`, push the branch + tag, run `npm publish` (`npm whoami` + `npm pack` dry-run first), update npm catalog links. Do not tag or push without an explicit yes.

2. **Optional upstream filings** (defer or separate PRs):
   - Issue against `mybigday/llama.rn`: minimal repro of the `std::exception` crash. Link `ggml-org/llama.cpp#21571`.
   - Comment on `ggml-org/llama.cpp#21571` with our Gemma 4 + RN JS-bridge repro.
   - Cosmetic PR against `mybigday/llama.rn`: fix `RNWhisperJSI` logcat tag (two-char change in `cpp/jsi/RNLlamaJSI.cpp` lines 40 and 46).

3. **Monitor upstream.** As soon as `mybigday/llama.rn` releases a build with the `common/sampling.cpp:285` slicing fixed or the `generation_prompt` prefill reverted against externally-provided grammars, bump the llama.rn pin, restore the one-line `responseFormat` forwarding in `src/StructuredOutput.ts`, re-run TC-23.1 / TC-23.2. If both pass with `attempts === 1` and no retry activity, revert ADR-009's amendment to finalize the grammar-first path.

4. **LinkedIn.** Phase 23 is a reasonable demo moment: `generateObject` from the Vercel AI SDK returning a validated Zod-typed object from an on-device Gemma 4 model in a React Native app. Reference `docs/LINKEDIN_CONTENT.md` for the angle if going this route.

---

## Revert path if option B proves worse than blocked

If more extensive on-device testing (multiple prompts, varied schemas) shows the model reproducibly fails to converge under B:

1. `git reset --hard HEAD~1` OR `git revert <b-commit-sha>` to undo the B pivot. The `ee497db` C cut is still in reflog and can be cherry-picked back.
2. If cherry-picking `ee497db`: the commit also trimmed 1774 lines from the old SESSION_LOG.md. With this new shorter log, that concern is gone — but the cherry-pick will still apply TC-23.x blocked markers, ADR-009 addendum, PLAN.md status, and package.json bump.
3. `package.json` version bump to `0.3.0` either way.

No SDK code surgery needed for the flip back — the engine passthrough stays wired under both B and C.

---

## Ground rules carried forward

- **llama.rn pin:** `>=0.12.0-rc.8 <0.13.0` in `package.json` peerDependencies. Do not bump without explicit approval.
- **Shashank does NOT write TypeScript.** Code changes come from Claude.
- **Shashank runs emulator commands.** Claude records the results.
- **No `/deep-research` or `/last30days` without explicit per-session permission** (CLAUDE.md rule 1). Last session's research authorization does not carry over.
- **Destructive git operations** (`git reset --hard`, force-push, branch deletion) always require explicit per-operation confirmation.
- **node_modules patches:** if debugging requires them, revert before any commit. Check `git -C example/node_modules/llama.rn status` returns clean before staging anything.
