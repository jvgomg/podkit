---
id: doc-018
title: 'PRD: Sync Preview Command'
type: other
created_date: '2026-03-23 18:26'
---
# PRD: Sync Preview Command

## Status: Draft — Needs Review

## Problem

Users cannot preview what podkit will do to their music collection without a physical device connected. Specifically:

1. **Transform preview**: There's no way to see how clean-artists transforms would affect track metadata without running a sync. A tester had to reimplement the transform logic in a standalone script to analyze their collection — fragile and divergence-prone.

2. **`sync --dry-run` requires a device**: The current dry-run mode needs a connected iPod to compute the diff. Users who want to understand podkit's behavior before plugging in (or who don't have their device handy) are blocked.

3. **No visibility into planner decisions**: Quality decisions (transcode vs. copy), artwork handling, and transform application are opaque until sync time. Users configuring podkit for the first time have no way to validate their setup.

## User Stories

- As a user configuring clean-artists for the first time, I want to preview which tracks would be transformed and how, so I can tune my ignore list before syncing.
- As a user setting up a new device, I want to see what a full sync would look like (track count, transcode decisions, artwork handling) without connecting my iPod.
- As a user with a connected device, I want a focused preview of what would change on next sync, with more detail than `sync --dry-run` provides about *why* each decision was made.

## Design Questions (Unresolved)

### 1. Command Location

Several options were discussed:

- **New top-level command** (e.g., `podkit preview`): Discoverable, clear purpose, but adds to the command surface area.
- **Subcommand of sync** (e.g., `podkit sync preview`): Groups related functionality, but `sync` currently implies device interaction.
- **Flag on collection** (e.g., `podkit collection music --tracks --for-device myipod`): Reuses existing infrastructure, but blurs the boundary between source data and sync planning.

### 2. Behavior With vs. Without Device

The command should adapt its output based on available information:

- **No device connected**: Can show transform preview, quality/transcode decisions (based on config), artwork analysis. Cannot show diff (what would be added/updated/removed).
- **Device connected**: Full preview including diff against current device state, plus all of the above.

Open question: Should the output explicitly tell the user what it *can't* show when the device is absent? Or should it silently show what's available?

### 3. Scope of Preview

Beyond transforms, what else should this command surface?

- **Quality decisions**: Which tracks would be transcoded vs. copied, and why (format mismatch, bitrate threshold)
- **Artwork handling**: Which tracks have artwork, which would get artwork transferred, artwork dimensions/format
- **Device capabilities**: What the target device supports (requires device profile/capabilities work — may not exist yet)
- **Planner summary**: High-level stats (N tracks to add, M to transcode, K to update metadata)

### 4. Transform Output Format

When showing transform results, the output should include both original and transformed values. Proposed fields for each affected track:

```json
{
  "artist": "Daft Punk feat. Pharrell Williams",
  "title": "Get Lucky",
  "transformedArtist": "Daft Punk",
  "transformedTitle": "Get Lucky (feat. Pharrell Williams)",
  "transformApplied": true
}
```

Open question: Should unaffected tracks be included (with `transformApplied: false`) or omitted? For analysis, including all tracks with the flag is more useful. For a focused "what changes" view, only affected tracks.

### 5. Relationship to Device Capabilities

The project has device profiles (`devices/ipod.md`, `devices/rockbox.md`) but device capabilities aren't yet represented in config or code as structured data. A preview command that shows quality/format decisions would benefit from knowing the target device's supported formats and limitations.

This PRD doesn't depend on device capabilities work, but should be designed to incorporate it later.

## Context

- Transform logic is pure and independently callable (`applyTransforms()` in `@podkit/core`)
- Per-device transform config lives in the config file under device settings
- The planner already computes quality/transcode decisions — this is about surfacing them outside of a full sync
- Related tester feedback captured in TASK-215 through TASK-218 (CLI output improvements)

## References

- Tester feedback session (2026-03-23)
- Transform implementation: `packages/podkit-core/src/transforms/`
- Planner: `packages/podkit-core/src/sync/music-planner.ts`
- Device profiles: `devices/`
