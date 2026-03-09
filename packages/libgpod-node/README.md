# @podkit/libgpod-node

Native Node.js bindings for [libgpod](https://github.com/libgpod/libgpod), the C library for reading and writing iPod databases.

## Overview

This package provides N-API bindings to libgpod, exposing iPod database operations to Node.js/TypeScript. While it aims to closely follow libgpod's API, some operations have enhanced behavior to handle edge cases that libgpod doesn't address automatically.

**For application code, use `IpodDatabase` from `@podkit/core` instead of this package directly.** This package is intended for:
- libgpod binding tests
- Debugging low-level issues
- Extending podkit-core internals

## Behavioral Deviations from libgpod

This binding **intentionally deviates** from a 1:1 mapping with libgpod in several areas to prevent data corruption and CRITICAL assertion failures. These changes are documented here for maintainability.

### 1. Track Removal: Playlist Cleanup

**libgpod behavior:** `itdb_track_remove()` removes a track from `itdb->tracks` and frees it, but **does NOT remove the track from playlists**. This leaves stale references that cause:
- `prepare_itdb_for_write: assertion 'link' failed` during save
- `Itdb_Track ID '0' not found` warnings when reopening the database
- Potential data corruption in playlist entries

**Our behavior:** `Database.removeTrack()` removes the track from **all playlists** before calling `itdb_track_remove()`.

```cpp
// native/track_operations.cc - RemoveTrack()
for (GList* pl = db_->playlists; pl != nullptr; pl = pl->next) {
    Itdb_Playlist* playlist = static_cast<Itdb_Playlist*>(pl->data);
    if (playlist) {
        itdb_playlist_remove_track(playlist, track);
    }
}
itdb_track_remove(track);
```

**Why:** libgpod's documentation for `itdb_track_unlink()` explicitly states "It doesn't remove the track from the playlists it may have been added to, in particular it won't be removed from the master playlist." The same applies to `itdb_track_remove()`. This is a footgun that causes data corruption.

### 2. Database Creation: Master Playlist

**libgpod behavior:** `itdb_new()` creates an empty database without a master playlist. Most libgpod operations require a master playlist to exist, causing:
- `itdb_playlist_mpl: assertion 'pl' failed` when adding tracks
- `prepare_itdb_for_write: assertion 'mpl' failed` when saving
- `mk_mhla: assertion 'fexp->albums' failed` during write
- `mk_mhli: assertion 'fexp->artists' failed` during write

**Our behavior:** `Database.create()` creates a master playlist after calling `itdb_new()`.

```cpp
// native/gpod_binding.cc - Create()
Itdb_iTunesDB* db = itdb_new();
Itdb_Playlist* mpl = itdb_playlist_new("iPod", FALSE);
itdb_playlist_set_mpl(mpl);
itdb_playlist_add(db, mpl, -1);
```

**Why:** This mirrors what `itdb_init_ipod()` does internally. Without a master playlist, the database is effectively unusable for most operations.

### 3. iPod Initialization: Directory Auto-Creation

**libgpod behavior:** `itdb_init_ipod()` expects the mountpoint directory to already exist. If the directory doesn't exist, initialization fails.

**Our behavior:** `Database.initializeIpod()` creates the mountpoint directory (and any necessary parent directories) if it doesn't exist, using `g_mkdir_with_parents()`.

```cpp
// native/gpod_binding.cc - InitIpod()
if (!g_file_test(mountpoint, G_FILE_TEST_IS_DIR)) {
    if (g_mkdir_with_parents(mountpoint, 0755) != 0) {
        // Handle error
    }
}
itdb_init_ipod(mountpoint, model, name, &error);
```

**Why:** When initializing an iPod that hasn't been set up yet (e.g., after reformatting), the mount point may not exist. Requiring callers to create the directory first is an unnecessary friction that leads to confusing errors. This matches the behavior users expect from a high-level initialization function.

### 4. Chapter Data: NULL Prevention

**libgpod behavior:** `itdb_track_free()` calls `itdb_chapterdata_free(track->chapterdata)` without checking for NULL first, causing:
- `itdb_chapterdata_free: assertion 'chapterdata' failed` on database close

**Our behavior:** `clearTrackChapters()` and `setTrackChapters([])` create a new empty chapterdata instead of setting it to NULL.

```cpp
// native/track_operations.cc - ClearTrackChapters()
if (track->chapterdata != nullptr) {
    itdb_chapterdata_free(track->chapterdata);
}
track->chapterdata = itdb_chapterdata_new();  // Create empty, not NULL
```

**Why:** This is a bug in libgpod - `itdb_chapterdata_free()` should check for NULL but doesn't. Since we can't modify libgpod, we work around it by ensuring chapterdata is never NULL.

## API Reference

### Database Operations

```typescript
import { Database } from '@podkit/libgpod-node';

// Open existing iPod database
const db = Database.openSync('/Volumes/IPOD');

// Create new in-memory database (use setMountpoint before save)
const newDb = Database.create();
newDb.setMountpoint('/Volumes/IPOD');

// Initialize a new iPod (creates directory structure and empty database)
const freshDb = await Database.initializeIpod('/Volumes/IPOD');
// Or with options:
const customDb = await Database.initializeIpod('/Volumes/IPOD', {
  model: Database.IpodModels.VIDEO_60GB,  // iPod Video 60GB
  name: 'My iPod',
});

// Save changes
db.saveSync();

// Close database
db.close();
```

### iPod Initialization

Use `Database.initializeIpod()` to set up an iPod that has no existing database:

```typescript
import { Database } from '@podkit/libgpod-node';

// Initialize a new iPod with default settings
const db = await Database.initializeIpod('/Volumes/IPOD');

// Initialize with a specific model for correct capability support
const db = await Database.initializeIpod('/Volumes/IPOD', {
  model: Database.IpodModels.CLASSIC_120GB,
  name: 'My Classic',
});

// Available model constants
Database.IpodModels.VIDEO_60GB     // 'MA147' - iPod Video 60GB (default)
Database.IpodModels.CLASSIC_120GB  // 'MB565' - iPod Classic 120GB
Database.IpodModels.NANO_2GB       // 'MA477' - iPod Nano 2GB
```

**What it creates:**
- `iPod_Control/` directory structure
- `iPod_Control/iTunes/iTunesDB` with empty track database
- `iPod_Control/Device/SysInfo` with model information
- Master playlist

**When to use:**
- Fresh/reformatted iPod with no iTunes database
- iPod with corrupted database (use `device reset` in CLI)
- Setting up test environments

### Track Operations

```typescript
// Add track
const handle = db.addTrack({
  title: 'Song Title',
  artist: 'Artist Name',
  album: 'Album Name',
  mediaType: MediaType.Audio,
});

// Get track data
const track = db.getTrack(handle);

// Update track
db.updateTrack(handle, { rating: 80 });

// Remove track (automatically removed from all playlists)
db.removeTrack(handle);

// Copy file to iPod
db.copyTrackToDevice(handle, '/path/to/song.mp3');
```

### Chapter Operations

```typescript
// Set chapters
db.setTrackChapters(handle, [
  { startPos: 0, title: 'Intro' },
  { startPos: 60000, title: 'Verse 1' },
  { startPos: 120000, title: 'Chorus' },
]);

// Get chapters
const chapters = db.getTrackChapters(handle);

// Clear chapters (creates empty chapterdata, not NULL)
db.clearTrackChapters(handle);
```

## TrackHandle System

libgpod uses raw pointers (`Itdb_Track*`) for track references. This binding wraps pointers in a `TrackHandle` system:

- Handles are stable within a session
- Handles become invalid after `removeTrack()` or `close()`
- Looking up an invalid handle throws an error

This provides memory safety while maintaining performance.

## Building

Requires libgpod and GLib development headers:

```bash
# macOS
brew install glib
# Build libgpod from source (see tools/libgpod-macos/)

# Debian/Ubuntu
sudo apt install libgpod-dev libglib2.0-dev

# Build the binding
bun run build
```

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test src/__tests__/video-tracks.integration.test.ts
```

Tests require `gpod-tool` to be built:

```bash
mise run tools:build
```

## See Also

- [docs/LIBGPOD.md](../../docs/LIBGPOD.md) - libgpod research and API documentation
- [packages/gpod-testing/](../gpod-testing/) - Test utilities for iPod environments
- [packages/podkit-core/](../podkit-core/) - High-level IpodDatabase API
