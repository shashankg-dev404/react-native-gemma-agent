# Manual E2E Test Cases — react-native-gemma-agent

> These are manual test cases for Shashank to run on a physical Android device after each phase.
> Not every phase is testable — only phases with user-visible behavior are included.

---

## Phase 0: Spike Validation

### TC-0.1: Model Loads Successfully
**Precondition**: Gemma 4 E2B GGUF file is on device storage
**Steps**:
1. Open the spike test app
2. Tap "Load Model"
3. Observe loading indicator

**Expected**:
- Model loads without crash
- RAM usage increases by ~1.5 GB (check via Android profiler or app display)
- Load time logged (acceptable: under 30 seconds)

### TC-0.2: Basic Inference Works
**Precondition**: Model is loaded (TC-0.1 passed)
**Steps**:
1. Enter prompt: "What is 2 + 2?"
2. Tap Send

**Expected**:
- Response appears within 10-15 seconds
- Response contains "4" (model correctly answers)
- Tokens appear progressively (streaming), not all at once
- Device does not overheat or crash

### TC-0.3: Multi-turn Conversation
**Precondition**: Model is loaded
**Steps**:
1. Send: "My name is Shashank"
2. Wait for response
3. Send: "What is my name?"

**Expected**:
- Model remembers context and responds with "Shashank"
- Proves conversation history is maintained

---

## Phase 1-2: Model Manager + Inference Engine

### TC-1.1: Model Download with Progress
**Precondition**: Model NOT yet downloaded, internet connected
**Steps**:
1. Open app
2. Tap "Download Model"
3. Observe progress bar
4. Wait for completion (or kill app mid-download to test TC-1.2)

**Expected**:
- Progress bar shows 0% → 100%
- Download completes successfully
- Model status changes to "ready"
- File exists in app storage (~1.5 GB)

### TC-1.2: Download Resume After Interruption
**Precondition**: Start download, then kill app at ~30%
**Steps**:
1. Start model download
2. At ~30%, force-kill the app
3. Reopen app
4. Tap "Download Model" again

**Expected**:
- Download resumes from ~30%, NOT from 0%
- Completes successfully

### TC-1.3: Insufficient Storage
**Precondition**: Device has less than 2 GB free storage
**Steps**:
1. Open app
2. Tap "Download Model"

**Expected**:
- Clear error message: "Not enough storage. Need X GB, have Y GB available."
- No crash, no partial download

---

## Phase 3-4: Skill System

### TC-3.1: Skill Registration
**Precondition**: App running, model loaded
**Steps**:
1. Open skill browser screen
2. Observe pre-loaded skills

**Expected**:
- Shows 3 skills: query_wikipedia, calculator, web_search
- Each shows name and description
- Skills can be toggled on/off

### TC-4.1: Skill Execution (Wikipedia)
**Precondition**: Skills loaded, internet connected
**Steps**:
1. In chat, type: "Check Wikipedia about the Eiffel Tower"
2. Observe response

**Expected**:
- Chat shows: `Loading skill "query_wikipedia"`
- Chat shows: `Called JS skill "query_wikipedia/scripts/index.html"`
- Response contains accurate Wikipedia information about the Eiffel Tower
- Response is in natural language (not raw JSON)

### TC-4.2: Skill Execution (Calculator — Offline)
**Precondition**: Skills loaded, airplane mode ON
**Steps**:
1. Enable airplane mode
2. In chat, type: "What is 1847 * 293 + 17?"
3. Observe response

**Expected**:
- Model calls calculator skill
- Correct answer: 541,188 (verify manually)
- Works completely offline (calculator skill uses no network)

### TC-4.3: Skill Timeout
**Precondition**: Skills loaded
**Steps**:
1. Disconnect from internet (airplane mode)
2. In chat, type: "Search Wikipedia for quantum physics"
3. Observe response

**Expected**:
- Skill attempts to fetch Wikipedia but fails (no internet)
- Error is handled gracefully — NOT an app crash
- Model receives the error and responds: "I couldn't reach Wikipedia right now. Let me try to answer from what I know..."
- Response time: within skill timeout (30s) + model response time

### TC-4.4: Skill from URL
**Precondition**: Internet connected, a skill hosted at a public URL
**Steps**:
1. Go to skill browser
2. Tap "Add Skill from URL"
3. Enter URL of a hosted skill
4. Tap Add

**Expected**:
- Skill downloads and appears in skill list
- Skill can be used in conversation

---

## Phase 5-6: Agent Loop (Function Calling)

### TC-5.1: Automatic Skill Selection
**Precondition**: All 3 skills registered
**Steps**:
1. Type: "What's 15% of 2400?"
2. Observe which skill is called

**Expected**:
- Model automatically selects `calculator` skill (NOT Wikipedia or web search)
- Correct answer: 360

### TC-5.2: No Skill Needed
**Precondition**: Skills registered
**Steps**:
1. Type: "Hello, how are you?"
2. Observe response

**Expected**:
- Model responds conversationally WITHOUT calling any skill
- No "Loading skill..." messages appear
- Normal chat response

### TC-5.3: Chained Skill Calls
**Precondition**: Wikipedia + calculator skills registered
**Steps**:
1. Type: "Look up the population of Tokyo on Wikipedia, then calculate what 15% of that number is"

**Expected**:
- Model first calls `query_wikipedia` to get Tokyo's population
- Then calls `calculator` to compute 15% of that number
- Final response combines both results naturally
- UI shows both skill calls in sequence

### TC-5.4: Max Chain Depth Protection
**Precondition**: Skills registered
**Steps**:
1. Type a query that could cause infinite skill chaining (e.g., a query where the model keeps wanting more info)

**Expected**:
- After 5 skill calls (max depth), model is forced to respond with what it has
- No infinite loop
- App remains responsive

---

## Phase 7: React Hooks API

> Not directly testable by manual testing. Verified through the demo app working.

---

## Phase 8: Demo Skills End-to-End

### TC-8.1: Wikipedia — Factual Question
**Steps**: Type: "Check Wikipedia about Oscars 2026, who won best picture?"
**Expected**: Skill called, accurate answer returned from Wikipedia

### TC-8.2: Wikipedia — Person Lookup
**Steps**: Type: "Look up Albert Einstein on Wikipedia"
**Expected**: Summary of Einstein's Wikipedia page, key facts included

### TC-8.3: Wikipedia — No Results
**Steps**: Type: "Search Wikipedia for xyzzynonexistent12345"
**Expected**: Model gracefully reports "I couldn't find an article about that"

### TC-8.4: Calculator — Basic Math
**Steps**: Type: "Calculate 847 divided by 23"
**Expected**: Correct answer: 36.826...

### TC-8.5: Calculator — Complex Expression
**Steps**: Type: "What is (15 * 3) + (27 / 9) - 4?"
**Expected**: Correct answer: 44

### TC-8.6: Web Search — Current Events
**Steps**: Type: "Search the web for latest tech news today"
**Expected**: Returns real search results with titles and snippets

---

## Phase 9: Demo App UX

### TC-9.1: First Launch Experience
**Precondition**: Fresh install, no model downloaded
**Steps**:
1. Install and open app
2. Follow onboarding flow

**Expected**:
- Clear explanation of what the app does
- Prompted to download model
- Shows model size and estimated download time
- After download, lands on chat screen with pre-loaded skills

### TC-9.2: Chat UI — Message Display
**Steps**:
1. Send a message
2. Observe UI during model generation

**Expected**:
- User message appears in bubble (right side)
- Typing indicator appears while model thinks
- Agent response streams in token by token (left side)
- "Model on GPU" badge visible
- Smooth scrolling, no jank

### TC-9.3: Chat UI — Skill Status Display
**Steps**:
1. Ask a question that triggers a skill

**Expected**:
- Shows: `Loaded skill "query_wikipedia"` (with distinct styling)
- Shows: `Called JS skill "query_wikipedia/scripts/index.html"`
- Then shows the model's response
- Skill status messages are visually distinct from chat messages

### TC-9.4: App Backgrounding and Return
**Steps**:
1. Have a conversation with 5+ messages
2. Press Home to background the app
3. Wait 2 minutes
4. Return to the app

**Expected**:
- Conversation history preserved
- Model may need to reload (acceptable if transparent to user)
- No crash on return

### TC-9.5: Low Memory Behavior
**Precondition**: Open several heavy apps to reduce available RAM
**Steps**:
1. Open Chrome with 10+ tabs, a game, etc.
2. Open the agent app
3. Try to load model

**Expected**:
- Either: loads successfully (device has enough RAM)
- Or: clear error message "Not enough memory. Close some apps and try again."
- NOT: silent crash, ANR, or frozen UI

---

## Phase 11: Skill Quality & Network Awareness

### TC-11.1: Wikipedia — LaTeX Stripped
**Precondition**: Model loaded, internet connected
**Steps**: Type "Look up Albert Einstein on Wikipedia"
**Expected**: Response contains facts, no `$...$` delimiters, no `\displaystyle`, no raw LaTeX commands, no leftover `{}`

### TC-11.2: Web Search — Broad Query (SearXNG)
**Precondition**: Model loaded, internet connected
**Steps**: Type "Search the web for latest React Native news"
**Expected**: Web search skill called, returns actual results with titles/URLs/snippets (not "No direct results found")

### TC-11.3: Network Check — Offline Blocks Network Skills
**Precondition**: Model loaded, airplane mode ON
**Steps**: Type "Search Wikipedia for quantum physics"
**Expected**: Tool result returns "No internet connection" within ~3s (no 30s timeout wait). Model responds gracefully.

### TC-11.4: Network Check — Offline Allows Calculator
**Precondition**: Model loaded, airplane mode ON
**Steps**: Type "What is 847 * 23?"
**Expected**: Calculator executes normally, correct answer (19,481), no connectivity error.

---

## Phase 11b: GPS & Calendar Skills

### TC-11b.1: GPS — Returns Location with City Name
**Precondition**: Model loaded, GPS enabled
**Steps**: Type "Where am I right now?"
**Expected**: Device location skill called. Response includes city name (e.g., "Jodhpur, Rajasthan, India"), coordinates, accuracy, altitude. All fields present.

### TC-11b.2: GPS — Works Offline
**Precondition**: Model loaded, airplane mode ON, GPS enabled
**Steps**: Type "Where am I?"
**Expected**: GPS still returns coordinates + city name (offline city database, no internet needed).

### TC-11b.3: Calendar — Returns Today's Events
**Precondition**: Model loaded, calendar has events for today
**Steps**: Type "What's on my calendar today?"
**Expected**: Calendar skill called. Response lists events with times, titles, and locations. Events sorted by start time.

### TC-11b.4: Calendar — No Events
**Precondition**: Model loaded, calendar empty for today
**Steps**: Type "What's on my calendar today?"
**Expected**: Response says no events found.

---

## Phase 12: BM25 Skill Routing

> To test: set `agentConfig={{ skillRouting: 'bm25', maxToolsPerInvocation: 1 }}` in App.tsx

### TC-12.1: BM25 — Math Routes to Calculator
**Precondition**: BM25 enabled, maxToolsPerInvocation: 1
**Steps**: Type "Calculate 15% of 200"
**Expected**: Calculator skill called, correct answer (30). Log shows only 1 tool sent to model.

### TC-12.2: BM25 — Factual Routes to Wikipedia
**Precondition**: BM25 enabled, maxToolsPerInvocation: 1
**Steps**: Type "Search Wikipedia for the Eiffel Tower"
**Expected**: Wikipedia skill called (not web_search or calculator).

---

## Phase 13: Context Usage API

### TC-13.1: Context Usage Updates After Message
**Precondition**: Model loaded
**Steps**: Send "Hello", then send a longer message. Check contextUsage after each.
**Expected**: `used` increases after each turn, `total` matches context size (4096), `percent` grows progressively.

---

## Phase 14: Unit Tests

### TC-14.1: All Tests Pass
**Steps**: Run `npm test` in SDK root
**Expected**: 60 tests pass across 5 suites, runtime under 5 seconds, no device needed.

---

## Phase 19 — Vercel AI SDK adapter

> Target: `example/App.tsx` running on a real Android device with `ai ~5.0.173` + `@ai-sdk/react` installed in `example/` and the Gemma 4 E2B Q4_K_M GGUF either downloaded or pushed to `/data/local/tmp/`.
>
> Primary surface: the **AI SDK** tab (third tab in the tab bar, after **Chat** and **Logs**). The SDK-facing adapter is `react-native-gemma-agent/ai`, wired in `example/src/AiSdkChatTab.tsx`.
>
> Setup (once per session):
> 1. `cd example && npm install`
> 2. `npx react-native run-android`
> 3. From the **Chat** tab: tap **Load Model** (or **Download** first). Wait for the "Model loaded in Xs" log line on the **Logs** tab.
> 4. Tap the **AI SDK** tab. You should see the placeholder `useChat() over createGemmaProvider. Try "What is 234 * 567?" or "Search Wikipedia for quantum computing".`
> 5. Routing chip defaults to `all`. Second chip `bm25` is available.
>
> Unless a case says otherwise: start with a fresh conversation (relaunch the app or tap **Clear Chat** on the **Chat** tab before switching), `skillRouting` chip set to `all`, and the device online.

### 19.A — Provider lifecycle (`prepare()`, `unload()`)

### TC-19.A.1: `prepare()` is a no-op when the engine already has a model loaded
**Precondition**: Model loaded via **Chat** tab (status chip reads `ready`, context bar visible).
**Steps**:
1. Switch to **AI SDK** tab.
2. Type `hello` into the tab's input row and tap **Send**.

**Expected**:
- First `text-delta` arrives within the same time as the legacy chat tab (no reload pause of ~10 s).
- **Logs** tab shows no new `Loading model into memory...` line.
- `engine.isLoaded` remains `true` — input placeholder stays `Ask something...`, not `Load the model first`.

**Result**: [x] Pass / [ ] Fail

### TC-19.A.2: `prepare(modelPath)` loads an explicit GGUF path when engine is unloaded
**Precondition**: Model file on device at `/data/local/tmp/gemma-4-E2B-it-Q4_K_M.gguf`. From **Chat** tab tap **Unload**.
**In-code edit** (`example/src/AiSdkChatTab.tsx`, inside `AiSdkChatTab`, replace the `const provider = useMemo(...)` block with the version below):
```diff
   const provider = useMemo(
     () =>
       createGemmaProvider({
         engine,
         registry,
         knowledgeStore: knowledgeStore ?? null,
         modelManager,
         skillExecutor,
       }),
     [engine, registry, knowledgeStore, modelManager, skillExecutor],
   );
+  React.useEffect(() => {
+    const model = provider('gemma-4-e2b');
+    model
+      .prepare('/data/local/tmp/gemma-4-E2B-it-Q4_K_M.gguf')
+      .then(() => console.log('[TC-19.A.2] prepare(explicit path) OK'))
+      .catch((err) => console.log('[TC-19.A.2] prepare failed:', err.message));
+  }, [provider]);
```
**Steps**:
1. Reload the Metro bundle.
2. Switch to **AI SDK** tab (don't touch **Load Model** on the **Chat** tab).
3. Watch `adb logcat *:S ReactNativeJS:V` for the tag.

**Expected**:
- Log line `[TC-19.A.2] prepare(explicit path) OK` appears within 15 s of opening the tab.
- Input placeholder flips from `Load the model first` to `Ask something...`.
- Sending `hello` produces a text bubble.

**Cleanup**: Revert the `useEffect` block.

**Result**: [~] Partial pass
- `[TC-19.A.2] prepare(explicit path) OK` log appeared on schedule, confirming `prepare(modelPath)` loads the GGUF via `engine.loadModel` end-to-end.
- Placeholder did NOT flip from `Load the model first` to `Ask something...` automatically. `AiSdkChatTab` reads `engine.isLoaded` as a plain getter; the component isn't subscribed to a React-state signal, so nothing schedules a re-render when `prepare()` resolves. Adding a local `forceRerender()` call in the useEffect's `.then` made the placeholder flip and unblocked sending. Harness gap, not an SDK/ADR-006 contract violation — `prepare()` doesn't promise React reactivity. Track as follow-up: either expose `isModelLoaded` through `useGemmaAgentContext`, or have `AiSdkChatTab` subscribe to a load signal.

### TC-19.A.3: `prepare()` auto-loads via configured `ModelManager`
**Precondition**: Model file on device; from **Chat** tab tap **Unload**.
**In-code edit** (`example/src/AiSdkChatTab.tsx`): same injection site as TC-19.A.2 but call `model.prepare()` with no arguments:
```diff
+  React.useEffect(() => {
+    const model = provider('gemma-4-e2b');
+    model
+      .prepare()
+      .then(() => console.log('[TC-19.A.3] prepare() auto-load OK'))
+      .catch((err) => console.log('[TC-19.A.3] prepare failed:', err.message));
+  }, [provider]);
```
**Steps**:
1. Reload Metro.
2. Switch to **AI SDK** tab.

**Expected**:
- Log line `[TC-19.A.3] prepare() auto-load OK` appears.
- `ModelManager.findModel()` picks up the on-device GGUF (same path the **Chat** tab's **Load Model** button uses).
- Sending `hello` produces a text bubble.

**Cleanup**: Revert the `useEffect` block.

**Result**: [~] Partial pass
- `[TC-19.A.3] prepare() auto-load OK` logged, confirming ModelManager.findModel() located the on-device GGUF and engine.loadModel succeeded.
- Sending `hello` produced a response bubble.
- Same harness gap as TC-19.A.2: placeholder flip required a local forceRerender() nudge.

### TC-19.A.4: `prepare()` throws a clear error when nothing is configured
**Precondition**: Model **not** on device (fresh install or file deleted). From **Chat** tab tap **Unload** if applicable.
**In-code edit** (`example/src/AiSdkChatTab.tsx`): strip `modelManager` from the provider factory and call `prepare()` with no argument:
```diff
   const provider = useMemo(
     () =>
       createGemmaProvider({
         engine,
         registry,
         knowledgeStore: knowledgeStore ?? null,
-        modelManager,
         skillExecutor,
       }),
-    [engine, registry, knowledgeStore, modelManager, skillExecutor],
+    [engine, registry, knowledgeStore, skillExecutor],
   );
+  React.useEffect(() => {
+    provider('gemma-4-e2b')
+      .prepare()
+      .catch((err) => console.log('[TC-19.A.4]', err.message));
+  }, [provider]);
```
**Steps**:
1. Reload Metro.
2. Switch to **AI SDK** tab.

**Expected**:
- Log line reads exactly: `[TC-19.A.4] GemmaLanguageModel.prepare: no model loaded. Pass a path to prepare(modelPath), configure the provider with { modelManager }, or call engine.loadModel(path) yourself.`
- No crash; input row stays in the disabled state.

**Cleanup**: Revert the provider factory and `useEffect`.

**Result**: [x] Pass — exact error message logged, no crash, input stayed disabled.

### 19.B — Stream-part sequencing (single AI SDK tab turn)

### TC-19.B.1: `stream-start` emitted first with empty warnings on a plain turn
**Precondition**: Model loaded, **AI SDK** tab open, no tools passed (default).
**In-code edit** (`example/src/AiSdkChatTab.tsx`, inside `makeGemmaTransport.sendMessages`, add a `for await` logger):
```diff
-      return result.toUIMessageStream({ originalMessages: messages });
+      const consumed: any[] = [];
+      for await (const chunk of result.fullStream) {
+        console.log('[TC-19.B]', chunk.type, JSON.stringify(chunk).slice(0, 200));
+        consumed.push(chunk);
+      }
+      return result.toUIMessageStream({ originalMessages: messages });
```
(Leave this edit in place for TC-19.B.2–B.11. Revert after the block.)
**Steps**:
1. Reload Metro.
2. In the **AI SDK** tab type `hello` and tap **Send**.
3. In `adb logcat *:S ReactNativeJS:V` observe tagged `[TC-19.B]` lines.

**Expected**:
- First tagged line has `type: 'stream-start'`.
- Its `warnings` array is `[]` (present in the JSON but empty).
- No `[TC-19.B]` line appears before `stream-start`.

**Result**: [x] Pass
- ai@6 `fullStream` renames V3 `stream-start` to `start` and adds `start-step`. `warnings: []` present on `start-step`. Sequence correct, `start` is first.

### TC-19.B.2: `text-start` precedes the first `text-delta`
**Precondition**: TC-19.B.1 edit in place.
**Steps**:
1. Type `count from one to five` and tap **Send**.

**Expected**:
- Log stream contains exactly one `type: 'text-start'` line before any `type: 'text-delta'` line.

**Result**: [x] Pass

### TC-19.B.3: `text-delta` parts arrive as individual tokens (buffered flush)
**Precondition**: TC-19.B.1 edit in place.
**Steps**:
1. Type `write a two sentence poem about rivers` and tap **Send**.
2. Watch the tab's bubble and the logcat lines.

**Expected**:
- Multiple `type: 'text-delta'` log lines with incremental `delta` values (one token each).
- All deltas arrive in a burst after generation completes (buffered to prevent tool-call token leaks), not progressively during generation.
- The Gemma bubble appears once generation finishes, not character-by-character.

**Result**: [x] Pass
- 20 text-delta parts, each one token, all within an ~18ms burst after generate() resolved. text-start before first delta, text-end after last. Buffered flush working as designed.

### TC-19.B.4: `text-end` fires before `finish`
**Precondition**: TC-19.B.1 edit in place.
**Steps**:
1. Type `hi` and tap **Send**; wait for the bubble to stop growing.

**Expected**:
- Log sequence ends with `... text-end ... finish`.
- No `text-delta` appears after `text-end`.

**Result**: [x] Pass
- text-end at 12:35:29.286, finish-step at 12:35:29.288. No text-delta after text-end.

### TC-19.B.5: `reasoning-start / -delta / -end` emitted when `enable_thinking` is on
**Precondition**: TC-19.B.1 edit in place.
**In-code edit** (`example/src/AiSdkChatTab.tsx`, inside `makeGemmaTransport.sendMessages`, extend `providerOptions.gemma`):
```diff
-        providerOptions: { gemma: { skillRouting: routing } },
+        providerOptions: {
+          gemma: { skillRouting: routing, enable_thinking: true, reasoning_format: 'deepseek' },
+        },
```
**Steps**:
1. Reload Metro.
2. Type `what is the 7th prime number, explain your reasoning` and tap **Send**.

**Expected**:
- If llama.rn populates `result.reasoning_content` for Gemma 4 with `enable_thinking: true`: log shows `reasoning-start`, one `reasoning-delta` with the full chain-of-thought, and `reasoning-end` before `text-start`/`finish`.
- The visible bubble renders only the final answer text (no thinking tokens leaked as text).
- If llama.rn does NOT populate `result.reasoning_content` (all thinking tokens arrive as regular text): no reasoning parts in the log, but text should still be clean (thinking stripped by `result.content`).

**Cleanup**: Revert `providerOptions` edit.

**Result**: [~] Partial — adapter correct, model limitation
- No `reasoning-start/delta/end` in logs. `result.reasoning` was null — Gemma 4 E2B doesn't use DeepSeek's `<think>` format; `reasoning_format: 'deepseek'` had no effect. Model answered with inline reasoning in visible text instead.
- No thinking token markers leaked (no `<|channel>thought` in UI). Text is clean.
- Adapter code for reasoning emission is verified by unit tests (GemmaLanguageModel.test.ts). Cannot exercise on-device until llama.rn adds a Gemma-native reasoning parser or Gemma adopts a supported format.

### TC-19.B.6: `tool-input-start` appears as soon as the model begins emitting a tool call
**Precondition**: TC-19.B.1 edit in place.
**Steps**:
1. Type `what is 234 * 567?` and tap **Send**.

**Expected**:
- A gold-bordered tool card appears in the bubble with `tool: calculator` before the numeric answer is shown.
- Logs: a `type: 'tool-input-start'` line with `toolName: 'calculator'` and `providerExecuted: true`.
- No `text-delta` parts containing tool-call syntax (buffered flush suppresses them).
- No `tool-error` parts (skills registered as tools in streamText).

**Result**: [x] Pass
- tool-input-start with toolName:calculator, providerExecuted:true. No leaked text-delta, no tool-error. Tool card shows "tool: tool-calculator, state: output-available, 132678". Collision warnings in start-step are cosmetic (dual registration).

### TC-19.B.7: `tool-input-delta` parts stream progressive tool-arg decode
**Precondition**: TC-19.B.1 edit in place. This specific stream-part is not rendered by the AI SDK tab UI today.
**Steps**:
1. Type `calculate 12345 * 6789` and tap **Send**.

**Expected**:
- Logs contain one or more `type: 'tool-input-delta'` lines between the `tool-input-start` and the matching `tool-input-end` (this is the day-one fix covered in §19.F but verified here at the sequence level).
- [BLOCKED — needs UI] The AI SDK tab does not render progressive input; the log lines are the only visible artifact. Flag fail only if the log lines are missing.

**Result**: [x] Pass
- Log from B.6 calculator test: `tool-input-delta` with `{"expression":"234 * 567"}` present between start and end.

### TC-19.B.8: `tool-input-end` closes the tool-input bracket before `tool-call`
**Precondition**: TC-19.B.1 edit in place.
**Steps**:
1. Type `what is 5 + 7?` and tap **Send**.

**Expected**:
- Log order: `tool-input-start → (zero or more) tool-input-delta → tool-input-end → tool-call → tool-result → finish`.
- No `tool-call` log line appears before the matching `tool-input-end`.

**Result**: [x] Pass
- B.6 calculator log confirms: tool-input-end at :31.169 then tool-call at :31.169 then tool-result at :31.169.

### TC-19.B.9: `tool-call` and `tool-result` pair correctly for a provider-executed skill
**Precondition**: TC-19.B.1 edit in place.
**Steps**:
1. Type `what is 234 * 567?` and tap **Send**.

**Expected**:
- Tool card in the bubble shows `tool: calculator`, `state: output-available`, output `132678`.
- Logs: the `tool-call` and the matching `tool-result` both carry `providerExecuted: true` and the same `toolCallId`.

**Result**: [x] Pass
- tool-call: toolCallId "call_0", providerExecuted:true. tool-result: same toolCallId, output "132678", providerExecuted:true. UI tool card matches.

### TC-19.B.10: `finish` is the terminal part and nothing follows it
**Precondition**: TC-19.B.1 edit in place.
**Steps**:
1. Type `what is 2 + 2?` and tap **Send**; wait until the **Stop** button disappears.

**Expected**:
- Last `[TC-19.B]` log line for the turn has `type: 'finish'`.
- No further log lines with the same tag until the next user message.

**Result**: [x] Pass
- B.6 calculator log: last line is `finish` with finishReason "stop". No subsequent [TC-19.B] lines.

### TC-19.B.11: `error` part fires terminally when the engine throws mid-stream
**Precondition**: TC-19.B.1 edit in place. From **Chat** tab tap **Unload** to force an engine failure.
**Steps**:
1. Switch to the **AI SDK** tab.
2. In-code edit: temporarily disable the `!engine.isLoaded` guard in `handleSend` so the input accepts the message anyway:
```diff
-    if (!text || isStreaming || !engine.isLoaded) return;
+    if (!text || isStreaming) return;
```
3. Reload Metro.
4. Type `hello` and tap **Send**.

**Expected**:
- Red error bubble appears under the placeholder with a message like `Model not loaded` or similar.
- Logs: last `[TC-19.B]` line has `type: 'error'`; no more lines for the turn.
- App does not crash.

**Cleanup**: Revert the guard change and the `fullStream` logger.

**Result**: [x] Pass — red error bubble appeared, last `[TC-19.B]` log was `type: 'error'`, no crash, no further lines after error.

### 19.C — Provider-executed skills

### TC-19.C.1: `calculator` skill round-trip
**Precondition**: Model loaded, **AI SDK** tab open, chip set to `all`.
**Steps**:
1. Type `what is 234 * 567?` and tap **Send**.

**Expected**:
- Tool card: `tool: calculator`, `state: output-available`, output contains `132678`.
- Final text bubble contains `132678` in a natural-language sentence.

**Result**: [x] Pass

### TC-19.C.2: `query_wikipedia` skill round-trip
**Precondition**: Online.
**Steps**:
1. Type `search Wikipedia for the Eiffel Tower` and tap **Send**.

**Expected**:
- Tool card: `tool: query_wikipedia`, output contains `Eiffel` and `Paris`.
- Final text bubble is a natural-language summary mentioning the tower's location in Paris.

**Result**: [x] Pass — tool card `tool-query_wikipedia`, `output-available`, Eiffel Tower content with Paris/France. Correct.

### TC-19.C.3: `web_search` skill round-trip
**Precondition**: Online.
**Steps**:
1. Type `search the web for the latest React Native release notes` and tap **Send**.

**Expected**:
- Tool card: `tool: web_search`, output includes at least one title + URL from a SearXNG instance.
- Final text bubble references a recent RN version.

**Result**: [x] Fail (external dep) — SearXNG instances all down/blocked. Tool card shows `output-error`. Model handled gracefully ("I was unable to find..."). Error handling correct, but no search results returned. Not an SDK bug.

### TC-19.C.4: `device_location` skill round-trip
**Precondition**: GPS enabled; location permission granted to the example app.
**Steps**:
1. Type `where am I right now?` and tap **Send**.

**Expected**:
- Tool card: `tool: device_location`, output includes `latitude`, `longitude`, and a city name.
- Final text bubble names the city.

**Result**: [x] Pass

### TC-19.C.5: `read_calendar` skill round-trip
**Precondition**: Calendar permission granted; at least one event on today's device calendar.
**Steps**:
1. Type `what's on my calendar today?` and tap **Send**.

**Expected**:
- Tool card: `tool: read_calendar`, output lists events with time ranges and titles.
- Final text bubble repeats the events in natural language.

**Result**: [x] Pass

### TC-19.C.6: `local_notes` skill round-trip (save + read)
**Precondition**: Fresh conversation.
**Steps**:
1. Type `save a note titled favorite color with content blue` and tap **Send**.
2. Wait for completion.
3. Type `read my note titled favorite color` and tap **Send**.

**Expected**:
- Turn 1: tool card `tool: local_notes`, output confirms save.
- Turn 2: tool card `tool: local_notes`, output contains `blue`; final text bubble says blue.

**Result**: [x] Pass

### 19.D — Chained skills + `maxChainDepth`

### TC-19.D.1: Wikipedia → local_notes chain
**Precondition**: Online, fresh conversation.
**Steps**:
1. Type `search Wikipedia for quantum computing then save the first sentence as a note titled qc-intro` and tap **Send**.

**Expected**:
- Two tool cards in order: `tool: query_wikipedia` (output contains `quantum`), then `tool: local_notes` (action `save`, title `qc-intro`).
- Final text bubble confirms both steps.

**Result**: [x] Pass — after fixing duplicate toolCallId bug (llama.rn resets ID counter per generate()). Two tool cards: `tool-query_wikipedia` with quantum computing content, then `tool-local_notes` with "Note qc-intro saved successfully."

### TC-19.D.2: Calculator → Wikipedia chain
**Precondition**: Online, fresh conversation.
**Steps**:
1. Type `compute 1969 + 20, then search Wikipedia for the year that number gives` and tap **Send**.

**Expected**:
- Tool cards in order: `tool: calculator` (output `1989`), then `tool: query_wikipedia` (query around `1989`).
- Final text bubble ties the two together.

**Result**: [x] Pass

### TC-19.D.3: Default `maxChainDepth: 5` terminates a runaway chain with fallback
**Precondition**: Fresh conversation.
**In-code edit** (`example/src/AiSdkChatTab.tsx`, temporarily lower routing so every skill is offered every turn and encourage looping — inject a user prompt that keeps asking for more searches). No code edit needed; use the prompt below.
**Steps**:
1. Type `search Wikipedia for topic 1, then for topic 2, then for topic 3, then for topic 4, then for topic 5, then for topic 6, and summarize` and tap **Send**.

**Expected**:
- At most 5 provider-executed tool cards appear.
- Final text bubble contains the string `maximum chain depth` (substring of `I tried to use tools but reached the maximum chain depth. Here is what I know so far.`).

**Result**: [x] Pass

### TC-19.D.4: `providerOptions.gemma.maxChainDepth: 2` overrides default
**Precondition**: Fresh conversation.
**In-code edit** (`example/src/AiSdkChatTab.tsx`, inside `makeGemmaTransport`):
```diff
-      providerOptions: { gemma: { skillRouting: routing } },
+      providerOptions: { gemma: { skillRouting: routing, maxChainDepth: 2 } },
```
**Steps**:
1. Reload Metro.
2. Type the same prompt as TC-19.D.3 and tap **Send**.

**Expected**:
- At most 2 provider-executed tool cards appear.
- Final text bubble contains `maximum chain depth`.

**Cleanup**: Revert.

**Result**: [x] Pass

### 19.E — `providerOptions.gemma` overrides

### TC-19.E.1: `skillRouting: 'bm25'` narrows the tool list
**Precondition**: Fresh conversation. Chip set to `bm25` (tap the `bm25` chip in the routing bar; it highlights blue).
**In-code edit**: none (UI covers this).
**Steps**:
1. Type `what is 12 * 19?` and tap **Send**.
2. In `adb logcat`, look for the turn's tool list (add a one-liner log in `runToolLoop.ts` if not already present, or use the `[TC-19.B]` stream logger from 19.B.1 to count distinct `toolName` values emitted in `tool-input-start`).

**Expected**:
- Only the `calculator` tool is exercised this turn; no other tool card appears.
- Tool card output: `228`.

**Result**: [x] Pass

### TC-19.E.2: `maxToolsPerInvocation` caps the tool list
**Precondition**: Fresh conversation.
**In-code edit** (`example/src/AiSdkChatTab.tsx`):
```diff
-      providerOptions: { gemma: { skillRouting: routing } },
+      providerOptions: { gemma: { skillRouting: 'bm25', maxToolsPerInvocation: 2 } },
```
Also add a transient log at the top of `src/runToolLoop.ts:getToolsForQuery` so the tool count is visible:
```diff
 function getToolsForQuery(
   registry: SkillRegistry,
   config: RunToolLoopConfig,
   query: string,
 ): ToolDefinition[] {
+  console.log('[TC-19.E.2] routing=', config.skillRouting, 'cap=', config.maxToolsPerInvocation);
```
**Steps**:
1. Reload Metro.
2. Type `search Wikipedia for Alan Turing` and tap **Send**.
3. Observe the returned tool list length via a second log line added at the return path (or inspect the `[TC-19.B]` stream: at most 2 distinct `toolName`s should surface across the turn).

**Expected**:
- Log prints `routing= bm25 cap= 2`.
- No more than 2 tool cards invoked across this single turn's tool loop iteration.

**Cleanup**: Revert both edits.

**Result**: [ ] Pass / [ ] Fail

### TC-19.E.3: `activeCategories` filters skills by category
**Precondition**: Fresh conversation.
**In-code edit** (`example/src/AiSdkChatTab.tsx`):
```diff
-      providerOptions: { gemma: { skillRouting: routing } },
+      providerOptions: { gemma: { skillRouting: 'all', activeCategories: ['utility'] } },
```
**Steps**:
1. Reload Metro.
2. Type `look up the capital of Japan on Wikipedia` and tap **Send**.

**Expected**:
- Model cannot call `query_wikipedia` (category `research` is excluded). Either no tool card appears, or only `calculator` / `read_calendar` / `local_notes` / `device_location` appear.
- Final text bubble answers from the model's own knowledge (or apologizes) — no Wikipedia card.

**Cleanup**: Revert.

**Result**: [x] Pass

### TC-19.E.4: `maxChainDepth` override
Covered by TC-19.D.4.

**Result**: [ ] Pass / [ ] Fail (same as TC-19.D.4)

### 19.F — Day-one fixes vs upstream providers

### TC-19.F.1: `tool-input-*` parts stream live (not a single post-call dump)
**Precondition**: TC-19.B.1 `fullStream` logger in place.
**Steps**:
1. Type `calculate 1234567 * 7654321` and tap **Send**.
2. Watch `adb logcat *:S ReactNativeJS:V`.

**Expected**:
- Between `tool-input-start` and `tool-input-end` there is at least one `tool-input-delta` line whose log timestamp is **strictly before** the `tool-result` line.
- Fail if the whole tool-input block is flushed in a single log frame simultaneous with the result.

**Cleanup**: revert logger after 19.F batch.

**Result**: [ ] Pass / [ ] Fail

### TC-19.F.2: Tool `inputSchema` reaches the model as `parameters`
**Precondition**: TC-19.B.1 logger still in place.
**In-code edit** (`example/src/AiSdkChatTab.tsx`, inject a consumer tool with a rich schema via `streamText`):
```diff
 import { streamText, type ChatTransport, type UIMessage } from 'ai';
+import { z } from 'zod';
 import { useChat } from '@ai-sdk/react';
...
-      const result = streamText({
+      const result = streamText({
         model,
         messages: messages as Parameters<typeof streamText>[0]['messages'],
         abortSignal,
         providerOptions: { gemma: { skillRouting: routing } },
+        tools: {
+          external_api: {
+            description: 'Call an external API with a city name and a unit system.',
+            inputSchema: z.object({
+              city: z.string().describe('city name'),
+              unit: z.enum(['metric', 'imperial']).describe('unit system'),
+            }),
+            execute: async ({ city, unit }) => ({ temp: 22, city, unit }),
+          },
+        },
       });
```
(Requires `example/package.json` to already have `zod`. If not, `cd example && npm i zod`.)
**Steps**:
1. Reload Metro.
2. Type `use external_api to look up weather in Tokyo in metric units` and tap **Send**.

**Expected**:
- Log line for `tool-input-start` (or `tool-call`) carries `parameters` with **both** `city: 'Tokyo'` and `unit: 'metric'` — proving the schema reached the model and the model produced correctly-keyed args.
- No `undefined` or missing keys.

**Cleanup**: Revert.

**Result**: [ ] Pass / [ ] Fail

### TC-19.F.3: `abortSignal` actually halts generation mid-stream
**Precondition**: Fresh conversation.
**In-code edit** (transient log inside `src/InferenceEngine.ts` — add one line to `stopGeneration`):
```diff
   async stopGeneration(): Promise<void> {
+    console.log('[TC-19.F.3] stopGeneration called');
```
**Steps**:
1. Reload Metro.
2. Type `write me a 500 word essay about ocean currents` and tap **Send**.
3. After the first few tokens stream in, tap **Stop** in the AI SDK tab routing bar.

**Expected**:
- Tokens stop arriving within ~1 s of tapping **Stop**.
- Log `[TC-19.F.3] stopGeneration called` appears.
- Send button returns from the spinner to the text `Send`.
- No further `text-delta` logs after the tap.

**Cleanup**: Remove the log line.

**Result**: [ ] Pass / [ ] Fail

### 19.G — Coexistence + collisions

### TC-19.G.1: Consumer-executed tool round-trip coexists with skills
**Precondition**: Fresh conversation. TC-19.F.2 `external_api` consumer-tool edit in place, plus the `[TC-19.B]` logger.
**Steps**:
1. Type `use external_api for London with metric units, then calculate 10 + 5` and tap **Send**.

**Expected**:
- Two tool cards: `tool: external_api` (consumer-executed — `state: output-available` with the object returned by the consumer `execute`), then `tool: calculator` (provider-executed — `providerExecuted: true` in logs).
- The `external_api` `tool-call` log line does **not** carry `providerExecuted: true`, and there is no matching `tool-result` log emitted by the adapter for that call (the consumer's `execute` produced it).
- Final text bubble references both pieces of info.

**Cleanup**: Revert.

**Result**: [x] Fail — BUG: consumer tool works individually (correct params, providerExecuted:false, execute runs, result returned), but chained consumer+skill in one turn fails. runToolLoop terminates on consumer tool with finishReason:'tool-calls'; streamText maxSteps:5 should re-invoke doStream for step 2 but doesn't. Only one start-step/finish-step in logs, no step 2. Needs investigation: either transport-pattern limitation in AI SDK or our provider's stream closing prevents multi-step re-invocation.

### TC-19.G.2: Name collision — consumer tool named `calculator` is dropped with a warning
**Precondition**: Fresh conversation.
**In-code edit** (`example/src/AiSdkChatTab.tsx` — register a consumer tool whose name collides with the built-in `calculator` skill):
```diff
+        tools: {
+          calculator: {
+            description: 'consumer override (should lose)',
+            inputSchema: z.object({ expr: z.string() }),
+            execute: async ({ expr }) => ({ bogus: true, expr }),
+          },
+        },
```
Also leave the `[TC-19.B]` logger in place so the `stream-start.warnings` array is visible.
**Steps**:
1. Reload Metro.
2. Type `what is 5 + 5?` and tap **Send**.

**Expected**:
- First `[TC-19.B]` log line is `type: 'stream-start'` with `warnings` containing a string mentioning `calculator` and "dropped" / "collision" (phrasing from `toolShapeBridge.separateProviderAndConsumerTools`).
- Tool card output is `10` (provider-executed skill wins). Not the consumer's `{ bogus: true }` shape.

**Cleanup**: Revert.

**Result**: [ ] Pass / [ ] Fail

### TC-19.G.3: Consumer-tool-only turn terminates after `tool-call` with no `tool-result`
**Precondition**: Fresh conversation. TC-19.F.2 `external_api` edit in place, **AI SDK** tab's `activeCategories` set to `[]` so no skills are offered:
```diff
-      providerOptions: { gemma: { skillRouting: routing } },
+      providerOptions: { gemma: { skillRouting: 'all', activeCategories: ['__none__'] } },
```
**Steps**:
1. Reload Metro.
2. Type `call external_api for Berlin in metric` and tap **Send**.

**Expected**:
- Logs: `tool-call` for `external_api` with `providerExecuted: false`, immediately followed by `finish` with `finishReason: 'tool-calls'`. No `tool-result` log emitted by the adapter for that call.
- The tab's tool card renders the consumer's returned object once the `useChat` round-trip re-invokes `sendMessages` (second pass).

**Cleanup**: Revert.

**Result**: [ ] Pass / [ ] Fail

### 19.H — `providerMetadata.gemma`

### TC-19.H.1: `providerMetadata.gemma` is populated on every `finish`
**Precondition**: Model loaded.
**In-code edit** (`example/src/AiSdkChatTab.tsx`, inside `makeGemmaTransport.sendMessages`, iterate `fullStream` and log the finish part):
```diff
-      return result.toUIMessageStream({ originalMessages: messages });
+      let lastFinish: any = null;
+      for await (const chunk of result.fullStream) {
+        if (chunk.type === 'finish') lastFinish = chunk;
+      }
+      console.log('[TC-19.H.1] providerMetadata.gemma:', JSON.stringify((lastFinish ?? {}).providerMetadata?.gemma));
+      return result.toUIMessageStream({ originalMessages: messages });
```
(Note: iterating `fullStream` consumes the stream. To also render in the UI, use `result.toUIMessageStream({ originalMessages })` before iterating; if the log block alone is enough for verification, you can leave the UI empty for this case.)
**Steps**:
1. Reload Metro.
2. Type `what is 234 * 567?` and tap **Send**.

**Expected**:
- Log contains a single JSON blob with shape:
  - `timings.promptMs > 0`
  - `timings.promptPerSecond > 0`
  - `timings.predictedMs > 0`
  - `timings.predictedPerSecond > 0`
  - `contextUsage.used > 0`
  - `contextUsage.total > 0`
  - `contextUsage.percent >= 0 && <= 100`
- The `percent` value matches (±1) the value shown on the **Chat** tab's context usage bar after the turn.

**Cleanup**: Revert logger.

**Result**: [ ] Pass / [ ] Fail

### 19.I — Coexistence with `useGemmaAgent`

### TC-19.I.1: Model stays loaded across tab switches
**Precondition**: Model loaded on **Chat** tab.
**Steps**:
1. Send `hello` from **Chat** tab; wait for response.
2. Switch to **AI SDK** tab; send `hello there`.
3. Switch back to **Chat** tab; send `what's 2 + 2?`.

**Expected**:
- All three turns produce responses. No `Loading model into memory...` log between them.
- `isModelLoaded` remains `true` throughout (subtitle reads `ready`).

**Result**: [x] Pass — all three turns responded, no model reload log, status stayed `ready`. AI SDK tab history clears on tab switch (expected: useChat local state unmounts).

### TC-19.I.2: Conversation histories are isolated per tab
**Precondition**: Fresh app launch; model loaded.
**Steps**:
1. On **Chat** tab: send `my name is Shashank`.
2. Switch to **AI SDK** tab: send `what is my name?`.
3. Switch back to **Chat** tab: send `what is my name?`.

**Expected**:
- Step 2: AI SDK tab does NOT know the name (replies with something like "I don't know" — its `useChat` history is independent).
- Step 3: **Chat** tab answers `Shashank` (orchestrator history preserved).

**Result**: [ ] Pass / [ ] Fail

### TC-19.I.3: Same skill works from either tab
**Precondition**: Model loaded.
**Steps**:
1. On **Chat** tab: `save a note titled alpha with content one`.
2. Switch to **AI SDK** tab: `read my note titled alpha`.

**Expected**:
- The AI SDK tab's `local_notes` tool card returns `one` — the underlying `KnowledgeStore` is shared (same instance passed to both tabs via `GemmaAgentProvider`).

**Result**: [ ] Pass / [ ] Fail

### 19.J — Polyfills + RN runtime smoke

### TC-19.J.1: Cold app start loads polyfills before any AI SDK import
**Precondition**: Kill the app entirely (swipe away from recents).
**In-code edit** (`example/polyfills.js`, append assertions at the bottom of the file):
```diff
+console.log('[TC-19.J.1] ReadableStream:', typeof global.ReadableStream);
+console.log('[TC-19.J.1] TextEncoderStream:', typeof global.TextEncoderStream);
+console.log('[TC-19.J.1] structuredClone:', typeof global.structuredClone);
```
**Steps**:
1. Reload Metro.
2. Cold-launch the example app.
3. Observe `adb logcat *:S ReactNativeJS:V` during splash.

**Expected**:
- Three log lines, each with `function` (or `object` for ReadableStream) — none print `undefined`.
- Lines appear before any `[TC-19.B]` log from a subsequent message.
- No red-screen error about `ReadableStream is not defined` or `TextEncoderStream is not a constructor`.

**Cleanup**: Remove the three log lines.

**Result**: [ ] Pass / [ ] Fail

### TC-19.J.2: `useChat` mounts and `streamText` resolves without a red screen
**Precondition**: Fresh cold start; model loaded on **Chat** tab.
**Steps**:
1. Switch to the **AI SDK** tab.
2. Type `hi` and tap **Send**.

**Expected**:
- No red screen on tab mount.
- `useChat()` placeholder renders, then the user's message bubble appears, then Gemma's response streams in.
- No uncaught promise rejection in logcat referencing `@ai-sdk/react`, `ChatTransport`, `toUIMessageStream`, or the polyfills.

**Result**: [x] Pass — cold launch (kill from recents, reopen), load model, AI SDK tab: no red screen, placeholder rendered, response streamed in.

---

## Phase 19 — Pass/fail tracker

| ID | Case | Pass |
|---|---|---|
| 19.A.1 | `prepare()` no-op when loaded | [x] |
| 19.A.2 | `prepare(path)` explicit load | [~] partial (load OK, UI placeholder needs forceRerender; harness gap) |
| 19.A.3 | `prepare()` ModelManager auto-load | [~] partial (same harness gap as A.2) |
| 19.A.4 | `prepare()` error with exact message | [x] |
| 19.B.1 | `stream-start` first, empty warnings | [x] |
| 19.B.2 | `text-start` precedes `text-delta` | [x] |
| 19.B.3 | Buffered `text-delta` flush (one token each) | [x] |
| 19.B.4 | `text-end` before `finish` | [x] |
| 19.B.5 | Reasoning part trio (enable_thinking) | [~] partial — adapter correct, Gemma 4 doesn't use DeepSeek `<think>` format; no reasoning_content from llama.rn |
| 19.B.6 | `tool-input-start` arrives early | [x] token leak + tool-error both fixed |
| 19.B.7 | `tool-input-delta` lines present | [x] delta with full JSON args between start/end |
| 19.B.8 | `tool-input-end` before `tool-call` | [x] |
| 19.B.9 | `tool-call` + `tool-result` pair (providerExecuted) | [x] same toolCallId call_0, both providerExecuted:true |
| 19.B.10 | `finish` terminal | [x] finish is last log line |
| 19.B.11 | `error` terminal on engine failure | [x] |
| 19.C.1 | calculator | [x] |
| 19.C.2 | query_wikipedia | [x] |
| 19.C.3 | web_search | [!] fail — SearXNG down, error handling correct, not an SDK bug |
| 19.C.4 | device_location | [x] |
| 19.C.5 | read_calendar | [x] |
| 19.C.6 | local_notes save + read | [x] |
| 19.D.1 | Wikipedia → notes chain | [x] after toolCallId dedup fix |
| 19.D.2 | Calculator → Wikipedia chain | [x] |
| 19.D.3 | Default maxChainDepth 5 terminates with fallback | [x] after fallback text-parts fix |
| 19.D.4 | maxChainDepth 2 override | [x] |
| 19.E.1 | `skillRouting: 'bm25'` narrows tools | [x] |
| 19.E.2 | `maxToolsPerInvocation` caps list | [ ] |
| 19.E.3 | `activeCategories` filter | [x] |
| 19.E.4 | `maxChainDepth` override (= 19.D.4) | [ ] |
| 19.F.1 | Live `tool-input-*` streaming | [ ] |
| 19.F.2 | `inputSchema` reaches model intact | [ ] |
| 19.F.3 | `abortSignal` stops generation | [x] |
| 19.G.1 | Consumer tool round-trip coexists | [x] after two fixes: (1) `stopWhen: stepCountIs(5)` (AI SDK v6 renamed maxSteps), (2) loopId in streamId to prevent cross-step ID collision |
| 19.G.2 | Name collision — skill wins + warning | [ ] |
| 19.G.3 | Consumer-only tool terminates turn | [ ] |
| 19.H.1 | `providerMetadata.gemma` populated | [ ] |
| 19.I.1 | Model stays loaded across tabs | [x] |
| 19.I.2 | Histories isolated per tab | [ ] |
| 19.I.3 | Same skill callable from either tab | [ ] |
| 19.J.1 | Polyfills loaded before AI SDK | [ ] |
| 19.J.2 | `useChat` mounts, `streamText` resolves | [x] |

---

## Phase 21 — Multi-model support

> Scope: the high-signal cases only. Catalog metadata and `resolveModelConfig()` correctness are covered by `src/__tests__/ModelRegistry.test.ts`. What unit tests cannot verify: does each model actually run end-to-end on device, does tool calling fire where the registry says it should, and do models with no tool calling degrade gracefully.
>
> Setup: every case starts from the app installed on a Pixel 8 / S23 class device, internet online, relevant GGUF already pushed to `/data/local/tmp/<filename>` (see TC-22.1 for the push step). Swap `MODEL_CONFIG` in `example/App.tsx` to the model under test (or resolve the registry ID through `resolveModelConfig`).

### TC-21.1: gemma-4-e2b-it answers and invokes one skill
**Precondition**: `MODEL_CONFIG` resolves to `gemma-4-e2b-it`. Model file present at `/data/local/tmp/gemma-4-E2B-it-Q4_K_M.gguf`. Skills loaded (calculator among them).
**Steps**:
1. Load model from the **Chat** tab.
2. Send `What is 234 * 567?`.

**Expected**:
- Response contains `132678`.
- Logs tab shows `Calling skill: calculator({"expression":"234*567"})` (or an equivalent arithmetic expression).
- Skill result appears before the final assistant bubble.

**Watch-outs / false-pass shapes**:
- Model answers `132678` from parametric memory without invoking the skill — `Calling skill: calculator` is MISSING. Fail the case: the point is to prove the skill path fires, not that Gemma can multiply.
- Tool-call JSON leaks into the visible chat bubble (`{"tool_call":...}` appears as assistant text). Fail: means the assistant-with-tool_calls content-stripping regressed.

**Result**: [x] Pass

### TC-21.2: qwen-3.5-4b reasoning trace stays out of the user-visible reply
**Precondition**: Qwen 3.5 4B GGUF pushed to `/data/local/tmp/Qwen3.5-4B-Q4_K_M.gguf`. `MODEL_CONFIG` resolves to `qwen-3.5-4b`. Provider/useLLM left at default system prompt.
**Steps**:
1. Load model.
2. Send `If a train leaves at 14:20 and arrives at 16:55, how long was the journey? Think step by step.`

**Expected**:
- Final assistant bubble contains a single answer (`2 hours 35 minutes` or equivalent) without a `<think>...</think>` block, without numbered "Step 1 / Step 2" scratch work, and without the raw CoT.
- `result.reasoning` is populated in the engine (visible via **Logs** if the log entry includes reasoning length, or via `engine.getInfo()` in a debug harness). The reasoning content is captured, not merely dropped.

**Watch-outs / false-pass shapes**:
- Chat bubble shows both the reasoning and the final answer concatenated. Fail: the reasoning-format stripping expected from `reasoningFormat: 'qwen'` regressed.
- Response is a single sentence `2h 35m` that skipped reasoning entirely — possible when Qwen's thinking mode is off by default in the chat template. Not an automatic fail, but inspect logcat for the reasoning field; if it's empty on every turn, the `enable_thinking` / `reasoning_format` passthrough in `InferenceEngine.generate` is not reaching the native layer.

**Result**: [x] Pass

### TC-21.3: smollm2-1.7b (no tool calling) chats and degrades gracefully on a tool-leaning prompt
**Precondition**: SmolLM 2 1.7B pushed to `/data/local/tmp/SmolLM2-1.7B-Instruct-Q4_K_M.gguf` (case-sensitive on Android). `MODEL_CONFIG` resolves to `smollm2-1.7b`. Registry entry has `toolCalling: false`.
**Steps**:
1. Load model.
2. From the **Chat** tab (agent mode, skills loaded) send `What is the current time in Mumbai?` — a prompt that would normally pull a skill.
3. Send a plain chat turn: `Tell me one short fact about Saturn.`

**Expected**:
- Step 2: model answers in prose (e.g. "I can't access live data"), does NOT emit a `tool_call` JSON, and the assistant bubble contains the prose reply. No skill invocation in **Logs**.
- Step 3: normal chat reply, single bubble, no tool-call artifacts.

**Watch-outs / false-pass shapes**:
- Model emits a literal `{"tool_call": {...}}` string in the chat bubble — means the assistant treats the tool schema as output instructions but the model can't actually emit tool calls. This was the Hammer 2.1 / Llama 1B failure mode. Fail.
- App crashes or stalls on the tool-leaning turn — the skill system should never receive a call from a `toolCalling: false` model. Fail.

**Result**: [x] Pass

---

## Phase 22 — Catalog hardening + pinned llama.rn

> Scope: prove the on-device discovery + download + verification flow works end-to-end. Unit tests cover `buildHuggingFaceUrl` and `assertChecksumMatches` as pure functions; the integration path (RNFS download, SHA-256 over the actual file, error surfacing) needs a real device.

### TC-22.1: adb-pushed GGUF is discovered without re-download
**Precondition**: Fresh install of the example app. `MODEL_CONFIG` resolves to `gemma-4-e2b-it`.
**Steps**:
1. On the dev machine: `npx react-native-gemma-agent pull gemma-4-e2b-it`. Let it verify SHA-256 and print the `adb push` hint.
   - **Pre-publish (before v0.3.0 is on npm)**: `npm run build && node lib/cli/pull.js pull gemma-4-e2b-it` from the repo root. Same behaviour, just bypasses the npm registry.
2. Run the printed `adb push <cache-path> /data/local/tmp/gemma-4-E2B-it-Q4_K_M.gguf`.
3. Open the app. From the **Chat** tab tap **Load Model** (not **Download**).

**Expected**:
- **Logs** tab shows `Model found at /data/local/tmp/` within ~200ms. No "Downloading" progress bar appears.
- Model load completes and the chat tab becomes interactive.
- No network egress during load (verify in Android Studio profiler if paranoid).

**Watch-outs / false-pass shapes**:
- App falls through to the download path even though the file is present — means `findModel()` missed the `/data/local/tmp/` fallback or the CLI wrote to the wrong filename.
- Model loads but the file at `/data/local/tmp/` is 0 bytes or truncated — means the `adb push` silently failed. Compare the on-device `stat` size against the CLI's cached file.

**Result**: [x] Pass

### TC-22.2: CLI downloads, verifies SHA-256, prints the push hint
**Precondition**: Clean `~/.cache/react-native-gemma-agent/` on the dev machine. Internet online.
**Steps**:
1. `rm -rf ~/.cache/react-native-gemma-agent/models/gemma-4-e2b-it/`.
2. Run `npx react-native-gemma-agent pull gemma-4-e2b-it`.
   - **Pre-publish (before v0.3.0 is on npm)**: `npm run build && node lib/cli/pull.js pull gemma-4-e2b-it` from the repo root.

**Expected**:
- Progress updates print on stderr or stdout (bytes / percent); the download lands at `~/.cache/react-native-gemma-agent/models/gemma-4-e2b-it/gemma-4-E2B-it-Q4_K_M.gguf`.
- After the download, a `SHA-256 OK` or equivalent success line appears (check the CLI's actual wording).
- Final output includes `adb push <absolute-cache-path> /data/local/tmp/gemma-4-E2B-it-Q4_K_M.gguf`.
- Exit code 0.

**Watch-outs / false-pass shapes**:
- CLI prints "done" but skips the SHA check (possible if the registry entry lost its `sha256` field in a refactor). Fail — the whole point of the hardening is tamper-evidence.
- URL in flight uses `/resolve/main/` instead of `/resolve/<commitSha>/` (visible in a network log). Fail — reproducibility guarantee broken.
- File is downloaded but is 0 bytes and the SHA check "passes" against a bogus empty-file hash. Fail — indicates the hash lookup regressed to an unrelated value.

**Result**: [x] Pass

### TC-22.3: Corrupted cache file is detected, partial is deleted, error is clear
**Precondition**: Run TC-22.2 first so the cache file exists.
**Steps**:
1. Corrupt the cache file: `dd if=/dev/urandom of=~/.cache/react-native-gemma-agent/models/gemma-4-e2b-it/gemma-4-E2B-it-Q4_K_M.gguf bs=1 count=16 seek=$(($(stat -f%z ~/.cache/react-native-gemma-agent/models/gemma-4-e2b-it/gemma-4-E2B-it-Q4_K_M.gguf) - 16)) conv=notrunc` (on macOS). (Goal: flip the last 16 bytes.)
2. Re-run `npx react-native-gemma-agent pull gemma-4-e2b-it`.

**Expected**:
- CLI either (a) detects the existing file's hash is wrong and re-downloads, or (b) redownloads unconditionally and then hits a mismatch on the fresh download only if the server bytes themselves drift (shouldn't happen with a pinned commit SHA). Either path ends clean.
- If the flow is configured to trust the cached file and the corruption is downstream, the subsequent `RNFS.hash` on the on-device copy will catch it. Either way, a SHA-256 mismatch surfaces with BOTH the expected and the actual hash in the error message. The partial / bad file is deleted from cache before exit.
- Exit code is non-zero on mismatch; zero on clean re-download.

**Watch-outs / false-pass shapes**:
- Bad file silently survives in the cache — means the delete-on-mismatch branch did not run.
- Error message shows only "SHA-256 mismatch" with no hex, so the user can't tell whether it's their corruption or a registry drift. Fail: the assertChecksumMatches contract requires both hashes.
- CLI re-downloads and overwrites without complaining, hiding the corruption — acceptable if and only if the post-download SHA verify still runs and passes against the pinned hash.

**Result**: [x] Pass — clean re-download path. dd flipped the last 16 bytes (SHA went `ac0069eb...576845` → `070ee985...8218152`), CLI detected the mismatch via `fileMatchesChecksum`, re-downloaded from `/resolve/f064409f.../`, printed `Verified SHA-256. Wrote 3106735776 bytes.`, final hash restored to `ac0069eb...576845`. Exit 0.

---

## Phase 23 — Structured output API

> Scope: the two paths consumers will actually exercise — the raw primitive and the Vercel `generateObject` adapter wiring. Unit tests cover schema detection, fence stripping, retry loop, and provider-side warning emission.

### TC-23.1: `generateStructured` with a Zod schema returns a validated object
**Precondition**: Model loaded on device. `zod` and `zod-to-json-schema` installed in `example/`. Add a debug button in `StructuredTab.tsx` (or temporarily in `App.tsx`) that calls:

```ts
import { z } from 'zod';
import { generateStructured } from 'react-native-gemma-agent';

const schema = z.object({
  title: z.string(),
  date: z.string(),
  attendees: z.array(z.string()).optional(),
});

const result = await generateStructured(engine, {
  schema,
  prompt: 'Dinner with Priya and Arjun on Saturday 8pm at Bombay Canteen',
});
console.log('[TC-23.1]', JSON.stringify(result));
```

**Steps**:
1. Trigger the debug call.
2. Inspect logcat (`adb logcat *:S ReactNativeJS:V`) and the on-screen result.

**Expected**:
- Log line contains `object: { title: "...", date: "...", attendees: [...] }` with sensible values pulled from the input text.
- `attempts` is `1` (native grammar decoding succeeded on the first try).
- No exceptions on the JS side; the call resolves within the usual generate timing.

**Watch-outs / false-pass shapes**:
- `attempts` is `2` or `3` on every run, suggesting the grammar decoding path isn't wired correctly and we're falling through to the retry-only fallback. Check that `response_format` is being forwarded in the completion call (logcat should show the native params).
- Result parses but `attendees` is missing/empty when the prompt explicitly names two people — means the model obeyed the schema but the prompt engineering isn't pulling required fields. Not an SDK bug, but note it.
- Throws "zod-to-json-schema not installed" despite the peer dep being present in `example/package.json` — means the lazy `require` path can't find the hoisted copy; bump the install location or fall back to `require.resolve` with explicit paths.

**Result**: [ ] Pass / [ ] Fail

### TC-23.2: Vercel `generateObject` round-trip through our provider
**Precondition**: Model loaded. `ai` and `zod` installed in `example/`. Provider wired via `createGemmaProvider`. Add a temporary button in `AiSdkChatTab.tsx`:

```ts
import { generateObject } from 'ai';
import { z } from 'zod';

const { object } = await generateObject({
  model: provider('gemma-4-e2b'),
  schema: z.object({
    cityName: z.string(),
    population: z.number(),
    country: z.string(),
  }),
  prompt: 'Give me basic facts about Mumbai.',
});
console.log('[TC-23.2]', object);
```

**Steps**:
1. Tap the debug button.
2. Watch logcat for the tagged line and confirm the on-screen state renders the object.

**Expected**:
- `object` has all three fields with correct types (`cityName: string`, `population: number`, `country: 'India'` or similar).
- Ollama-style finish reason mapping holds: the underlying provider call resolved with `finishReason.unified === 'stop'`.
- No `tools` warnings in the AI SDK response (we didn't pass any tools).

**Watch-outs / false-pass shapes**:
- `NoObjectGeneratedError` thrown despite the model producing plausible JSON — likely means our provider returned the raw JSON as a text content part, but the text contains a leading/trailing prose that fence-stripping missed. Inspect the raw text part in the AI SDK debug logs.
- `object.population` is a string ("20000000") because grammar constraints treated `number` as a JSON number but the model emitted it quoted; AI SDK's `safeValidateTypes` should fail in that case. Fail on our side only if the primitive's retry path also gave up — the AI SDK itself does not retry.
- Provider silently routes the call through `runToolLoop` (skills appear in the tool field). Fail: the `responseFormat === 'json'` branch in `doGenerate` was bypassed.

**Result**: [ ] Pass / [ ] Fail

---

## Regression Tests (Run Before Every Release)

| # | Test | Phase |
|---|------|-------|
| R1 | Model downloads and loads | 1 |
| R2 | Basic inference works | 0 |
| R3 | Multi-turn conversation | 0 |
| R4 | Wikipedia skill works — no LaTeX | 4-8, 11 |
| R5 | Calculator skill works offline | 4-8, 11 |
| R6 | Network check returns clean error offline | 4, 11 |
| R7 | No-skill conversation works | 5 |
| R8 | Chained skill calls work | 5 |
| R9 | App survives backgrounding | 9 |
| R10 | Chat UI streams tokens | 9 |
| R11 | Web search returns real results (SearXNG) | 11 |
| R12 | Offline blocks network skills, allows calculator | 11 |
| R13 | GPS returns city name + coordinates | 11b |
| R14 | Calendar returns device events | 11b |
| R15 | `npm test` passes (60 tests) | 14 |
