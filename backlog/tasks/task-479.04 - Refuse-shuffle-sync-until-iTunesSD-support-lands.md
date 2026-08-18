---
id: TASK-479.04
title: Refuse shuffle sync until iTunesSD support lands
status: Done
assignee: []
created_date: '2026-08-13 21:18'
updated_date: '2026-08-14 19:28'
labels:
  - shuffle
  - cli
  - safety
milestone: m-18
dependencies: []
parent_task_id: TASK-479
priority: high
ordinal: 247000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`shuffle_1g` and `shuffle_2g` are `access: 'syncable'`, so podkit will transcode a full collection onto a shuffle, report success, and leave a device that cannot play any of it (see TASK-479.01). That happened on real hardware on 2026-08-13: 198 tracks, 870 MB, 16 minutes, unplayable.

Until TASK-479.01 lands, sync to a shuffle must refuse rather than waste the user's time and disk.

## Shape

A typed sync-time refusal naming the real cause — "podkit cannot yet write the shuffle playback database (iTunesSD); tracks would transfer but would not play".

**Do not express this by changing the access tier.** `access` describes the *device's* accessibility, not podkit's capability gap; conflating them is the mistake `b41bb02e` made when it suppressed contradictory output by access tier, which is why a `syncable` shuffle walked straight into the bug this epic exists to fix. Flipping shuffle_1g/2g to `read-only` would also lie in `device info` and would have to be un-flipped.

Read paths (`device info`, `device music`, `archive`) must keep working — they are correct today.

## Lifetime

This refusal is deliberately temporary. TASK-479.01 removes it. Keep it small enough that deleting it is trivial, and reference it from 479.01 so it is not orphaned.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Sync to a shuffle_1g/shuffle_2g refuses with a typed error naming the iTunesSD gap as the cause
- [x] #2 The generation table's `access` tier is unchanged
- [x] #3 `device info`, `device music` and `archive` still work against a shuffle
- [x] #4 The refusal is referenced from TASK-479.01 so it is removed when support lands
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added a sync-time-only refusal gate in packages/podkit-cli/src/commands/sync.ts, inside the existing `isIpodDevice` identity cascade, placed between the DEVICE_UNSUPPORTED gate and the unknown-model gate (after `syncAssessment.model` is resolved). Triggers only when `syncAssessment.model.generationId` is `shuffle_1g` or `shuffle_2g` — access tier untouched (still `syncable` in packages/devices-ipod/src/tables/generations.ts).

New error code `SyncErrorCodes.SHUFFLE_ITUNESSD_UNSUPPORTED` added to the existing enum (auto-flows into the `PodkitErrorCode` union via error-codes.ts; error-codes.test.ts's shape checks cover it automatically).

Error message (headline + two detail lines, matching the multi-line CliError pattern used elsewhere in this gate):
"podkit cannot yet write the iPod shuffle playback database (iTunesSD) for ${deviceLabel}."
"Tracks would transfer to the device but would not play."
"This is a temporary limitation in podkit, not a problem with your device — support is planned."

Read paths (device info / device music / archive) are untouched — the gate lives only in sync.ts's write-path cascade.

Tests added to sync-runner.unit.test.ts: 'refuses cleanly with SHUFFLE_ITUNESSD_UNSUPPORTED for a shuffle_1g', 'refuses cleanly with SHUFFLE_ITUNESSD_UNSUPPORTED for a shuffle_2g', 'does not apply the shuffle refusal to a non-shuffle iPod' (asserts a video_5g falls through to IPOD_NEEDS_INIT untouched). All follow the existing assessIpodIdentity-stub pattern used by the DEVICE_UNSUPPORTED/UNKNOWN_IPOD_MODEL/IPOD_NEEDS_INIT tests in the same file.

Added .changeset/shuffle-sync-refusal.md (patch bump, podkit).

Cross-referenced from TASK-479.01: added an acceptance criterion there to remove this gate (and its test coverage) once iTunesSD write support lands, so it isn't orphaned.

Quality gates: bun run lint (clean), bun run typecheck (clean, turbo-cached across the monorepo), bun run test:unit --filter podkit (1965 pass, 1 pre-existing unrelated failure in collection-playlist-display.test.ts's subsonic playlist-heading test — reproduced identically with these changes stashed out, confirmed not caused by this change).

Superseded before release. The interim refusal was implemented and then removed within the same unreleased cycle, because TASK-479.01 landed immediately after it — so the restriction never reached a user and no changelog entry describes it.

What survives from this work: the ordering test in `sync-runner.unit.test.ts` pinning that a read-only shuffle_3g/4g refuses with DEVICE_UNSUPPORTED (the access tier), not with a capability-gap error. That test is the durable value — it stops a future change from conflating podkit's capability gap with the device's own access tier, which is the confusion that let the original bug ship.
<!-- SECTION:NOTES:END -->
