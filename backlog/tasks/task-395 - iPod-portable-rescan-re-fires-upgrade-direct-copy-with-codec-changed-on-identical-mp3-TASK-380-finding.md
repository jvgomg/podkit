---
id: TASK-395
title: >-
  iPod portable rescan re-fires upgrade-direct-copy with codec-changed on
  identical mp3 (TASK-380 finding)
status: To Do
assignee: []
created_date: '2026-06-06 18:03'
labels:
  - bug
  - ipod
  - portable-mode
  - planner
  - rescan-convergence
dependencies: []
references:
  - test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts
  - packages/podkit-core/src/sync/engine/planner.ts
  - >-
    backlog/tasks/task-380 -
    Save-failure-matrix-test-suite-—-doc-041-§4.3-§7.3.md
priority: medium
ordinal: 109100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

Surfaced by TASK-380 Phase C.3 iPod cells (2026-06-06). For `ipod-{noart,artwork} × mp3 × prefer-copy × portable × track-readonly` cells, the second sync's dry-run re-fires `upgrade-direct-copy` with `reason: codec-changed` despite **identical mp3 codec on both sides** of the round-trip.

The matrix's other observations (typed `TagWriteError` warn-only via WarningSink, partialDeviceState, doctorSeesPodkitTmp) all match prediction. Only `rescanRefires: false (predicted) vs true (observed)` is wrong — the planner thinks the codec changed when it didn't.

## Repro

```bash
# inside the Lima podkit-device-harness VM
gpod-tool init <mount> --model 9160                    # iPod mini 1G
podkit sync -d <mount> --transfer-mode portable        # first sync: copies mp3
podkit sync -d <mount> --transfer-mode portable --dry-run --json
# → planner's operations[] contains:
#   { type: 'upgrade-direct-copy', reason: 'codec-changed', track: 'Artist - Title' }
# even though the source mp3 and the device's mp3 are byte-identical
```

## Investigation needed

1. **Where does the codec comparison live?** Search `packages/podkit-core/src/sync/engine/planner.ts` or `diff-utils.ts` for `codec-changed` reason emission.
2. **Compare source codec field vs device track codec field.** Is the source reporting `mp3` and the device reporting `MPEG audio` (or vice versa)? Tag-vs-actual mismatch?
3. **Is this iPod-specific or also reproducible on mass-storage portable?** Worker reports it's surfaced in iPod portable cells; mass-storage cells didn't fan this way.
4. **Is `codec-changed` ever justified on a same-codec round-trip?** Probably not — the reason should fire only when input + output codecs genuinely differ.

## Fix

Depends. Probably: the planner's codec-identity comparison normalises one side but not the other (e.g. ffprobe's `codec_name: mp3` vs libgpod's track-info field). Normalise both to the same canonical codec id before comparison.

## Why filed now

Real divergence surfaced by the matrix. Two iPod portable cells consistently RED on `rescanRefires`. Not a stale-binary artefact (the asymmetry is reproducible).

## Acceptance

- Root cause: which field differs (source vs device) and why
- Fix: planner emits `codec-changed` only when source codec genuinely differs from device codec
- Test pins iPod mp3 round-trip in portable mode (no `upgrade-direct-copy` on second dry-run)
- TASK-380 matrix cells flip GREEN on `rescanRefires`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Root cause documented: which side of the codec comparison reports a different label (ffprobe-side vs libgpod-side vs sync-tag-side)
- [ ] #2 Planner codec-identity comparison normalises both sides to a canonical id before comparing
- [ ] #3 Unit test pins the comparison: same mp3 codec, different label representations, must NOT emit codec-changed
- [ ] #4 VM e2e test: iPod mp3 portable round-trip converges on second dry-run (no upgrade-direct-copy with codec-changed reason)
- [ ] #5 TASK-380 matrix `ipod-{noart,artwork} × mp3 × prefer-copy × portable × track-readonly` cells flip GREEN on `rescanRefires`
<!-- AC:END -->
