# ADR-004: Collection Source Abstraction

## Status

**Accepted** (2026-02-22)

## Context

podkit needs to read music collections to determine what to sync to iPods. After evaluating options, we decided to focus on a single, universal approach rather than supporting multiple source-specific adapters.

### Options Evaluated

| Approach | Pros | Cons |
|----------|------|------|
| **Strawberry SQLite** | Rich metadata, fast queries | Strawberry-only users |
| **beets SQLite/CLI** | Custom fields, query language | beets-only users, rare edge cases |
| **Directory + music-metadata** | Universal, works for everyone | Must scan files, no custom DB fields |

### Decision

**Directory scanning with `music-metadata` library** as the sole collection source for v1.0.

**Rationale:**
- Works for any user with music files, regardless of music player
- `music-metadata` is actively maintained, supports all common formats (FLAC, MP3, M4A, OGG, OPUS)
- Extracts MusicBrainz IDs, embedded artwork detection
- Strawberry/beets users already have well-tagged files
- Simpler implementation and maintenance

The adapter pattern is retained in the codebase for potential future sources, but only the directory adapter will be implemented initially.

## Decision Drivers

- Extensibility (easy to add new sources)
- Consistency (uniform interface for sync engine)
- Performance (efficient querying)
- Maintenance (isolated changes)
- User experience (simple configuration)

## Options Considered

### Option A: Direct Integration

Implement each source directly in the sync engine with conditionals.

**Pros:**
- Simple for small number of sources
- No abstraction overhead

**Cons:**
- Code duplication
- Difficult to extend
- Testing complexity
- Tight coupling

### Option B: Adapter Pattern (Recommended)

Define a common interface; each source implements an adapter.

**Pros:**
- Clean separation of concerns
- Easy to add new sources
- Testable in isolation
- Consistent behavior

**Cons:**
- Some abstraction overhead
- May not fit all sources perfectly

### Option C: Plugin System

Dynamic plugin loading for sources.

**Pros:**
- Ultimate extensibility
- Third-party contributions
- Runtime discovery

**Cons:**
- Over-engineering for current needs
- Security considerations
- Complex distribution

## Decision

**Option B: Adapter Pattern**

### Interface Design

```typescript
/**
 * Collection adapter interface.
 * Implementations provide access to a music collection from a specific source.
 */
interface CollectionAdapter {
  /** Unique identifier for this adapter */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /** Configuration schema (for CLI/config file) */
  readonly configSchema: ConfigSchema;

  /**
   * Initialize connection to the collection.
   * @param config - Source-specific configuration
   */
  connect(config: AdapterConfig): Promise<void>;

  /**
   * Retrieve all tracks from the collection.
   * Should return tracks sorted by artist, album, track number.
   */
  getTracks(): Promise<CollectionTrack[]>;

  /**
   * Retrieve tracks matching a filter.
   * Implementations may optimize queries based on filter.
   */
  getFilteredTracks(filter: TrackFilter): Promise<CollectionTrack[]>;

  /**
   * Get absolute filesystem path for a track.
   * May involve URL decoding, path resolution, etc.
   */
  getFilePath(track: CollectionTrack): string;

  /**
   * Check if the track's source file exists and is readable.
   */
  fileExists(track: CollectionTrack): Promise<boolean>;

  /**
   * Clean up resources (close database connections, etc.)
   */
  disconnect(): Promise<void>;
}
```

### Track Model

```typescript
interface CollectionTrack {
  // === Identity ===
  /** Unique identifier within this collection */
  id: string;

  // === Core Metadata (required for matching) ===
  title: string;
  artist: string;
  album: string;

  // === Extended Metadata ===
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  totalTracks?: number;
  discNumber?: number;
  totalDiscs?: number;
  duration?: number;  // milliseconds
  composer?: string;
  comment?: string;

  // === File Information ===
  filePath: string;
  fileType: AudioFileType;
  fileSize?: number;
  mtime?: Date;

  // === External Identifiers ===
  musicBrainzRecordingId?: string;
  musicBrainzReleaseId?: string;
  musicBrainzArtistId?: string;
  acoustId?: string;

  // === Artwork ===
  hasEmbeddedArtwork?: boolean;
  externalArtworkPath?: string;

  // === Source-Specific ===
  sourceData?: Record<string, unknown>;
}

type AudioFileType =
  | 'flac'
  | 'mp3'
  | 'aac'
  | 'm4a'
  | 'alac'
  | 'ogg'
  | 'opus'
  | 'wav'
  | 'unknown';
```

### Filter Model

```typescript
interface TrackFilter {
  // Text matching (case-insensitive, partial match)
  artist?: string;
  album?: string;
  title?: string;
  genre?: string;

  // Numeric ranges
  yearFrom?: number;
  yearTo?: number;

  // Date filters
  addedAfter?: Date;
  addedBefore?: Date;
  modifiedAfter?: Date;

  // Free-text search (implementation-specific)
  query?: string;

  // Limit results
  limit?: number;
  offset?: number;
}
```

### Registry Pattern

```typescript
class AdapterRegistry {
  private adapters = new Map<string, AdapterFactory>();

  /**
   * Register an adapter factory.
   */
  register(name: string, factory: AdapterFactory): void {
    if (this.adapters.has(name)) {
      throw new Error(`Adapter '${name}' already registered`);
    }
    this.adapters.set(name, factory);
  }

  /**
   * Create an adapter instance.
   */
  create(name: string, config?: AdapterConfig): CollectionAdapter {
    const factory = this.adapters.get(name);
    if (!factory) {
      throw new Error(`Unknown adapter: ${name}. Available: ${this.list().join(', ')}`);
    }
    return factory(config);
  }

  /**
   * List registered adapter names.
   */
  list(): string[] {
    return Array.from(this.adapters.keys());
  }
}

type AdapterFactory = (config?: AdapterConfig) => CollectionAdapter;
```

## Implementation Strategy

### v1.0: Directory Adapter with music-metadata

```typescript
// packages/podkit-core/src/adapters/directory.ts
import { glob } from 'glob';
import * as mm from 'music-metadata';

export class DirectoryAdapter implements CollectionAdapter {
  readonly name = 'directory';
  readonly description = 'Directory scan with music-metadata';

  constructor(private config: { path: string; extensions?: string[] }) {}

  async connect(): Promise<void> {
    await this.scan();
  }

  async getTracks(): Promise<CollectionTrack[]> {
    // Scan directory, parse metadata with music-metadata
  }
}
```

### Registry (simplified)

```typescript
// packages/podkit-core/src/adapters/index.ts
import { AdapterRegistry } from './registry';
import { DirectoryAdapter } from './directory';

export const defaultRegistry = new AdapterRegistry();
defaultRegistry.register('directory', (config) => new DirectoryAdapter(config));

export { defaultRegistry as registry };
```

### Future Adapters (on request)

Additional adapters may be added if users request them:
- Strawberry (SQLite)
- beets (SQLite)
- Navidrome/Jellyfin (API)
- iTunes XML (legacy)

## Consequences

### Positive

- Universal: works for any user with music files
- Simple: single implementation to maintain
- No external dependencies on music players
- Adapter pattern retained for future extensibility

### Negative

- Must scan files each time (no database cache)
- Cannot access music-player-specific custom fields
- Users who don't tag their files will have poor metadata

### Filtering & Sync Selection (Future - M4)

Without beets' custom fields, users need other ways to control what syncs:

| Approach | Description |
|----------|-------------|
| **Playlist-based** | Import M3U/M3U8 playlists |
| **Path patterns** | Include/exclude directories |
| **Tag filters** | Filter by genre, artist, year, etc. |

Playlist-based is recommended as the primary approach - users already know how to create playlists.

### Future Considerations

1. **Caching** - Cache scan results to speed up subsequent runs
2. **Incremental scanning** - Only re-scan files with changed mtime
3. **Additional adapters** - Add Strawberry/beets if users request

## Related Decisions

- ADR-001: Runtime choice - Adapters work with both Node and Bun
- ADR-002: libgpod binding - iPod is a "destination adapter" conceptually

## References

- [Adapter Pattern (Design Patterns)](https://refactoring.guru/design-patterns/adapter)
- [Strawberry Database Schema](https://github.com/strawberrymusicplayer/strawberry)
- [beets Database Documentation](https://beets.readthedocs.io/en/stable/dev/db.html)
