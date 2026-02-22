# Architecture Overview

## System Context

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              User Environment                                │
│                                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐                │
│  │  Strawberry  │     │    beets     │     │ Music Files  │                │
│  │   Database   │     │   Database   │     │  (Directory) │                │
│  └──────┬───────┘     └──────┬───────┘     └──────┬───────┘                │
│         │                    │                    │                         │
│         └────────────────────┼────────────────────┘                         │
│                              │                                              │
│                              ▼                                              │
│                     ┌────────────────┐                                      │
│                     │     podkit     │                                      │
│                     │      CLI       │                                      │
│                     └────────┬───────┘                                      │
│                              │                                              │
│         ┌────────────────────┼────────────────────┐                         │
│         │                    │                    │                         │
│         ▼                    ▼                    ▼                         │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │    FFmpeg    │    │   libgpod    │    │   System     │                  │
│  │  (transcode) │    │  (via node)  │    │   Storage    │                  │
│  └──────────────┘    └──────┬───────┘    └──────────────┘                  │
│                              │                                              │
└──────────────────────────────┼──────────────────────────────────────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │    iPod      │
                        │   Device     │
                        └──────────────┘
```

## Package Architecture

podkit is organized as a monorepo with three main packages:

```
packages/
├── libgpod-node/          # Native bindings for libgpod
│   ├── src/
│   │   ├── binding.ts     # Native binding layer
│   │   ├── database.ts    # iTunesDB operations
│   │   ├── track.ts       # Track management
│   │   ├── artwork.ts     # Artwork handling
│   │   └── types.ts       # TypeScript definitions
│   └── native/            # C/Rust binding code (approach dependent)
│
├── podkit-core/           # Core sync logic
│   ├── src/
│   │   ├── adapters/      # Collection source adapters
│   │   │   ├── interface.ts
│   │   │   ├── strawberry.ts
│   │   │   ├── beets.ts
│   │   │   └── directory.ts
│   │   ├── sync/          # Sync engine
│   │   │   ├── differ.ts
│   │   │   ├── planner.ts
│   │   │   └── executor.ts
│   │   ├── transcode/     # Transcoding
│   │   │   ├── ffmpeg.ts
│   │   │   ├── presets.ts
│   │   │   └── detector.ts
│   │   └── artwork/       # Artwork processing
│   │       ├── extractor.ts
│   │       └── resizer.ts
│   └── index.ts
│
└── podkit-cli/            # CLI application
    ├── src/
    │   ├── commands/
    │   │   ├── sync.ts
    │   │   ├── status.ts
    │   │   └── list.ts
    │   ├── config.ts
    │   └── main.ts
    └── bin/
        └── podkit
```

## Component Details

### libgpod-node

Native Node.js bindings for libgpod. This package abstracts the complexity of calling C code from JavaScript.

#### Responsibilities
- Initialize and parse iPod database
- Create, update, delete track entries
- Copy files to iPod storage
- Manage artwork database
- Write changes back to device

#### Key Interfaces

```typescript
// Database operations
interface IPodDatabase {
  readonly mountPoint: string;
  readonly deviceInfo: DeviceInfo;
  readonly tracks: Track[];

  parse(): Promise<void>;
  write(): Promise<void>;
  close(): void;
}

// Track management
interface Track {
  id: number;
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  duration: number;  // milliseconds
  bitrate: number;
  sampleRate: number;
  filePath: string;  // path on iPod
  hasArtwork: boolean;
}

interface TrackInput {
  sourceFile: string;
  metadata: TrackMetadata;
  artwork?: Buffer;
}

// Device info
interface DeviceInfo {
  model: string;
  modelNumber: string;
  generation: number;
  capacity: number;  // bytes
  freeSpace: number; // bytes
  artworkFormats: ArtworkFormat[];
}
```

### podkit-core

Core business logic for syncing music collections.

#### Collection Adapters

Adapters provide a uniform interface for reading track metadata from different sources.

```typescript
interface CollectionAdapter {
  readonly name: string;

  // Connect to the collection source
  connect(): Promise<void>;

  // Get all tracks in collection
  getTracks(): Promise<CollectionTrack[]>;

  // Get tracks matching filter
  getFilteredTracks(filter: TrackFilter): Promise<CollectionTrack[]>;

  // Get track's source file path
  getFilePath(track: CollectionTrack): string;

  // Disconnect from source
  disconnect(): Promise<void>;
}

interface CollectionTrack {
  // Unique identifier within collection
  id: string;

  // Core metadata (required)
  title: string;
  artist: string;
  album: string;

  // Extended metadata (optional)
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  duration?: number;

  // File info
  filePath: string;
  fileType: AudioFileType;

  // Identifiers (optional, for advanced matching)
  musicBrainzRecordingId?: string;
  musicBrainzReleaseId?: string;
  acoustId?: string;
}
```

#### Sync Engine

The sync engine coordinates the process of comparing, planning, and executing sync operations.

```typescript
// Differ: Compare collection to iPod
interface SyncDiff {
  toAdd: CollectionTrack[];      // In collection, not on iPod
  toRemove: Track[];             // On iPod, not in collection (optional)
  existing: MatchedTrack[];      // Already synced
  conflicts: ConflictTrack[];    // Metadata mismatch
}

// Planner: Create execution plan
interface SyncPlan {
  operations: SyncOperation[];
  estimatedTime: number;
  estimatedSize: number;
}

type SyncOperation =
  | { type: 'transcode'; source: CollectionTrack; preset: TranscodePreset }
  | { type: 'copy'; source: CollectionTrack }  // Already compatible format
  | { type: 'remove'; track: Track }
  | { type: 'update-metadata'; track: Track; metadata: Partial<TrackMetadata> };

// Executor: Run the plan
interface SyncExecutor {
  execute(plan: SyncPlan, options: ExecuteOptions): AsyncIterable<SyncProgress>;
}

interface SyncProgress {
  phase: 'transcoding' | 'copying' | 'updating-db' | 'complete';
  current: number;
  total: number;
  currentTrack?: string;
  bytesProcessed: number;
  bytesTotal: number;
}
```

#### Transcoding

FFmpeg-based transcoding with quality presets.

```typescript
interface TranscodePreset {
  name: 'high' | 'medium' | 'low' | 'custom';
  codec: 'aac';
  container: 'm4a';
  bitrate?: number;        // CBR: kbps
  quality?: number;        // VBR: quality level
  sampleRate?: number;
  channels?: number;
  customArgs?: string[];
}

const PRESETS: Record<string, TranscodePreset> = {
  high: {
    name: 'high',
    codec: 'aac',
    container: 'm4a',
    bitrate: 256,
    sampleRate: 44100,
  },
  medium: {
    name: 'medium',
    codec: 'aac',
    container: 'm4a',
    bitrate: 192,
    sampleRate: 44100,
  },
  low: {
    name: 'low',
    codec: 'aac',
    container: 'm4a',
    bitrate: 128,
    sampleRate: 44100,
  },
};

interface Transcoder {
  // Check FFmpeg availability and capabilities
  detect(): Promise<TranscoderCapabilities>;

  // Transcode a file
  transcode(input: string, output: string, preset: TranscodePreset): Promise<TranscodeResult>;

  // Get metadata from file
  probe(file: string): Promise<AudioMetadata>;
}
```

#### Artwork Processing

Extract and prepare artwork for iPod.

```typescript
interface ArtworkProcessor {
  // Extract artwork from audio file
  extractEmbedded(file: string): Promise<Buffer | null>;

  // Load external artwork (cover.jpg, folder.jpg, etc.)
  findExternal(directory: string): Promise<string | null>;

  // Resize artwork to iPod-compatible dimensions
  resize(image: Buffer, format: ArtworkFormat): Promise<Buffer>;
}

interface ArtworkFormat {
  width: number;
  height: number;
  format: 'rgb565' | 'jpeg';
}

// iPod Video artwork formats (from libgpod)
const IPOD_VIDEO_ARTWORK: ArtworkFormat[] = [
  { width: 100, height: 100, format: 'rgb565' },
  { width: 200, height: 200, format: 'rgb565' },
];
```

### podkit-cli

Command-line interface built on the core library.

```typescript
// Command structure
interface CLI {
  // podkit sync [options]
  sync(options: SyncOptions): Promise<void>;

  // podkit status
  status(): Promise<void>;

  // podkit list [--source <source>] [--device]
  list(options: ListOptions): Promise<void>;
}

interface SyncOptions {
  source: 'strawberry' | 'beets' | 'directory';
  sourcePath?: string;
  device?: string;  // Mount point, auto-detect if not specified
  quality: 'high' | 'medium' | 'low';
  dryRun: boolean;
  verbose: boolean;
  filter?: string;
  json: boolean;
}
```

## Data Flow

### Sync Operation Flow

```
1. Initialize
   ├── Parse CLI arguments
   ├── Load configuration
   ├── Connect to collection source
   └── Detect and connect to iPod

2. Diff
   ├── Load all collection tracks
   ├── Load all iPod tracks
   ├── Match by (artist, title, album)
   └── Generate diff: toAdd, toRemove, existing

3. Plan
   ├── For each track to add:
   │   ├── Check if transcoding needed
   │   ├── Estimate output size
   │   └── Create operation
   ├── Calculate total time/size
   └── Return SyncPlan

4. Execute (if not dry-run)
   ├── For each operation:
   │   ├── Transcode if needed
   │   ├── Extract artwork
   │   ├── Add track to iPod database
   │   ├── Copy file to iPod storage
   │   ├── Set artwork
   │   └── Report progress
   └── Write iPod database

5. Finalize
   ├── Report summary
   └── Cleanup temp files
```

### Track Matching Algorithm

```typescript
function matchTracks(
  collectionTracks: CollectionTrack[],
  ipodTracks: Track[]
): SyncDiff {
  const normalize = (s: string) => s.toLowerCase().trim();

  // Build index of iPod tracks
  const ipodIndex = new Map<string, Track>();
  for (const track of ipodTracks) {
    const key = `${normalize(track.artist)}|${normalize(track.title)}|${normalize(track.album)}`;
    ipodIndex.set(key, track);
  }

  const toAdd: CollectionTrack[] = [];
  const existing: MatchedTrack[] = [];

  for (const collTrack of collectionTracks) {
    const key = `${normalize(collTrack.artist)}|${normalize(collTrack.title)}|${normalize(collTrack.album)}`;
    const ipodTrack = ipodIndex.get(key);

    if (ipodTrack) {
      existing.push({ collection: collTrack, ipod: ipodTrack });
      ipodIndex.delete(key);  // Mark as matched
    } else {
      toAdd.push(collTrack);
    }
  }

  // Remaining iPod tracks are not in collection
  const toRemove = Array.from(ipodIndex.values());

  return { toAdd, toRemove, existing, conflicts: [] };
}
```

## Error Handling

### Error Categories

```typescript
type PodkitError =
  | { type: 'device-not-found'; message: string }
  | { type: 'device-not-writable'; message: string; path: string }
  | { type: 'collection-error'; source: string; message: string }
  | { type: 'transcode-error'; file: string; message: string }
  | { type: 'copy-error'; file: string; message: string }
  | { type: 'database-error'; message: string }
  | { type: 'space-error'; required: number; available: number };
```

### Recovery Strategies

| Error | Recovery |
|-------|----------|
| Transcode failure | Skip track, continue sync, report at end |
| Copy failure | Retry once, then skip and report |
| Database write failure | Attempt rollback, report critical error |
| Space exhaustion | Stop sync, report partial completion |
| Device disconnect | Stop immediately, report status |

## Configuration

### Configuration File

```yaml
# ~/.config/podkit/config.yaml

# Default quality preset
quality: high

# Collection source
source: strawberry

# Strawberry database path (auto-detected if not specified)
strawberry:
  database: ~/.local/share/strawberry/strawberry/strawberry.db

# beets database path
beets:
  database: ~/.config/beets/library.db

# Directory scan settings
directory:
  path: /mnt/music/library
  extensions: [flac, mp3, m4a, ogg, opus]

# Transcoding settings
transcode:
  # Use specific FFmpeg binary
  ffmpeg: /usr/bin/ffmpeg

  # Temp directory for transcoded files
  tempDir: /tmp/podkit

  # Custom presets
  presets:
    audiophile:
      codec: aac
      bitrate: 320
      sampleRate: 48000

# Device settings
device:
  # Auto-detect or specify mount point
  mountPoint: auto

  # Artwork settings
  artwork:
    enabled: true
    resize: true
```

## Testing Strategy

### Unit Tests

- Collection adapters: Mock database/filesystem
- Sync differ: Test matching algorithm
- Transcoder: Mock FFmpeg calls
- Artwork processor: Mock image operations

### Integration Tests

- libgpod bindings: Test against real libgpod
- Full sync flow: Use test iPod image
- Transcoding: Verify output file quality

### End-to-End Tests

- CLI commands: Test actual binary
- Real device testing: Manual test matrix

## Security Considerations

1. **File paths** - Validate all paths, prevent directory traversal
2. **SQLite injection** - Use parameterized queries for collection adapters
3. **Temp files** - Secure temp directory, cleanup on exit
4. **Device access** - Respect filesystem permissions

## Performance Considerations

1. **Parallel transcoding** - Use worker pool, limit by CPU cores
2. **Streaming copies** - Don't load entire files into memory
3. **Database batching** - Batch iPod database writes
4. **Progress updates** - Throttle UI updates to avoid overhead
