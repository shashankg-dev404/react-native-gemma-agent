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

## 2026-04-21 — pre-publish audit (compat + AI fingerprints)

Two-phase audit to de-risk the v0.3.0 cut against (a) 0.2.1 users upgrading and (b) reviewers skimming the diff for AI-written code. Audit only. No edits, no commits, no tree changes. HEAD stays at `25d64f8`.

Two report files written into `docs/` so they survive context compaction and are grep-able during the fix session. They are transient: delete them (or relocate outside `docs/`) before any `npm publish` so they do not ship in the tarball.

- `docs/V030_COMPAT_REPORT.md`
- `docs/V030_CODE_HYGIENE_REPORT.md`

### Phase 1: backward-compatibility

Verdict: ship-safe with one documentation task. Baseline `git tag v0.2.1`, diffed against HEAD `25d64f8`.

1. Peer `llama.rn` narrowed from `>=0.12.0-rc.3` to `>=0.12.0-rc.8 <0.13.0`. Users on rc.3..rc.7 or 0.13+ will hit a peer-dep warning; strict pnpm / yarn 2 fails the install. Fix: one CHANGELOG line.
2. `ParsedToolCall.skill` type widened from `SkillManifest` to `SkillManifest | null`. Strict TS consumers that read `call.skill.name` see a new TS2531. Runtime break only fires when the new `extraToolNames` option is passed. Fix: CHANGELOG mention.
3. `exports` map restricts deep imports. Any consumer reaching into `react-native-gemma-agent/lib/*` or `/src/*` now hits `ERR_PACKAGE_PATH_NOT_EXPORTED`. Probability low. Fix: CHANGELOG mention.
4. `InferenceEngine` default stop-tokens removed. With `jinja: true` (always on) and a GGUF that carries a correct `eos_token_id`, catalog models are unaffected. Fix: none needed.

Non-breaking: full new public surface is additive (`BUILT_IN_MODELS`, `getModelEntry`, `listModels`, `modelConfigFromEntry`, `resolveModelConfig`, `useLLM`, `generateStructured`, `toJsonSchema`, `isZodSchema`, `ResponseFormat`, plus the `./ai` subpath). New peer deps (`@ai-sdk/provider`, `zod`, `zod-to-json-schema`) are all flagged optional via `peerDependenciesMeta`; compiled JS contains zero runtime `require` of them except a single lazy `require('zod-to-json-schema')` inside a try / catch.

Install sanity test: packed tarball, installed into a scratch dir with only the 0.2.1 peer set, verified `require('react-native-gemma-agent/ai')` resolves without `@ai-sdk/provider` present. Tarball clean: 155 files, 125 kB packed, zero `__tests__`, zero `.playwright-cli/`, zero `marketing.md`, zero `.DS_Store`. Bin symlink gets executable permission on install (npm normalizes).

### Phase 2: AI-fingerprints + console

Verdict: shipping code is in good shape. Biggest remaining tell is em-dash use in warnings, errors, and a handful of comment blocks.

What passed clean:

- Zero AI-tell words (`delve`, `leverage`, `seamless`, `moreover`, `furthermore`, `utilize`, etc.).
- Zero marketing puffery (`production-ready`, `cutting-edge`, etc.).
- Zero `// Step 1` or `// Now we...` narration.
- Zero "removed" breadcrumbs.
- Zero over-abstraction (no Factory / Strategy / Builder classes added).
- Zero dead code, zero gratuitous `console.log`.
- CLI output in `src/cli/pull.ts` is legitimate (eslint is explicitly disabled at top).
- One `console.warn` in `KnowledgeStore.ts` is a boundary log.
- `example/src/*` console calls are intentional TC-23 test markers.

Top 5 most obvious AI tells:

1. `src/useGemmaAgent.ts:150-170`: stacked em-dash narration on the streaming state machine (7 em-dashes plus a "We're in content mode" comment in one 20-line block).
2. README em-dash density: 42 instances (40 pre-existing from 0.2.1, 2 new in 0.3.0). Shipped to npm and rendered on GitHub.
3. User-visible warning / error strings with em-dashes across `src/ai/*`, `src/runToolLoop.ts`, `src/SkillSandbox.tsx`, `src/cli/pull.ts`. About 11 sites. These appear in the dev console and the AI SDK `warnings` array.
4. `src/InferenceEngine.ts:91-92`: `@param name — description` JSDoc convention (em-dash where a hyphen is standard).
5. Multi-paragraph docstrings on `InferenceEngine._cumulativeUsed`, `getContextUsage()`, `resetContextUsage()`. Rule 7a says one short sentence max on public exports.

Proposed fix order (batches land as separate commits; each batch ends with `npx tsc --noEmit` and `npm test` green):

- Batch 1: em-dashes in user-visible strings. About 11 replacements across 5 files plus 1 test update.
- Batch 2: em-dashes in JSDoc `@param` lines. 2 lines in `src/InferenceEngine.ts`.
- Batch 3: em-dashes in inline code comments. About 11 edits across 9 files.
- Batch 4: collapse multi-paragraph docstrings. 5 sites in `src/InferenceEngine.ts` and `src/runToolLoop.ts`.
- Batch 5: rewrite `useGemmaAgent.ts` streaming comments. 1 file, about 10 lines.
- Batch 6 (optional, separate commit): README prose sweep, about 40 em-dashes.

Also pending: one `CHANGELOG.md` entry covering the three Phase 1 items (llama.rn floor bump, `ParsedToolCall.skill` widening, `exports` map restriction) plus the full additive surface.

### My-side checks

- `git status`: four local-only commits on `v0.3.0`, unchanged since end of 2026-04-20. Working tree clean except `.playwright-cli/`, `marketing.md`, and the two new report files in `docs/` (untracked).
- `npm pack --dry-run`: 155 files, 125 kB. Clean.
- No code edits performed this session.

---

## Branch state at end of session

- **Branch:** `v0.3.0` (local only, `origin/v0.3.0` does not exist, nothing pushed).
- **HEAD:** `25d64f8 docs: session log entry for option B pivot`. Unchanged since 2026-04-20.
- **Reflog recoverable:** `ee497db chore: cut v0.3.0 with TC-23.x blocked on upstream llama.cpp`, the reverted C cut. Available for about 30 days.
- **Working tree:** clean except untracked `.playwright-cli/`, `marketing.md`, `docs/V030_COMPAT_REPORT.md`, `docs/V030_CODE_HYGIENE_REPORT.md`.

---

## What to pick up next

Audit done 2026-04-21. Six fix batches and one CHANGELOG task are queued.

1. **Apply Phase 2 fix batches in order.** Each batch lands as its own commit. Run `npx tsc --noEmit` and `npm test` after each batch; do not move on until green. Commit bodies must follow rule 7a (no em-dashes, no AI-tell words, no emojis, no listicle narration).
   - Batch 1: de-em-dash user-visible strings.
   - Batch 2: de-em-dash JSDoc `@param` lines.
   - Batch 3: de-em-dash inline code comments.
   - Batch 4: collapse multi-paragraph docstrings.
   - Batch 5: simplify `useGemmaAgent.ts` streaming comments.
   - Batch 6 (optional): README prose sweep.

2. **Write `CHANGELOG.md` for v0.3.0.** Cover the new surface (AI SDK provider, useLLM, generateStructured, multi-model catalog, CLI bin) plus the three Phase 1 call-outs (llama.rn floor bump, `ParsedToolCall.skill` widening, `exports` deep-import restriction). Mirror a short release-notes paragraph into the README.

3. **Delete or relocate the two report files** before any `npm publish`. They are reference-only; they must not ship in the tarball.

4. **Decide on publish.** When Shashank says publish-ready: tag `v0.3.0`, push the branch + tag, run `npm publish` (`npm whoami` plus `npm pack --dry-run` first). Do not tag or push without an explicit per-operation yes.

5. **Optional upstream filings** (defer or separate PRs):
   - Issue against `mybigday/llama.rn`: minimal repro of the `std::exception` crash. Link `ggml-org/llama.cpp#21571`.
   - Comment on `ggml-org/llama.cpp#21571` with our Gemma 4 + RN JS-bridge repro.
   - Cosmetic PR against `mybigday/llama.rn`: fix the `RNWhisperJSI` logcat tag (two-char change in `cpp/jsi/RNLlamaJSI.cpp` lines 40 and 46).

6. **Monitor upstream.** When `mybigday/llama.rn` releases a build with `common/sampling.cpp:285` slicing fixed or the `generation_prompt` prefill reverted against externally-provided grammars: bump the llama.rn pin, restore the one-line `responseFormat` forwarding in `src/StructuredOutput.ts`, re-run TC-23.1 / TC-23.2. If both pass with `attempts === 1`, revert ADR-009's amendment.

7. **LinkedIn.** Phase 23 plus the clean audit make a reasonable demo moment: `generateObject` from the Vercel AI SDK returning a validated Zod-typed object from an on-device Gemma 4 model in a React Native app. See `docs/LINKEDIN_CONTENT.md` for the angle.

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
