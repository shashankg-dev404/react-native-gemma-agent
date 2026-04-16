# ADR-004: Skill Routing — BM25 Pre-filter (Opt-in)

## Status
Accepted (2026-04-12)

## Context
Research shows tool-call accuracy collapses as the tool count grows: ~95% at 50 tools, 41–83% at 200. Each tool definition costs ~50–100 tokens in our 4096-token context, capping naive "load all tools" at ~10–15 skills. We need routing so developers can register many skills without torching the context window — but we also don't want to ship a 23 MB embedding model in the MVP.

## Decision
Ship **BM25** (term-frequency / IDF with length normalization) as an **opt-in** pre-filter. Pure math, ~100 lines of TypeScript, zero dependencies, zero model weights.

- Scores each skill's `name + description + parameter descriptions` against the user's query.
- Top-N (default 5) sent to the inference engine per invocation.
- Config: `agentConfig.skillRouting: 'all' | 'bm25'` (default `'all'`); `maxToolsPerInvocation: number`.
- Composes with skill categories (category filter first, BM25 ranks within active categories).

## Consequences

### Positive
- Zero-cost default: BM25 only runs when opted in; unchanged behavior otherwise.
- Tokenization is simple whitespace + lowercase — no stemmer, no locale footguns.
- Deterministic and debuggable — developers can log the ranked list.
- Scales to hundreds of skills with negligible latency (<1ms).

### Negative
- Lexical matching misses semantic intent ("book a cab" won't match a skill named `ride_hailing`).
- Developers must write descriptive skill names/descriptions; sparse metadata = poor ranking.

### Risks
- False negatives silently drop the right skill. Mitigated by shipping semantic vector routing as a follow-up (see roadmap), not by inflating the MVP.

## Alternatives Considered
| Option | Pros | Cons | Verdict |
|---|---|---|---|
| BM25 (opt-in) | Tiny, fast, interpretable | Lexical only | **Chosen** |
| Always-on semantic embeddings (MiniLM) | 97%+ accuracy | Ships 23 MB model, inference cost per query | Deferred to v0.4+ |
| LLM-based router ("pick tools from this list") | High accuracy | Extra inference pass — 2× latency | Rejected |
| No routing (status quo) | Simple | Breaks past ~15 skills | Rejected as scale story |
