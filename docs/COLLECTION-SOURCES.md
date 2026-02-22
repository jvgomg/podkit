# Collection Sources

## Overview

podkit supports multiple music collection sources through an adapter pattern. Each adapter reads track metadata from a specific source and presents it through a common interface.

## Adapter Interface

```typescript
interface CollectionAdapter {
  /** Adapter identifier */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /** Connect to the collection source */
  connect(config?: AdapterConfig): Promise<void>;

  /** Get all tracks in the collection */
  getTracks(): Promise<CollectionTrack[]>;

  /** Get tracks matching a filter */
  getFilteredTracks(filter: TrackFilter): Promise<CollectionTrack[]>;

  /** Get the absolute file path for a track */
  getFilePath(track: CollectionTrack): string;

  /** Check if the track's source file exists */
  fileExists(track: CollectionTrack): Promise<boolean>;

  /** Disconnect from the source */
  disconnect(): Promise<void>;
}

interface CollectionTrack {
  /** Unique identifier within this collection */
  id: string;

  /** Core metadata (required for matching) */
  title: string;
  artist: string;
  album: string;

  /** Extended metadata */
  albumArtist?: string;
  genre?: string;
  year?: number;
  trackNumber?: number;
  discNumber?: number;
  duration?: number;  // milliseconds
  composer?: string;

  /** File information */
  filePath: string;
  fileType: AudioFileType;
  fileSize?: number;
  mtime?: Date;

  /** External identifiers (for advanced matching) */
  musicBrainzRecordingId?: string;
  musicBrainzReleaseId?: string;
  musicBrainzArtistId?: string;
  acoustId?: string;

  /** Source-specific data */
  sourceData?: Record<string, unknown>;
}

interface TrackFilter {
  artist?: string;
  album?: string;
  genre?: string;
  yearFrom?: number;
  yearTo?: number;
  addedAfter?: Date;
  query?: string;  // Free-text search
}
```

## Strawberry Adapter

### Overview

[Strawberry Music Player](https://www.strawberrymusicplayer.org/) stores its collection in a SQLite database. This is the primary adapter for v1.0.

### Database Location

| Platform | Default Path |
|----------|--------------|
| Linux | `~/.local/share/strawberry/strawberry/strawberry.db` |
| macOS | `~/Library/Application Support/Strawberry/strawberry/strawberry.db` |
| Windows | `%APPDATA%\strawberry\strawberry\strawberry.db` |

### Schema

Key tables:

```sql
-- Main collection table
CREATE TABLE songs (
  -- Identity
  rowid INTEGER PRIMARY KEY,
  url TEXT NOT NULL,          -- file:// URL

  -- Core metadata
  title TEXT,
  artist TEXT,
  album TEXT,
  albumartist TEXT,

  -- Extended metadata
  genre TEXT,
  year INTEGER,
  track INTEGER,
  disc INTEGER,
  composer TEXT,
  comment TEXT,

  -- Technical info
  length INTEGER,             -- nanoseconds
  bitrate INTEGER,
  samplerate INTEGER,
  bitdepth INTEGER,
  filetype INTEGER,
  filesize INTEGER,
  mtime INTEGER,
  ctime INTEGER,

  -- MusicBrainz IDs
  musicbrainz_recording_id TEXT,
  musicbrainz_album_id TEXT,
  musicbrainz_artist_id TEXT,
  musicbrainz_release_group_id TEXT,
  acoustid_id TEXT,
  acoustid_fingerprint TEXT,

  -- ... many more fields
);

-- Device tracks (populated when device is scanned)
CREATE TABLE device_<N>_songs (
  -- Same schema as songs table
);
```

### Implementation

```typescript
import Database from 'better-sqlite3';
import { homedir } from 'os';
import { join } from 'path';

class StrawberryAdapter implements CollectionAdapter {
  readonly name = 'strawberry';
  readonly description = 'Strawberry Music Player';

  private db?: Database.Database;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? this.getDefaultPath();
  }

  private getDefaultPath(): string {
    const platform = process.platform;
    if (platform === 'linux') {
      return join(homedir(), '.local/share/strawberry/strawberry/strawberry.db');
    } else if (platform === 'darwin') {
      return join(homedir(), 'Library/Application Support/Strawberry/strawberry/strawberry.db');
    } else if (platform === 'win32') {
      return join(process.env.APPDATA!, 'strawberry/strawberry/strawberry.db');
    }
    throw new Error(`Unsupported platform: ${platform}`);
  }

  async connect(): Promise<void> {
    this.db = new Database(this.dbPath, { readonly: true });
  }

  async getTracks(): Promise<CollectionTrack[]> {
    const rows = this.db!.prepare(`
      SELECT
        rowid,
        url,
        title,
        artist,
        album,
        albumartist,
        genre,
        year,
        track,
        disc,
        composer,
        length,
        bitrate,
        samplerate,
        filetype,
        filesize,
        mtime,
        musicbrainz_recording_id,
        musicbrainz_album_id,
        musicbrainz_artist_id,
        acoustid_id
      FROM songs
      WHERE unavailable = 0
      ORDER BY artist, album, disc, track
    `).all();

    return rows.map(row => this.rowToTrack(row));
  }

  async getFilteredTracks(filter: TrackFilter): Promise<CollectionTrack[]> {
    const conditions: string[] = ['unavailable = 0'];
    const params: Record<string, unknown> = {};

    if (filter.artist) {
      conditions.push('LOWER(artist) LIKE LOWER(:artist)');
      params.artist = `%${filter.artist}%`;
    }

    if (filter.album) {
      conditions.push('LOWER(album) LIKE LOWER(:album)');
      params.album = `%${filter.album}%`;
    }

    if (filter.genre) {
      conditions.push('LOWER(genre) LIKE LOWER(:genre)');
      params.genre = `%${filter.genre}%`;
    }

    if (filter.yearFrom) {
      conditions.push('year >= :yearFrom');
      params.yearFrom = filter.yearFrom;
    }

    if (filter.yearTo) {
      conditions.push('year <= :yearTo');
      params.yearTo = filter.yearTo;
    }

    const sql = `
      SELECT * FROM songs
      WHERE ${conditions.join(' AND ')}
      ORDER BY artist, album, disc, track
    `;

    const rows = this.db!.prepare(sql).all(params);
    return rows.map(row => this.rowToTrack(row));
  }

  getFilePath(track: CollectionTrack): string {
    // Convert file:// URL to path
    return decodeURIComponent(track.filePath.replace('file://', ''));
  }

  private rowToTrack(row: any): CollectionTrack {
    return {
      id: String(row.rowid),
      title: row.title || 'Unknown Title',
      artist: row.artist || 'Unknown Artist',
      album: row.album || 'Unknown Album',
      albumArtist: row.albumartist,
      genre: row.genre,
      year: row.year > 0 ? row.year : undefined,
      trackNumber: row.track > 0 ? row.track : undefined,
      discNumber: row.disc > 0 ? row.disc : undefined,
      duration: row.length ? Math.floor(row.length / 1_000_000) : undefined,
      composer: row.composer,
      filePath: row.url,
      fileType: this.mapFileType(row.filetype),
      fileSize: row.filesize,
      mtime: row.mtime ? new Date(row.mtime * 1000) : undefined,
      musicBrainzRecordingId: row.musicbrainz_recording_id,
      musicBrainzReleaseId: row.musicbrainz_album_id,
      musicBrainzArtistId: row.musicbrainz_artist_id,
      acoustId: row.acoustid_id,
    };
  }

  private mapFileType(filetype: number): AudioFileType {
    // Strawberry's Song::FileType enum
    const types: Record<number, AudioFileType> = {
      2: 'flac',
      3: 'mp3',
      5: 'aac',
      10: 'alac',
      // ... more mappings
    };
    return types[filetype] ?? 'unknown';
  }

  async disconnect(): Promise<void> {
    this.db?.close();
  }
}
```

### Device Tracks

Strawberry also stores scanned device tracks in `device_<N>_songs` tables:

```typescript
async getDeviceTracks(deviceId: number): Promise<CollectionTrack[]> {
  const tableName = `device_${deviceId}_songs`;

  // Check if table exists
  const exists = this.db!.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name=?
  `).get(tableName);

  if (!exists) {
    return [];
  }

  const rows = this.db!.prepare(`
    SELECT * FROM ${tableName}
    ORDER BY artist, album, disc, track
  `).all();

  return rows.map(row => this.rowToTrack(row));
}
```

## beets Adapter

### Overview

[beets](https://beets.io/) is a command-line music library manager with a SQLite database backend.

### Database Location

| Platform | Default Path |
|----------|--------------|
| Linux | `~/.config/beets/library.db` |
| macOS | `~/.config/beets/library.db` |
| Windows | `%APPDATA%\beets\library.db` |

Can be overridden in beets config (`~/.config/beets/config.yaml`):
```yaml
library: /path/to/library.db
```

### Schema

```sql
-- Items table (tracks)
CREATE TABLE items (
  id INTEGER PRIMARY KEY,
  path BLOB NOT NULL,         -- File path (bytes)

  -- Core metadata
  title TEXT,
  artist TEXT,
  album TEXT,
  albumartist TEXT,

  -- Extended metadata
  genre TEXT,
  year INTEGER,
  track INTEGER,
  disc INTEGER,
  composer TEXT,

  -- Technical info
  length REAL,                -- seconds
  bitrate INTEGER,
  samplerate INTEGER,
  format TEXT,                -- e.g., 'FLAC', 'MP3'

  -- MusicBrainz IDs
  mb_trackid TEXT,
  mb_albumid TEXT,
  mb_artistid TEXT,
  mb_albumartistid TEXT,
  mb_releasegroupid TEXT,

  -- ... more fields
);

-- Albums table
CREATE TABLE albums (
  id INTEGER PRIMARY KEY,
  artpath BLOB,               -- Album artwork path

  album TEXT,
  albumartist TEXT,
  year INTEGER,
  -- ...
);
```

### Implementation

```typescript
class BeetsAdapter implements CollectionAdapter {
  readonly name = 'beets';
  readonly description = 'beets music library';

  private db?: Database.Database;
  private dbPath: string;

  async connect(config?: { database?: string }): Promise<void> {
    this.dbPath = config?.database ?? this.getDefaultPath();
    this.db = new Database(this.dbPath, { readonly: true });
  }

  async getTracks(): Promise<CollectionTrack[]> {
    const rows = this.db!.prepare(`
      SELECT
        i.id,
        i.path,
        i.title,
        i.artist,
        i.album,
        i.albumartist,
        i.genre,
        i.year,
        i.track,
        i.disc,
        i.composer,
        i.length,
        i.bitrate,
        i.samplerate,
        i.format,
        i.mb_trackid,
        i.mb_albumid,
        i.mb_artistid,
        a.artpath
      FROM items i
      LEFT JOIN albums a ON i.album_id = a.id
      ORDER BY i.albumartist, i.album, i.disc, i.track
    `).all();

    return rows.map(row => ({
      id: String(row.id),
      title: row.title || 'Unknown Title',
      artist: row.artist || 'Unknown Artist',
      album: row.album || 'Unknown Album',
      albumArtist: row.albumartist,
      genre: row.genre,
      year: row.year,
      trackNumber: row.track,
      discNumber: row.disc,
      duration: row.length ? Math.floor(row.length * 1000) : undefined,
      composer: row.composer,
      filePath: row.path.toString(),  // beets stores as blob
      fileType: this.mapFormat(row.format),
      musicBrainzRecordingId: row.mb_trackid,
      musicBrainzReleaseId: row.mb_albumid,
      musicBrainzArtistId: row.mb_artistid,
      sourceData: {
        artworkPath: row.artpath?.toString(),
      },
    }));
  }

  private mapFormat(format: string): AudioFileType {
    const map: Record<string, AudioFileType> = {
      'FLAC': 'flac',
      'MP3': 'mp3',
      'AAC': 'aac',
      'ALAC': 'alac',
      'OGG': 'ogg',
      'OPUS': 'opus',
    };
    return map[format?.toUpperCase()] ?? 'unknown';
  }
}
```

## Directory Adapter

### Overview

Scans a directory tree for audio files and reads metadata directly from file tags.

### Implementation

```typescript
import { glob } from 'glob';
import * as mm from 'music-metadata';

class DirectoryAdapter implements CollectionAdapter {
  readonly name = 'directory';
  readonly description = 'Directory scan';

  private rootPath: string;
  private extensions: string[];
  private cache: CollectionTrack[] = [];

  constructor(config: {
    path: string;
    extensions?: string[];
  }) {
    this.rootPath = config.path;
    this.extensions = config.extensions ?? ['flac', 'mp3', 'm4a', 'ogg', 'opus'];
  }

  async connect(): Promise<void> {
    // Scan directory and build cache
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
      id: filePath,  // Use path as unique ID
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
      sourceData: {
        hasPicture: (common.picture?.length ?? 0) > 0,
      },
    };
  }

  private getTitleFromPath(filePath: string): string {
    const basename = path.basename(filePath, path.extname(filePath));
    // Remove track number prefix like "01 - " or "01. "
    return basename.replace(/^\d+[\s.-]+/, '');
  }

  private getFileType(filePath: string): AudioFileType {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const map: Record<string, AudioFileType> = {
      'flac': 'flac',
      'mp3': 'mp3',
      'm4a': 'aac',
      'ogg': 'ogg',
      'opus': 'opus',
    };
    return map[ext] ?? 'unknown';
  }

  async getTracks(): Promise<CollectionTrack[]> {
    return this.cache;
  }

  getFilePath(track: CollectionTrack): string {
    return track.filePath;
  }
}
```

## Adapter Registry

```typescript
class AdapterRegistry {
  private adapters = new Map<string, () => CollectionAdapter>();

  register(name: string, factory: () => CollectionAdapter): void {
    this.adapters.set(name, factory);
  }

  create(name: string): CollectionAdapter {
    const factory = this.adapters.get(name);
    if (!factory) {
      throw new Error(`Unknown adapter: ${name}`);
    }
    return factory();
  }

  list(): string[] {
    return Array.from(this.adapters.keys());
  }
}

// Default registry
const registry = new AdapterRegistry();
registry.register('strawberry', () => new StrawberryAdapter());
registry.register('beets', () => new BeetsAdapter());
registry.register('directory', () => new DirectoryAdapter({ path: '' }));

export { registry };
```

## Future Adapters

### Potential Sources

| Source | Type | Notes |
|--------|------|-------|
| **Navidrome** | API | Self-hosted streaming server |
| **Jellyfin** | API | Media server with music support |
| **Plex** | API | Media server |
| **Subsonic** | API | Streaming protocol |
| **iTunes XML** | File | Legacy iTunes library.xml |
| **M3U Playlists** | File | Playlist-based selection |

### Adapter Development Guide

To create a new adapter:

1. Implement the `CollectionAdapter` interface
2. Handle connection/disconnection lifecycle
3. Map source-specific fields to `CollectionTrack`
4. Register with the `AdapterRegistry`
5. Add configuration options
6. Write tests

```typescript
// Example: Custom adapter template
class CustomAdapter implements CollectionAdapter {
  readonly name = 'custom';
  readonly description = 'Custom music source';

  async connect(config?: CustomConfig): Promise<void> {
    // Initialize connection
  }

  async getTracks(): Promise<CollectionTrack[]> {
    // Fetch and transform tracks
  }

  async getFilteredTracks(filter: TrackFilter): Promise<CollectionTrack[]> {
    // Apply filter (can fall back to filtering getTracks())
    const all = await this.getTracks();
    return this.applyFilter(all, filter);
  }

  getFilePath(track: CollectionTrack): string {
    return track.filePath;
  }

  async fileExists(track: CollectionTrack): Promise<boolean> {
    const filePath = this.getFilePath(track);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    // Cleanup
  }
}
```

## References

- [Strawberry Source Code](https://github.com/strawberrymusicplayer/strawberry)
- [beets Documentation](https://beets.readthedocs.io/)
- [music-metadata npm package](https://www.npmjs.com/package/music-metadata)
- [better-sqlite3 npm package](https://www.npmjs.com/package/better-sqlite3)
