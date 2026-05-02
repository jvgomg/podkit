---
id: TASK-249.02
title: Capability-gated transform resolution + warnings
status: Done
assignee: []
created_date: '2026-03-27 12:47'
updated_date: '2026-03-28 15:15'
labels:
  - feature
  - transforms
  - device-capabilities
dependencies:
  - TASK-249.01
references:
  - doc-025
documentation:
  - agents/testing.md
  - docs/user-guide/devices/artist-transforms.md
parent_task_id: TASK-249
priority: medium
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Wire `supportsAlbumArtistBrowsing` into the transform resolution logic so that `cleanArtists` is automatically suppressed on devices that support Album Artist browsing. Add a warning system for users who force-enable it unnecessarily. See PRD: doc-025 for full context.

**Transform resolution — extend `getEffectiveTransforms()` in sync.ts:**
- Accept device capabilities as a new parameter
- Implement precedence rules:
  1. Per-device `cleanArtists` explicitly set → use that (highest priority)
  2. Global enabled + `supportsAlbumArtistBrowsing: false` → auto-enable
  3. Global enabled + `supportsAlbumArtistBrowsing: true` → auto-suppress
  4. Global disabled → disabled regardless
- Track resolution state (auto-enabled, auto-suppressed, explicitly enabled, explicitly disabled) for downstream warning/display logic

**Warning utility — new pure function:**
- Inputs: effective transforms config, device capabilities, whether user explicitly set cleanArtists per-device, whether user explicitly overrode supportsAlbumArtistBrowsing
- "Enabled but unnecessary" warning: fires when cleanArtists is explicitly enabled per-device AND effective `supportsAlbumArtistBrowsing` is `true` AND user has NOT overridden `supportsAlbumArtistBrowsing`
- No warning when user has overridden `supportsAlbumArtistBrowsing` to `false` — deliberate classification decision is trusted

**Dry-run output — music presenter pre-sync summary:**
- Auto-suppressed: terse message like `Clean artists: skipped (device supports Album Artist browsing)`
- Active with warning: show config + warning line
- Active without warning: show config as today

**Device info command:**
- Show transform warnings in text output after transforms section
- Include warnings in JSON output structure

**Self-healing:** No new code needed — existing dual-key matching + transform-remove machinery handles revert when cleanArtists is auto-suppressed. Tracks previously synced with transforms are matched via transform key and reverted.

**Documentation:** Update `docs/user-guide/devices/artist-transforms.md` to explain capability gating, auto-suppress behavior, and per-device force-enable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 getEffectiveTransforms uses supportsAlbumArtistBrowsing to auto-suppress cleanArtists when the device supports Album Artist browsing
- [x] #2 Per-device cleanArtists config overrides the auto-suppress (force-enable works)
- [x] #3 Global cleanArtists disabled results in disabled for all devices regardless of capability
- [x] #4 Resolution returns state metadata indicating why the transform is in its current state
- [x] #5 Warning utility returns 'enabled but unnecessary' when cleanArtists is explicitly enabled per-device on a device with supportsAlbumArtistBrowsing true (not overridden)
- [x] #6 Warning utility returns no warning when user has overridden supportsAlbumArtistBrowsing to false
- [x] #7 sync --dry-run shows terse auto-suppress message in pre-sync summary when cleanArtists is globally enabled but suppressed for the device
- [x] #8 sync --dry-run shows warning when cleanArtists is force-enabled on a device that supports Album Artist browsing
- [x] #9 device info text output shows transform warnings when applicable
- [x] #10 device info JSON output includes transform warnings in the output structure
- [x] #11 Existing self-healing behavior works: tracks with transformed metadata are reverted when cleanArtists is auto-suppressed (via existing dual-key matching)
- [x] #12 User documentation updated to cover capability gating and per-device override
- [x] #13 Unit tests cover: transform resolution precedence matrix (all 4 rules + combinations), warning utility (all conditions including capability override edge case), dry-run output variations, device info warning display
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented in the same commit as TASK-249.01.

Added capability-gated transform resolution and warning system:

- **Transform resolution:** New `resolveCleanArtistsTransform()` pure function implements 4 precedence rules: per-device explicit > global disabled > capability gate (auto-suppress when `supportsAlbumArtistBrowsing: true`, auto-enable when `false`). Returns resolution reason metadata.
- **Warning utility:** New `computeTransformWarnings()` fires "enabled but unnecessary" when cleanArtists is force-enabled per-device on a capable device, unless user overrode `supportsAlbumArtistBrowsing`.
- **Sync dry-run:** Text shows `Clean artists: skipped (device supports Album Artist browsing)` when auto-suppressed, warnings when force-enabled. JSON includes all resolution states with reasons.
- **Device info:** Transform warnings in both text and JSON output when per-device cleanArtists is configured.
- **Self-healing:** No new code — existing dual-key matching + transform-remove reverts tracks when auto-suppressed.
- **Tests:** 17 unit tests covering all precedence rules, warning conditions, and edge cases.
- **Docs:** New "Automatic Device Gating" section in artist-transforms.md.
<!-- SECTION:FINAL_SUMMARY:END -->
