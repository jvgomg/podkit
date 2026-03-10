---
title: libgpod Integration
description: Technical reference for the libgpod C library and podkit's Node.js bindings.
sidebar:
  order: 5
---

# libgpod Integration

This document covers the libgpod C library and how podkit integrates with it through native Node.js bindings.

## Overview

libgpod is a C library for reading and writing the iTunes database (iTunesDB) on iPod devices. It is the de facto standard library used by most Linux iPod management tools.

| Attribute | Value |
|-----------|-------|
| **Repository** | https://github.com/libgpod/libgpod |
| **Language** | C (with GLib) |
| **License** | LGPL-2.1 |
| **Current Version** | 0.8.3 |
| **Status** | Maintenance mode (stable, infrequent updates) |

## IpodDatabase Abstraction

**For application code, use `IpodDatabase` from `@podkit/core` instead of `@podkit/libgpod-node` directly.**

The `IpodDatabase` class provides a clean, high-level API that:
- Hides internal details like `TrackHandle` references
- Provides type-safe track and playlist operations
- Returns immutable snapshots for safe data access
- Handles error translation to structured `IpodError` types

### When to Use Each Package

| Use Case | Package |
|----------|---------|
| CLI commands, application code | `@podkit/core` (IpodDatabase) |
| Sync engine, business logic | `@podkit/core` (IpodDatabase) |
| libgpod binding tests | `@podkit/libgpod-node` |
| Debugging low-level issues | `@podkit/libgpod-node` |

### Quick Example

```typescript
import { IpodDatabase } from '@podkit/core';

// Open iPod
const ipod = await IpodDatabase.open('/Volumes/IPOD');

// Display info
const info = ipod.getInfo();
console.log(`${info.device.modelName} (${info.device.capacity}GB)`);

// List tracks
for (const track of ipod.getTracks()) {
  console.log(`${track.artist} - ${track.title}`);
}

// Add a track
const track = ipod.addTrack({
  title: 'New Song',
  artist: 'Artist',
  album: 'Album',
});
track.copyFile('/path/to/song.mp3');

// Save and close
await ipod.save();
ipod.close();
```

## libgpod Core API

### Database Operations

```c
#include <gpod/itdb.h>

// Parse iPod database from mount point
Itdb_iTunesDB *itdb_parse(const char *mountpoint, GError **error);

// Write database back to iPod
gboolean itdb_write(Itdb_iTunesDB *itdb, GError **error);

// Free database structure
void itdb_free(Itdb_iTunesDB *itdb);
```

### Track Management

```c
// Create new track
Itdb_Track *itdb_track_new(void);

// Add track to database
void itdb_track_add(Itdb_iTunesDB *itdb, Itdb_Track *track, gint32 pos);

// Remove track from database
void itdb_track_remove(Itdb_Track *track);

// Copy file to iPod
gboolean itdb_cp_track_to_ipod(Itdb_Track *track,
                                const char *filename,
                                GError **error);

// Set track artwork
gboolean itdb_track_set_thumbnails(Itdb_Track *track,
                                    const char *filename);
```

### Playlist Management

```c
// Create new playlist
Itdb_Playlist *itdb_playlist_new(const char *title, gboolean spl);

// Add playlist to database
void itdb_playlist_add(Itdb_iTunesDB *itdb, Itdb_Playlist *pl, gint32 pos);

// Add track to playlist
void itdb_playlist_add_track(Itdb_Playlist *pl, Itdb_Track *track, gint32 pos);
```

## Track Identification

libgpod provides several identifiers, but **only pointers (`Itdb_Track*`) are reliable references**.

### Why IDs Are Unreliable

The `id` field has limitations:
- Assigned during `itdb_write()`, not `itdb_track_add()`
- Reassigned on every export
- New tracks have `id = 0` until database is saved

### How libgpod-node Uses TrackHandle

The `TrackHandle` abstraction wraps pointers safely:

```typescript
// TrackHandle wraps a pointer internally
const handle = db.addTrack('/path/to/music.mp3', metadata);

// All operations accept TrackHandle
db.setTrackMetadata(handle, { title: 'New Title' });
db.setTrackArtwork(handle, '/path/to/artwork.jpg');

// After write, handle remains valid
await db.write();
const info = db.getTrackInfo(handle);  // Still works
```

## Behavioral Deviations

The libgpod-node bindings have enhanced behavior to handle edge cases:

| Operation | libgpod Issue | Our Fix |
|-----------|---------------|---------|
| `removeTrack()` | Doesn't remove from playlists | Remove from all playlists first |
| `create()` | No master playlist | Create master playlist |
| `clearTrackChapters()` | NULL chapterdata crashes | Create empty chapterdata |

See `packages/libgpod-node/README.md` for the full list and rationale.

## GLib Type Handling

libgpod uses GLib extensively:

| GLib Type | Complexity | Notes |
|-----------|------------|-------|
| `gchar*` | Low | Just C strings |
| `gint32`, `guint32` | Low | Standard integers |
| `gboolean` | Low | 0/1 integer |
| `GList*` | Medium | Linked list, needs iteration |
| `GError**` | Medium | Output parameter for errors |

## Thread Safety

libgpod is **not thread-safe**. All operations on a single database must be serialized. Multiple databases can be used in parallel if they're for different devices.

## Investigating Issues

When encountering libgpod CRITICAL assertions:

1. **Reproduce with a test** - Create an integration test that triggers the issue
2. **Check libgpod source** - Look at `tools/libgpod-macos/build/libgpod-0.8.3/src/`
3. **Understand the expectation** - What does libgpod expect vs. what we're providing?
4. **Fix and document** - Apply the fix and document the deviation

## See Also

- [Architecture](/developers/architecture) - Overall system design
- [iPod Internals](/devices/ipod-internals) - iTunesDB format details
- `packages/libgpod-node/README.md` - Binding documentation
- [libgpod API Documentation](http://www.gtkpod.org/libgpod/docs/)
