# E2E Test Plan — Phase 17: Context Warning Callback & Metrics

**Target build:** branch `v0.2.0`, Phase 17 changes (uncommitted at time of writing).
**Device:** Android emulator (Pixel_9_Pro AVD or similar with 8GB RAM, API 34+).
**SDK under test:** `react-native-gemma-agent` with `InferenceEngine` running Gemma 4 E2B-it Q4_K_M.

---

## Goal

Verify that the context-window warning system works end-to-end with a **real** `InferenceEngine` — not the mock used in unit tests. Specifically validate:

1. `contextUsage` state updates after each message through the full stack (orchestrator → hook → UI).
2. The `ContextUsageBar` component renders, color-transitions, and displays correct token counts.
3. The `onContextWarning` callback + `'context_warning'` event fire exactly once per threshold crossing.
4. The `resetConversation()` path clears the bar AND re-arms the warning for a second crossing.
5. Mid-conversation tool calls don't cause spurious warning re-fires or bar flicker.

Unit tests (in `src/__tests__/AgentOrchestrator.test.ts`) already cover the orchestrator logic with a mocked engine. This E2E plan covers everything the mock can't: real tokenization, UI rendering, async state flow, and human-observable UX.

---

## Screenshot Rule (MANDATORY)

**All screenshots MUST be saved to disk at `tmp/screenshots/` in the project root.**

- Use `adb exec-out screencap -p > tmp/screenshots/<name>.png` to capture directly to a file.
- DO NOT read the .png files back into the agent context with the `Read` tool. The files exist only as filesystem artifacts — reference them by filename in the report.
- File naming convention: `tc-17-<case-number>-<short-slug>.png` (e.g., `tc-17-3-red-flash.png`).
- Also capture a final summary shot `tc-17-summary.png` at the end.
- The `tmp/` directory is gitignored so screenshots will not be committed.

---

## Preconditions

Before running the tests:

- [ ] Emulator is booted and `adb devices` lists it as `device` (not `offline`).
- [ ] Gemma 4 E2B GGUF is pushed to the emulator at `/data/local/tmp/gemma-4-E2B-it-Q4_K_M.gguf` OR downloadable via the in-app Download button.
- [ ] Run `npx jest` at the project root — all 113 tests must pass before starting E2E.
- [ ] Run `npx tsc --noEmit` — must be clean.
- [ ] `tmp/screenshots/` exists at the project root (create with `mkdir -p tmp/screenshots` if missing).

---

## Temporary test setup (REVERT AFTER TESTING)

The default context window is 4096 tokens, which takes 10+ message turns to fill past 80%. To validate all color transitions and the warning flash in 3–4 turns, temporarily shrink the context window in `example/App.tsx`:

```tsx
<GemmaAgentProvider
  model={MODEL_CONFIG}
  skills={ALL_SKILLS}
  systemPrompt={SYSTEM_PROMPT}
  engineConfig={{ contextSize: 1024 }}  // TEMP for Phase 17 E2E — revert before commit
>
```

With `contextSize: 1024`:
- 60% threshold (yellow) ≈ 614 tokens
- 80% threshold (red + warning) ≈ 819 tokens
- A typical short turn adds ~150–250 tokens, so you cross both bands within 4 messages.

**Revert this change after TC-17.8 completes.** Do not commit it. `git checkout example/App.tsx` is the cleanest way to undo.

---

## Build and install

```bash
# From project root
cd example
npx react-native run-android
```

Wait for the bundle to compile and the app to launch on the emulator. The header should read `Gemma Agent — on-device AI | 5 skills | not_downloaded`.

Tap **Load Model** (or **Download** if the model isn't on device yet). After a ~20s load, the chat UI appears with the **Clear Chat** and **Unload** buttons.

---

## Test Cases

> Each test case is numbered `TC-17.N`. Run them in order — state from one carries into the next unless noted.

### TC-17.1 — Bar appears after first message (GREEN)

**Setup:** fresh conversation, model loaded.

**Steps:**
1. Type `Hello, introduce yourself briefly` and tap Send.
2. Wait for the assistant response to complete.
3. Screenshot: `tmp/screenshots/tc-17-1-green-bar.png`

**Expected:**
- Bar appears below the `Clear Chat / Unload` row.
- Label reads `CONTEXT` on the left, `<used> / 1024 tokens (<percent>%)` on the right, where `<percent>` is small (expect 10–25%).
- Fill color is **green (`#4CAF50`)**.
- No warning banner below the bar.
- No context-warning log entry in the Logs tab.

**Fail signals:** bar invisible, token count stuck at `0`, wrong color, or a premature warning banner.

---

### TC-17.2 — Green → Yellow transition at 60%

**Steps:**
1. Continue the conversation with messages that provoke longer replies, e.g.:
   - `Tell me about Python in three paragraphs.`
   - `Now explain JavaScript closures with an example.`
2. After each turn, observe the bar. Screenshot the frame where the fill first turns yellow: `tmp/screenshots/tc-17-2-yellow-bar.png`

**Expected:**
- Bar percent climbs monotonically with each turn.
- Fill color flips from green to **yellow (`#FFC107`)** when `percent >= 60`.
- No warning banner yet (threshold is 80%).
- No context-warning log entry yet.

**Fail signals:** bar skips the yellow band entirely, color doesn't change, or the flash fires before 80%.

---

### TC-17.3 — Yellow → Red + warning flash at 80% (THE MONEY SHOT)

**Steps:**
1. Send one more message with a long-form prompt, e.g.:
   - `Give me a detailed overview of how neural networks learn, covering backpropagation.`
2. Watch for the fill to turn red and the warning flash to appear.
3. Screenshot **immediately** while the flash is visible: `tmp/screenshots/tc-17-3-red-flash.png`
4. Wait ~6 seconds, screenshot again: `tmp/screenshots/tc-17-3-red-after-flash.png`
5. Switch to the Logs tab, screenshot the context-warning log line: `tmp/screenshots/tc-17-3-log-entry.png`

**Expected:**
- Fill color is **red (`#E53935`)** when `percent >= 80`.
- Flash banner appears below the bar with text `Context window filling up — consider Clear Chat`.
- Background of the bar container turns dark-red (`#3a1d1d`).
- Logs tab contains a red line: `[HH:MM:SS] Context window <percent>% full (<used>/1024). Consider clearing chat.`
- After ~5 seconds the flash banner **auto-dismisses** but the bar stays red.

**Fail signals:**
- Flash never appears.
- Flash appears but never dismisses.
- Flash fires during streaming (before the assistant response completes).
- Log entry missing or in the wrong color.
- Bar color stays yellow despite being above 80%.

---

### TC-17.4 — Warning does not re-fire on subsequent messages

**Setup:** still above 80% from TC-17.3.

**Steps:**
1. Send a short follow-up: `Give me one concrete example.`
2. Wait for the response.
3. Screenshot: `tmp/screenshots/tc-17-4-no-refire.png`
4. Check the Logs tab for any new context-warning entry.

**Expected:**
- Bar percent ticks **higher** (still red).
- **NO** new flash banner.
- **NO** new context-warning log entry (the one from TC-17.3 is the most recent).
- Normal assistant response appears.

**Fail signals:** flash banner re-appears, or a second context-warning line shows up in Logs — this would mean the `_contextWarningFired` guard is broken in the production build.

---

### TC-17.5 — Clear Chat resets the bar

**Steps:**
1. Tap **Clear Chat**.
2. Screenshot: `tmp/screenshots/tc-17-5-after-reset.png`

**Expected:**
- Chat area empties (no message bubbles).
- Logs tab gets a new line: `[HH:MM:SS] Conversation reset`.
- **Bar disappears entirely** (the render guard is `contextUsage.total > 0`, and `resetConversation()` zeros it).
- Clear Chat and Unload buttons remain.
- No flash banner.

**Fail signals:** bar still visible with stale numbers, messages still on screen, or app crashes.

---

### TC-17.6 — Warning re-fires after reset (regression-critical)

**Steps:**
1. Repeat the conversation flow from TC-17.1 → TC-17.2 → TC-17.3:
   - `Hello again, introduce yourself.`
   - `Tell me about Python in three paragraphs.`
   - `Give me a detailed overview of how neural networks learn.`
2. Wait until the bar crosses 80% again.
3. Screenshot the second flash: `tmp/screenshots/tc-17-6-second-flash.png`

**Expected:**
- Bar re-appears on the first message (green).
- Climbs through yellow (60%) and into red (80%) as before.
- Flash banner appears a **second time**.
- A **second** context-warning line appears in Logs with the new timestamp.

**Fail signals:** silent — no warning despite crossing threshold. This would mean the `_contextWarningFired` flag isn't being cleared by `reset()`.

---

### TC-17.7 — Skill call mid-conversation doesn't break the bar

**Setup:** after TC-17.6, tap Clear Chat to start fresh. Wait for the bar to disappear.

**Steps:**
1. Send several short messages first to build up ~40% context usage:
   - `Hi`
   - `What is your name?`
   - `What can you help me with?`
2. Now trigger a skill: `What is 347 multiplied by 892?`
3. Observe the skill badge + bar during execution.
4. Screenshot during skill execution: `tmp/screenshots/tc-17-7-during-skill.png`
5. Screenshot after skill completes: `tmp/screenshots/tc-17-7-after-skill.png`

**Expected:**
- Yellow "Running skill: calculator" badge appears during execution.
- Bar **does not flicker** mid-skill — it either stays stable or updates exactly once when the final assistant message arrives.
- The assistant answer with the correct number shows up.
- If the skill call pushes usage past a threshold, the warning fires at most **once** for the full user turn (not once per inner `generate()` call — the orchestrator makes two generate calls in a tool-call turn).

**Fail signals:**
- Bar updates twice in one turn (once mid-skill, once after).
- Flash fires during skill execution and again after.
- Bar flickers visibly.

---

### TC-17.8 — Unload → Reload → Fresh state

**Steps:**
1. Tap **Unload**.
2. Screenshot: `tmp/screenshots/tc-17-8-unloaded.png`
3. Tap **Load Model** again. Wait for it to finish loading.
4. Send `Hello` — one short message.
5. Screenshot: `tmp/screenshots/tc-17-8-after-reload.png`

**Expected:**
- After unload: chat hidden, Load Model / Download buttons visible, bar gone.
- After reload: chat shows, bar does not appear until the first message arrives.
- After first message: bar appears fresh at low percent, green, no residual flash or log entry from prior sessions.

**Fail signals:** stale percent from prior session, immediate flash fire, or crash on reload.

---

## Summary Screenshot

After all test cases complete, take one final full-screen shot showing the Logs tab scrolled to the bottom so the full history is visible:

`tmp/screenshots/tc-17-summary.png`

---

## Teardown

1. `git diff example/App.tsx` — confirm only the `engineConfig={{ contextSize: 1024 }}` change is present (plus whatever cosmetic formatting).
2. `git checkout example/App.tsx` — revert the temp config change.
3. `ls tmp/screenshots/` — confirm all screenshots are on disk.
4. Run `npx jest` one more time — all 113 tests should still pass.

---

## Results Template

Fill this in as you run the tests:

```
TC-17.1 Bar appears green           [ ] PASS  [ ] FAIL  Notes:
TC-17.2 Green → yellow at 60%       [ ] PASS  [ ] FAIL  Notes:
TC-17.3 Yellow → red + flash at 80% [ ] PASS  [ ] FAIL  Notes:
TC-17.4 No re-fire above threshold  [ ] PASS  [ ] FAIL  Notes:
TC-17.5 Clear Chat resets bar       [ ] PASS  [ ] FAIL  Notes:
TC-17.6 Warning re-fires after reset[ ] PASS  [ ] FAIL  Notes:
TC-17.7 Skill call doesn't break bar[ ] PASS  [ ] FAIL  Notes:
TC-17.8 Unload → reload fresh state [ ] PASS  [ ] FAIL  Notes:
```

Any FAIL should include:
- The exact percent at which the failure occurred
- The screenshot filename showing the bad state
- Logcat lines (`adb logcat -d | grep -i "gemma\|context\|warning"`) if anything crashed
