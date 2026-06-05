---
id: TASK-388
title: Pin artwork=false forwarding at handler → pipeline boundary
status: Done
assignee: []
created_date: '2026-06-04 08:18'
updated_date: '2026-06-05 18:29'
labels:
  - bug
  - config
  - music-pipeline
  - artwork
dependencies:
  - TASK-370
references:
  - packages/podkit-cli/src/commands/music-presenter.ts
  - packages/podkit-core/src/sync/music/pipeline.ts
modified_files:
  - packages/podkit-core/src/sync/music/handler.test.ts
priority: medium
ordinal: 114000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background — premise revised (2026-06-05)

The original task suspected that `MusicPresenter.executeSync` failed to forward `config.effectiveArtwork` to `executor.execute(...)`, so `artwork = false` in TOML was silently ignored.

Investigation found the **actual chain works correctly**:

1. `MusicPresenter` line 202: `core.createMusicHandler({...artwork: config.effectiveArtwork...})` — handler receives the flag.
2. `MusicHandler` ctor: `this.config = resolveMusicConfig(config)` — `config.raw.artwork` stored verbatim.
3. `MusicHandler.executeBatch` (handler.ts line 956–960): `executor.execute(plan, { ..., artwork: this.config.raw.artwork, ... })` — forwarded.
4. `MusicPipeline.execute` line 905: `this.artworkEnabled = artwork`.
5. `transferArtwork` line 1545: `if (!this.artworkEnabled) return undefined`.
6. Outer guards at lines 2248, 2420 also gate on `this.artworkEnabled`.

All three artwork write paths (`setArtworkFromData`, `updateTrack({embeddedPictureData})`, `writeSidecar`) live inside `transferArtwork`. All gated.

The **observed symptom** ("sidecar `cover.jpg` written despite `artwork = false`") had a different root cause at the CLI/config layer:
- Commander's `--no-X` pattern synthesises `opts.X = true` as the default; raw opts flowed into the config-merge layer and beat the TOML value.
- Fixed by commit `39e48c21` ("fix(core,cli): honor artwork=false") — three layers: `resolveDeviceArtwork` honors explicit-false, `main.ts` preAction filters Commander opts by `getOptionValueSource === 'cli'`, `sync.ts` adds `stripDefaultOptionValues` before `deriveSettings`.

That CLI fix landed several hours after TASK-388 was filed.

## Repurposed scope

Original Option C (pass `artwork: config.effectiveArtwork` to `executor.execute(...)` in presenter) is unnecessary — the value flows via handler config, not the executor's options bag. No prod code change required.

What IS valuable: a regression test pinning the handler → pipeline forwarding so a future change can't silently re-introduce the bug.

## What landed

**New describe block in `packages/podkit-core/src/sync/music/handler.test.ts`** — `MusicHandler.executeBatch — artwork forwarding`. Uses `spyOn(MusicPipeline.prototype, 'execute').mockImplementation(...)` to intercept the pipeline call and inspect the options bag. Three tests:

1. `forwards artwork=false from config to pipeline.execute options`
2. `forwards artwork=true from config to pipeline.execute options`
3. `omitted artwork in config maps to undefined (pipeline default kicks in)` — pins the narrower invariant that the handler does not substitute its own default.

The CLI-layer fix (Commander `--no-X` filtering) is already pinned in `packages/podkit-cli/src/utils/option-source.test.ts`.

## Acceptance Criteria
<!-- AC:BEGIN -->
- `artwork = false` in TOML produces a sync with zero artwork-write operations — **verified** by the existing CLI-layer test + new handler-boundary test + existing pipeline gate tests.
- `--no-artwork` flag produces the same — **pinned** by `option-source.test.ts` (Commander `--no-X` synthetic-default stripping).
- Regression test pins the contract — **landed** in handler.test.ts.

## Reference

- Original observation reported in TASK-387 background (Option C).
- Root-fix commit `39e48c21` (2026-06-04 21:36, fix(core,cli): honor artwork=false).
- Repurposed 2026-06-05 in team-lead session after the trace showed Option C wasn't load-bearing.
- See [[feedback_commander_no_x_default]] for the underlying Commander gotcha.
<!-- SECTION:DESCRIPTION:END -->

- [x] #1 TOML `artwork = false` produces a sync with zero artwork-write operations (pinned at handler boundary; CLI flag pinned at option-source layer; pipeline gate pinned at pipeline layer)
- [x] #2 `--no-artwork` CLI flag produces the same (already covered by option-source.test.ts)
- [x] #3 Regression test pins the handler → pipeline forwarding contract (handler.test.ts: 3 cases)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**No prod code change.** The chain handler.config.raw.artwork → pipeline.execute({artwork}) is correct in the current code. The original observed symptom was caused by Commander `--no-X` defaults leaking into the config-merge layer; fixed by commit 39e48c21 ("fix(core,cli): honor artwork=false") and its follow-up `0d0e8dd5` (extract option-source helper).

**Test added** to `packages/podkit-core/src/sync/music/handler.test.ts` — `MusicHandler.executeBatch — artwork forwarding` describe block. `spyOn(MusicPipeline.prototype, 'execute').mockImplementation(...)` intercepts and inspects options.

Sonnet review pass — no blockers. Two suggestions applied:
- Trimmed commit SHA from rationale comment (SHAs rot for future readers).
- Added clarifying comment to the "omitted → undefined" case to pin the narrower invariant (handler must not substitute a default).
- Added cast comment explaining bun:test spy typing limitation.

Quality gates:
- `bun test packages/podkit-core/src/sync/music/handler.test.ts` → 93 pass, 0 fail.
- `bun run test:unit --filter @podkit/core` → 2893 pass, 5 skip, 0 fail.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TASK-388's original premise was stale. Investigation showed the handler → pipeline forwarding (handler.ts line 956–960) already correctly threads `artwork` through `this.config.raw.artwork`. The observed symptom (sidecar `cover.jpg` written despite `artwork = false`) was a Commander `--no-X` default leak at the CLI layer, fixed earlier by commit 39e48c21.

Repurposed scope: instead of changing prod code, added a regression-pinning describe block to `handler.test.ts` (`MusicHandler.executeBatch — artwork forwarding`). Three tests cover artwork=false / artwork=true / omitted-artwork forwarding using `spyOn(MusicPipeline.prototype, 'execute')`. The narrower invariants — "handler does not substitute a default", "pipeline owns the default" — are now structural.

No prod code change; pin only. The other layers in the contract are already covered: CLI flag → `option-source.test.ts`, pipeline gate → `pipeline.test.ts`. The handler boundary was the missing piece.
<!-- SECTION:FINAL_SUMMARY:END -->
