/**
 * Read-only IpodReader facade for @podkit/ipod-db.
 *
 * Integrates the iTunesDB parser, ArtworkDB parser, SysInfo parser, and
 * ithmb extractor into a single convenient class for querying an iPod's
 * music library.
 */

import { parseDatabase } from './itunesdb/parser.js';
import { MhodType } from './itunesdb/types.js';
import type { ITunesDatabase, MhitRecord, MhypRecord, MhodRecord } from './itunesdb/types.js';
import { parseArtworkDatabase } from './artworkdb/parser.js';
import { extractThumbnail } from './artworkdb/ithmb.js';
import type { ArtworkDatabase, DecodedImage } from './artworkdb/types.js';
import { parseSysInfo } from './device/sysinfo.js';
import { getModelInfo, getDisplayName, supportsArtwork, supportsVideo } from './device/models.js';
import type { SysInfoData, IpodModelInfo } from './device/types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface Track {
  id: number;
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  composer: string;
  duration: number;
  trackNumber: number;
  discNumber: number;
  year: number;
  bitrate: number;
  sampleRate: number;
  size: number;
  rating: number;
  playCount: number;
  compilation: boolean;
  ipodPath: string | null;
  artworkId: number;
  dbid: bigint;
}

export interface Playlist {
  id: bigint;
  name: string;
  isMaster: boolean;
  trackCount: number;
  trackIds: number[];
}

export interface Album {
  name: string;
  artist: string;
  trackIds: number[];
}

export interface DeviceInfo {
  modelNumber: string | null;
  modelName: string;
  generation: string;
  capacityGb: number;
  supportsArtwork: boolean;
  supportsVideo: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a string MHOD value by type from a list of MHODs. */
function getMhodString(mhods: MhodRecord[], mhodType: number): string | null {
  for (const mhod of mhods) {
    if (mhod.type === 'string' && mhod.mhodType === mhodType) {
      return mhod.value;
    }
  }
  return null;
}

/** Convert an MhitRecord into a Track. */
function mhitToTrack(mhit: MhitRecord): Track {
  return {
    id: mhit.trackId,
    title: getMhodString(mhit.mhods, MhodType.Title) ?? '',
    artist: getMhodString(mhit.mhods, MhodType.Artist) ?? '',
    album: getMhodString(mhit.mhods, MhodType.Album) ?? '',
    albumArtist: getMhodString(mhit.mhods, MhodType.AlbumArtist) ?? '',
    genre: getMhodString(mhit.mhods, MhodType.Genre) ?? '',
    composer: getMhodString(mhit.mhods, MhodType.Composer) ?? '',
    duration: mhit.trackLength,
    trackNumber: mhit.trackNumber,
    discNumber: mhit.discNumber,
    year: mhit.year,
    bitrate: mhit.bitrate,
    sampleRate: mhit.sampleRate,
    size: mhit.size,
    rating: mhit.rating,
    playCount: mhit.playCount,
    compilation: mhit.compilation !== 0,
    ipodPath: getMhodString(mhit.mhods, MhodType.Path),
    artworkId: mhit.artworkCount > 0 ? mhit.trackId : 0,
    dbid: mhit.dbid,
  };
}

/** Convert an MhypRecord into a Playlist. */
function mhypToPlaylist(mhyp: MhypRecord): Playlist {
  return {
    id: mhyp.playlistId,
    name: getMhodString(mhyp.mhods, MhodType.Title) ?? '',
    isMaster: (mhyp.hidden & 0xff) === 1,
    trackCount: mhyp.items.length,
    trackIds: mhyp.items.map((item) => item.trackId),
  };
}

/** Sort comparator: by trackNumber, then by title. */
function compareTrackOrder(a: Track, b: Track): number {
  if (a.trackNumber !== b.trackNumber) return a.trackNumber - b.trackNumber;
  return a.title.localeCompare(b.title);
}

/** Find the ithmb key in the map that matches a given formatId. */
function findIthmbKey(formatId: number, ithmbs: Map<string, Uint8Array>): string | null {
  // ithmb filenames look like "F{formatId}_1.ithmb"
  const prefix = `F${formatId}_`;
  for (const key of ithmbs.keys()) {
    if (key.startsWith(prefix) || key.includes(`/${prefix}`) || key.includes(`\\${prefix}`)) {
      return key;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// IpodReader
// ---------------------------------------------------------------------------

export class IpodReader {
  private readonly tracks: Track[];
  private readonly playlists: Playlist[];
  private readonly trackById: Map<number, Track>;
  private readonly artistIndex: Map<string, number[]>;
  private readonly albumIndex: Map<string, Album>;
  private readonly genreIndex: Map<string, number[]>;
  private readonly sortedArtists: string[];
  private readonly sortedAlbums: Album[];
  private readonly sortedGenres: string[];
  private readonly artworkDb: ArtworkDatabase | null;
  private readonly ithmbs: Map<string, Uint8Array> | null;
  private readonly sysInfo: SysInfoData | null;
  private readonly modelInfo: IpodModelInfo | null;

  private constructor(
    db: ITunesDatabase,
    artworkDb: ArtworkDatabase | null,
    ithmbs: Map<string, Uint8Array> | undefined | null,
    sysInfo: SysInfoData | null,
    modelInfo: IpodModelInfo | null
  ) {
    this.artworkDb = artworkDb;
    this.ithmbs = ithmbs ?? null;
    this.sysInfo = sysInfo;
    this.modelInfo = modelInfo;

    // Convert raw records to Track/Playlist objects
    this.tracks = db.tracks.map(mhitToTrack);
    this.playlists = db.playlists.map(mhypToPlaylist);

    // Build trackById index
    this.trackById = new Map();
    for (const track of this.tracks) {
      this.trackById.set(track.id, track);
    }

    // Build artist index
    this.artistIndex = new Map();
    for (const track of this.tracks) {
      const artist = track.artist;
      if (!artist) continue;
      let ids = this.artistIndex.get(artist);
      if (!ids) {
        ids = [];
        this.artistIndex.set(artist, ids);
      }
      ids.push(track.id);
    }

    // Build album index (key = "artist|album")
    // iPods don't use albumArtist — always index by track artist.
    this.albumIndex = new Map();
    for (const track of this.tracks) {
      const artist = track.artist;
      const album = track.album;
      if (!album) continue;
      const key = `${artist}|${album}`;
      let entry = this.albumIndex.get(key);
      if (!entry) {
        entry = { name: album, artist, trackIds: [] };
        this.albumIndex.set(key, entry);
      }
      entry.trackIds.push(track.id);
    }

    // Build genre index
    this.genreIndex = new Map();
    for (const track of this.tracks) {
      const genre = track.genre;
      if (!genre) continue;
      let ids = this.genreIndex.get(genre);
      if (!ids) {
        ids = [];
        this.genreIndex.set(genre, ids);
      }
      ids.push(track.id);
    }

    // Sort track IDs within each index by trackNumber, then title
    const sortIds = (ids: number[]): void => {
      ids.sort((aId, bId) => {
        const a = this.trackById.get(aId)!;
        const b = this.trackById.get(bId)!;
        return compareTrackOrder(a, b);
      });
    };

    for (const ids of this.artistIndex.values()) sortIds(ids);
    for (const entry of this.albumIndex.values()) sortIds(entry.trackIds);
    for (const ids of this.genreIndex.values()) sortIds(ids);

    // Pre-sort artist/album/genre lists alphabetically
    this.sortedArtists = [...this.artistIndex.keys()].sort((a, b) => a.localeCompare(b));

    this.sortedAlbums = [...this.albumIndex.values()].sort((a, b) => {
      const cmp = a.artist.localeCompare(b.artist);
      if (cmp !== 0) return cmp;
      return a.name.localeCompare(b.name);
    });

    this.sortedGenres = [...this.genreIndex.keys()].sort((a, b) => a.localeCompare(b));
  }

  /**
   * Create an IpodReader from raw file data.
   *
   * All parsing is synchronous.
   */
  static fromFiles(files: {
    itunesDb: Uint8Array;
    artworkDb?: Uint8Array;
    sysInfo?: string;
    ithmbs?: Map<string, Uint8Array>;
  }): IpodReader {
    const db = parseDatabase(files.itunesDb);

    const artworkDb = files.artworkDb ? parseArtworkDatabase(files.artworkDb) : null;

    const sysInfo = files.sysInfo ? parseSysInfo(files.sysInfo) : null;
    const modelInfo = sysInfo?.modelNumber ? (getModelInfo(sysInfo.modelNumber) ?? null) : null;

    return new IpodReader(db, artworkDb, files.ithmbs, sysInfo, modelInfo);
  }

  // ── Library queries ─────────────────────────────────────────────────

  /** Return all tracks in the library. */
  getTracks(): Track[] {
    return this.tracks;
  }

  /** Look up a single track by its ID. */
  getTrack(id: number): Track | undefined {
    return this.trackById.get(id);
  }

  /** Return all playlists. */
  getPlaylists(): Playlist[] {
    return this.playlists;
  }

  /** Look up a single playlist by its ID. */
  getPlaylist(id: bigint): Playlist | undefined {
    return this.playlists.find((p) => p.id === id);
  }

  /** Return the tracks in a playlist, in playlist order. */
  getPlaylistTracks(id: bigint): Track[] {
    const playlist = this.getPlaylist(id);
    if (!playlist) return [];
    return playlist.trackIds
      .map((tid) => this.trackById.get(tid))
      .filter((t): t is Track => t !== undefined);
  }

  /** Return the master (library) playlist. */
  getMasterPlaylist(): Playlist {
    const master = this.playlists.find((p) => p.isMaster);
    if (!master) {
      // Fallback: return first playlist (always the master by convention)
      return this.playlists[0]!;
    }
    return master;
  }

  // ── Artwork ─────────────────────────────────────────────────────────

  /** Extract the artwork image for a track, or null if unavailable. */
  getTrackArtwork(trackId: number): DecodedImage | null {
    const track = this.trackById.get(trackId);
    if (!track || !track.artworkId || !this.artworkDb || !this.ithmbs) {
      return null;
    }

    // Find the artwork image for this track.
    // Primary: match by sourceId (track dbid) — this is how libgpod links them.
    // Fallback: match by imageId === trackId (legacy/synthetic data).
    const image =
      this.artworkDb.images.find((img) => img.sourceId === track.dbid) ??
      this.artworkDb.images.find((img) => img.imageId === track.artworkId);
    if (!image || image.thumbnails.length === 0) return null;

    // Pick the largest thumbnail
    const thumb = image.thumbnails.reduce((a, b) => (a.width > b.width ? a : b));

    // Find the ithmb file data
    // First try the filename from the thumbnail (colon-separated path)
    let ithmbData: Uint8Array | undefined;
    if (thumb.filename) {
      // Convert colon-path like ":iPod_Control:Artwork:F1057_1.ithmb" to filename
      const parts = thumb.filename.split(':');
      const basename = parts[parts.length - 1];
      if (basename) {
        ithmbData = this.ithmbs.get(basename);
      }
    }

    // Fallback: search by formatId
    if (!ithmbData) {
      const key = findIthmbKey(thumb.formatId, this.ithmbs);
      if (key) {
        ithmbData = this.ithmbs.get(key);
      }
    }

    if (!ithmbData) return null;

    return extractThumbnail(ithmbData, thumb);
  }

  // ── Device info ─────────────────────────────────────────────────────

  /** Return device identification info, or null if no SysInfo was provided. */
  getDeviceInfo(): DeviceInfo | null {
    if (!this.sysInfo) return null;

    if (this.modelInfo) {
      return {
        modelNumber: this.sysInfo.modelNumber,
        modelName: getDisplayName(this.modelInfo),
        generation: this.modelInfo.generation,
        capacityGb: this.modelInfo.capacityGb,
        supportsArtwork: supportsArtwork(this.modelInfo.generation),
        supportsVideo: supportsVideo(this.modelInfo.generation),
      };
    }

    // Model not recognized, return basic info
    return {
      modelNumber: this.sysInfo.modelNumber,
      modelName: 'Unknown iPod',
      generation: 'unknown',
      capacityGb: 0,
      supportsArtwork: false,
      supportsVideo: false,
    };
  }

  // ── Indexing helpers (for iPod menu navigation) ─────────────────────

  /** Return sorted unique artist names. */
  getArtists(): string[] {
    return this.sortedArtists;
  }

  /** Return albums sorted by artist then name, with associated track IDs. */
  getAlbums(): Album[] {
    return this.sortedAlbums;
  }

  /** Return sorted unique genre names. */
  getGenres(): string[] {
    return this.sortedGenres;
  }

  /** Return tracks by a specific artist, sorted by trackNumber then title. */
  getTracksByArtist(artist: string): Track[] {
    const ids = this.artistIndex.get(artist);
    if (!ids) return [];
    return ids.map((id) => this.trackById.get(id)).filter((t): t is Track => t !== undefined);
  }

  /** Return tracks for a specific album by artist, sorted by trackNumber then title. */
  getTracksByAlbum(artist: string, album: string): Track[] {
    const key = `${artist}|${album}`;
    const entry = this.albumIndex.get(key);
    if (!entry) return [];
    return entry.trackIds
      .map((id) => this.trackById.get(id))
      .filter((t): t is Track => t !== undefined);
  }

  /** Return tracks in a specific genre, sorted by trackNumber then title. */
  getTracksByGenre(genre: string): Track[] {
    const ids = this.genreIndex.get(genre);
    if (!ids) return [];
    return ids.map((id) => this.trackById.get(id)).filter((t): t is Track => t !== undefined);
  }
}
