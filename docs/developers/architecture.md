---
title: Architecture
description: Technical architecture overview of podkit including component design, interfaces, and data flow.
sidebar:
  order: 1
---

# Architecture Overview

This document covers the technical architecture of podkit, including component design, interfaces, and data flow.

## System Context

```
+-----------------------------------------------------------------------------+
|                              User Environment                                |
|                                                                             |
|                          +------------------+                               |
|                          |  Music Directory |                               |
|                          |   (FLAC, MP3,    |                               |
|                          |    M4A, etc.)    |                               |
|                          +--------+---------+                               |
|                                   |                                         |
|                                   v                                         |
|                          +----------------+                                 |
|                          |     podkit     |                                 |
|                          |      CLI       |                                 |
|                          +--------+-------+                                 |
|                              |                                              |
|         +--------------------+--------------------+                         |
|         |                    |                    |                         |
|         v                    v                    v                         |
|  +--------------+    +--------------+    +--------------+                  |
|  |    FFmpeg    |    |   libgpod    |    |   System     |                  |
|  |  (transcode) |    |  (via node)  |    |   Storage    |                  |
|  +--------------+    +------+-------+    +--------------+                  |
|                              |                                              |
+------------------------------+----------------------------------------------+
                               |
                               v
                        +--------------+
                        |    iPod      |
                        |   Device     |
                        +--------------+
```

## Package Architecture

podkit is organized as a monorepo with these main packages:

```
packages/
+-- libgpod-node/          # Native bindings for libgpod (internal)
|   +-- src/
|   |   +-- binding.ts     # Native binding layer
|   |   +-- database.ts    # iTunesDB operations
|   |   +-- track.ts       # Track management
|   |   +-- artwork.ts     # Artwork handling
|   |   +-- types.ts       # TypeScript definitions
|   +-- native/            # C binding code
|
+-- podkit-core/           # Core sync logic + iPod abstraction
|   +-- src/
|   |   +-- ipod/          # IpodDatabase abstraction layer
|   |   +-- adapters/      # Collection source adapters
|   |   +-- sync/          # Sync engine
|   |   +-- transcode/     # Transcoding
|   |   +-- artwork/       # Artwork processing
|   +-- index.ts
|
+-- podkit-cli/            # CLI application
    +-- src/
    |   +-- commands/
    |   +-- config.ts
    |   +-- main.ts
    +-- bin/
        +-- podkit
```

### Layer Diagram

```
+-------------------------------------------------------------+
|                       podkit-cli                            |
|                    (CLI commands)                           |
+---------------------------+---------------------------------+
                            |
                            v
+-------------------------------------------------------------+
|                      podkit-core                            |
|  +-------------------+  +----------------+  +-----------+  |
|  |   IpodDatabase    |  |  Sync Engine   |  | Transcode |  |
|  |   (iPod access)   |  |  (diff/plan)   |  | (FFmpeg)  |  |
|  +---------+---------+  +----------------+  +-----------+  |
+------------+------------------------------------------------+
             |
             v
+-------------------------------------------------------------+
|                    libgpod-node (internal)                  |
|                 (N-API bindings for libgpod)                |
+-------------------------------------------------------------+
```

**Important:** Applications should use `IpodDatabase` from `@podkit/core`, not `@podkit/libgpod-node` directly. The libgpod-node package is an internal implementation detail.

## Component Details

### IpodDatabase (podkit-core)

The primary interface for iPod operations. `IpodDatabase` provides a clean, type-safe API that hides libgpod internals.

```typescript
import { IpodDatabase, IpodError } from '@podkit/core';

// Open an iPod and work with tracks
const ipod = await IpodDatabase.open('/Volumes/IPOD');

// Get device info
const info = ipod.getInfo();
console.log(`${info.device.modelName}: ${info.trackCount} tracks`);

// Track operations
const tracks = ipod.getTracks();
const track = ipod.addTrack({ title: 'Song', artist: 'Artist' });
track.copyFile('/path/to/song.mp3').setArtwork('/path/to/cover.jpg');

// Playlist operations
const playlist = ipod.createPlaylist('Favorites');
playlist.addTrack(track);

// Save and close
await ipod.save();
ipod.close();
```

### Collection Adapters

Adapters provide a uniform interface for reading track metadata from different sources.

```typescript
interface CollectionAdapter {
  readonly name: string;

  connect(): Promise<void>;
  getTracks(): Promise<CollectionTrack[]>;
  getFilteredTracks(filter: TrackFilter): Promise<CollectionTrack[]>;
  getFilePath(track: CollectionTrack): string;
  disconnect(): Promise<void>;
}
```

### Sync Engine

The sync engine coordinates comparing, planning, and executing sync operations.

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

// Executor: Run the plan
interface SyncExecutor {
  execute(plan: SyncPlan, options: ExecuteOptions): AsyncIterable<SyncProgress>;
}
```

## Data Flow

### Sync Operation Flow

```
1. Initialize
   +-- Parse CLI arguments
   +-- Load configuration
   +-- Connect to collection source (adapter)
   +-- Open iPod database (IpodDatabase.open())

2. Diff
   +-- Load all collection tracks (adapter.getTracks())
   +-- Load all iPod tracks (ipod.getTracks())
   +-- Match by (artist, title, album)
   +-- Generate diff: toAdd, toRemove, existing

3. Plan
   +-- For each track to add:
   |   +-- Check if transcoding needed
   |   +-- Estimate output size
   |   +-- Create operation
   +-- Calculate total time/size
   +-- Return SyncPlan

4. Execute (if not dry-run)
   +-- For each operation:
   |   +-- Transcode if needed (FFmpeg)
   |   +-- Extract artwork
   |   +-- Add track to iPod (ipod.addTrack())
   |   +-- Copy file to iPod (track.copyFile())
   |   +-- Set artwork (track.setArtwork())
   |   +-- Report progress
   +-- Save iPod database (ipod.save())

5. Finalize
   +-- Report summary
   +-- Close database (ipod.close())
   +-- Cleanup temp files
```

### Track Matching Algorithm

Tracks are matched by normalized (artist, title, album) tuple:

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
      ipodIndex.delete(key);
    } else {
      toAdd.push(collTrack);
    }
  }

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

## See Also

- [Development Setup](/developers/development) - Setting up dev environment
- [Testing](/developers/testing) - Testing strategy
- [ADRs](/developers/adr/) - Architecture decision records
