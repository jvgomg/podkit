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
 * Per-call options for {@link AlbumArtworkCache.get}.
 */
export interface AlbumArtworkGetOptions {
  /**
   * Sibling source-file candidates for this album, in preference order.
   *
   * On a cache miss the cache iterates the list and uses the FIRST candidate
   * that yields artwork; the result is cached for every subsequent track in
   * the same album (whether or not that track was in the list). If every
   * candidate yields null, the negative result is cached too — at that point
   * the album genuinely has no embedded art and there's no value in retrying.
   *
   * Callers ordering: put embed-capable containers (FLAC / ALAC / MP3 / AAC /
   * AIFF-with-id3v2 / OGG-Opus-with-METADATA_BLOCK_PICTURE) first; put
   * containers that can't carry art at all (e.g. raw PCM WAV without an
   * `id3 ` chunk) last or omit them entirely.
   *
   * Omit this option to fall back to single-source behaviour (extract only
   * `sourceFilePath`, never cache a null — protects single-source callers
   * like the artwork-repair routine from poisoning the album when a sibling
   * might have art).
   */
  candidates?: readonly string[];
}

/**
 * Album-level artwork cache that deduplicates extraction across tracks
 * sharing the same `(artist, album)`.
 *
 * ## Why this exists
 *
 * Real-world albums usually share a single cover image across every track.
 * Extracting it once per album (instead of once per track) skips N-1
 * ffprobe spawns for local sources and N-1 HTTP downloads for remote
 * sources — typically a 10x win.
 *
 * ## Determinism: the candidates contract
 *
 * Calling `get(track, sourceFilePath)` with just a single source path means
 * the cache asks ffprobe about exactly that file. If the caller processes
 * tracks in an order where the first track for an album happens to be one
 * whose container can't carry embedded art (e.g. raw WAV before FLAC),
 * extracting from THAT first track returns null — and historically the cache
 * remembered the null, so every later track in the album also got null.
 *
 * The order in which "the first track of an album" gets processed differs
 * between source adapters (the directory adapter sorts by glob order, the
 * Subsonic adapter sorts by Navidrome's `getAlbum.songs` order), so the same
 * album would land on the device with or without art depending on adapter.
 *
 * Pass `options.candidates` with the album's sibling source paths, ordered
 * by embed-capability, to make the outcome deterministic: the cache stops at
 * the first sibling that yields art, and every track in the album (including
 * WAV / OGG / Opus) ends up with the same embedded bytes. See
 * `packages/podkit-core/src/sync/music/pipeline.ts` for the call site.
 *
 * Single-source callers (artwork repair, ad-hoc inspection) can keep the old
 * signature; they're conservative — they never cache a null, so a later call
 * for the same album with siblings will still try to find art.
 *
 * ## Usage
 *
 * ```ts
 * const cache = new AlbumArtworkCache();
 * const entry = await cache.get(track, '/music/01-wav.wav', {
 *   candidates: ['/music/03-flac.flac', '/music/04-alac.m4a', '/music/01-wav.wav'],
 * });
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
   * Behaviour:
   * - Cache hit (positive or null): return cached entry immediately.
   * - Cache miss with `options.candidates`: iterate candidates in order,
   *   cache + return the first positive. If all candidates yield null,
   *   cache + return null (album exhausted — won't retry).
   * - Cache miss without `options.candidates`: extract only `sourceFilePath`.
   *   Cache positive; do NOT cache null (the album might still have art
   *   reachable via a sibling we haven't seen yet).
   *
   * @returns Artwork data + hash, or `null` if no candidate yielded art.
   */
  async get(
    track: { artist: string; album: string },
    sourceFilePath: string,
    options?: AlbumArtworkGetOptions
  ): Promise<AlbumArtworkEntry> {
    const key = getAlbumKey(track);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const candidates = options?.candidates;
    if (candidates && candidates.length > 0) {
      for (const path of candidates) {
        const artwork = await this.extractArtwork(path);
        if (artwork) {
          const entry: AlbumArtworkEntry = {
            data: artwork.data,
            hash: hashArtwork(artwork.data),
          };
          this.cache.set(key, entry);
          return entry;
        }
      }
      // Every candidate yielded null — album genuinely has no embedded art.
      this.cache.set(key, null);
      return null;
    }

    // Single-source fallback: only extract the requested path. Never cache a
    // negative result — a future caller might pass candidates that reveal art.
    const artwork = await this.extractArtwork(sourceFilePath);
    if (artwork) {
      const entry: AlbumArtworkEntry = { data: artwork.data, hash: hashArtwork(artwork.data) };
      this.cache.set(key, entry);
      return entry;
    }
    return null;
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
