# ADR-005: Knowledge Base — Flat Index over RAG

## Status
Accepted (2026-04-14)

## Context
We needed persistent agent memory (saved answers, user preferences, learned facts) with zero cloud dependence. The industry default is RAG: embed chunks, store vectors, retrieve top-k on each turn. Research ("LLM Knowledge Bases", Karpathy) argues RAG is overkill below a certain scale and *less reliable* than injecting a flat index because the model sees the whole menu.

## Decision
Ship a **flat file-backed note store with a compact index injected into the system prompt**. No vectors, no RAG.

- One `.md` file per note in `{app-storage}/gemma-agent-notes/`.
- YAML frontmatter: `title`, `tags`, `created`, `modified`.
- `KnowledgeStore.getIndex()` returns `title + tags + first line` for every note, appended to the system prompt as `## Your Notes` when the `local_notes` skill is registered.
- Model decides when to fetch full content via the `local_notes.read` action.
- Search path: reuse `BM25Scorer` across title + body for `local_notes.search`.
- Guard: warn at 100 KB total (approaching prompt budget).

## Consequences

### Positive
- Deterministic recall — the model always sees that a note exists, even when BM25 fails.
- No vector DB, no embedding model, no index rebuilds.
- Debuggable via `ls` on a phone-side shell.
- Fully private — bytes never leave the device.

### Negative
- Scales to tens of notes, not thousands. Past ~100 KB, the index eats real context.
- Upgrading to RAG later means rewriting the retrieval path (acceptable — at that scale the user already benefits from richer recall).

### Risks
- Developers may pile notes in and hit the 100 KB guard in production. Mitigated by warning + future `archive` action.

## Alternatives Considered
| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Flat index in system prompt | Simple, reliable below 100 KB | Doesn't scale past tens of notes | **Chosen** |
| Vector RAG (on-device embeddings) | Scales to thousands of chunks | +23 MB model, indexing complexity, retrieval miss hides existence from model | Deferred |
| SQLite FTS5 | Mature full-text search | Native dep, still doesn't inject "what exists" into the model | Rejected |
| No persistence (conversation-only) | Zero work | Misses the primary user story ("remember that...") | Rejected |
