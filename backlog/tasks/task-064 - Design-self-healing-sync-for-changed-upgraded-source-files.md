---
id: TASK-064
title: Design self-healing sync for changed/upgraded source files
status: To Do
assignee: []
created_date: '2026-02-26 14:38'
updated_date: '2026-03-14 02:42'
labels:
  - design
  - sync
  - feature
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

Currently, sync only detects new tracks and tracks to remove. It doesn't detect when a source file has changed and should be re-synced:

- **Format upgrade:** MP3 replaced with FLAC → should resync with better quality
- **Artwork added:** Track now has embedded artwork → should sync artwork (or resync track)
- **Metadata corrected:** Tags fixed in source → should update iPod copy
- **Bitrate upgrade:** 128kbps → 320kbps → should resync

## Current Behavior

Sync matches tracks by artist/title/album. If a track exists on both source and iPod, it's considered "already synced" and skipped, even if the source file has improved.

## Desired Behavior

Detect meaningful changes in source files and offer to resync:

```bash
podkit sync --dry-run

Changes:
  Tracks to add: 5
  Tracks to update: 12      # <-- NEW
    - Format upgrade: 8     # MP3 → FLAC
    - Artwork added: 3      # Now has artwork
    - Metadata changed: 1   # Tags updated
  Already synced: 1,397
```

## Design Questions

### 1. Change Detection

How to detect a source file changed?
- **File hash:** Accurate but slow for large libraries
- **Modification time:** Fast but may miss changes
- **Metadata comparison:** Compare bitrate, format, artwork presence, etc.

### 2. What Triggers Resync?

Which changes are "meaningful" enough to resync?
- Format upgrade (lossy → lossless, or higher bitrate lossy)
- Artwork added (track had none, now has some)
- Quality upgrade (bitrate increased significantly)

Should metadata-only changes (title spelling fix) trigger resync?

### 3. Update vs Replace

Options for updating a track:
- **Replace:** Remove old track, add new one (simple, loses play count)
- **Update in place:** Modify existing track (preserves play count, more complex)
- **Artwork only:** Just update artwork without replacing audio

### 4. User Control

```bash
podkit sync                     # Default: don't auto-upgrade
podkit sync --upgrade           # Include upgrades in sync
podkit sync --upgrade=format    # Only format upgrades
podkit sync --upgrade=artwork   # Only artwork additions
```

## Implementation Considerations

- Need to store sync metadata (what version of file was synced)
- Relates to TASK-062 (collection caching would track file state)
- May need SQLite or similar to track sync state per collection/device pair

## Outcome

Design document / ADR covering:
- Change detection strategy
- What constitutes a "meaningful" change
- Update vs replace approach
- CLI flags and configuration
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Change detection strategy decided
- [ ] #2 Meaningful change criteria defined
- [ ] #3 Update vs replace approach chosen
- [ ] #4 CLI/config options designed
- [ ] #5 ADR documenting the approach
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
### Sound Check / volume normalization

With TASK-133 (Sound Check support), tracks now carry a `soundcheck` value extracted from ReplayGain/iTunNORM tags. If a user adds normalization data to files that are already synced (e.g., runs `loudgain` on their collection), the soundcheck value won't be updated on the iPod because the diff engine only matches on core metadata (title/artist/album). The track would need to be removed and re-added.

This is a candidate for the "meaningful change" criteria — a soundcheck value appearing (or changing) on a source track that's already synced could trigger an in-place metadata update without replacing the audio file, since soundcheck is just a database field, not part of the audio data.
<!-- SECTION:NOTES:END -->
