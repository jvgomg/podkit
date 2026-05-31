---
id: TASK-356.07
title: P6 — Add decision-assertion cells to existing concerns
status: Done
assignee: []
created_date: '2026-05-31 21:47'
updated_date: '2026-05-31 22:08'
labels:
  - testing
  - e2e
  - matrix
  - decisions
dependencies: []
references:
  - backlog/docs/doc-039 - E2E-Sync-Matrix-Testing-Strategy.md
  - backlog/docs/doc-040 - PRD-—-Expose-sync-decisions-in-json-TASK-357.md
  - test-packages/e2e-tests/src/matrix/codec-rules.ts
  - test-packages/e2e-tests/src/matrix/artwork-rules.ts
parent_task_id: TASK-356
priority: medium
ordinal: 90000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Direct follow-up to TASK-357 (sync decisions JSON mechanism). The matrix harness has had a `decisions` seam since TASK-356.01 (`diffCell` diffs object fields structurally); TASK-357 landed the JSON-side mechanism (`json.decisions.*` + per-op `inputCodec`/`outputCodec`). This subtask wires those into the existing concerns so a regression in podkit's *decisions* (not just outcomes) fails the matrix.

## What changes

### Codec concern (`matrix/codec-rules.ts`)
- `CodecExpected` adds `lossyCodecSource: DecisionSource` and `outputCodec: string | null` per cell.
- Observer reads `json.decisions?.lossyCodec.source` + per-op `outputCodec` from the dry-run JSON.
- Predictor sets `lossyCodecSource` based on the cell's codec config (config = 'global'; default = 'default'; CLI flag would be 'cli' but no CLI codec flag exists today).
- Cells then catch: a regression that produces the right codec via the wrong inheritance path (silently broken provenance); a regression that picks AAC when the matrix expects Opus (today only the action type asserts, not the codec).

### Artwork concern (`matrix/artwork-rules.ts`)
- `StaticArtExpected` adds `checkArtworkSource: DecisionSource`.
- Observer reads `json.decisions?.checkArtwork.source`.
- Predictor sets it based on whether the runPass enables `--check-artwork` (source = 'cli' when on; source = 'default' when off).
- Catches: a CLI-flag plumbing regression that silently uses the config/default value.

### Correlation cell (TASK-366 ↔ TASK-357)
- New matrix file or cell: assert that the `artwork-detection-disabled` plan warning fires iff `decisions.checkArtwork.value === false` AND the source is Subsonic. Both directions — warning present when expected, absent when not. Catches: a regression in either feature alone (warning silently dropped, or warning still fires after a bug "fixes" checkArtwork-on detection).

## Out of scope (future cell additions)
- Config-inheritance matrix (per-setting × inheritance level × CLI override). Separate concern — file as TASK-356.08 if pursued.
- CLI override matrix (--quality vs --audio-quality precedence, --no-check-artwork explicit-false, etc.). Today these are unit-tested in `sync-decisions.test.ts`; an e2e matrix would prove the wiring end-to-end. Separate concern — file as TASK-356.09 if pursued.
- `'auto'` source attribution (planner-driven choices). Blocked on a planner change; tracked under TASK-357 follow-ups.

## Acceptance Criteria
- Codec matrix asserts `decisions.lossyCodec.source` per cell.
- Codec matrix asserts per-op `outputCodec` per cell.
- Artwork matrix (host) asserts `decisions.checkArtwork.source` per cell.
- Correlation cell pins `artwork-detection-disabled` warning ↔ `decisions.checkArtwork.value` for Subsonic source.
- All existing matrix cells remain green (no regressions from tightened expectations).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-05-31 (Claude / Opus 4.7): Landed in commit `82357a5f` — "test(matrix): assert sync decisions in codec + artwork concerns".

**What changed**

- `matrix/codec-rules.ts`: CodecExpected gains `lossyCodecSource: DecisionSource` + `outputCodec`. predictor pins `lossyCodecSource = 'global'` (every cell writes `[codec] lossy = [...]`); outputCodec is `resolved` for transcode ops and `FORMAT_FILETYPE[cell.format]` for copy ops. New `FORMAT_FILETYPE` map handles the codec-vs-container mismatch (`.m4a` container for AAC and ALAC sources). Observer reads `json.decisions.lossyCodec.source` and per-op `outputCodec`. 80 live cells × 2 new assertions = +160 expects.
- `matrix/artwork-rules.ts`: StaticArtExpected gains `checkArtworkSource` + `artworkDetectionDisabledWarning`. CompilationExpected inherits both. predictDirectory and predictSubsonic set source = 'cli' when checkArtwork passed, 'default' otherwise. Subsonic warning fires iff !checkArtwork. Directory never fires the Subsonic warning. Observer reads `json.decisions.checkArtwork.source` and `json.planWarnings[].type` once per pass.

**Coverage**

- Host codec matrix: 80 pass / 0 fail.
- Host artwork matrix: 384 pass / 0 fail.
- Subsonic artwork matrix: 64 pass / 0 fail.
- Subsonic change matrix (TASK-355.05): unchanged (didn't extend ChangeExpected with the new fields — out of scope).

**Sonnet review caught and fixed**

1. P2: `FORMAT_FILETYPE` map declared between import statements (legal ESM but visually a syntax surprise). Moved after all imports.
2. P2: `predictSubsonic`'s `checkArtworkSource: 'default'` hardcoded — fragile if a future config helper writes `checkArtwork` into TOML. Added explicit ASSUMPTION comments coupling the predictor to `createSubsonicConfig` / `createPipelineConfig`.

**Trade-offs noted in code**

- `DecisionSource` union duplicated in both matrix files (avoiding test→CLI source imports). If podkit adds a new source value, both predictors will need manual updating; comment notes the trade-off.
- The `as` cast on observer reads of `json.decisions?.lossyCodec.source` defeats compile-time type safety. Acceptable because the cast is local to the matrix layer.

**Out of scope (future cell additions)**

- Config-inheritance matrix (per-setting × inheritance level × CLI override). File as TASK-356.08 if pursued.
- CLI override matrix (--quality vs --audio-quality precedence, --no-check-artwork explicit-false). Currently unit-tested in `sync-decisions.test.ts`. File as TASK-356.09 if pursued.

**Gates**

typecheck, oxlint, host codec + artwork matrices, docker artwork matrix — all green on macOS.
<!-- SECTION:NOTES:END -->
