---
id: TASK-397
title: >-
  Split mass-storage orphan check into orphan + debris (separate podkit residue
  from user content)
status: To Do
assignee: []
created_date: '2026-06-07 12:17'
updated_date: '2026-06-07 14:37'
labels:
  - enhancement
  - doctor
  - diagnostics
  - mass-storage
  - ipod
  - refactor
dependencies: []
references:
  - packages/podkit-core/src/diagnostics/checks/orphans-mass-storage.ts
  - packages/podkit-core/src/diagnostics/checks/orphans.ts
  - packages/podkit-core/src/device/mass-storage-utils.ts
  - packages/podkit-core/src/diagnostics/index.ts
  - documents/architecture/sync/save-transactions.md
priority: medium
ordinal: 109300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`orphan-files-mass-storage` today bundles two semantically distinct concerns:

- **Orphans** — media files present on disk but absent from the manifest. *Could* be user-placed (intentional) or pre-podkit content. Repair must be user-confirmed.
- **Debris** — podkit's own in-flight write residue (`.podkit-tmp`, `.Audio file`). *Always* incomplete by construction; podkit-owned. Repair is safe-by-design — no prompt needed.

Mixing them dilutes the report signal (user sees "12 orphan files" and thinks "did I lose music?" when it's actually `.podkit-tmp`) AND blocks safe automation (we cannot auto-clean debris between syncs while orphans are in the same bucket — see TASK-NEW-B which builds on this).

A third concern is on the horizon (TASK-375: orphan sidecar `cover.jpg` with no audio peer) which is its own category with its own repair confidence.

Additionally: the iPod-side orphan check (`orphans.ts`) does NOT include the debris extensions today. Since TASK-376 routes iPod portable tag-writes through `atomicWriteFileWithSync`, iPod can now accumulate `.podkit-tmp` debris that doctor doesn't surface. Real gap.

## Scope

1. **Share the walker.** Extract the file-categorising walk in `orphans-mass-storage.ts` into a shared scanner that returns `{media, debris}` (or a richer typed result if TASK-375's sidecar category lands first).
2. **Two checks, one walk:**
   - `orphan-files-mass-storage` → emits orphans only; repair gated as today.
   - `debris-files-mass-storage` → emits debris only; repair is non-interactive (safe-by-design).
3. **iPod parity**: add `debris-files-ipod` check (or extend `orphans.ts` to grow a `debris` result alongside its existing one). Walks `iPod_Control/Music/F**` for `.podkit-tmp` debris from TASK-376's portable tag-writes.
4. **Repair UX**: `debris-*` checks' repair description should reflect the safety (e.g. "Always-safe: deletes podkit's incomplete-write residue from prior syncs"). The CLI should NOT prompt for debris cleanup; orphan cleanup keeps its existing prompt semantics.
5. **Doctor report**: the rendered report distinguishes debris from orphans in the per-check sections (existing renderer should already do this via separate check ids).
6. **Tests**: split the existing test file; pin: orphan repair still gated, debris repair safe-auto, both populate `debris[]` / `orphans[]` correctly, iPod debris check finds `.podkit-tmp` in `iPod_Control/Music/F**`.

## Why splitting now

This task is the framework foundation for:
- **TASK-NEW-B** (pre-sync debris sweep + dry-run reporting): needs a callable debris-only scanner to invoke at sync start; can't safely call into a mixed orphan check.
- **TASK-375** (orphan sidecar `cover.jpg`): cleanly plugs in as a third check using the same walker.
- **TASK-378 §4** (free-space strategy): reporting "where did the bytes go" benefits from the debris/orphan distinction.

## Reference

- `documents/architecture/sync/save-transactions.md` §6 — the self-heal-via-rescan model under which debris exists.
- `documents/architecture/sync/error-handling.md` — diagnostic check conventions.
- doc-041 §6 — rescan contract.

## Acceptance

- Two distinct check ids in the diagnostic registry: `orphan-files-mass-storage` (orphans only) and `debris-files-mass-storage` (debris only).
- iPod-side parity: `debris-files-ipod` (or equivalent extension) covers `iPod_Control/Music/F**` `.podkit-tmp` residue.
- Single shared walker; no double FS walk.
- Debris repair is non-interactive (no confirmation prompt); orphan repair semantics unchanged.
- Test coverage split + iPod-side test added.
- Architecture doc updated if responsibility-boundary table changes.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Shared file-categorising walker extracted; orphan and debris checks both consume it (no double FS walk)
- [ ] #2 `orphan-files-mass-storage` emits only orphans; repair preserves current confirmation-gated UX
- [ ] #3 `debris-files-mass-storage` (new) emits only debris (`.podkit-tmp`, `.Audio file`, etc.); repair is safe-auto (no prompt)
- [ ] #4 iPod-side debris check covers `iPod_Control/Music/F**` `.podkit-tmp` residue from TASK-376 portable tag-writes
- [ ] #5 Test file split: orphan tests vs debris tests; iPod debris test pins the new walk
- [ ] #6 Doctor report distinguishes the two check sections cleanly (existing renderer should handle this via separate ids)
- [ ] #7 Architecture doc updated to name the debris-vs-orphan split if responsibility-boundaries warrant
- [ ] #8 Public --repair IDs unified: `orphan-files` (dispatched by device type), `debris-files` (dispatched by device type), `debris-transcode-tmp` (host scratch). NO device-suffixed public IDs.
- [ ] #9 `--repair orphan-files-mass-storage` is HARD REMOVED — invocation errors out with a clear message pointing to `--repair orphan-files`. Changeset published with minor bump.
- [ ] #10 doctor.md + cli-commands.md + common-issues.md updated to reference only the unified IDs; no remaining references to device-suffixed --repair flags.
<!-- AC:END -->





## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## Revised approach (2026-06-07 design session)

Scope expanded based on opus second-opinion + user direction. This task now folds in three structural improvements alongside the orphan/debris split — done together because they share the same files + tests + walker.

### Scope additions

1. **`Scanner<Result>` registry interface** (new). Mirror the existing `DiagnosticCheck` registry shape — `applicableTo` + `scan(ctx)` producing typed results. Lives in `packages/podkit-core/src/diagnostics/scanners/`. Future scanners (TASK-375 sidecar, hash-debris) plug in.
2. **Doctor registry re-org by `{scope, category}`**. Categories: `identity`, `storage-debris`, `database-integrity`, `host-environment`. Mass-storage and iPod debris checks both go into `storage-debris` regardless of device. Existing `applicableTo` keeps device filtering orthogonal.
3. **libgpod tmp-suffix coverage**. libgpod uses its own tmp suffix (NOT `.podkit-tmp`). Fold into the debris-extension set so debris-files-ipod catches it too. Verify the exact suffix from `tools/gpod-tool/` + libgpod source before shipping.

### Concurrency safety for `debris-transcode-tmp`

`os.tmpdir()/podkit-transcode-<uuid>/` is HOST-GLOBAL — two podkit processes (daemon + manual CLI) can stomp each other. Mitigation: skip any `podkit-transcode-*` dir whose mtime is newer than the current session's start time. Lower-risk than pidfile/lock; sufficient for the SIGKILL self-heal use case.

### iPod debris surface

Walk the full iPod content surface (`iPod_Control/Music`, `iPod_Control/iTunes`, `iPod_Control/Artwork`) and key on `.podkit-tmp` suffix, NOT path. Task-spec wording "`iPod_Control/Music/F**`" was too narrow — atomic-write helper is suffix-agnostic and TASK-376 retrofitted it broadly.

### Phantom manifest pruning

Walker also surfaces manifest entries whose target file is missing. Repair-style behaviour stays in the orphan check (it already does this — `orphans-mass-storage.ts:441`); but the new shared scanner exposes the same gap so TASK-398's pre-sync sweep can close it without a doctor backstop.

### Architecture doc impact

- `documents/architecture/sync/save-transactions.md` §3 (responsibility boundaries): add scanner-registry-vs-check-registry to the table.
- NEW `documents/architecture/sync/planning.md` — long-overdue per README migration plan; written in this PR (sibling work to TASK-398). Includes a "scanners + checks" sub-boundary.

### Test split

- Existing `orphans-mass-storage.test.ts` splits into `orphan-files-mass-storage.test.ts` + `debris-files-mass-storage.test.ts`.
- New `debris-files-ipod.test.ts` (covers full content surface + libgpod tmp suffix).
- New `debris-transcode-tmp.test.ts` (covers concurrency-safe mtime filter).
- New `scanner-registry.test.ts` (pins the scanner shape).

## CLI ID unification (2026-06-07 mid-session decision)

User requested unified public IDs so users only need to remember `--repair orphan-files` regardless of device type. Decisions:

### Public ID surface (after TASK-397 lands)

| Public ID | Scope | Internal dispatch |
|-----------|-------|-------------------|
| `orphan-files` | iPod + mass-storage | Device-type dispatch picks iPod walker vs mass-storage walker |
| `debris-files` | iPod + mass-storage | Same dispatch pattern |
| `debris-transcode-tmp` | host scratch (`/tmp/podkit-transcode-*`) | Single walker, no device needed |

Total public IDs: **3** (was 4 in the original split plan: orphan-files, orphan-files-mass-storage, debris-files-mass-storage, debris-files-ipod).

### Backwards-compat: hard remove

- `--repair orphan-files-mass-storage` → **removed**. Minor bump per `feedback_minor_breaking_changes.md` (CLI breaking changes use minor).
- The new debris IDs (`debris-files-mass-storage`, `debris-files-ipod`) are NOT shipped as public IDs at all — they only ever existed in this design discussion.

### Internal organisation

The scanner registry can still have device-specific walker implementations (iPod walker vs mass-storage walker — they hit different paths). The unified public ID layer sits in the doctor CLI / registry resolver.

### Changeset required

- Minor bump: `--repair orphan-files-mass-storage` removed.
- Changeset note: mention the unified ID + rationale.

### Doc impact

- TASK-399 (Phase 0) ships docs that reference `--repair orphan-files-mass-storage` (current state — honest at Phase 0 ship time).
- TASK-397 PR updates the same docs: rewrites every `--repair orphan-files-mass-storage` to `--repair orphan-files`; adds notes that doctor dispatches by device type.
- New debris docs use `--repair debris-files` + `--repair debris-transcode-tmp` (never reference the device-suffixed forms).

### Acceptance addition

Fold into AC: `--repair orphan-files` works on both device types; `--repair orphan-files-mass-storage` is rejected (hard removed); changeset published; docs updated to unified IDs.
<!-- SECTION:PLAN:END -->
