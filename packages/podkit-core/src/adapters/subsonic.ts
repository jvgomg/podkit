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
import type { AudioNormalization } from '../metadata/normalization.js';
import { replayGainToSoundcheck } from '../metadata/normalization.js';
import { hashArtwork } from '../artwork/hash.js';

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
  /** When true, compute artwork hashes for change detection (--check-artwork) */
  checkArtwork?: boolean;
}

/**
 * Minimum response size (bytes) to consider a getCoverArt response as a real image.
 * Responses smaller than this are likely error pages or corrupt data.
 */
const MIN_ARTWORK_BYTES = 100;

/**
 * Maximum number of retry attempts for connection-level failures
 * (DNS resolution, connection refused, timeout).
 */
const MAX_RETRIES = 3;

/**
 * Timeout per request in milliseconds (30 seconds).
 * Prevents indefinite hangs on unresponsive servers.
 */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Base delay for exponential backoff between retries (in milliseconds).
 * Retry 1: 1s, Retry 2: 2s, Retry 3: 4s
 */
const RETRY_BASE_DELAY_MS = 1_000;

/**
 * Check if an error is a connection-level failure that should be retried.
 *
 * Connection errors from fetch() are thrown as TypeError (per the Fetch spec).
 * This includes DNS resolution failures, connection refused, network unreachable,
 * and AbortError from our timeout signal. HTTP errors (4xx, 5xx) are NOT retried
 * because they indicate the server received the request — retrying won't help for
 * auth failures (401/403), bad requests (400), or server errors (500).
 */
function isConnectionError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  // Node.js fetch may throw non-TypeError for connection issues
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('etimedout') ||
      msg.includes('econnreset') ||
      msg.includes('enetunreach') ||
      msg.includes('ehostunreach') ||
      msg.includes('fetch failed') ||
      msg.includes('dns') ||
      msg.includes('abort')
    );
  }
  return false;
}

/**
 * Create a fetch wrapper that adds a per-request timeout and retries
 * on connection-level failures with exponential backoff.
 *
 * This prevents the Subsonic adapter from spinning indefinitely when
 * the server is unreachable (DNS failure, connection refused, timeout).
 *
 * @param serverUrl - The server URL, included in error messages for diagnostics
 * @param timeoutMs - Per-request timeout in milliseconds
 */
function createRetryFetch(serverUrl: string, timeoutMs: number = REQUEST_TIMEOUT_MS) {
  const retryFetch = async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const response = await globalThis.fetch(input, {
            ...init,
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          return response;
        } catch (error) {
          clearTimeout(timeoutId);
          throw error;
        }
      } catch (error) {
        lastError = error;

        if (!isConnectionError(error)) {
          // Not a connection error — don't retry (e.g., HTTP errors thrown by middleware)
          throw error;
        }

        if (attempt < MAX_RETRIES) {
          // Exponential backoff: 1s, 2s, 4s
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted — throw a descriptive error
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new SubsonicConnectionError(serverUrl, reason);
  };
  return retryFetch as typeof fetch;
}

/**
 * Error thrown when the Subsonic server cannot be reached after all retry attempts.
 * Includes the server URL and a helpful diagnostic message for Docker/network users.
 */
export class SubsonicConnectionError extends Error {
  readonly url: string;

  constructor(url: string, reason: string) {
    super(
      `Failed to connect to Subsonic server at ${url} after ${MAX_RETRIES} attempts. ` +
        `${reason}. ` +
        `Check that the server is running and the URL is correct. ` +
        `If running in Docker, ensure the container can reach the server ` +
        `(check DNS, network mode, and firewall settings).`
    );
    this.name = 'SubsonicConnectionError';
    this.url = url;
  }
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
 *
 * ## Artwork presence detection
 *
 * The Subsonic API provides no reliable metadata field for artwork presence.
 * Navidrome always populates the `coverArt` field and serves a static placeholder
 * image for albums without real artwork. Gonic only populates `coverArt` when
 * artwork exists and returns error code 70 for missing artwork.
 *
 * To handle both servers correctly, the adapter probes for placeholder images
 * at connect time by requesting `getCoverArt` with an empty `id`. If the server
 * returns an image (as Navidrome does), its hash is stored and used to filter
 * placeholder responses during scanning. Servers that return errors for missing
 * artwork (like Gonic) simply have no placeholder hash, and filtering is a no-op.
 */
export class SubsonicAdapter implements CollectionAdapter<CollectionTrack, TrackFilter> {
  readonly name = 'subsonic';
  readonly adapterType = 'subsonic';

  private api: SubsonicAPI;
  private config: SubsonicAdapterConfig;
  private tracks: CollectionTrack[] | null = null;
  private connected = false;
  private checkArtwork: boolean;

  /** Artwork cache: coverArtId → hash (artwork exists) or null (no artwork / placeholder) */
  private artworkCache = new Map<string, string | null>();

  /**
   * Hash of the server's placeholder artwork image, detected during connect().
   * Used to filter placeholder responses from servers like Navidrome that return
   * a static image instead of an error for albums without artwork.
   * Null when the server doesn't serve placeholders (e.g., Gonic).
   */
  private placeholderHash: string | null = null;

  constructor(config: SubsonicAdapterConfig) {
    this.config = config;
    this.checkArtwork = config.checkArtwork ?? false;
    this.api = new SubsonicAPI({
      url: config.url,
      auth: {
        username: config.username,
        password: config.password,
      },
      fetch: createRetryFetch(config.url),
    });
  }

  /**
   * Connect to the Subsonic server, validate credentials, and detect placeholder artwork.
   */
  async connect(): Promise<void> {
    try {
      const response = await this.api.ping();
      if (response.status !== 'ok') {
        throw new Error(`Subsonic server returned status: ${response.status}`);
      }
      this.connected = true;
    } catch (error) {
      // Re-throw SubsonicConnectionError directly (already has a descriptive message)
      if (error instanceof SubsonicConnectionError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to connect to Subsonic server at ${this.config.url}: ${message}`);
    }

    // Probe for placeholder artwork when --check-artwork is enabled.
    // Navidrome returns a static placeholder image for getCoverArt with an empty id;
    // Gonic and others return an error. The hash is stored for filtering during scans.
    if (this.checkArtwork) {
      this.placeholderHash = await this.detectPlaceholderArtwork();
    }
  }

  /**
   * Probe the server for placeholder artwork by requesting getCoverArt with an empty id.
   *
   * Navidrome serves a static WebP placeholder image for any coverArt request that
   * doesn't resolve to real artwork. By fetching with an empty id, we capture that
   * placeholder's hash. During scanning, any artwork matching this hash is treated
   * as "no artwork".
   *
   * Servers that return errors for invalid ids (Gonic, Airsonic) will simply cause
   * this method to return null, disabling placeholder filtering.
   *
   * @returns Hash of the placeholder image, or null if the server doesn't serve one
   */
  private async detectPlaceholderArtwork(): Promise<string | null> {
    try {
      const response = await this.api.getCoverArt({ id: '' });
      if (!response.ok) return null;

      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) return null;

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length < MIN_ARTWORK_BYTES) return null;

      return hashArtwork(buffer);
    } catch {
      return null;
    }
  }

  /**
   * Get all items from the Subsonic server
   *
   * Paginates through all albums and extracts songs.
   * Results are cached after first fetch.
   */
  async getItems(): Promise<CollectionTrack[]> {
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
              const track = await this.mapSongToTrack(song, fullAlbum);
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
   * Get items matching filter criteria
   */
  async getFilteredItems(filter: TrackFilter): Promise<CollectionTrack[]> {
    const allTracks = await this.getItems();
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
    this.artworkCache.clear();
    this.placeholderHash = null;
  }

  /**
   * Get the number of cached tracks
   */
  getTrackCount(): number {
    return this.tracks?.length ?? 0;
  }

  /**
   * Fetch artwork from the Subsonic server and determine if it represents real artwork.
   *
   * Validates the response (HTTP status, content-type, minimum size) and filters
   * server-generated placeholder images using the hash detected during connect().
   *
   * Results are cached by coverArt ID — multiple tracks on the same album share
   * a single fetch.
   *
   * @returns hasArtwork (always set), hash (only when checkArtwork is enabled and artwork exists)
   */
  private async fetchArtworkInfo(
    coverArtId: string
  ): Promise<{ hasArtwork: boolean; hash?: string }> {
    // Check cache first (many tracks share the same album cover)
    if (this.artworkCache.has(coverArtId)) {
      const cached = this.artworkCache.get(coverArtId);
      if (cached === null) return { hasArtwork: false };
      return { hasArtwork: true, hash: cached };
    }

    try {
      const response = await this.api.getCoverArt({ id: coverArtId });

      // Non-2xx response means no artwork (Gonic returns error code 70)
      if (!response.ok) {
        this.artworkCache.set(coverArtId, null);
        return { hasArtwork: false };
      }

      // Non-image content-type means an error response (XML/JSON/text)
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.startsWith('image/')) {
        this.artworkCache.set(coverArtId, null);
        return { hasArtwork: false };
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Very small responses are likely corrupt or empty
      if (buffer.length < MIN_ARTWORK_BYTES) {
        this.artworkCache.set(coverArtId, null);
        return { hasArtwork: false };
      }

      const hash = hashArtwork(buffer);

      // Filter server-generated placeholder images (e.g., Navidrome's static WebP)
      if (this.placeholderHash !== null && hash === this.placeholderHash) {
        this.artworkCache.set(coverArtId, null);
        return { hasArtwork: false };
      }

      this.artworkCache.set(coverArtId, hash);
      return { hasArtwork: true, hash };
    } catch {
      // Fetch error (network, server error) — conservatively treat as no artwork
      this.artworkCache.set(coverArtId, null);
      return { hasArtwork: false };
    }
  }

  /**
   * Map a Subsonic song (Child) to a CollectionTrack
   */
  private async mapSongToTrack(song: Child, album: AlbumWithSongsID3): Promise<CollectionTrack> {
    const fileType = suffixToFileType(song.suffix);
    const codec = getCodec(song.suffix, song.contentType);
    const lossless = isLosslessSuffix(song.suffix);

    // Artwork detection is gated behind --check-artwork for Subsonic sources,
    // matching the directory adapter pattern: without the flag, syncs are fast
    // (no getCoverArt calls). With it, fetchArtworkInfo validates the response,
    // filters server-generated placeholders (detected during connect), and
    // enables artwork-added, artwork-removed, and artwork-updated detection.
    //
    // The artworkHash is always returned when artwork is fetched, enabling
    // progressive sync tag writes that prevent infinite artwork-added loops
    // for tracks where the server has album-level artwork but the audio file
    // has no embedded artwork (see TASK-142).
    let hasArtwork: boolean | undefined;
    let artworkHash: string | undefined;
    if (this.checkArtwork && song.coverArt) {
      const artworkInfo = await this.fetchArtworkInfo(song.coverArt);
      hasArtwork = artworkInfo.hasArtwork;
      artworkHash = artworkInfo.hash;
    } else if (!song.coverArt) {
      hasArtwork = false;
    }

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
      compilation: album.isCompilation ?? undefined,
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

      // Artwork
      hasArtwork,
      artworkHash,

      // MusicBrainz IDs if available
      musicBrainzRecordingId: song.musicBrainzId,

      // Volume normalization from ReplayGain data
      normalization: this.extractNormalization(song.replayGain),
    };
  }

  /**
   * Extract normalization data from Subsonic ReplayGain data.
   *
   * Prefers track gain over album gain. The ReplayGain type from subsonic-api
   * marks fields as required numbers, but the OpenSubsonic spec treats them
   * as optional — so we null-check carefully. A gain of 0 is valid (unity gain).
   */
  private extractNormalization(replayGain: Child['replayGain']): AudioNormalization | undefined {
    if (!replayGain) return undefined;

    if (replayGain.trackGain !== undefined) {
      return {
        source: 'replaygain-track',
        trackGain: replayGain.trackGain,
        trackPeak: replayGain.trackPeak,
        albumGain: replayGain.albumGain,
        albumPeak: replayGain.albumPeak,
        soundcheckValue: replayGainToSoundcheck(replayGain.trackGain),
      };
    }

    if (replayGain.albumGain !== undefined) {
      return {
        source: 'replaygain-album',
        trackGain: replayGain.albumGain,
        trackPeak: replayGain.albumPeak,
        albumGain: replayGain.albumGain,
        albumPeak: replayGain.albumPeak,
        soundcheckValue: replayGainToSoundcheck(replayGain.albumGain),
      };
    }

    return undefined;
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
