---
id: TASK-381
title: IpodAdapter portable-tag-write result type — doc-041 §3.2/Q4
status: Done
assignee: []
created_date: '2026-06-03 09:09'
updated_date: '2026-06-06 10:14'
labels:
  - enhancement
  - save-transaction
  - ipod
  - error-handling
  - json-output
dependencies:
  - TASK-142
references:
  - packages/podkit-core/src/device/ipod-adapter.ts
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
modified_files:
  - packages/podkit-core/src/sync/engine/types.ts
  - packages/podkit-core/src/sync/engine/errors.ts
  - packages/podkit-core/src/sync/engine/error-handling.ts
  - packages/podkit-core/src/sync/engine/error-handling.test.ts
  - packages/podkit-core/src/sync/engine/executor.ts
  - packages/podkit-core/src/sync/engine/planner.ts
  - packages/podkit-core/src/sync/engine/content-type.ts
  - packages/podkit-core/src/sync/engine/diff-utils.test.ts
  - packages/podkit-core/src/sync/music/pipeline.ts
  - packages/podkit-core/src/sync/music/pipeline.test.ts
  - packages/podkit-core/src/sync/music/handler.ts
  - packages/podkit-core/src/sync/music/handler.test.ts
  - packages/podkit-core/src/sync/music/artwork.ts
  - packages/podkit-core/src/sync/music/transfer.ts
  - packages/podkit-core/src/device/adapter.ts
  - packages/podkit-core/src/device/ipod-adapter.ts
  - packages/podkit-core/src/device/ipod-adapter.integration.test.ts
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/device/mass-storage-adapter.test.ts
  - packages/podkit-core/src/device/mass-storage-tag-writer.ts
  - packages/podkit-core/src/adapters/interface.ts
  - packages/podkit-core/src/adapters/subsonic.ts
  - packages/podkit-core/src/index.ts
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-cli/src/commands/music-presenter.ts
  - packages/podkit-cli/src/commands/sync-presenter.ts
  - packages/podkit-cli/src/types.ts
  - packages/demo/src/mock-core.ts
  - test-packages/e2e-tests/src/matrix/artwork-rules.ts
  - test-packages/e2e-tests/src/workflows/mixed-formats.test.ts
  - documents/architecture/sync/error-handling.md
priority: low
ordinal: 107000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`doc-041 §3.2`: `IpodAdapter.save()` warns to stderr on tag-write failure, while `MassStorageAdapter.save()` throws `TagWriteError`. The asymmetry is principled (different sources of truth) but the warn is silent in the JSON output and discoverable only via stderr scraping.

## Scope

1. Change `IpodAdapter.save()` to return a typed result rather than `void` — `{ portableTagWarnings: string[] }`.
2. Surface those warnings in `SyncOutput` (the `--json` payload) so consumers can pin them.
3. CLI: render the warning count in the summary line (`"3 portable-tag writes failed (run with -vv for details)"`).
4. Keep the stderr warn as a fallback for CLI users not consuming JSON.

## Open question (Q4 in doc-041)

Should the typed result let CALLERS decide whether to throw? Today's CLI would still treat them as warnings; a daemon could choose to retry. Probably yes — keep it data, not flow.

## Reference

`doc-041` §3.2, Q4 in §8.
<!-- SECTION:DESCRIPTION:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Resolved by a larger error-handling architecture sweep (doc-041 §3.2 + Q4) rather than a localised iPod-adapter result-type change.

## What landed (vs. original scope)

Original scope was narrow: change `IpodAdapter.save()` to return `{ portableTagWarnings: string[] }` so JSON consumers could see what stderr was silently dropping. Discussion expanded scope to fix the underlying boundary problems:

- Two parallel `Warning` types (planning vs. execution)
- Substring-keyword error categorization (~60 lines of fragile string-matching)
- `console.warn` from inside a core adapter
- Half-built `addWarning` callback plumbing that varied across modules

## Three-phase refactor

**Phase 1 — Unified `Warning` type.** Killed `SyncWarning` + `ExecutionWarning` split. Single `Warning { phase, type, message, tracks: WarningTrackRef[] }` + `WarningSink` interface. CLI `planWarnings` + `executionWarnings` JSON fields collapsed into one `warnings` array. Wired pipeline's execute-phase warnings through to the real-run JSON output — they were silently dropped before (latent bug closed).

**Phase 2 — `CategorizedSyncError` + typed errors.** New `packages/podkit-core/src/sync/engine/errors.ts` with abstract base class. `TagWriteError`/`SidecarWriteError` extend it; added `PictureWriteError`, `MoveError`, `DatabaseWriteError`. `categorizeError` shrank from ~60 lines of substring matching to ~10 lines (`instanceof` + op-type fallback). Picture-write stage in `MassStorageAdapter.save()` normalized from `Promise.all` fail-fast → `runWithConcurrency` + aggregate + typed error + clear-before-throw (closes doc-041 §3.1). Move stage wraps raw fs errors in `MoveError`. `IpodAdapter` wraps libgpod failures in `DatabaseWriteError` at `save()`, `addTrack`, `updateTrack`, `removeTrack` — the mutator wraps are a correctness fix (without them, libgpod errors would categorize as 'copy' via op-type fallback and retry once, instead of 'database' / no retry).

**Phase 3 — `WarningSink` plumbing.** `DeviceAdapter.setWarningSink?(sink)` optional method. `MusicPipeline` injects its accumulator sink into the adapter at execute start. `IpodAdapter` portable-mode tag-write warnings (formerly two `console.warn` calls) now emit through the sink as typed `'tag-write'` warnings with structured track refs. `MusicArtworkManager` switched from raw callback to `WarningSink` for symmetry. `console.warn` removed from core.

## Original ask (Q4 in doc-041)

> Should the typed result let CALLERS decide whether to throw? Today's CLI would still treat them as warnings; a daemon could choose to retry. Probably yes — keep it data, not flow.

Resolved as **data, not flow** — `WarningSink` is the data channel. Hard failures throw typed errors; soft signals emit to the sink. Caller (pipeline) accumulates both into `ExecuteResult` and lets the CLI surface them.

## Documentation

`documents/architecture/sync/error-handling.md` — first of a planned architecture series. Describes the two-channel model (typed errors / sink), the `CategorizedSyncError` hierarchy, responsibility boundaries (adapter / handler / pipeline / CLI), and conventions for new adapters.

## Doc-041 entries closed

- §3.1 — picture-write normalization
- §3.2 — adapter symmetry: surface shape now typed at the contract
- §3.5 — picture-write clear-then-throw matches tag-write convention
- §9 future tasks: "IpodAdapter `IpodPortableTagWriteResult` typed return" (the original Q4 ask) + "Picture-write `Promise.all` → `runWithConcurrency` normalization + typed `PictureWriteError`"

## Tests

All unit (2897 pass, 0 fail) + integration (69 pass, 0 fail) green. New coverage:
- `error-handling.test.ts` — each typed-error subclass + categorizer contract
- `ipod-adapter.integration.test.ts` — sink emission shape, default no-op sink path
- `mass-storage-adapter.test.ts` — picture-write collect-and-aggregate + clear-before-throw (replaces the prior tests that pinned the fail-fast smell)

## Open follow-ups (noted in architecture doc §7)

- `MassStorageAdapter` doesn't implement `setWarningSink` yet — interface accepts (optional method, no emit sites yet). Add a stub when first warning emission lands.
- Sidecar flush stage still uses bare `Promise.allSettled` with no concurrency cap. Normalize to `runWithConcurrency` for EMFILE safety and §7.1 symmetry.
<!-- SECTION:FINAL_SUMMARY:END -->
