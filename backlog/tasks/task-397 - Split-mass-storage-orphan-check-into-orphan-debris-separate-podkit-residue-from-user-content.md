---
id: TASK-397
title: >-
  Split mass-storage orphan check into orphan + debris (separate podkit residue
  from user content)
status: To Do
assignee: []
created_date: '2026-06-07 12:17'
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
<!-- AC:END -->
