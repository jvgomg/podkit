---
id: US-20
title: Self-healing sync
priority: P1
status: out-of-scope
scope: out
theme: selection-fundamentals
last-updated: 2026-05-11
addressed-by:
  features: []
  principles: []
  open-questions: []
  spikes: []
---

# US-20 — Self-healing sync

> When a source file changes, the next sync should detect the change and
> upgrade the device's copy automatically.

## Detail

If a user re-tags a file, swaps it out for a higher-quality version, or
otherwise modifies a file in their source, podkit should notice and
update the device's copy on the next sync. Today's sync compares by file
identity in ways that miss content-level changes.

## Resolution

**Out of scope for this workspace.** Covered by ADR-009 (self-healing
sync) and the associated implementation work. Listed here because the
machinery (track identity, change detection) overlaps with concerns this
workspace touches:

- [Track identity](../../features/track-identity.md) is the same
  primitive needed for both self-healing and cross-source playlists.
  The track-identity sub-PRD should explicitly acknowledge ADR-009 as
  a consumer.
- Content-hash-based detection is covered by ADR-012 (artwork change
  detection) and adjacent work.

This story is archived as out-of-scope; the link to the music-selection
design exists primarily so the track-identity sub-PRD honours the
existing self-healing requirements.
