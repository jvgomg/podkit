---
id: TASK-255
title: Improve `device add` output and onboarding tips
status: Done
assignee: []
created_date: '2026-03-31 12:55'
updated_date: '2026-03-31 13:11'
labels:
  - ux
  - cli
milestone: m-14
dependencies: []
references:
  - packages/podkit-cli/src/commands/device.ts
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The `device add` command output is too sparse and the tips aren't context-aware. Discovered during Echo Mini E2E validation (TASK-226).

**Issues:**

1. **Config summary missing:** After adding a device, the output only shows name, type, and path. Users should see a table of effective settings with provenance — what was set explicitly via CLI flags, what comes from the device preset, and what falls back to global defaults. This helps users understand what they've configured.

2. **"Add a music collection" tip shown when collections exist:** The next-steps tip always suggests adding a music collection, even when the user already has collections configured. Should only show this for first-time onboarding. Instead, suggest `podkit device info` to see full device details.

3. **No indication of first-class device support:** When a user adds a device with `--type echo-mini`, there's no confirmation that the device has a predefined profile with known capabilities. Users should see that their device has first-class support.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 After `device add`, display a table showing effective settings (quality, artwork, codec support, etc.) with provenance indicators (explicit/preset/default)
- [x] #2 Only show 'add a music collection' tip when no collections are configured
- [x] #3 Show 'run podkit device info for more details' tip when collections already exist
- [ ] #4 Display a message confirming first-class device support when a known device type preset is used
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented #1 (settings summary with provenance), #2 (collection-aware tips), and #3 (device info tip). Criteria #4 (preset confirmation message) deferred — the device preset/type system (`getDevicePreset`, `--type` flag for device add) does not exist yet. The `printDeviceAddSummary` helper is structured to be extended when presets are added.

Criteria #1: Settings summary shows quality, artwork, and transfer mode with provenance (device/global/default). Codec support, artwork max resolution, and audio normalization are preset-dependent and will be added when the preset system is implemented.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented improved `device add` output in `packages/podkit-cli/src/commands/device.ts`.\n\nChanges:\n- Added `printDeviceAddSummary` helper that both the explicit-path and auto-detected device flows now use\n- Settings summary shows effective quality, artwork, and transfer mode with provenance indicators (device/global/default)\n- Collection tip only shown when no music collections are configured (first-time onboarding)\n- When collections exist, shows `podkit device info -d <name>` tip instead\n- Criteria #4 (preset confirmation message) deferred pending the device preset/type system implementation\n\nAll 807 CLI unit tests pass. Changeset created in `.changeset/device-add-summary.md`."]
<!-- SECTION:FINAL_SUMMARY:END -->
