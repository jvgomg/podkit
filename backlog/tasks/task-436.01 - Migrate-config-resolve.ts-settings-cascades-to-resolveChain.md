---
id: TASK-436.01
title: Migrate config/resolve.ts settings cascades to resolveChain
status: Done
assignee: []
created_date: '2026-06-24 15:19'
updated_date: '2026-06-24 16:02'
labels:
  - config
  - refactor
dependencies: []
parent_task_id: TASK-436
ordinal: 182000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Behavior-neutral refactor. Migrate the hand-written quality/audio/video/artwork cascades in `config/resolve.ts` (both global and device variants) onto the shared `resolveChain` primitive from `@podkit/device-types`, finishing the half-done migration the file already started for simple scalars.

Every existing source label (`global-quality`, `device-quality`, `unsupported`, `unknown`, etc.) and the capability-gating order (the explicit-`false` bypass and the unsupported/unknown checks) must be preserved exactly. Stop growing the parallel `ConfigSource` vocabulary; demote the thin `ResolvedValue<T>` alias toward the canonical `Resolved<T, Source>` where practical.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user story 23.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 quality/audio/video/artwork global+device cascades in config/resolve.ts route through resolveChain (no hand-written if-ladders remain for these fields)
- [x] #2 Capability gating (explicit-false bypass, unsupported/unknown precedence) is unchanged
- [x] #3 Existing config/resolve.test.ts passes with no assertion changes attributable to this refactor
- [x] #4 No new *Source provenance union is introduced
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Migrated the hand-written if-ladders in packages/podkit-cli/src/config/resolve.ts onto resolveChain<T, ConfigSource>:

- resolveGlobalAudio: single layer [config.audioQuality → 'global'], default quality.value/'global-quality'.
- resolveGlobalVideo: single layer [config.videoQuality → 'global'], default (quality.value as VideoQualityPreset)/'global-quality'.
- resolveDeviceQuality: single layer [deviceConfig.quality → 'device'], default config.quality/'global-quality'.
- resolveDeviceAudio: 3 layers [device.audioQuality→'device', device.quality→'device-quality', global.audioQuality→'global'], with default = quality.value/quality.source (dynamic source preserved — carries the already-resolved global quality's own 'global'/'global-quality' label).
- resolveDeviceVideo: capability gating (null→'unknown', !supportsVideo→'unsupported') kept BEFORE the cascade; cascade then routes through resolveChain with the same 3 layers + dynamic quality default as audio.
- resolveDeviceArtwork: explicit-false bypass (device then global) and capability gating (null→'unknown', empty artworkSources→'unsupported') kept with their original precedence; only the final 2-layer cascade [device.artwork→'device'] default config.artwork/'global' was moved to resolveChain. Safe because resolveChain skips only undefined, so a defined `true`/`false` device value is honored exactly as the old `!== undefined` check did; by the time the cascade runs, device.artwork is undefined or true (false handled by bypass).

Intentionally left un-migrated:
- resolveGlobalArtwork: NOT a cascade — it returns the always-present required config.artwork with a fixed 'global' source. There is no if-ladder to remove; wrapping it in resolveChain (empty layers + mandatory default) would add noise, not remove it. Left as a direct single-value return.
- resolveGlobalQuality: same — single mandatory value, no cascade, untouched.

No new *Source union introduced; reused ConfigSource throughout. ResolvedValue<T> alias left in place (widely imported across the CLI; demoting it would exceed the intended blast radius). resolveChain itself unchanged.

Gates (from repo root): typecheck (tsc --noEmit) clean; oxlint on resolve.ts 0 warnings/0 errors; bun run build --filter podkit successful; bun run test:unit --filter podkit → 1817 pass / 0 fail; config/resolve.test.ts → 51 pass / 0 fail with no assertion edits.
<!-- SECTION:NOTES:END -->
