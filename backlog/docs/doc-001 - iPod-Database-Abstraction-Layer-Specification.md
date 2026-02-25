---
id: doc-001
title: iPod Database Abstraction Layer Specification
type: other
created_date: '2026-02-25 21:21'
---
# iPod Database Abstraction Layer Specification

**Status:** Draft  
**Task:** TASK-043  
**Date:** 2026-02-25

## Overview

This specification defines a new `IpodDatabase` API in `@podkit/core` that abstracts iPod database operations. This allows consumers like `podkit-cli` to interact with iPods without directly depending on `@podkit/libgpod-node`.

### Goals

1. **Encapsulation** - Hide libgpod-node internals (TrackHandle, etc.) from consumers
2. **Clean API** - Provide intuitive, fluent interfaces for track and playlist operations
3. **Type safety** - Strong TypeScript types that don't leak implementation details
4. **Consistency** - Match patterns established in the codebase

### Architecture

```
Before (broken coupling):
  CLI → podkit-core (sync logic)
  CLI → libgpod-node (direct Database access)

After (clean layers):
  CLI → podkit-core (IpodDatabase + sync logic) → libgpod-node
```

---

## API Specification

### Track Types

```typescript
/**
 * Input for creating a new track.
 */
interface TrackInput {
  // Required
  title: string;

  // Core metadata
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  composer?: string;
  comment?: string;
  grouping?: string;

  // Track/disc info
  trackNumber?: number;
  totalTracks?: number;
  discNumber?: number;
  totalDiscs?: number;
  year?: number;

  // Technical info (from source file)
  duration?: number;      // milliseconds
  bitrate?: number;       // kbps
  sampleRate?: number;    // Hz
  size?: number;          // bytes
  bpm?: number;
  filetype?: string;      // e.g., "MPEG audio file"
  mediaType?: number;     // MediaType flags

  // Flags
  compilation?: boolean;

  // Play stats (for sync/restore scenarios)
  rating?: number;        // 0-100, where 20 = 1 star
  playCount?: number;
  skipCount?: number;
}

/**
 * Fields that can be updated on an existing track.
 */
interface TrackFields {
  title?: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  genre?: string;
  composer?: string;
  comment?: string;
  grouping?: string;
  trackNumber?: number;
  totalTracks?: number;
  discNumber?: number;
  totalDiscs?: number;
  year?: number;
  bpm?: number;
  mediaType?: number;
  compilation?: boolean;
  rating?: number;
  playCount?: number;
  skipCount?: number;
}

/**
 * Media type flags for tracks.
 */
const MediaType = {
  Audio: 0x0001,
  Podcast: 0x0004,
  Audiobook: 0x0008,
  MusicVideo: 0x0020,
  TVShow: 0x0040,
} as const;
```

### IPodTrack

Track objects are **snapshots** of track metadata. They also serve as references for operations - the object itself identifies which track to operate on.

```typescript
interface IPodTrack {
  // Core metadata (read-only snapshot)
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly albumArtist?: string;
  readonly genre?: string;
  readonly composer?: string;
  readonly comment?: string;
  readonly grouping?: string;

  // Track/disc info
  readonly trackNumber?: number;
  readonly totalTracks?: number;
  readonly discNumber?: number;
  readonly totalDiscs?: number;
  readonly year?: number;

  // Technical info
  readonly duration: number;      // milliseconds
  readonly bitrate: number;       // kbps
  readonly sampleRate: number;    // Hz
  readonly size: number;          // bytes
  readonly bpm?: number;
  readonly filetype?: string;     // e.g., "MPEG audio file", "AAC audio file"
  readonly mediaType: number;     // MediaType flags

  // File path on iPod
  readonly filePath: string;      // e.g., ":iPod_Control:Music:F00:ABCD.mp3"

  // Timestamps (Unix seconds)
  readonly timeAdded: number;
  readonly timeModified: number;
  readonly timePlayed: number;
  readonly timeReleased: number;  // For podcasts

  // Play statistics
  readonly playCount: number;
  readonly skipCount: number;
  readonly rating: number;        // 0-100, where 20 = 1 star

  // Flags
  readonly hasArtwork: boolean;
  readonly hasFile: boolean;      // true if audio file copied to iPod
  readonly compilation: boolean;

  // Operations (return new snapshot)
  update(fields: TrackFields): IPodTrack;
  remove(): void;
  copyFile(sourcePath: string): IPodTrack;
  setArtwork(imagePath: string): IPodTrack;
  setArtworkFromData(imageData: Buffer): IPodTrack;
  removeArtwork(): IPodTrack;
}
```

**Behavior notes:**

- `update()` returns a new `IPodTrack` snapshot with updated values
- `remove()` marks the track for deletion; subsequent operations on this object throw `IpodError`
- `copyFile()` copies the audio file to iPod storage; returns new snapshot with `hasFile: true`
- Track objects are the reference for operations (no separate ID/handle exposed)

### IpodPlaylist

```typescript
interface IpodPlaylist {
  readonly name: string;
  readonly trackCount: number;
  readonly isMaster: boolean;     // The "Library" playlist containing all tracks
  readonly isSmart: boolean;      // Smart playlists (rules-based, read-only for now)
  readonly isPodcasts: boolean;   // System podcasts playlist
  readonly timestamp: number;     // Creation time (Unix seconds)

  // Operations (return new snapshot)
  rename(newName: string): IpodPlaylist;
  remove(): void;
  getTracks(): IPodTrack[];
  addTrack(track: IPodTrack): IpodPlaylist;
  removeTrack(track: IPodTrack): IpodPlaylist;
  containsTrack(track: IPodTrack): boolean;
}
```

**Behavior notes:**

- Master playlist cannot be removed or renamed
- Smart playlists are read-only (creating/editing deferred to future work)
- `addTrack()` and `removeTrack()` return new playlist snapshot for chaining

### Device & Info Types

```typescript
interface IpodDeviceInfo {
  readonly modelName: string;           // e.g., "iPod Video (60GB)"
  readonly modelNumber: string | null;  // e.g., "MA147"
  readonly generation: string;          // e.g., "video_1", "classic_1"
  readonly capacity: number;            // GB
  readonly supportsArtwork: boolean;
  readonly supportsVideo: boolean;
  readonly supportsPhoto: boolean;
  readonly supportsPodcast: boolean;
}

interface IpodInfo {
  readonly mountPoint: string;
  readonly trackCount: number;
  readonly playlistCount: number;
  readonly device: IpodDeviceInfo;
}

interface SaveResult {
  readonly warnings: string[];  // e.g., "3 tracks have no audio file"
}
```

### IpodDatabase

```typescript
class IpodDatabase {
  // Factory
  static open(mountPoint: string): Promise<IpodDatabase>;

  // Properties
  readonly mountPoint: string;
  readonly device: IpodDeviceInfo;
  readonly trackCount: number;
  readonly playlistCount: number;

  // Info
  getInfo(): IpodInfo;

  // Track operations
  getTracks(): IPodTrack[];
  addTrack(input: TrackInput): IPodTrack;
  updateTrack(track: IPodTrack, fields: TrackFields): IPodTrack;
  removeTrack(track: IPodTrack): void;
  copyFileToTrack(track: IPodTrack, sourcePath: string): IPodTrack;
  setTrackArtwork(track: IPodTrack, imagePath: string): IPodTrack;
  setTrackArtworkFromData(track: IPodTrack, imageData: Buffer): IPodTrack;
  removeTrackArtwork(track: IPodTrack): IPodTrack;

  // Playlist operations
  getPlaylists(): IpodPlaylist[];
  getMasterPlaylist(): IpodPlaylist;
  getPlaylistByName(name: string): IpodPlaylist | null;
  createPlaylist(name: string): IpodPlaylist;
  removePlaylist(playlist: IpodPlaylist): void;
  renamePlaylist(playlist: IpodPlaylist, newName: string): IpodPlaylist;
  addTrackToPlaylist(playlist: IpodPlaylist, track: IPodTrack): IpodPlaylist;
  removeTrackFromPlaylist(playlist: IpodPlaylist, track: IPodTrack): IpodPlaylist;
  getPlaylistTracks(playlist: IpodPlaylist): IPodTrack[];

  // Lifecycle
  save(): Promise<SaveResult>;
  close(): void;
}
```

**Behavior notes:**

- `save()` writes changes to iPod and returns warnings (e.g., tracks without files)
- `close()` releases resources; subsequent operations throw `IpodError`
- Track and playlist methods mirror the methods on the objects for flexibility

### Error Types

```typescript
class IpodError extends Error {
  readonly code: IpodErrorCode;
  constructor(message: string, code: IpodErrorCode);
}

type IpodErrorCode =
  | 'NOT_FOUND'           // iPod not found at path
  | 'DATABASE_CORRUPT'    // Database corrupt or unreadable
  | 'TRACK_REMOVED'       // Operating on a removed track
  | 'PLAYLIST_REMOVED'    // Operating on a removed playlist
  | 'FILE_NOT_FOUND'      // Source file not found for copy
  | 'COPY_FAILED'         // File copy to iPod failed
  | 'ARTWORK_FAILED'      // Artwork operation failed
  | 'SAVE_FAILED'         // Database write failed
  | 'DATABASE_CLOSED';    // Database already closed
```

---

## Usage Examples

### Status Command

```typescript
import { IpodDatabase } from '@podkit/core';

const ipod = await IpodDatabase.open('/Volumes/IPOD');
const info = ipod.getInfo();

console.log(`${info.device.modelName} (${info.device.capacity}GB)`);
console.log(`Mount: ${info.mountPoint}`);
console.log(`Tracks: ${info.trackCount}`);

ipod.close();
```

### List Tracks

```typescript
const ipod = await IpodDatabase.open('/Volumes/IPOD');

for (const track of ipod.getTracks()) {
  console.log(`${track.artist} - ${track.title}`);
}

ipod.close();
```

### Find and Update Tracks

```typescript
const ipod = await IpodDatabase.open('/Volumes/IPOD');

for (const track of ipod.getTracks()) {
  if (track.title.includes('Live')) {
    track.update({ title: `${track.title} (Live Recording)` });
  }
}

await ipod.save();
ipod.close();
```

### Add Tracks

```typescript
const ipod = await IpodDatabase.open('/Volumes/IPOD');

const track = ipod.addTrack({
  title: 'New Song',
  artist: 'Artist',
  album: 'Album',
});

track.copyFile('/path/to/song.mp3');

await ipod.save();
ipod.close();
```

### Chained Style

```typescript
ipod.addTrack({ title: 'Song', artist: 'Artist' })
    .copyFile('/path/to/song.mp3')
    .setArtwork('/path/to/cover.jpg');

await ipod.save();
```

### Playlist Management

```typescript
const ipod = await IpodDatabase.open('/Volumes/IPOD');

// Create playlist and add highly-rated tracks
const favorites = ipod.createPlaylist('Favorites');

for (const track of ipod.getTracks()) {
  if (track.rating >= 80) {
    favorites.addTrack(track);
  }
}

await ipod.save();
ipod.close();
```

### Fluent Playlist Building

```typescript
ipod.createPlaylist('Road Trip')
    .addTrack(track1)
    .addTrack(track2)
    .addTrack(track3);

await ipod.save();
```

---

## Executor Integration

The sync executor will take `IpodDatabase` instead of raw `Database`:

```typescript
interface ExecutorDependencies {
  ipod: IpodDatabase;           // Was: database: Database
  transcoder: FFmpegTranscoder;
}
```

**CLI usage:**

```typescript
const ipod = await IpodDatabase.open(devicePath);
const executor = new DefaultSyncExecutor({ ipod, transcoder });

for await (const progress of executor.execute(plan)) {
  // Display progress
}

const result = await ipod.save();
if (result.warnings.length > 0) {
  console.warn(result.warnings.join('\n'));
}

ipod.close();
```

---

## Internal Implementation Notes

### Track Reference Management

Internally, `IpodDatabase` maintains a mapping from `IPodTrack` objects to libgpod-node `TrackHandle`s:

```typescript
class IpodDatabaseImpl {
  private db: Database;  // libgpod-node Database
  private trackHandles = new WeakMap<IPodTrack, TrackHandle>();
  
  getTracks(): IPodTrack[] {
    return this.db.getTracks().map(handle => {
      const data = this.db.getTrack(handle);
      const track = new IpodTrackImpl(this, data);
      this.trackHandles.set(track, handle);
      return track;
    });
  }
  
  updateTrack(track: IPodTrack, fields: TrackFields): IPodTrack {
    const handle = this.trackHandles.get(track);
    if (!handle) throw new IpodError('Unknown track', 'TRACK_REMOVED');
    
    this.db.updateTrack(handle, fields);
    const updated = this.db.getTrack(handle);
    const newTrack = new IpodTrackImpl(this, updated);
    this.trackHandles.set(newTrack, handle);
    return newTrack;
  }
}
```

### Save Warnings

On `save()`, check for tracks without files:

```typescript
async save(): Promise<SaveResult> {
  const warnings: string[] = [];
  
  const tracksWithoutFiles = this.getTracks().filter(t => !t.hasFile);
  if (tracksWithoutFiles.length > 0) {
    warnings.push(`${tracksWithoutFiles.length} tracks have no audio file and won't be playable`);
  }
  
  await this.db.save();
  return { warnings };
}
```

---

## Deferred Features

The following are explicitly out of scope for this implementation:

- **Smart playlist creation/editing** - Complex rules-based playlists. `isSmart` exposed as read-only.
- **Chapter markers** - For podcasts/audiobooks. Niche use case.
- **SysInfo access** - Low-level device configuration.
- **Photo database** - Separate database for photos.

---

## Migration Path

### CLI Changes

Replace direct libgpod-node imports with podkit-core imports:

```typescript
// Before
import { Database } from '@podkit/libgpod-node';
const db = await Database.open(devicePath);
const tracks = db.getTracks().map(h => db.getTrack(h));

// After
import { IpodDatabase } from '@podkit/core';
const ipod = await IpodDatabase.open(devicePath);
const tracks = ipod.getTracks();
```

### Core Exports

Add to `@podkit/core` index.ts:

```typescript
// iPod database abstraction
export { IpodDatabase } from './ipod/database.js';
export type {
  IPodTrack,
  IpodPlaylist,
  IpodDeviceInfo,
  IpodInfo,
  TrackInput,
  TrackFields,
  SaveResult,
} from './ipod/types.js';
export { IpodError, type IpodErrorCode } from './ipod/errors.js';
export { MediaType } from './ipod/constants.js';
```
