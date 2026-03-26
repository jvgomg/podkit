/**
 * Album-level artwork cache
 *
 * Caches extracted artwork data keyed by normalized (artist, album) so that
 * tracks on the same album share a single extraction. This avoids redundant
 * FFmpeg extractions for local sources and redundant network downloads for
 * remote sources (e.g., Subsonic), where the savings are ~10x (avg 10
 * tracks per album).
 *
 * Used by both the sync executor and the artwork repair routine.
 *
 * ## Future: adapter-level artwork
 *
 * The ideal long-term home for album-level artwork caching is the collection
 * adapter pattern itself. Adapters already cache artwork *hashes* (e.g., the
 * Subsonic adapter's `artworkCache` map), but they don't expose artwork *data*.
 * If adapters gained a `getArtwork(track): Promise<{ data, hash } | null>`
 * method with built-in album-level caching, both the executor and repair code
 * could call it directly instead of extracting from source files. This would:
 *
 * - Eliminate the "download source file just to extract artwork" pattern for
 *   remote sources (Subsonic could use getCoverArt directly)
 * - Unify the hash and data caching that currently live in separate layers
 * - Let each adapter own its artwork strategy (embedded vs. API vs. sidecar)
 *
 * For now, this standalone cache is a pragmatic shared abstraction that avoids
 * duplicating the album-keyed extraction logic between executor and repair.
 *
 * @module
 */

import { normalizeArtist, normalizeAlbum } from '../metadata/matching.js';
import { extractArtwork as defaultExtractArtwork } from './extractor.js';
import { hashArtwork } from './hash.js';
import type { ExtractedArtwork } from './types.js';

/** Cached artwork entry. `null` means the album was looked up but has no artwork. */
export type AlbumArtworkEntry = { data: Buffer; hash: string } | null;

/**
 * Build a normalized album key for cache lookups.
 * Tracks with the same (artist, album) share artwork.
 */
export function getAlbumKey(track: { artist: string; album: string }): string {
  return `${normalizeArtist(track.artist)}\x1F${normalizeAlbum(track.album)}`;
}

export interface AlbumArtworkCacheOptions {
  /** Override artwork extraction (for testing) */
  extractArtwork?: (filePath: string) => Promise<ExtractedArtwork | null>;
}

/**
 * Album-level artwork cache that deduplicates extraction across tracks
 * sharing the same (artist, album).
 *
 * Usage:
 * ```ts
 * const cache = new AlbumArtworkCache();
 * const entry = await cache.get(track, '/path/to/source.flac');
 * if (entry) {
 *   ipodTrack.setArtworkFromData(entry.data);
 * }
 * ```
 */
export class AlbumArtworkCache {
  private cache = new Map<string, AlbumArtworkEntry>();
  private extractArtwork: (filePath: string) => Promise<ExtractedArtwork | null>;

  constructor(options?: AlbumArtworkCacheOptions) {
    this.extractArtwork = options?.extractArtwork ?? defaultExtractArtwork;
  }

  /**
   * Get artwork for a track, using the album-level cache.
   *
   * On cache miss, extracts artwork from `sourceFilePath`, caches the result,
   * and returns it. On cache hit, returns the cached entry immediately.
   *
   * @returns Artwork data + hash, or `null` if the source has no artwork.
   */
  async get(
    track: { artist: string; album: string },
    sourceFilePath: string
  ): Promise<AlbumArtworkEntry> {
    const key = getAlbumKey(track);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const artwork = await this.extractArtwork(sourceFilePath);
    const entry: AlbumArtworkEntry = artwork
      ? { data: artwork.data, hash: hashArtwork(artwork.data) }
      : null;

    this.cache.set(key, entry);
    return entry;
  }

  /** Number of cached albums */
  get size(): number {
    return this.cache.size;
  }

  /** Clear all cached entries */
  clear(): void {
    this.cache.clear();
  }
}
