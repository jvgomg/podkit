# Collection Sources

## Overview

podkit reads music collections by scanning directories and parsing metadata from audio files using the `music-metadata` library. This approach works universally regardless of which music player you use.

## Directory Scanning

### How It Works

1. Scan specified directory for audio files (FLAC, MP3, M4A, OGG, OPUS)
2. Parse metadata from each file using `music-metadata`
3. Build in-memory collection of tracks
4. Compare against iPod contents for sync

### Supported Formats

| Format | Extension | Notes |
|--------|-----------|-------|
| FLAC | `.flac` | Lossless, will be transcoded to AAC |
| MP3 | `.mp3` | Copied directly |
| AAC | `.m4a` | Copied directly |
| OGG Vorbis | `.ogg` | Transcoded to AAC |
| Opus | `.opus` | Transcoded to AAC |
| ALAC | `.m4a` | Copied directly (Apple Lossless) |

### Metadata Extracted

```typescript
interface CollectionTrack {
  // Identity
  id: string;              // File path as unique ID

  // Core metadata (required for matching)
  title: string;
  artist: string;
  album: string;

  // Extended metadata
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  duration?: number;       // milliseconds
  composer?: string;

  // File information
  filePath: string;
  fileType: AudioFileType;
  fileSize?: number;
  mtime?: Date;

  // External identifiers (for advanced matching)
  musicBrainzRecordingId?: string;
  musicBrainzReleaseId?: string;
  musicBrainzArtistId?: string;
  acoustId?: string;
}
```

## Adapter Interface

The adapter pattern is used internally for potential future extensibility. Currently only `DirectoryAdapter` is implemented.

```typescript
interface CollectionAdapter {
  readonly name: string;
  readonly description: string;

  connect(config?: AdapterConfig): Promise<void>;
  getTracks(): Promise<CollectionTrack[]>;
  getFilteredTracks(filter: TrackFilter): Promise<CollectionTrack[]>;
  getFilePath(track: CollectionTrack): string;
  fileExists(track: CollectionTrack): Promise<boolean>;
  disconnect(): Promise<void>;
}
```

## Directory Adapter Implementation

```typescript
import { glob } from 'glob';
import * as mm from 'music-metadata';

class DirectoryAdapter implements CollectionAdapter {
  readonly name = 'directory';
  readonly description = 'Directory scan';

  private rootPath: string;
  private extensions = ['flac', 'mp3', 'm4a', 'ogg', 'opus'];
  private cache: CollectionTrack[] = [];

  constructor(config: { path: string }) {
    this.rootPath = config.path;
  }

  async connect(): Promise<void> {
    await this.scan();
  }

  private async scan(): Promise<void> {
    const pattern = `**/*.{${this.extensions.join(',')}}`;
    const files = await glob(pattern, {
      cwd: this.rootPath,
      absolute: true,
      nodir: true,
    });

    this.cache = [];
    for (const filePath of files) {
      try {
        const track = await this.parseFile(filePath);
        this.cache.push(track);
      } catch (err) {
        console.warn(`Failed to parse ${filePath}:`, err);
      }
    }
  }

  private async parseFile(filePath: string): Promise<CollectionTrack> {
    const metadata = await mm.parseFile(filePath);
    const { common, format } = metadata;

    return {
      id: filePath,
      title: common.title || this.getTitleFromPath(filePath),
      artist: common.artist || 'Unknown Artist',
      album: common.album || 'Unknown Album',
      albumArtist: common.albumartist,
      genre: common.genre?.[0],
      year: common.year,
      trackNumber: common.track?.no ?? undefined,
      discNumber: common.disk?.no ?? undefined,
      duration: format.duration ? Math.floor(format.duration * 1000) : undefined,
      composer: common.composer?.[0],
      filePath,
      fileType: this.getFileType(filePath),
      musicBrainzRecordingId: common.musicbrainz_recordingid,
      musicBrainzReleaseId: common.musicbrainz_albumid,
      musicBrainzArtistId: common.musicbrainz_artistid?.[0],
      acoustId: common.acoustid_id,
    };
  }

  async getTracks(): Promise<CollectionTrack[]> {
    return this.cache;
  }

  getFilePath(track: CollectionTrack): string {
    return track.filePath;
  }

  async disconnect(): Promise<void> {
    this.cache = [];
  }
}
```

## Sync Selection (Future - M4)

Currently, podkit syncs all tracks found in the source directory. Future versions will support filtering:

| Approach | Description |
|----------|-------------|
| **Playlist** | Import M3U/M3U8 playlist of songs to sync |
| **Path patterns** | Include/exclude directories |
| **Tag filters** | Filter by genre, artist, year, etc. |

See TASK-031 for implementation details.

## Subsonic Adapter

podkit supports syncing from Subsonic-compatible servers including Navidrome, Airsonic, Gonic, and the original Subsonic server.

### Configuration

Add a Subsonic collection to your config file (`~/.config/podkit/config.toml`):

```toml
[music.navidrome]
type = "subsonic"
url = "https://your-server.example.com"
username = "your-username"
password = "your-password"
path = "/path/to/download/cache"
```

### Password Options

The password can be provided in several ways (checked in this order):

1. **Config file** (simplest): Add `password = "..."` to the collection config
2. **Environment variable**: Set `PODKIT_MUSIC_{NAME}_PASSWORD` where `{NAME}` is the collection name in uppercase
3. **Fallback env var**: Set `SUBSONIC_PASSWORD` for any Subsonic collection

**Example with environment variable:**
```bash
# For a collection named "navidrome"
export PODKIT_MUSIC_NAVIDROME_PASSWORD="your-password"
podkit collection music navidrome
```

> **Note:** Storing passwords in config files is convenient but less secure than environment variables. A future version will support system keychain integration for better security.

### How It Works

1. Connect to the Subsonic server using the API
2. Fetch the complete catalog (paginating through albums)
3. Extract track metadata from the API response
4. During sync, stream audio directly from the server
5. Transcode as needed and copy to iPod

### Supported Servers

| Server | Tested | Notes |
|--------|--------|-------|
| Navidrome | Yes | Full support |
| Airsonic | Untested | Should work (uses same API) |
| Gonic | Untested | Should work (uses same API) |
| Subsonic | Untested | Should work (original API) |

### Limitations

- **No playlist sync** (yet) - only tracks are synced
- **Fresh fetch each sync** - no local catalog caching
- **Single server per collection** - create multiple collections for multiple servers

See [ADR-007](adr/ADR-007-subsonic-collection-source.md) for full design details.

## Future Adapters

Additional adapters may be added if users request them:

| Source | Type | Notes |
|--------|------|-------|
| **Strawberry** | SQLite | Direct database access |
| **beets** | SQLite | Direct database access |
| **Jellyfin** | API | Media server |
| **iTunes XML** | File | Legacy library.xml |

## References

- [music-metadata npm package](https://www.npmjs.com/package/music-metadata)
- [ADR-004: Collection Source Abstraction](adr/ADR-004-collection-sources.md)
