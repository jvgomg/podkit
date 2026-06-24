---
id: TASK-436.07
title: Extend `podkit device set` with default-collection write flags
status: Done
assignee: []
created_date: '2026-06-24 15:20'
updated_date: '2026-06-24 16:49'
labels:
  - cli
  - config
  - collections
dependencies:
  - TASK-436.05
parent_task_id: TASK-436
ordinal: 188000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the CLI write path for per-device defaults to the existing `podkit device set` command, following its established set / `--clear-X` / `--no-X` + option-source-filter pattern.

- `--default-music <name>` / `--default-video <name>` — set a collection name.
- `--no-default-music` / `--no-default-video` — record `false` (explicit none).
- `--clear-default-music` / `--clear-default-video` — remove the value (revert to inheriting the global default).
- Error at write time if a provided name does not reference an existing collection (consistent with how the command already rejects bad `--quality`), listing the available collections.
- The defaults apply to all device types — do NOT place them behind the mass-storage-only option gate.
- Widen the `updateDevice` writer's `updates` value type to include the two keys (with `null` meaning remove); its generic write loop already handles arbitrary keys, so no new TOML-surgery routine is needed.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user stories 9, 10, 11, 12, 13.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 device set supports --default-music/--default-video (set), --no-default-music/--no-default-video (false), and --clear-default-music/--clear-default-video (remove)
- [x] #2 Setting a name that references a missing collection errors at write time and lists available collections
- [x] #3 The flags work for all device types (not gated to mass-storage)
- [x] #4 updateDevice persists the values (null = remove) via its generic write loop with no new surgery routine
- [x] #5 Unit tests cover set/none/clear, the missing-collection error, and a round-trip through updateDevice
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in packages/podkit-cli/src/commands/device/set.ts and packages/podkit-cli/src/config/writer.ts (plus error-codes.ts for a new code).

Options added on `device set` (mirroring the existing --artwork/--no-artwork + --clear-* pattern):
- `--default-music <name>` / `--no-default-music` (both bind to commander option `defaultMusic`: string when a value is given, `false` via the negatable flag) / `--clear-default-music` (separate boolean).
- Same trio for video (`defaultVideo` / `--clear-default-video`).

Option → updates mapping (null = remove):
- clearDefaultMusic → updates.defaultMusic = null; else defaultMusic !== undefined → updates.defaultMusic = options.defaultMusic (string OR false).
- Same for video. `withCleanOptions` strips commander's synthetic `'default'` source, so `--no-default-music` surfaces as `options.defaultMusic === false` ONLY when the user actually passed it (verified: the no-updates guard still fires when nothing is passed — the synthetic `false` default is dropped, so it is NOT counted as an update).

Write-time validation (new): when `typeof options.defaultMusic === 'string'`, verify the name is a key of `config.music`; otherwise throw a CliError with new code `DeviceErrorCodes.COLLECTION_NOT_FOUND` listing available music collections. Same for `defaultVideo` against `config.video`. `false` / `--clear-*` reference no collection so are not validated. Judgment call: no existing code fit, so added `COLLECTION_NOT_FOUND` to error-codes.ts.

NOT mass-storage-gated: the new options were intentionally left out of the `massStorageOptions` array, so they work on iPod devices.

Writer change: widened `updateDevice`'s `updates` param type with `defaultMusic?: string | false | null` and `defaultVideo?: string | false | null`. NO new serialization routine — the existing generic `Object.entries(updates)` loop already serializes a string as `defaultMusic = "main"` (quoted, via escapeTomlString), a boolean `false` as `defaultVideo = false` (unquoted, via `String(value)`), and `null` removes the line. Verified by tests.

Output formatting: the existing changes loop renders `null` as "cleared (will use global default)" and otherwise `${value}`, which prints `defaultVideo: false` sensibly; no change needed. Extended only the no-updates guard message to mention --default-music/--default-video.

Tests:
- New packages/podkit-cli/src/commands/device/set.test.ts (10 tests): set name (writes quoted), --no-default-* (writes false), --clear-default-* (removes), missing name errors with exit 1 + no write, flags accepted on non-mass-storage iPod device, no-updates guard still fires. Both music and video.
- packages/podkit-cli/src/config/writer.test.ts (+4 tests): defaultMusic name quoted, defaultVideo false unquoted, null removes, and a loader round-trip asserting `defaults: { music: 'main', video: false }`.

Gates: typecheck (tsc --noEmit) clean; oxlint clean on the 5 changed files; `bun run build` succeeds; `bun run test:unit --filter podkit --force` = 1868 pass / 0 fail (includes the 63 from the two affected files).

Reviewed (Sonnet): no blocking. Confirmed --no- maps to false (not true) via withCleanOptions; writer serializes string quoted / boolean false UNQUOTED / null removes, and the round-trip preserves boolean false (never the string "false"); validation only on the string-name case; COLLECTION_NOT_FOUND added without collision; options not mass-storage-gated. Should-fix applied by team lead: renamed shadowed inner `name`→`collectionName` in both validation blocks; added the missing `not.toContain('defaultVideo = "false"')` negative assertion; added a clear-wins-over-set test. set.test.ts now 11 tests, writer.test.ts 53.
<!-- SECTION:NOTES:END -->
