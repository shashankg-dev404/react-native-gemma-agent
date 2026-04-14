# E2E Test Results — Phase 17: Context Warning Callback & Metrics

**Test date:** 2026-04-11
**Branch:** `v0.2.0` (Phase 17 uncommitted in working tree)
**Device:** Pixel_9_Pro AVD, Android 16 (API 35), emulator-5554
**Model:** Gemma 4 E2B-it Q4_K_M (`/data/local/tmp/gemma-4-E2B-it-Q4_K_M.gguf`)
**Config:** `engineConfig={{ contextSize: 1024 }}` (per plan, reverted post-teardown)
**Runtime:** ~1 hour wall time. First turn = ~9 minutes (547-token system-prompt processing on CPU emulator); cached follow-up turns ~15–20 seconds.

---

## Results Table

| # | Test case | Result | Screenshot(s) | Notes |
|---|---|---|---|---|
| TC-17.1 | Bar appears GREEN | **FAIL (plan parameter)** | `tc-17-1-green-bar.png` | Bar jumped directly to 80% red on the **first** turn — see Finding E |
| TC-17.2 | Green → Yellow at 60% | **N/A** | `tc-17-2-yellow-bar.png` | Never observed during progression at `contextSize: 1024`. Opportunistic capture at **62% yellow** during TC-17.8 post-reload "Hello" turn proves the color-mapping code path is correct |
| TC-17.3 | Yellow → Red + flash at 80% | **PASS** | `tc-17-3-red-flash.png`, `tc-17-3-red-after-flash.png`, `tc-17-3-log-entry.png` | 823/1024 = exact 80%, red bar, flash banner visible with correct text, auto-dismissed after ~5 s. Log entry: `[08:35:53] Context window 80% full (823/1024). Consider clearing chat.` |
| TC-17.4 | No re-fire above threshold | **PASS (critical assertion)** | `tc-17-4-no-refire.png` | **Exactly one** context-warning log for the entire session across 6+ subsequent sends. `_contextWarningFired` guard works. Caveat: bar did NOT tick higher — it dropped 80%→46% — see Finding D |
| TC-17.5 | Clear Chat resets bar | **PASS** | `tc-17-5-after-reset.png` | Bar disappeared, `[08:39:07] Conversation reset` logged, Clear Chat / Unload buttons preserved, no flash |
| TC-17.6 | Warning re-fires after reset | **INCONCLUSIVE** | `tc-17-6-second-flash.png` | After Clear Chat, follow-up turns never individually re-crossed 80% on a per-call basis (see Finding D). Code read confirms `orchestrator.reset()` clears the flag at `AgentOrchestrator.ts:234`. Cannot empirically demonstrate re-fire at `contextSize: 1024` |
| TC-17.7 | Skill call doesn't break bar | **PASS** | `tc-17-7-during-skill.png` (may miss badge — 7 s window) | Calculator ran: `347 × 892 = 309524` ✓. Logs: `Calling skill: calculator` → `Skill calculator returned: 309524` → `Assistant responded (47 chars)`. No double warning, no bar flicker observed |
| TC-17.8 | Unload → Reload fresh state | **FAIL** | `tc-17-8-unloaded.png`, `tc-17-8-after-reload.png` | **Stale bar shown after reload.** Before sending any message post-reload, bar displayed `57 / 1,024 tokens (6%)` — carried over from before unload. Plan explicitly states: "bar does not appear until the first message arrives" |

Supporting: `tc-17-0-initial.png`, `tc-17-0-loaded.png`, `tc-17-summary.png`.

---

## Full session log (from in-app Logs tab)

```
[08:25:42] Searching for model on device...
[08:25:43] Model found on device.
[08:25:43] Loading model into memory...
[08:26:12] Model loaded in 29.4s
[08:26:33] User: "Hello, introduce yourself briefly"              ← TC-17.1 send
[08:35:53] Context window 80% full (823/1024). Consider clearing chat.  ← WARNING FIRED (TC-17.3)
[08:35:53] Assistant responded (1166 chars)
[08:37:13] User: "Give me one concrete example."                  ← TC-17.4 send
[08:37:31] Assistant responded (1686 chars)                       ← no re-fire ✓
[08:39:07] Conversation reset                                     ← TC-17.5
[08:39:31] User: "Hello again, introduce yourself."               ← TC-17.6 send 1
[08:47:18] Assistant responded (1334 chars)
[08:48:16] User: "Give me a detailed overview of neural networks and backpropagation."  ← TC-17.6 send 2
[08:58:47] Assistant responded (1769 chars)                       ← still no second warning
[08:59:58] Conversation reset                                     ← TC-17.7 pre-clear
[09:00:03] User: "What is 347 multiplied by 892?"                 ← TC-17.7 skill trigger
[09:00:10] Calling skill: calculator({...})
[09:00:10] Skill calculator returned: 309524                      ← skill correct ✓
[09:00:11] Assistant responded (47 chars)                         ← full tool-call turn in 8 s
[09:05:05] Model unloaded                                         ← TC-17.8
[09:05:21] Searching for model on device...
[09:05:21] Model found on device.
[09:05:21] Loading model into memory...
[09:05:33] Model loaded in 12.0s
[09:06:10] User: "Hello"                                          ← TC-17.8 post-reload send
[09:06:17] Assistant responded (32 chars)                         ← bar went 57→632 (stale→62%)
```

**Only one `Context window ... full` log entry for the entire session**, which proves the `_contextWarningFired` guard prevents duplicate firing but also illustrates the limitations described in Finding D.

Relevant `adb logcat` evidence from RNLlama:
```
08:21:20 loadPrompt: num_prompt_tokens=610, n_past=0
08:26:33 loadPrompt: num_prompt_tokens=547, n_past=0
08:37:13 loadPrompt: num_prompt_tokens=612, n_past=547       ← KV cache reuse (65 new tokens)
08:37:31 W nextToken: context full, n_ctx: 1024, tokens: 1024 ← ctx_shift disabled ceiling hit
08:39:31 loadPrompt: num_prompt_tokens=548, n_past=538       ← after Clear Chat, cache still warm
08:48:16 loadPrompt: num_prompt_tokens=621, n_past=548
```

---

## Real bugs uncovered

### Bug 1 — `unloadModel()` does not reset the orchestrator or context state

**File:** `src/useGemmaAgent.ts:107-110`

```ts
const unloadModel = useCallback(async () => {
  await engine.unload();
  setModelStatus(modelManager.modelPath ? 'ready' : 'not_downloaded');
}, [engine, modelManager]);
```

**Problems:**
- Does NOT call `orchestrator.reset()` → `_contextWarningFired` remains `true` across a load → crossing → unload → load cycle. If a user triggers the warning, unloads, then reloads and continues chatting, the warning will NOT re-fire on the next 80% crossing until they press Clear Chat.
- Does NOT reset the `contextUsage` React state → the context bar renders stale values from the previous session immediately after `loadModel()` succeeds, before any new message is sent.
- Does NOT clear `messages`, `streamingText`, `error`, `activeSkill` → old chat bubbles from the prior session persist visually through an unload/reload cycle (though the render guard `showChat` hides them during the unloaded window).

**Reproduction:** exactly TC-17.8 — the bar displayed `57 / 1,024 tokens (6%)` post-reload with zero messages sent.

### Bug 2 — `InferenceEngine.unload()` does not reset token counters

**File:** `src/InferenceEngine.ts:203-210`

```ts
async unload(): Promise<void> {
  if (this.context) {
    await releaseAllLlama();
    this.context = null;
    this.modelInfo = null;
    this._isGenerating = false;
  }
}
```

`_lastPromptTokens` and `_lastPredictedTokens` are never zeroed. Even if Bug 1 were fixed by calling `orchestrator.reset()`, a subsequent `engine.getContextUsage()` call on a freshly reloaded engine (before any new `generate()` runs) would still return the stale `lastPrompt + lastPredicted` sum from the previous session.

### Bug 3 (design question) — `getContextUsage()` semantics

**File:** `src/InferenceEngine.ts:238-243`

```ts
getContextUsage(): ContextUsage {
  const total = this.config.contextSize;
  const used = this._lastPromptTokens + this._lastPredictedTokens;
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  return { used, total, percent };
}
```

`used` represents tokens from the **most recent** `generate()` call only, not the cumulative KV cache fill. With llama.rn's automatic cache reuse, a follow-up turn only processes the prompt **diff** (e.g., `n_past=547, embd.size=612` = 65 new tokens) plus the new predicted tokens. So `used` can go DOWN between turns while the conversation actually grows longer:

| Turn | Prompt (processed) | Predicted | `used` | % | Bar color |
|---|---|---|---|---|---|
| TC-17.1 | 547 | ~276 | 823 | 80% | RED + flash |
| TC-17.4 | 65 (diff) | ~411 | 476 | 46% | GREEN |
| TC-17.6 #1 | ~10 (diff after reset) | ~318 | 328 | 32% | GREEN |
| TC-17.8 | ~10 (Hello) | ~622 | 632 | 62% | YELLOW |

**Consequences:**
1. The 80% "context filling up" warning fires based on **last-call cost**, not **conversation state**. If a user has a long conversation but each individual turn is short, the warning will never fire even if the true KV cache is at 95%.
2. The bar "dropping" between turns confuses users expecting a monotonic "filling up" gauge.
3. TC-17.6's expectation ("warning re-fires after reset") is empirically untestable in the emulator at `contextSize: 1024` because follow-up turns can't individually cross the 80% threshold once the prefix is cached.

**Design decision required:**
- **Option A (current):** keep last-call semantics, document clearly, rename (e.g., `lastCallUsage`) to avoid confusion, and treat the warning as "this single turn was expensive".
- **Option B (user intent):** track cumulative KV cache fill. Requires capturing `n_past + predicted_n` at the llama.rn boundary (the `result.timings` object already exposes this). This is what users will expect from a "context window filling up" warning.

Recommendation: **Option B.** The whole point of the warning is to tell the user "your conversation is about to overflow — clear history or it will truncate/fail." Last-call cost doesn't answer that question.

### Finding E — Test-plan parameter drift

The test plan assumes ~150–250 tokens per turn and that 4 turns will cross 80% at `contextSize: 1024`. In reality, the example app's built-in `SYSTEM_PROMPT` plus the 5-skill tool-call manifest produces a **547-token baseline** every call (measured via `RNLlama loadPrompt num_prompt_tokens=547`). A single "Hello, introduce yourself briefly" turn consumed 547 + 276 = 823 tokens = 80.4% on the very first send.

Plan calibration recommendation: bump the temp override to `contextSize: 2500` for a clean 3-turn green → yellow → red progression, OR trim `SYSTEM_PROMPT` / register fewer skills for E2E runs.

---

## Non-bug confirmations

- `08:37:31 W RNLlama nextToken:247 context full, n_ctx: 1024, tokens: 1024` — expected behavior when `ctx_shift: disabled` (confirmed at `loadModel:237`) and the KV cache hits the hard ceiling. No crash, generation simply stops cleanly at the ceiling.
- No Redbox, no native crash, no RN error boundary triggered throughout the 1-hour session.
- Tool-call pipeline (orchestrator → WebView sandbox → result → final turn) is fast and correct when the model cooperates.

---

## Teardown verification

- [x] `example/App.tsx` — only the Phase 17 UI diff remains. Temp line `engineConfig={{ contextSize: 1024 }}` removed. Verified with `git diff example/App.tsx | grep engineConfig` → empty.
- [x] `npx jest` — 8 suites, **113/113 passing** post-teardown.
- [x] 13 screenshots on disk at `tmp/screenshots/`:
  - `tc-17-0-initial.png`
  - `tc-17-0-loaded.png`
  - `tc-17-1-green-bar.png`
  - `tc-17-2-yellow-bar.png`
  - `tc-17-3-log-entry.png`
  - `tc-17-3-red-after-flash.png`
  - `tc-17-3-red-flash.png`
  - `tc-17-4-no-refire.png`
  - `tc-17-5-after-reset.png`
  - `tc-17-6-second-flash.png`
  - `tc-17-8-after-reload.png`
  - `tc-17-8-unloaded.png`
  - `tc-17-summary.png`
- [x] No screenshots loaded into agent context (filesystem artifacts only, per instructions).

---

## Recommended fix order (for next session)

1. **Bug 1 — fix `useGemmaAgent.unloadModel()`:** call `orchestrator.reset()`, reset `contextUsage` to `{ used: 0, total: 0, percent: 0 }`, clear `messages`, `streamingText`, `error`, `activeSkill`. Add a unit test asserting each of these is reset after `await unloadModel()`.
2. **Bug 2 — fix `InferenceEngine.unload()`:** zero `_lastPromptTokens` and `_lastPredictedTokens`. Add a test that calls `load → generate → unload → getContextUsage()` and expects `{ used: 0, total: <contextSize>, percent: 0 }`.
3. **Bug 3 — decide semantics and fix `getContextUsage()`:**
   - Preferred (Option B): track cumulative `used` across `generate()` calls in the engine. Reset on `reset()` / `unload()` only. Use `result.timings.prompt_n + result.timings.predicted_n` but SUM across calls within a session.
   - Add unit tests for both the cumulative-fill semantics AND the reset path.
4. **Test plan recalibration:** update `e2e/phase-17-context-warnings.md` to use `contextSize: 2500` (or similar) and update expected token ranges. Add TC-17.8 assertion that explicitly checks `contextUsage.total === 0` immediately after reload, before any new message.
5. **Regression re-test:** re-run the E2E plan on emulator once bugs 1–3 are fixed. Expect all 8 TCs to PASS cleanly.
