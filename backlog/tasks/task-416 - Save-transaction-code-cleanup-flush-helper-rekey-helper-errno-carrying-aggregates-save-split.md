---
id: TASK-416
title: >-
  Save-transaction code cleanup: flush helper, rekey helper, errno-carrying
  aggregates, save() split
status: Done
assignee: []
created_date: '2026-06-09 08:34'
updated_date: '2026-06-09 14:04'
labels:
  - enhancement
  - refactor
  - save-transaction
  - mass-storage
  - error-handling
dependencies:
  - TASK-377
references:
  - packages/podkit-core/src/device/mass-storage-adapter.ts
  - packages/podkit-core/src/device/mass-storage-tag-writer.ts
  - packages/podkit-core/src/sync/engine/errors.ts
  - packages/podkit-core/src/sync/engine/error-handling.ts
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
  - documents/architecture/sync/save-transactions.md
priority: medium
ordinal: 131000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

TASK-377 closure surfaced four post-landing cleanups in the save-transaction code. Behaviour is correct (TASK-381 normalized the picture-write stage to mirror tag writes); the code-shape can converge to match.

## Scope

### 1. `flushPending<K,V>` helper

Stages 2/3/4 of `MassStorageAdapter.save()` (tag writes, picture writes, sidecar writes — `mass-storage-adapter.ts:1427-1533`) duplicate the same 18-line shape:

```
collect entries → runWithConcurrency → clear map → loop settled → build causes → throw typed error
```

Extract:

```ts
private async flushPending<K, V>(
  map: Map<K, V>,
  work: (key: K, value: V) => Promise<void>,
  formatCause: (key: K, msg: string, errno: string | undefined) => string,
  ErrorCtor: new (causes: readonly Cause[]) => CategorizedSyncError,
  concurrency: number,
): Promise<void>
```

Each caller becomes ~3 lines. Stage 1 (moves) stays bespoke — fail-fast, ENOENT-skip, sub-warning emission — see doc-041 §3.5 "Move-stage asymmetry intentional".

### 2. `rekeyPendingWrites(oldPath, newPath)` helper

`relocateTrack` (`:965-974`) and `replaceTrackFile` (`:1219-1247`) each manually re-key `pendingTagWrites` + `pendingPictureWrites`. Six near-identical blocks. `replaceTrackFile` additionally re-keys `pendingSidecarWrites` on album-dir change; `relocateTrack` skips it with a "TODO if cross-album-dir relocate appears" comment.

Encapsulate. The asymmetry becomes explicit (one method handles all three) or gets fixed (both callers handle the same set).

### 3. Errno-carrying aggregate errors

`CopyError` (`mass-storage-tag-writer.ts:265`) carries `errorCode: string | undefined` so the categorizer can one day route `ENOSPC` → `'space'`. `TagWriteError`/`PictureWriteError`/`SidecarWriteError`/`MoveError` fold errno into message strings — lost.

Today: mid-save tag-write `ENOSPC` categorizes as `'copy'` (1 wasted retry) instead of `'space'` (no retry).

Change shape from `causes: readonly string[]` to:

```ts
causes: readonly { path: string; message: string; errno: string | undefined }[]
```

Categorizer extended: if any cause carries `ENOSPC`, the aggregate categorizes as `'space'`. Otherwise stage's declared category (`'copy'`) wins.

### 4. Split `save()` per stage

`save()` is 220 lines with five flush stages. Extract:
- `flushMoves()`
- `flushTagWrites()` (uses #1)
- `flushPictureWrites()` (uses #1)
- `flushSidecarWrites()` (uses #1)
- `writeManifest()`

`save()` becomes the orchestration shell.

## Out of scope

- Move-stage `runWithConcurrency` normalization (intentionally fail-fast — see save-transactions.md §asymmetries).
- Daemon-mode "throw-then-clear" question (doc-041 §8 Q3 — separate decision).
- Per-stage progress events (doc-041 §8 Q1 — separate).
- Cross-aggregate "carry the original Error not a string" refactor — bigger surface, separate PR if/when desired.

## References

- `doc-041` §3.1 (closed) / §3.5 (asymmetries) / §7.1 (convention).
- `documents/architecture/sync/save-transactions.md` (per-stage shape).
- `documents/architecture/sync/error-handling.md` (categorizer contract).
- `mass-storage-adapter.ts:1329-1555` (save()).
- `mass-storage-tag-writer.ts:188-283` (aggregate errors + CopyError pattern).

## Acceptance criteria captured below.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 #1 `flushPending<K,V>` helper extracted; tag-write / picture-write / sidecar-write stages each <= 5 lines at the callsite; behaviour unchanged (existing pinning tests + matrix cells stay green)
- [x] #2 #2 `rekeyPendingWrites(oldPath, newPath)` private method encapsulates all pending-map re-keying; `relocateTrack` and `replaceTrackFile` call it; sidecar album-dir re-key handled in both callers (no caller-specific gap)
- [x] #3 #3 Aggregate errors (`TagWriteError`/`PictureWriteError`/`SidecarWriteError`/`MoveError`) carry per-cause errno; categorizer routes any `ENOSPC` cause to `'space'` category (no retry); unit tests pin the routing for each error type
- [x] #4 #4 `save()` split into `flushMoves` / `flushTagWrites` / `flushPictureWrites` / `flushSidecarWrites` / `writeManifest` private methods; `save()` body is the orchestration shell (<= 30 lines)
- [x] #5 #5 Doc updates: `doc-041 §3.1` (acknowledge code-shape convergence), `save-transactions.md` (document the flush-helper shape + errno-routing convention), `error-handling.md` (add the errno-on-aggregate convention)
- [x] #6 #6 Full unit suite green (no regressions); host artwork + save-failure matrices unchanged
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## What landed

Four-item save-transaction code cleanup; net +971/-367 across 12 files; 3093 tests pass / 5 skip / 0 fail; typecheck clean across podkit-core, podkit-cli, demo. Behavioural change is limited to ENOSPC routing: any `CategorizedSyncError` carrying an `ENOSPC` errno on `structuredCauses` now routes to category `'space'` (no retry) instead of the class's declared `'copy'` (1 wasted retry). Everything else is structural.

### #1 `flushPending<K, V>` helper

`packages/podkit-core/src/device/mass-storage-adapter.ts:1467-1500`. Stages 2/3/4 (`flushTagWrites` / `flushPictureWrites` / `flushSidecarWrites`) each ~10 lines, all delegating to the shared helper for the `runWithConcurrency` cap + settle-all + clear-before-throw + `ErrorCause[]` construction. ~60 lines of triplicate boilerplate collapsed to ~25 + three thin per-stage methods.

### #2 `rekeyPendingWrites(oldPath, newPath)` helper

`mass-storage-adapter.ts:830-859`. Single point of truth for re-keying `pendingTagWrites` + `pendingPictureWrites` (file-path keyed) plus `pendingSidecarWrites` (album-dir keyed) plus the `managedFiles` sidecar entry. Called by `relocateTrack` and `replaceTrackFile`. Both call sites previously inlined the same dance; the helper closes the consistency gap (relocateTrack used to skip the sidecar branch in some paths) and makes a hypothetical 4th pending map a one-line addition rather than two more copies.

### #3 Errno-carrying aggregate errors

New `ErrorCause { path, message, errno }` type at `packages/podkit-core/src/sync/engine/types.ts`. `CategorizedSyncError` base now carries optional `structuredCauses: readonly ErrorCause[]` alongside the existing `causes: readonly string[]` (the `--json` wire format stays string-typed — `ErrorInfo.causes` at `packages/podkit-cli/src/commands/sync.ts:165` unchanged). `TagWriteError`/`PictureWriteError`/`SidecarWriteError`/`MoveError`/`CopyError` constructors take `ErrorCause[]` and populate both channels in lockstep. Two shared helpers `errnoOf` + `toErrorCause` in `engine/errors.ts` keep the errno extraction in one place.

Categorizer at `engine/error-handling.ts` adds the `hasEnospc` override: any cause with `errno === 'ENOSPC'` short-circuits to `'space'` before reading the class's declared category. Matrix prediction at `test-packages/e2e-vm-tests/src/matrix/save-failure-rules.ts:520` updated from `errorCategory: 'copy'` → `'space'` to match.

### #4 `save()` per-stage split

`save()` is now a 7-line orchestration shell (`flushMoves` → `flushTagWrites` → `flushPictureWrites` → `flushSidecarWrites` → `writeManifest`). Each stage lives in its own private method; `cleanupEmptyParentDirs` extracted from the old move loop for re-use.

### Tests

- `error-handling.test.ts`: existing typed-error tests updated to `ErrorCause[]` shape (8 tests); new "ENOSPC override" describe block with 7 tests covering each aggregate + mixed-cause + no-structuredCauses fallthrough.
- `mass-storage-adapter.test.ts`: 4 new tests pinning `rekeyPendingWrites` contract (tag-write follows relocate, picture follows relocate, sidecar follows cross-album-dir relocate + manifest update, intra-album-dir no-op). 1 new test pinning the end-to-end ENOSPC wiring (`adapter.save()` → `TagWriteError.structuredCauses[0].errno === 'ENOSPC'` → `categorizeError` returns `'space'`).
- CopyError tests: assert both `causes[0]` string and `structuredCauses[0]` shape; pin `errorCode` continuity.

### Docs

- `documents/architecture/sync/save-transactions.md`: stage 4 table row corrected (`runWithConcurrency`, not `Promise.allSettled`); §2 gains "flushPending shared helper" prose + "Errno on aggregate errors" subsection; §6 open-work reorg (settled work moved to "closed", new entries added for daemon-mode + per-stage progress); ADR-018 status updated from "pending" to "landed".
- `documents/architecture/sync/error-handling.md`: §2 documents the dual-channel cause model + the ENOSPC override; categorizer "two rules" → "three rules" snippet rewritten; §5 conventions for new adapters gains "carry errno on per-entry causes" item; §7 dead "MassStorageAdapter doesn't implement setWarningSink" entry removed (it does now).
- `backlog/docs/doc-041`: §3.1 closure note expanded to credit TASK-416 alongside TASK-381; §6 "Recently closed" gains four new entries (flushPending, rekey, structuredCauses, save() split).

### Process

Pre-impl sonnet design review caught the JSON-envelope-break risk and steered the design to keep `causes: readonly string[]` on the base class as the wire-stable channel, with `structuredCauses` as an optional in-process detail. Mid-impl sonnet diff review caught: (a) `errnoOf` vs inline duplication across three sites — collapsed to one shared `toErrorCause(path, reason)` helper exported from `engine/errors.ts`; (b) `MoveError` throw site still inlining errno extraction — now also calls `toErrorCause`; (c) demo `mock-core.ts` `CategorizedSyncError` signature drift — added explanatory header comment + `hasEnospc` stub so the demo stays lower-fidelity-but-honest about it; (d) one pre-existing bug in `flushMoves` (vanished-track ref uses `newPath` not `oldPath` as map key, always misses) — filed as TASK-417 to keep this PR pure.

### Verification

- `bun run test`: 54/54 workspace tasks green.
- `bun run test --filter @podkit/core`: 3093 pass / 5 skip / 0 fail (was 3075 before; +18 tests).
- `bunx tsc --noEmit` clean across podkit-core, podkit-cli, demo.
- E2E save-failure matrix prediction updated; VM run pending next harness pass (drift cell now predicts `errorCategory: 'space'`).

## Post-VM-test fixes (after handoff)

Running `bun run test:vm` on the new binary surfaced two pre-existing latent issues directly exposed by the ENOSPC routing change. Both folded into this PR because they're symptoms of the routing change, not separate bugs.

1. **`copyTrackFile` catch missed `pendingTagWrites` + `pendingPictureWrites`** (`mass-storage-adapter.ts:1059-1064`). Old behaviour masked it: `CopyError` retried once via `'copy'`, the retry often succeeded, and the stale pending tag-write never fired against a missing file. New `'space'` routing skips the retry → the stale tag write fires during `save()` → ENOENT lands as a second classification next to the original CopyError. Fix: extend rollback to delete the failed track's entries from both pending maps. Sidecar map is album-dir-keyed and shared across siblings, so explicitly NOT cleared. Pinned by a new test at `mass-storage-adapter.test.ts` ('copyTrackFile rollback also drops pending tag + picture writes for the failed path').

2. **Matrix harness regex missed the `'space'` category** (`test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts:663,668`). The verbose-output parser's `[<category>]` alternation didn't include `space` — so any cell whose error category was `'space'` parsed as `firstError = undefined`, making `observed.errorCategory === null`. Fix: add `space` to the regex alternation (both call sites via `replace_all`). The `SaveFailExpected` type already had `'space'` in its `ErrorCategory` union from TASK-412.

### VM verification

- `bun run --cwd test-packages/e2e-vm-tests test:vm -- --test-name-pattern 'save-failure'`: 27 pass / 42 skip / 0 fail. Both ENOSPC cells (drift + post-sweep) GREEN with the new routing.
- Full `bun run test:vm`: 35 pass / 3 fail. The 3 remaining failures are pre-existing `personas-baseline.e2e.test.ts` `'healthy'` SystemState cells — fixture asserts `inquiry-methods: warn` but the harness VM has `/dev/sg*` nodes, so doctor correctly reports `pass`. Pre-dates TASK-416 entirely; filed as TASK-418.

## VM fully green

`bun run test:vm`: 20/20 turbo tasks GREEN.
- `@podkit/device-testing#test:vm`: 38/38 (3 prior personas-baseline failures resolved by TASK-418 — one-line fix removing a `withPersona` wrap around a doctor-vs-state assertion; the persona's USB attach was spawning `/dev/sg*` nodes that masked the baseline-host fixture state).
- `@podkit/e2e-vm-tests#test:vm`: 184 pass / 42 skip / 0 fail. Save-failure matrix (both TASK-412 ENOSPC cells now routed via TASK-416's `'space'` override) GREEN. SystemState cross-check GREEN across all 9 states.

TASK-418 turned out to be a test bug, not a fixture drift — the fixture was correct; the test was contaminating the host environment by attaching a persona before probing inquiry-methods. Closed in the same pass.
<!-- SECTION:FINAL_SUMMARY:END -->
