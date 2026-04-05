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

## Regression Tests (Run Before Every Release)

| # | Test | Phase |
|---|------|-------|
| R1 | Model downloads and loads | 1 |
| R2 | Basic inference works | 0 |
| R3 | Multi-turn conversation | 0 |
| R4 | Wikipedia skill works | 4-8 |
| R5 | Calculator skill works offline | 4-8 |
| R6 | Skill timeout handled | 4 |
| R7 | No-skill conversation works | 5 |
| R8 | Chained skill calls work | 5 |
| R9 | App survives backgrounding | 9 |
| R10 | Chat UI streams tokens | 9 |
