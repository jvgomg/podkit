# ADR-004: Collection Source Abstraction

## Status

**Proposed**

## Context

podkit must support multiple music collection sources:
- Strawberry Music Player (v1.0)
- beets (v1.1)
- Directory scanning (v1.1)
- Future sources (Navidrome, Jellyfin, etc.)

An abstraction layer is needed to decouple sync logic from source-specific implementations.

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

### v1.0: Strawberry Adapter

```typescript
// packages/podkit-core/src/adapters/strawberry.ts
import Database from 'better-sqlite3';

export class StrawberryAdapter implements CollectionAdapter {
  readonly name = 'strawberry';
  readonly description = 'Strawberry Music Player';
  readonly configSchema = {
    database: {
      type: 'string',
      description: 'Path to strawberry.db',
      default: '~/.local/share/strawberry/strawberry/strawberry.db',
    },
  };

  // Implementation...
}
```

### v1.1: Additional Adapters

```typescript
// beets adapter
export class BeetsAdapter implements CollectionAdapter { ... }

// Directory scanner
export class DirectoryAdapter implements CollectionAdapter { ... }
```

### Default Registry

```typescript
// packages/podkit-core/src/adapters/index.ts
import { AdapterRegistry } from './registry';
import { StrawberryAdapter } from './strawberry';
import { BeetsAdapter } from './beets';
import { DirectoryAdapter } from './directory';

export const defaultRegistry = new AdapterRegistry();

defaultRegistry.register('strawberry', (config) => new StrawberryAdapter(config));
defaultRegistry.register('beets', (config) => new BeetsAdapter(config));
defaultRegistry.register('directory', (config) => new DirectoryAdapter(config));

export { defaultRegistry as registry };
```

## Consequences

### Positive

- Clean architecture with single responsibility
- Easy to test adapters in isolation
- Simple to add new sources
- Consistent sync engine behavior

### Negative

- All adapters must fit the interface (some mapping required)
- Slight overhead from abstraction
- May need interface evolution for edge cases

### Future Considerations

1. **Streaming results** - For very large collections, consider `AsyncIterable<CollectionTrack>`
2. **Incremental updates** - Adapters could provide "changes since last sync"
3. **Two-way sync** - Interface could expand for write operations

## Related Decisions

- ADR-001: Runtime choice - Adapters work with both Node and Bun
- ADR-002: libgpod binding - iPod is a "destination adapter" conceptually

## References

- [Adapter Pattern (Design Patterns)](https://refactoring.guru/design-patterns/adapter)
- [Strawberry Database Schema](https://github.com/strawberrymusicplayer/strawberry)
- [beets Database Documentation](https://beets.readthedocs.io/en/stable/dev/db.html)
