---
title: "ADR-004: Collection Source Abstraction"
description: Decision to use adapter pattern for music collection sources.
sidebar:
  order: 5
---

# ADR-004: Collection Source Abstraction

## Status

**Accepted** (2026-02-22)

## Context

podkit needs to read music collections to determine what to sync to iPods. After evaluating options, we decided to focus on a universal approach using the adapter pattern.

### Options Evaluated

| Approach | Pros | Cons |
|----------|------|------|
| **Strawberry SQLite** | Rich metadata, fast queries | Strawberry-only users |
| **beets SQLite/CLI** | Custom fields, query language | beets-only users |
| **Directory + music-metadata** | Universal, works for everyone | Must scan files |

### Decision

**Directory scanning with `music-metadata` library** as the primary collection source.

**Rationale:**
- Works for any user with music files, regardless of music player
- `music-metadata` is actively maintained, supports all common formats
- Extracts MusicBrainz IDs, embedded artwork detection
- Simpler implementation and maintenance

## Decision Drivers

- Extensibility (easy to add new sources)
- Consistency (uniform interface for sync engine)
- User experience (simple configuration)

## Options Considered

### Option A: Direct Integration

Implement each source directly with conditionals.

**Cons:**
- Code duplication
- Difficult to extend
- Tight coupling

### Option B: Adapter Pattern (Recommended)

Define a common interface; each source implements an adapter.

**Pros:**
- Clean separation of concerns
- Easy to add new sources
- Testable in isolation

## Decision

**Option B: Adapter Pattern**

### Interface Design

```typescript
interface CollectionAdapter {
  readonly name: string;
  readonly description: string;

  connect(config: AdapterConfig): Promise<void>;
  getTracks(): Promise<CollectionTrack[]>;
  getFilteredTracks(filter: TrackFilter): Promise<CollectionTrack[]>;
  getFilePath(track: CollectionTrack): string;
  disconnect(): Promise<void>;
}
```

### Track Model

```typescript
interface CollectionTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  filePath: string;
  fileType: AudioFileType;
  hasEmbeddedArtwork?: boolean;
}
```

## Implementation Strategy

### v1.0: Directory Adapter

```typescript
import * as mm from 'music-metadata';

export class DirectoryAdapter implements CollectionAdapter {
  readonly name = 'directory';

  async getTracks(): Promise<CollectionTrack[]> {
    // Scan directory, parse metadata
  }
}
```

### Future Adapters

Additional adapters may be added if users request them:
- Strawberry (SQLite)
- beets (SQLite)
- Navidrome/Jellyfin (API)
- Subsonic (API) - see [ADR-007](/developers/adr/adr-007-subsonic-collection-source)

## Consequences

### Positive

- Universal: works for any user with music files
- Simple: single implementation to maintain
- Adapter pattern retained for future extensibility

### Negative

- Must scan files each time (no database cache)
- Cannot access music-player-specific custom fields

## Related Decisions

- [ADR-001](/developers/adr/adr-001-runtime): Runtime choice
- [ADR-007](/developers/adr/adr-007-subsonic-collection-source): Subsonic adapter implementation

## References

- [Adapter Pattern (Design Patterns)](https://refactoring.guru/design-patterns/adapter)
- [music-metadata npm package](https://www.npmjs.com/package/music-metadata)
