---
id: TASK-436.09
title: 'End-to-end test: per-device default drives synced collection'
status: Done
assignee: []
created_date: '2026-06-24 15:21'
updated_date: '2026-06-24 17:16'
labels:
  - sync
  - collections
  - test
  - e2e
dependencies:
  - TASK-436.06
  - TASK-436.07
modified_files:
  - test-packages/e2e-tests/src/features/per-device-default-collection.test.ts
parent_task_id: TASK-436
ordinal: 190000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add one light, happy-path end-to-end test pinning the wired behavior: a named device with a per-device default music collection, synced with no `-c` flag, syncs that collection (not the global default). Prior art: existing config/sync e2e tests.

Optionally also cover the `false` (none) case end-to-end if cheap to do in the same fixture.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user story 1 (end-to-end verification).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 An e2e test syncs a named device whose per-device default music collection differs from the global default, with no -c flag, and asserts the device default is used
- [x] #2 The test follows existing config/sync e2e prior art
- [x] #3 Test passes in the standard e2e run
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added `test-packages/e2e-tests/src/features/per-device-default-collection.test.ts`.

**Prior art followed:** `preset-change.test.ts` and `config-rules.ts` patterns — explicit TOML construction via template string, `withMassStorageTarget({ preset: 'rockbox' })` (no hardware, no gpod-tool), `runCliJson<SyncOutput>` with `--dry-run --json`, `try/finally` cleanup. No new harness helpers introduced.

**AC#1 — device default overrides global default:**
Two collections: `globalcol` (1 track, harmony.flac only) and `devcol` (3 tracks, full goldberg-selections). Global `[defaults] music = "globalcol"`, device stanza has `defaultMusic = "devcol"`. Sync runs with `--device <name>` and NO `-c` flag. Decisive assertion: `json.plan.tracksToAdd === 3` (the devcol count; globalcol would give 1). Secondary: `json.source` contains "devcol" and does NOT contain "globalcol". Both assertions together make provenance explicit and prevent an accidental pass.

**AC#2 — false suppression (added because it fits the same harness naturally):**
Same device stanza with `defaultMusic = false`. Global default still exists. Dry-run exits non-zero with `CliErrorOutput { success: false, code: 'NO_COLLECTIONS' }`.

**How run:** `bun test test-packages/e2e-tests/src/features/per-device-default-collection.test.ts`

**Result: 2 pass, 0 fail in 383ms.**

Typecheck: `bun run typecheck --filter @podkit/e2e-tests` → clean (0 errors).
Lint: `bun run lint --filter @podkit/e2e-tests` → 0 warnings, 0 errors.

Added test-packages/e2e-tests/src/features/per-device-default-collection.test.ts (2 tests), mirroring preset-change.test.ts + config-rules.ts prior art (withMassStorageTarget rockbox preset, runCliJson dry-run). AC#1: global default 'globalcol' (1 track) vs device defaultMusic='devcol' (3 tracks); `sync --device test --dry-run` with NO -c asserts tracksToAdd===3 AND source contains 'devcol' not 'globalcol' — both fail if the global default wrongly won. AC#2: device defaultMusic=false with a global default present → NO_COLLECTIONS error (music suppressed, no video). Reviewed (Sonnet): no blocking; confirmed decisive (count + source-path both required, neither satisfiable by the other collection) + deterministic (mkdtemp + try/finally cleanup, dry-run no device writes) + correct path (named device, no -c flag → device cascade). Should-fix applied by team lead: build the device stanza by inserting defaultMusic right after the [devices.<name>] header (regex) instead of appending after the fragment — robust against a future trailing sub-table. Run: `bun test <file>` → 2 pass/0 fail; typecheck + oxlint clean.
<!-- SECTION:NOTES:END -->
