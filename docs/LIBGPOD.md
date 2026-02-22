# libgpod Research

## Overview

libgpod is a C library for reading and writing the iTunes database (iTunesDB) on iPod devices. It is the de facto standard library used by most Linux iPod management tools.

## Project Information

| Attribute | Value |
|-----------|-------|
| **Repository** | https://github.com/libgpod/libgpod |
| **Documentation** | http://www.gtkpod.org/libgpod/docs/ |
| **Language** | C (with GLib) |
| **License** | LGPL-2.1 |
| **Current Version** | 0.8.3 |
| **Status** | Maintenance mode (stable, infrequent updates) |

## Dependencies

| Dependency | Purpose |
|------------|---------|
| **GLib 2.0** | Core data structures (GList, GError, etc.) |
| **libplist** | Property list parsing |
| **libimobiledevice** | iOS device communication (optional) |
| **SQLite** | Photo database (optional) |
| **libxml2** | XML parsing |

### Installation

**Debian/Ubuntu:**
```bash
sudo apt install libgpod-dev libgpod4t64 libgpod-common
```

**macOS (Homebrew):**
```bash
brew install libgpod
```

**From Source:**
```bash
git clone https://github.com/libgpod/libgpod
cd libgpod
./autogen.sh
./configure
make
sudo make install
```

## Core API

### Database Operations

```c
#include <gpod/itdb.h>

// Parse iPod database from mount point
Itdb_iTunesDB *itdb_parse(const char *mountpoint, GError **error);

// Write database back to iPod
gboolean itdb_write(Itdb_iTunesDB *itdb, GError **error);

// Free database structure
void itdb_free(Itdb_iTunesDB *itdb);

// Get device info
const Itdb_IpodInfo *itdb_device_get_ipod_info(const Itdb_Device *device);
```

### Track Management

```c
// Create new track
Itdb_Track *itdb_track_new(void);

// Add track to database
void itdb_track_add(Itdb_iTunesDB *itdb, Itdb_Track *track, gint32 pos);

// Remove track from database
void itdb_track_remove(Itdb_Track *track);

// Copy file to iPod (handles storage location)
gboolean itdb_cp_track_to_ipod(Itdb_Track *track,
                                const char *filename,
                                GError **error);

// Set track thumbnails (artwork)
gboolean itdb_track_set_thumbnails(Itdb_Track *track,
                                    const char *filename);

// Remove track thumbnails
void itdb_track_remove_thumbnails(Itdb_Track *track);
```

### Playlist Management

```c
// Create new playlist
Itdb_Playlist *itdb_playlist_new(const char *title, gboolean spl);

// Add playlist to database
void itdb_playlist_add(Itdb_iTunesDB *itdb, Itdb_Playlist *pl, gint32 pos);

// Add track to playlist
void itdb_playlist_add_track(Itdb_Playlist *pl, Itdb_Track *track, gint32 pos);

// Remove track from playlist
void itdb_playlist_remove_track(Itdb_Playlist *pl, Itdb_Track *track);

// Get master playlist (contains all tracks)
Itdb_Playlist *itdb_playlist_mpl(Itdb_iTunesDB *itdb);
```

### Artwork Operations

```c
// Get cover art formats supported by device
GList *itdb_device_get_cover_art_formats(const Itdb_Device *device);

// Artwork format structure
typedef struct {
    gint format_id;
    gint width;
    gint height;
    ItdbThumbFormat format;  // e.g., THUMB_FORMAT_RGB565_LE
} Itdb_ArtworkFormat;
```

## Key Data Structures

### Itdb_iTunesDB

The main database structure.

```c
struct _Itdb_iTunesDB {
    GList *tracks;           // List of Itdb_Track
    GList *playlists;        // List of Itdb_Playlist
    Itdb_Device *device;     // Device information
    gchar *filename;         // Database filename
    gchar *mountpoint;       // iPod mount point
    // ... internal fields
};
```

### Itdb_Track

Track metadata structure (~50 fields).

```c
struct _Itdb_Track {
    Itdb_iTunesDB *itdb;     // Parent database

    // Core metadata
    gchar *title;
    gchar *artist;
    gchar *album;
    gchar *albumartist;
    gchar *genre;
    gchar *composer;
    gchar *comment;
    gchar *grouping;

    // Track info
    gint32 track_nr;         // Track number
    gint32 tracks;           // Total tracks on album
    gint32 cd_nr;            // Disc number
    gint32 cds;              // Total discs
    gint32 year;

    // Technical info
    gint32 tracklen;         // Duration in milliseconds
    gint32 bitrate;          // kbps
    gint32 samplerate;       // Hz
    guint32 size;            // File size in bytes

    // File type
    guint8 type1;            // 0=AAC, 1=MP3
    guint8 type2;            // Same as type1
    guint8 mediatype;        // 1=audio, 2=video, etc.

    // Artwork
    gboolean has_artwork;
    GList *artwork;          // List of Itdb_Artwork

    // Path on iPod (relative)
    gchar *ipod_path;

    // Timestamps
    guint32 time_added;
    guint32 time_modified;
    guint32 time_played;

    // Play statistics
    guint32 playcount;
    guint32 skipcount;
    guint8 rating;           // 0-100 (20=1 star, 100=5 stars)

    // ... many more fields
};
```

### Itdb_Device

Device information.

```c
struct _Itdb_Device {
    gchar *mountpoint;
    Itdb_IpodInfo *ipi;      // Model info
    SysInfo *sysinfo;        // SysInfo file contents
    SysInfoExtended *sie;    // SysInfoExtended contents
    // ...
};

// iPod model info
typedef struct {
    const gchar *model_number;    // e.g., "A147"
    const gchar *model_name;      // e.g., "iPod Video (60GB)"
    guint generation;             // e.g., 5
    guint capacity;               // GB
    // ...
} Itdb_IpodInfo;
```

## Node.js Binding Approaches

### Option 1: ffi-napi

Direct foreign function interface calls to libgpod.

**Pros:**
- Quick to prototype
- No compilation step for binding code
- Dynamic loading

**Cons:**
- Complex struct handling
- Manual memory management
- Performance overhead
- Fragile with GLib types

**Example:**
```typescript
import ffi from 'ffi-napi';
import ref from 'ref-napi';
import StructType from 'ref-struct-di';

const GError = StructType({
  domain: 'uint32',
  code: 'int',
  message: 'string',
});
const GErrorPtr = ref.refType(GError);

const libgpod = ffi.Library('libgpod', {
  'itdb_parse': ['pointer', ['string', GErrorPtr]],
  'itdb_write': ['bool', ['pointer', GErrorPtr]],
  'itdb_free': ['void', ['pointer']],
  'itdb_track_new': ['pointer', []],
  'itdb_track_add': ['void', ['pointer', 'pointer', 'int32']],
  'itdb_cp_track_to_ipod': ['bool', ['pointer', 'string', GErrorPtr]],
});

// Usage
const errPtr = ref.alloc(GErrorPtr);
const db = libgpod.itdb_parse('/media/ipod', errPtr);
```

### Option 2: node-addon-api (N-API)

Native C++ addon using Node's stable ABI.

**Pros:**
- Full control over memory management
- Better performance
- Stable across Node versions
- Proper GLib integration

**Cons:**
- Requires C++ code
- Build step with node-gyp
- More complex development

**Example Structure:**
```cpp
// binding.cc
#include <napi.h>
#include <gpod/itdb.h>

class IPodDatabase : public Napi::ObjectWrap<IPodDatabase> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    IPodDatabase(const Napi::CallbackInfo& info);
    ~IPodDatabase();

private:
    static Napi::FunctionReference constructor;
    Itdb_iTunesDB* db_;

    Napi::Value Parse(const Napi::CallbackInfo& info);
    Napi::Value Write(const Napi::CallbackInfo& info);
    Napi::Value GetTracks(const Napi::CallbackInfo& info);
    Napi::Value AddTrack(const Napi::CallbackInfo& info);
};
```

```typescript
// index.ts
import { IPodDatabase } from './build/Release/libgpod_node.node';

const db = new IPodDatabase();
await db.parse('/media/ipod');
const tracks = db.getTracks();
```

### Option 3: Rust + napi-rs

Rust wrapper around libgpod, exposed to Node via napi-rs.

**Pros:**
- Memory safety
- Excellent error handling
- Modern build system (cargo)
- Cross-platform compilation

**Cons:**
- Requires Rust knowledge
- Additional dependency (Rust toolchain)
- FFI overhead at Rust-C boundary

**Example:**
```rust
// src/lib.rs
use napi_derive::napi;
use std::ffi::CString;

#[napi]
pub struct IPodDatabase {
    db: *mut gpod_sys::Itdb_iTunesDB,
}

#[napi]
impl IPodDatabase {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self { db: std::ptr::null_mut() }
    }

    #[napi]
    pub fn parse(&mut self, mountpoint: String) -> napi::Result<()> {
        let c_path = CString::new(mountpoint)?;
        unsafe {
            let mut error: *mut gpod_sys::GError = std::ptr::null_mut();
            self.db = gpod_sys::itdb_parse(c_path.as_ptr(), &mut error);
            if !error.is_null() {
                // Handle error
            }
        }
        Ok(())
    }

    #[napi]
    pub fn get_tracks(&self) -> Vec<Track> {
        // Iterate db->tracks GList and convert to Vec<Track>
    }
}
```

## Binding Complexity Analysis

### GLib Type Handling

libgpod uses GLib extensively. Key types to handle:

| GLib Type | Complexity | Notes |
|-----------|------------|-------|
| `gchar*` | Low | Just C strings |
| `gint32`, `guint32` | Low | Standard integers |
| `gboolean` | Low | 0/1 integer |
| `GList*` | Medium | Linked list, needs iteration |
| `GError**` | Medium | Output parameter for errors |
| `GHashTable*` | Medium | Hash table, less common |

### Memory Management

```c
// libgpod allocates strings that must be freed
gchar *title = track->title;  // Do NOT free - owned by track

// When setting strings, libgpod copies them
track->title = "New Title";   // libgpod strdup's internally

// Database must be freed
itdb_free(db);  // Frees all tracks, playlists, etc.
```

### Thread Safety

libgpod is **not thread-safe**. All operations on a single database must be serialized. Multiple databases can be used in parallel if they're for different devices.

## API Mapping for Node Wrapper

### Proposed TypeScript API

```typescript
// Database
class IPodDatabase {
  static open(mountPoint: string): Promise<IPodDatabase>;
  close(): void;

  readonly mountPoint: string;
  readonly device: DeviceInfo;
  readonly tracks: Track[];
  readonly playlists: Playlist[];

  addTrack(input: TrackInput): Promise<Track>;
  removeTrack(track: Track): void;
  updateTrack(track: Track, metadata: Partial<TrackMetadata>): void;

  addPlaylist(name: string): Playlist;
  removePlaylist(playlist: Playlist): void;

  write(): Promise<void>;
}

// Track
interface Track {
  readonly id: number;

  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  genre?: string;
  composer?: string;
  comment?: string;

  trackNumber?: number;
  totalTracks?: number;
  discNumber?: number;
  totalDiscs?: number;
  year?: number;

  duration: number;  // ms
  bitrate: number;   // kbps
  sampleRate: number;

  readonly filePath: string;
  readonly fileSize: number;

  playCount: number;
  skipCount: number;
  rating: number;  // 0-5

  readonly hasArtwork: boolean;
  setArtwork(imagePath: string): Promise<boolean>;
  removeArtwork(): void;
}

interface TrackInput {
  sourceFile: string;  // File to copy to iPod
  metadata?: Partial<TrackMetadata>;  // Override detected metadata
  artwork?: string;    // Artwork file path
}

// Device
interface DeviceInfo {
  model: string;
  modelNumber: string;
  generation: number;
  capacity: number;  // bytes
  freeSpace: number;
  artworkFormats: ArtworkFormat[];
}
```

## Implementation Recommendations

### Phase 1: Proof of Concept

1. Use **ffi-napi** for quick validation
2. Implement only core operations:
   - `itdb_parse`
   - `itdb_write`
   - `itdb_track_new` + `itdb_track_add`
   - `itdb_cp_track_to_ipod`
3. Test with real iPod device

### Phase 2: Production Binding

1. Evaluate ffi-napi stability
2. If issues, migrate to **node-addon-api**:
   - Better GList handling
   - Proper async operations
   - Memory safety

### Phase 3: Full API Coverage

1. Playlist support
2. Artwork support
3. Smart playlists (if needed)
4. Photo database (if needed)

## Testing Strategy

### Unit Tests

- Mock libgpod calls
- Test struct conversions
- Test error handling

### Integration Tests

```bash
# Create test iPod image
dd if=/dev/zero of=ipod.img bs=1M count=100
mkfs.vfat ipod.img
mkdir -p /tmp/test-ipod
mount -o loop ipod.img /tmp/test-ipod

# Initialize iPod structure
mkdir -p /tmp/test-ipod/iPod_Control/{Music,iTunes,Device}
echo "ModelNumStr: MA147" > /tmp/test-ipod/iPod_Control/Device/SysInfo
```

### Device Matrix

| Device | Model | Generation | Priority |
|--------|-------|------------|----------|
| iPod Video | MA147 | 5th | P0 |
| iPod Classic | MB565 | 6th | P1 |
| iPod Nano | MA477 | 2nd | P2 |

## References

- [libgpod API Documentation](http://www.gtkpod.org/libgpod/docs/)
- [libgpod Source Code](https://github.com/libgpod/libgpod)
- [gtkpod Source](https://github.com/gtkpod/gtkpod) - Reference implementation
- [Strawberry libgpod fork](https://github.com/strawberrymusicplayer/strawberry-libgpod)
- [ffi-napi Documentation](https://github.com/node-ffi-napi/node-ffi-napi)
- [node-addon-api Documentation](https://github.com/nodejs/node-addon-api)
- [napi-rs Documentation](https://napi.rs/)
