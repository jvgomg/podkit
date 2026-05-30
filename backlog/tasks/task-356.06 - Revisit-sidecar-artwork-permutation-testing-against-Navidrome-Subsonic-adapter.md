---
id: TASK-356.06
title: >-
  Revisit sidecar artwork permutation testing against Navidrome (Subsonic
  adapter)
status: To Do
assignee: []
created_date: '2026-05-29 17:33'
labels:
  - testing
  - e2e
  - matrix
  - artwork
  - subsonic
  - coverage
dependencies:
  - TASK-142
  - TASK-355.05
references:
  - test-packages/e2e-tests/src/features/art-matrix.docker.test.ts
  - test-packages/e2e-tests/src/matrix/artwork-rules.ts
  - test-packages/e2e-tests/src/matrix/reference-model.ts
  - test-packages/e2e-tests/src/matrix/axes.ts
  - test-packages/e2e-tests/src/sources/subsonic.ts
  - packages/podkit-core/src/adapters/directory.ts
documentation:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - backlog/docs/doc-012 - Spec-Transfer-Mode-Behavior-Matrix.md
parent_task_id: TASK-356
priority: low
ordinal: 83000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

The e2e artwork matrix has four source-side scenarios (axes.ts): `A-none`, `B-embedded`, `C-sidecar`, `D-both`. Sidecar handling differs fundamentally between the two collection adapters, but the Subsonic/Navidrome arm of the matrix does not deliberately exercise the sidecar permutations:

- **Directory adapter** (`predictDirectory` in `test-packages/e2e-tests/src/matrix/artwork-rules.ts`): the `C-sidecar` scenario "collapses onto A" because the adapter only reads embedded art (`packages/podkit-core/src/adapters/directory.ts`). Closing that read gap is tracked by TASK-142.
- **Subsonic adapter** (`predictSubsonic` in the same file): Navidrome serves cover art through its API (`getCoverArt`), not from the on-disk sidecar file. So a `C-sidecar` album that the directory adapter sees as art-less can be served *with* art by Navidrome. The current `predictSubsonic` only branches on `scenario === 'A-none'` vs embedded; it folds `C-sidecar` together with "no embed" formats and never models Navidrome's API-served cover art reaching the device. The device-side prediction is driven purely by the downloaded file's embed state (`sourceEmbedsArt`), with a comment that "sidecar bytes never reach the stream" — which is true for the on-disk file but not for what Navidrome serves over its API.

The result: the Subsonic docker matrix (`test-packages/e2e-tests/src/features/art-matrix.docker.test.ts`) does not have deliberate, asserted coverage of how sidecar-sourced art (`C-sidecar`, `D-both`) flows through Navidrome to the device, and whether/how it differs from the directory adapter. TASK-356.05 closed several gaps but its Final Summary explicitly notes the docker matrix was not re-run and `predictSubsonic`/`observeStaticArtwork` were left untouched.

## What to revisit

Determine the *intended* behaviour first (this likely needs the TASK-142 executor-adapter-fallback decision — whether podkit fetches art from the adapter when the downloaded file has no embed), then add deliberate matrix cells that assert sidecar-sourced art behaviour through Navidrome:

- Whether a `C-sidecar` album (no embedded art in the served file, but Navidrome exposes a cover via `getCoverArt`) results in artwork on the device.
- Whether `D-both` (embedded + sidecar) behaves identically to `B-embedded` or differs.
- How this compares cell-for-cell with the directory adapter's `C-sidecar`/`D-both` predictions.

Build on the shared harness/rules module (`matrix/`), per doc-039 §"Proposed code organisation" — host and docker files import one `*-rules.ts`. Coordinate with TASK-142 (directory + executor sidecar work) and TASK-355.05 (Subsonic change-matrix plumbing: `SubsonicTestSource.mutateLibrary()`), which adds the file-mutation/rescan machinery this may reuse.

## Decision needed

The *expected* outcome of the sidecar-via-Navidrome cells depends on a product/implementation decision (does podkit pull adapter-served art for files with no embed? — TASK-142 AC #1). If that decision is unresolved when this is picked up, resolve or pin it before asserting cells; do not encode a guessed expectation as green.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 predictSubsonic distinguishes C-sidecar / D-both from the no-embed-format case and models Navidrome's API-served cover art, rather than folding them together
- [ ] #2 Docker artwork matrix has deliberate, asserted cells for C-sidecar and D-both on the Subsonic/Navidrome adapter (no longer collapsed onto A)
- [ ] #3 Sidecar-via-Navidrome cells are documented cell-for-cell against the directory adapter's C-sidecar/D-both behaviour, making the cross-adapter difference explicit
- [ ] #4 Expected outcomes are pinned against the resolved TASK-142 executor-adapter-fallback behaviour, not guessed; any unresolved product decision is called out rather than encoded as green
- [ ] #5 New/changed cells green in the docker (Navidrome) suite; doc-039 updated to reflect the Subsonic sidecar coverage
<!-- AC:END -->
