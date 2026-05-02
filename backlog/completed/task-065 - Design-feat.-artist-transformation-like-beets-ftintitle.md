---
id: TASK-065
title: Design "feat. artist" transformation (like beets ftintitle)
status: Done
assignee: []
created_date: '2026-02-26 14:38'
updated_date: '2026-02-27 14:42'
labels:
  - design
  - feature
  - metadata
  - transforms
dependencies:
  - TASK-062
  - TASK-064
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

iPods don't respect the "Album Artist" field, leading to cluttered artist lists with many permutations:
- "Artist A"
- "Artist A feat. Artist B"
- "Artist A & Artist C"
- "Artist A featuring Artist D"

Users prefer a clean artist list where collaborations are shown in the title instead.

## Reference: Beets ftintitle Plugin

https://beets.readthedocs.io/en/stable/plugins/ftintitle.html

This plugin moves featuring artists from the Artist field to the Title:
- **Before:** Artist: "Artist A feat. Artist B", Title: "Song Name"
- **After:** Artist: "Artist A", Title: "Song Name (feat. Artist B)"

### Beets Config Options

```yaml
ftintitle:
  auto: yes
  drop: no           # If true, drop feat. entirely instead of moving to title
  format: 'feat. {0}' # Format string for title suffix
```

## Proposed Approach

### 1. Transform Configuration

```toml
[devices.terapod]
mount = "/Volumes/TERAPOD"

[devices.terapod.transforms]
ftintitle = true
# or with options:
# ftintitle = { format = "feat. {0}", drop = false }
```

Per-device configuration allows different iPods to have different preferences.

### 2. Transform in Sync Pipeline

Apply transformation during sync, not to source files:
- Source metadata preserved
- Transform applied when writing to iPod
- Diffing compares transformed metadata

### 3. Integration with Diffing

The differ needs to compare source tracks with their *transformed* version against iPod tracks:

```typescript
function matchTracks(sourceTrack, ipodTrack, transforms) {
  const transformed = applyTransforms(sourceTrack, transforms);
  return transformed.artist === ipodTrack.artist 
      && transformed.title === ipodTrack.title;
}
```

### 4. Self-Healing on Config Change

If user toggles ftintitle on/off:
- **On → Off:** Tracks should resync with original metadata
- **Off → On:** Tracks should resync with transformed metadata

This depends on self-healing sync (detecting config-driven changes).

## Dependencies

- **TASK-062:** Multi-device config structure (where to store per-device transforms)
- **Self-healing sync task:** For handling config change scenarios

## Implementation Tasks

1. Research beets ftintitle source code for regex patterns
2. Design transform interface (extensible for future transforms)
3. Implement ftintitle transform
4. Integrate with differ
5. Handle config change scenarios
6. Tests with various "feat." formats

## Regex Patterns to Handle

- "feat. Artist"
- "featuring Artist"
- "ft. Artist"
- "Feat. Artist"
- "with Artist"
- "& Artist" (maybe?)
- "(feat. Artist)" already in title (don't double-add)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Beets ftintitle plugin reviewed for patterns and config
- [x] #2 Transform interface designed (extensible)
- [x] #3 Per-device config structure defined
- [x] #4 Diffing integration approach documented
- [x] #5 Self-healing behavior on config change defined
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Design Complete

Comprehensive design discussion completed for the ftintitle transform feature. Key decisions:

### Architecture
- **Transform pipeline**: Transforms applied before diffing, creating both original and transformed versions of each track
- **Dual-key matching**: Differ checks iPod tracks against both original and transformed match keys to handle config changes gracefully
- **In-place updates**: Use `updateTrack()` to modify metadata without re-adding tracks (preserves play counts, ratings)

### Config Schema
- Global config now: `[transforms.ftintitle]` with `enabled`, `drop`, `format` options
- Per-device config later (when TASK-062 complete)
- Matches beets ftintitle plugin API

### Implementation Approach
- Port beets ftintitle regex patterns and logic with attribution
- Handle edge cases: title already has feat, bracket positioning (before Remix/Edit), Various Artists compilations
- New `toUpdate` category in SyncDiff for transform apply/remove operations

### CLI Output
- Dry-run shows transform stats: "Apply ftintitle: 145"
- Shows before/after for transformed tracks

### Documentation
- Created docs/TRANSFORMS.md documenting the transform system architecture and ftintitle feature

### Next Steps
- TASK-066 created for implementation
<!-- SECTION:FINAL_SUMMARY:END -->
