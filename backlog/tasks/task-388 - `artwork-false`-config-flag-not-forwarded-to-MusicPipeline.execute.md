---
id: TASK-388
title: '`artwork = false` config flag not forwarded to MusicPipeline.execute()'
status: To Do
assignee: []
created_date: '2026-06-04 08:18'
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
priority: medium
ordinal: 114000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

While diagnosing TASK-387 (codec-preference e2e flakes), sub-agent C found that `MusicPresenter.executeSync` reads `config.effectiveArtwork` from the resolved config but does not pass it through to `executor.execute(...)`. The executor's `artwork` parameter defaults to `true`, so a user who sets `artwork = false` in their TOML still has artwork transfer attempted.

## Symptom

A `[devices.foo] artwork = false` (or top-level `artwork = false`) is parsed, resolved correctly, surfaced in `--json` decisions output, but is silently ignored at execution time.

Cosmetically the sync succeeds; the user thinks "OK artwork is off" while podkit is still extracting + transferring artwork on every sync. With TASK-370 in place this now also writes sidecar `cover.jpg` files unexpectedly.

## Scope

1. `packages/podkit-cli/src/commands/music-presenter.ts` (or wherever `executeSync` resolves the executor's `execute` options): pass `artwork: config.effectiveArtwork` through to the `execute(...)` call.
2. Add a test: a sync with `artwork = false` config + a source with embedded artwork → assert no `setArtworkFromData` / `updateTrack({embeddedPictureData})` / `writeSidecar` is called. Pin the contract.
3. Verify the CLI flag (`--no-artwork`) and TOML key produce the same result.
4. Smoke: run a real sync against a fake target to verify no artwork bytes hit the device.

## Acceptance criteria

- `artwork = false` in TOML produces a sync with zero artwork-write operations.
- `--no-artwork` flag produces the same.
- Regression test pins the contract.

## Reference

- Discovered during TASK-387 investigation (2026-06-04).
- `packages/podkit-cli/src/commands/music-presenter.ts` `executeSync` is the suspect callsite.
<!-- SECTION:DESCRIPTION:END -->
