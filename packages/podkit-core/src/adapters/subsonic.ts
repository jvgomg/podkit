/**
 * Subsonic collection adapter
 *
 * Fetches tracks from Subsonic-compatible servers (Navidrome, Airsonic, Gonic, etc.)
 * and provides stream-based file access for syncing.
 */

import SubsonicAPI from 'subsonic-api';
import type { Child, AlbumWithSongsID3 } from 'subsonic-api';
import type { CollectionAdapter, CollectionTrack, FileAccess } from './interface.js';
import type { TrackFilter, AudioFileType } from '../types.js';

/**
 * Configuration for SubsonicAdapter
 */
export interface SubsonicAdapterConfig {
  /** Subsonic server URL (e.g., https://music.example.com) */
  url: string;
  /** Username for authentication */
  username: string;
  /** Password for authentication */
  password: string;
}

/**
 * Map file suffix to AudioFileType
 */
function suffixToFileType(suffix: string | undefined): AudioFileType {
  if (!suffix) return 'mp3';

  const lower = suffix.toLowerCase();
  switch (lower) {
    case 'flac':
      return 'flac';
    case 'mp3':
      return 'mp3';
    case 'm4a':
    case 'aac':
      return 'm4a';
    case 'ogg':
    case 'oga':
      return 'ogg';
    case 'opus':
      return 'opus';
    case 'wav':
      return 'wav';
    case 'aiff':
    case 'aif':
      return 'aiff';
    default:
      return 'mp3'; // Default fallback
  }
}

/**
 * Determine if a suffix represents a lossless format
 */
function isLosslessSuffix(suffix: string | undefined): boolean {
  if (!suffix) return false;

  const lower = suffix.toLowerCase();
  return ['flac', 'wav', 'aiff', 'aif', 'alac'].includes(lower);
}

/**
 * Get codec name from suffix and content type
 */
function getCodec(suffix: string | undefined, contentType: string | undefined): string | undefined {
  if (suffix) {
    const lower = suffix.toLowerCase();
    switch (lower) {
      case 'flac':
        return 'flac';
      case 'mp3':
        return 'mp3';
      case 'm4a':
        // Could be AAC or ALAC - check content type
        if (contentType?.includes('alac')) return 'alac';
        return 'aac';
      case 'aac':
        return 'aac';
      case 'ogg':
      case 'oga':
        return 'vorbis';
      case 'opus':
        return 'opus';
      case 'wav':
        return 'pcm_s16le';
      case 'aiff':
      case 'aif':
        return 'pcm_s16be';
      default:
        return undefined;
    }
  }
  return undefined;
}

/**
 * Adapter for reading tracks from Subsonic-compatible servers
 *
 * Supports Navidrome, Airsonic, Gonic, and other Subsonic API implementations.
 * Tracks are fetched by paginating through albums and extracting songs.
 */
export class SubsonicAdapter implements CollectionAdapter {
  readonly name = 'subsonic';

  private api: SubsonicAPI;
  private config: SubsonicAdapterConfig;
  private tracks: CollectionTrack[] | null = null;
  private connected = false;

  constructor(config: SubsonicAdapterConfig) {
    this.config = config;
    this.api = new SubsonicAPI({
      url: config.url,
      auth: {
        username: config.username,
        password: config.password,
      },
    });
  }

  /**
   * Connect to the Subsonic server and validate credentials
   */
  async connect(): Promise<void> {
    try {
      const response = await this.api.ping();
      if (response.status !== 'ok') {
        throw new Error(`Subsonic server returned status: ${response.status}`);
      }
      this.connected = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to connect to Subsonic server at ${this.config.url}: ${message}`);
    }
  }

  /**
   * Get all tracks from the Subsonic server
   *
   * Paginates through all albums and extracts songs.
   * Results are cached after first fetch.
   */
  async getTracks(): Promise<CollectionTrack[]> {
    if (this.tracks !== null) {
      return this.tracks;
    }

    if (!this.connected) {
      await this.connect();
    }

    this.tracks = [];
    const pageSize = 500;
    let offset = 0;

    // Paginate through all albums
    while (true) {
      const response = await this.api.getAlbumList2({
        type: 'alphabeticalByName',
        size: pageSize,
        offset,
      });

      const albums = response.albumList2?.album;
      if (!albums || albums.length === 0) {
        break;
      }

      // Fetch songs for each album
      for (const album of albums) {
        try {
          const albumResponse = await this.api.getAlbum({ id: album.id });
          const fullAlbum = albumResponse.album;

          if (fullAlbum?.song) {
            for (const song of fullAlbum.song) {
              const track = this.mapSongToTrack(song, fullAlbum);
              this.tracks.push(track);
            }
          }
        } catch {
          // Silently skip albums that fail to fetch and continue with other albums
        }
      }

      offset += pageSize;

      // If we got fewer albums than requested, we've reached the end
      if (albums.length < pageSize) {
        break;
      }
    }

    return this.tracks;
  }

  /**
   * Get tracks matching filter criteria
   */
  async getFilteredTracks(filter: TrackFilter): Promise<CollectionTrack[]> {
    const allTracks = await this.getTracks();
    return this.applyFilter(allTracks, filter);
  }

  /**
   * Get file access for a track
   *
   * Returns a stream-based access that downloads the track from the server.
   */
  getFileAccess(track: CollectionTrack): FileAccess {
    return {
      type: 'stream',
      getStream: async () => {
        const response = await this.api.download({ id: track.id });
        if (!response.body) {
          throw new Error(`Failed to download track ${track.id}: no response body`);
        }
        return response.body;
      },
      // Size is stored in track metadata if available
      size: track.bitrate ? undefined : undefined, // Size not reliably available from Subsonic
    };
  }

  /**
   * Disconnect from the server and clear cached data
   */
  async disconnect(): Promise<void> {
    this.tracks = null;
    this.connected = false;
  }

  /**
   * Get the number of cached tracks
   */
  getTrackCount(): number {
    return this.tracks?.length ?? 0;
  }

  /**
   * Map a Subsonic song (Child) to a CollectionTrack
   */
  private mapSongToTrack(song: Child, album: AlbumWithSongsID3): CollectionTrack {
    const fileType = suffixToFileType(song.suffix);
    const codec = getCodec(song.suffix, song.contentType);
    const lossless = isLosslessSuffix(song.suffix);

    return {
      // Use Subsonic ID as track ID
      id: song.id,

      // Core metadata
      title: song.title,
      artist: song.artist ?? album.artist ?? 'Unknown Artist',
      album: song.album ?? album.name,

      // Extended metadata
      albumArtist: album.artist,
      genre: song.genre ?? album.genre,
      year: song.year ?? album.year,
      trackNumber: song.track,
      discNumber: song.discNumber,
      // Subsonic duration is in seconds, convert to milliseconds
      duration: song.duration !== undefined ? song.duration * 1000 : undefined,

      // File info
      // Use the server path or construct a virtual path for identification
      filePath: song.path ?? `subsonic://${this.config.url}/${song.id}`,
      fileType,

      // Audio format details
      codec,
      lossless,
      bitrate: song.bitRate,

      // MusicBrainz IDs if available
      musicBrainzRecordingId: song.musicBrainzId,
    };
  }

  /**
   * Apply filter to tracks (in-memory filtering)
   */
  private applyFilter(tracks: CollectionTrack[], filter: TrackFilter): CollectionTrack[] {
    return tracks.filter((track) => {
      // Artist filter (case-insensitive partial match)
      if (filter.artist) {
        const artistMatch =
          track.artist.toLowerCase().includes(filter.artist.toLowerCase()) ||
          (track.albumArtist?.toLowerCase().includes(filter.artist.toLowerCase()) ?? false);
        if (!artistMatch) return false;
      }

      // Album filter (case-insensitive partial match)
      if (filter.album) {
        if (!track.album.toLowerCase().includes(filter.album.toLowerCase())) {
          return false;
        }
      }

      // Genre filter (case-insensitive partial match)
      if (filter.genre) {
        if (!track.genre?.toLowerCase().includes(filter.genre.toLowerCase())) {
          return false;
        }
      }

      // Year filter (exact match or range)
      if (filter.year !== undefined) {
        if (track.year !== filter.year) return false;
      }

      return true;
    });
  }
}

/**
 * Create a new SubsonicAdapter instance
 */
export function createSubsonicAdapter(config: SubsonicAdapterConfig): SubsonicAdapter {
  return new SubsonicAdapter(config);
}
