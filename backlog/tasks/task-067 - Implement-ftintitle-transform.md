---
id: TASK-067
title: Implement ftintitle transform
status: To Do
assignee: []
created_date: '2026-02-27 14:42'
labels:
  - feature
  - sync
  - metadata
  - transforms
dependencies:
  - TASK-065
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Summary

Implement the ftintitle transform feature as designed in TASK-065. This moves "featuring" artists from the Artist field to the Title field during sync, matching the beets ftintitle plugin behavior.

**Before:** Artist: `"Artist A feat. Artist B"`, Title: `"Song Name"`
**After:** Artist: `"Artist A"`, Title: `"Song Name (feat. Artist B)"`

## Implementation Details

### File Structure

```
packages/podkit-core/src/
├── transforms/
│   ├── index.ts                    # Public API exports
│   ├── types.ts                    # Transform interfaces
│   ├── pipeline.ts                 # Transform pipeline (apply in order)
│   ├── ftintitle/
│   │   ├── index.ts                # ftintitle transform implementation
│   │   ├── patterns.ts             # Regex patterns (ported from beets)
│   │   ├── extract.ts              # Featured artist extraction logic
│   │   └── ftintitle.test.ts       # Tests
│   └── __tests__/
│       └── pipeline.test.ts        # Pipeline tests
├── sync/
│   ├── differ.ts                   # Update for dual-key matching
│   ├── types.ts                    # Add toUpdate, UpdateReason
│   └── planner.ts                  # Generate update operations
├── config/
│   └── types.ts                    # Add TransformsConfig
```

### Core Interfaces

```typescript
// transforms/types.ts

export interface TransformableTrack {
  artist: string;
  title: string;
  album: string;
  albumArtist?: string;
}

export interface TransformResult<T extends TransformableTrack> {
  original: T;
  transformed: T;
  applied: boolean;  // true if any changes were made
}

export interface TrackTransform<TConfig = unknown> {
  name: string;
  defaultConfig: TConfig;
  apply(track: TransformableTrack, config: TConfig): TransformableTrack;
}

// sync/types.ts additions

export type UpdateReason = 
  | 'transform-apply'    // Need to apply transform (config enabled)
  | 'transform-remove'   // Need to remove transform (config disabled)  
  | 'metadata-changed';  // Source metadata changed

export interface UpdateTrack {
  source: CollectionTrack;
  ipod: IPodTrack;
  reason: UpdateReason;
  changes: MetadataChange[];
}

export interface MetadataChange {
  field: 'artist' | 'title' | 'album' | 'albumArtist';
  from: string;
  to: string;
}

export interface SyncDiff {
  toAdd: CollectionTrack[];
  toRemove: IPodTrack[];
  existing: MatchedTrack[];
  toUpdate: UpdateTrack[];  // NEW
}
```

### Config Schema

```toml
# Global config (current)
[transforms.ftintitle]
enabled = true
drop = false           # Drop feat. info instead of moving to title
format = "feat. {}"    # {} replaced with featured artist(s)
```

```typescript
interface FtInTitleConfig {
  enabled: boolean;   // default: false
  drop: boolean;      // default: false
  format: string;     // default: "feat. {}"
}

interface TransformsConfig {
  ftintitle?: FtInTitleConfig;
}

interface PodkitConfig {
  // ... existing fields
  transforms?: TransformsConfig;
}
```

### Regex Patterns (port from beets)

```typescript
// Explicit featuring words (for title matching)
const FEAT_WORDS_EXPLICIT = ['ft', 'featuring', 'feat', 'feat.', 'ft.'];

// All featuring words including generic separators (for artist matching)
const FEAT_WORDS_ARTIST = [
  ...FEAT_WORDS_EXPLICIT,
  'with', 'vs', 'and', 'con', '&'
];

// Bracket keywords - insert feat. before these in title
const BRACKET_KEYWORDS = [
  'abridged', 'acapella', 'club', 'demo', 'edit', 'edition',
  'extended', 'instrumental', 'live', 'mix', 'radio', 'release',
  'remaster', 'remastered', 'remix', 'rmx', 'unabridged',
  'unreleased', 'version', 'vip',
];

// Pattern: lookbehind for whitespace/bracket, lookahead for whitespace
function createFeatTokensRegex(forArtist: boolean): RegExp {
  const words = forArtist ? FEAT_WORDS_ARTIST : FEAT_WORDS_EXPLICIT;
  const escaped = words.map(w => escapeRegex(w));
  return new RegExp(`(?<=[\\s(\\[])(?:${escaped.join('|')})(?=\\s)`, 'i');
}
```

### Dual-Key Differ Algorithm

For each source track:
1. Compute both original and transformed versions
2. Generate match keys for both
3. Check which version exists on iPod
4. Categorize based on current config vs what's on iPod:
   - iPod has transformed, config wants transformed → existing
   - iPod has transformed, config wants original → toUpdate (transform-remove)
   - iPod has original, config wants transformed → toUpdate (transform-apply)
   - iPod has original, config wants original → existing
   - No match → toAdd

### Attribution

All files ported from beets must include:

```typescript
/**
 * Ported from beets ftintitle plugin
 * Original: Copyright 2016, Verrus, <github.com/Verrus/beets-plugin-featInTitle>
 * Source: https://github.com/beetbox/beets/blob/master/beetsplug/ftintitle.py
 * License: MIT
 */
```

### Test Cases

```typescript
const TEST_CASES = [
  { input: { artist: 'A feat. B', title: 'Song' }, expected: { artist: 'A', title: 'Song (feat. B)' } },
  { input: { artist: 'A featuring B', title: 'Song' }, expected: { artist: 'A', title: 'Song (feat. B)' } },
  { input: { artist: 'A ft. B', title: 'Song (Remix)' }, expected: { artist: 'A', title: 'Song (feat. B) (Remix)' } },
  { input: { artist: 'A', title: 'Song (feat. B)' }, expected: { artist: 'A', title: 'Song (feat. B)' } }, // skip
  { input: { artist: 'A', title: 'Song' }, expected: { artist: 'A', title: 'Song' } }, // no feat
];
```

### CLI Output

Dry-run should show:
```
Transforms:
  ftintitle: enabled (format: "feat. {}")

Summary:
  Tracks to add: 5
  Tracks to update: 147
    Apply ftintitle: 145
    Metadata changed: 2
  ...
```

## Reference

- Beets ftintitle docs: https://beets.readthedocs.io/en/stable/plugins/ftintitle.html
- Beets source: https://github.com/beetbox/beets/blob/master/beetsplug/ftintitle.py
- Design task: TASK-065
- Architecture docs: docs/TRANSFORMS.md
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Transform infrastructure created (types.ts, pipeline.ts)
- [ ] #2 ftintitle patterns ported from beets with attribution
- [ ] #3 ftintitle transform implemented with all config options
- [ ] #4 Unit tests for ftintitle logic and edge cases
- [ ] #5 Config schema extended with transforms section
- [ ] #6 Differ updated for dual-key matching
- [ ] #7 SyncDiff includes toUpdate category with UpdateReason
- [ ] #8 Planner generates update operations for transform changes
- [ ] #9 Executor calls updateTrack() for metadata-only updates
- [ ] #10 CLI dry-run shows transform stats and before/after
- [ ] #11 Integration tests for enable/disable transform scenarios
<!-- AC:END -->
