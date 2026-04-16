# ADR-003: Skill Sandbox — Hidden WebView Execution

## Status
Accepted (2026-04-08)

## Context
JS skills need to run arbitrary developer-authored code (HTTP calls, DOM-ish parsing, third-party APIs) without exposing the host app to that code's failures or polluting the React Native JS runtime. We needed an isolation model that:
- Works on Android (iOS later)
- Supports async skill execution with timeouts
- Has zero native module authoring cost
- Matches a pattern the community already understands

## Decision
Execute JS skills inside a **hidden `react-native-webview`** using the protocol from Google AI Edge Gallery's Agent Skills:

1. `SkillSandbox` mounts a single `WebView` with `style={{ width: 0, height: 0 }}`.
2. Skill HTML is injected; a bridge script calls `window['ai_edge_gallery_get_result'](params)`.
3. Result is posted back via `ReactNativeWebView.postMessage`.
4. `SkillSandbox.execute(html, params, timeout)` returns a promise keyed by a request id.
5. WebView config: `domStorageEnabled={false}`, `incognito`, no file access — fresh JS context per execution.

Return types: `{ result }`, `{ result, image }`, `{ error }`. Default timeout 30s, configurable per skill.

## Consequences

### Positive
- True JS isolation — a skill crash can't take down the host app's JS thread.
- Full `fetch`/`URL`/`crypto` available without native work.
- Pattern lift from Google AI Edge Gallery — developers porting skills across ecosystems can reuse code.
- No supply-chain surface: skill code never joins the host bundle.

### Negative
- ~50ms WebView startup per execution (acceptable for agent loops).
- Single WebView is serialized — no parallel skill exec in v0.1/0.2 (rare in practice; agent calls skills sequentially).
- Adds `react-native-webview` as a peer dependency.

### Risks
- `react-native-webview` API changes could break the bridge.
- Memory leaks if the bridge doesn't clear request handlers — mitigated by timeout-driven cleanup.

## Alternatives Considered
| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Hidden WebView (AI Edge Gallery pattern) | Isolated, battle-tested pattern, no native code | Startup cost, single-threaded | **Chosen** |
| `eval()` / `Function` constructor in JS thread | Fastest | No isolation; skill crash crashes host | Rejected |
| Native sandbox (Hermes snapshot / JSI isolate) | Theoretically ideal | Massive native effort, Android/iOS parity nightmare | Rejected |
| Remote execution (serverless functions) | Full sandbox | Kills "on-device" value prop | Rejected |
