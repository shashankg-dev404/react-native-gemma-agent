# ADR-008: llama.rn Version Pinning and Catalog Hosting

## Status
Accepted (2026-04-16)

## Context

Two adjacent decisions, handled as one ADR because they show up together whenever someone asks "why does this SDK work this way":

1. **Which `llama.rn` range does the SDK support?** A loose pin causes silent regressions on Gemma 4 (chat-template parsing, streaming slot reuse). A strict pin blocks consumers from picking up legitimate upstream fixes.

2. **Where do model bytes live?** The registry currently ships as seven `ModelRegistryEntry` records pointing at HuggingFace. The v0.3.0 catalog hardening work forced a decision on whether those bytes should continue to come from upstream HF authors or move under SDK-owned hosting.

Relevant input gathered 2026-04-16:

- `llama.rn` release timeline (via `gh api repos/mybigday/llama.rn/releases`):
  - `0.12.0-rc.8` (2026-04-13) syncs llama.cpp to b8771 — the Gemma-4-stable snapshot per upstream consensus.
  - `0.12.0-rc.7` fixed `slot_manager pending work`, which had caused streaming reliability regressions for long generations.
  - `0.12.0-rc.2` fixed `TranslateGemma content parts`, the actual Gemma-4 chat-template fix.
  - `0.11.5` is the latest non-RC but predates Gemma 4 entirely.
- HuggingFace anonymous rate limit is 3000 resolvers/IP/5min, per the public HF rate-limits doc. One model download equals one resolver hit. Community forum reports of 5TB unauthenticated downloads with no measurable slowdown.
- Peer SDKs (`react-native-executorch`, `llama.rn` examples, `@react-native-ai/llama`, `transformers.js`) all reference HF directly; none host bytes.
- GitHub Releases has a 2GB/asset cap — fatal for Gemma 4 E4B (5.3GB), E2B Q4_K_M (3.1GB), Qwen 4B (2.7GB), Llama 3B (2.0GB) before even counting headroom.
- Google Drive has a per-file anonymous quota around 25GB/day and redirect-link URLs that are hostile to programmatic clients.

## Decision

### 1. Pin `llama.rn` to `>=0.12.0-rc.8 <0.13.0`

Peer dependency in `package.json`:

```json
"llama.rn": ">=0.12.0-rc.8 <0.13.0"
```

Rationale:

- `rc.8` is the earliest build that carries both Gemma-4-specific fixes (`TranslateGemma content parts` from rc.2) and the streaming reliability fix (`slot_manager pending work` from rc.7), and syncs llama.cpp to b8771.
- The upper bound `<0.13.0` catches the next minor-version sync that may change the native module surface without a migration path.
- `0.11.5` is not an option: it predates Gemma 4 and is incompatible with Gemma-4 chat templates.

### 2. The catalog references, it does not host

`ModelRegistryEntry` now pins `commitSha` and `sha256`. Download URLs become `/resolve/{commitSha}/{filename}`, giving reproducibility (commit SHA) and integrity (SHA-256 from the LFS `oid` published in the HF tree API).

The SDK stays a catalog/convention layer. The bytes belong to the model authors on HuggingFace. Developers shipping their own quants pass a custom `ModelConfig` with `repoId`, `filename`, `commitSha`, and `checksum` — their infrastructure, their choice.

## Consequences

### Positive
- Reproducible downloads. A catalog entry resolves to the exact bytes we tested against, not whatever the HF `main` branch looks like today.
- Tamper-evident downloads. `ModelManager.download()` verifies SHA-256 after the transfer; on mismatch the partial is deleted and the error surfaces to the consumer.
- Zero hosting cost. Zero infrastructure ownership. Zero bandwidth surprises.
- `npx react-native-gemma-agent pull <id>` gives developers a one-time download + `adb push` flow that cuts fresh-install iteration from multi-gigabyte re-download to one push per device.
- Consumers of the SDK get a single, current `llama.rn` target — no "works on rc.4, crashes on rc.5" bug reports.

### Negative
- A model author can retag their repo (or delete a commit) and break our catalog entry without warning. Mitigation: the `commitSha` pin makes this a 404 rather than a silent content change, and the `sha256` catches any surviving drift.
- HF outages propagate directly to SDK consumers. Historical reliability in this space has been high enough that adding a CDN layer for free users is a net negative.
- Llama 3.2 community re-hosts we reference are not gated today, but any future upstream that is gated (or any repo that flips to gated) will require the consumer to supply an HF token. The CLI documents this via its 401/403 error message; `ModelManager.download()` surfaces the raw HTTP status to the caller.

### Risks
- Pinning to an rc tag means consumers' lockfiles carry `-rc.8`. If `llama.rn` 0.12.0 (stable) ships with breaking changes we'll need a bump ADR, not a silent upgrade.
- If HF changes its LFS `oid` semantics (currently SHA-256) the integrity check stops working. Low probability, easy to detect.

## Alternatives Considered

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| Keep `llama.rn >=0.12.0-rc.3` | No consumer lockfile churn | rc.3 predates the Gemma-4 chat-template fix (rc.2 is correct on its own, but rc.3 was a sync-only release that regressed nothing but also fixed nothing extra); rc.3 also predates the streaming reliability fix | Rejected |
| Pin to `0.11.5` (latest non-RC) | Sounds stable | Predates Gemma 4 entirely — the SDK's headline model doesn't work | Rejected |
| Self-host GGUFs on GitHub Releases | Obvious for OSS projects | 2GB/asset cap breaks 4 of 7 catalog entries immediately; prior failures observed in this project | Rejected |
| Self-host on Cloudflare R2 / Backblaze B2 | Control over uptime | Adds infra ownership, billing relationship, DMCA surface, operational burden — all for zero measurable reliability upside over HF | Rejected |
| Self-host on Google Drive | "It's free" | 25GB/day per-file anonymous quota; redirect-link URLs fight programmatic clients; not designed for this workload | Rejected |
| Reference HF with `/resolve/main/` (unpinned) | Simple | Non-reproducible; a silent reupload by the model author changes what consumers get | Rejected (was the v0.2 behavior) |
| **Reference HF with `/resolve/{sha}/{filename}` + SHA-256 verify** | Reproducible, tamper-evident, no infra | Depends on HF availability | **Chosen** |

## Escape hatch

The catalog is a convenience, not a requirement. Any `ModelConfig` accepted by `useModelDownload` / `ModelManager`:

```ts
{
  repoId: 'my-org/my-custom-GGUF',
  filename: 'my-quant.gguf',
  commitSha: '<optional>',
  checksum: '<optional sha256>',
  expectedSize: 1_234_567_890,
}
```

Developers hosting models on their own R2, S3, or mirrored HF repo keep full control. Only the seven catalog entries live under SDK ownership, and those rely on the upstream authors.
