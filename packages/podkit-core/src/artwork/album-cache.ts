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
 * Pair the embedded extraction with the optional `adapterFallback` hook to
 * route adapter-side artwork (directory sidecar, Subsonic `getCoverArt`)
 * through the same album-level memoisation — see `AlbumArtworkGetOptions`.
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
 *
 * ## Behavioural branches
 *
 * The two fields compose to give four distinct cache behaviours. Understanding
 * which branch applies is important for cache hygiene (null-poisoning risk):
 *
 * | `candidates` | `adapterFallback` | Null cached? | Source consulted           |
 * |:---:         |:---:              |:---:         |:---                        |
 * | absent       | absent            | no           | `sourceFilePath` only      |
 * | absent       | present           | no           | `sourceFilePath`, then fallback |
 * | present      | absent            | **yes**      | candidates in order        |
 * | present      | present           | **yes**      | candidates, then fallback  |
 *
 * When `candidates` is present the cache commits to a final answer for the
 * album — all siblings have been enumerated, so a null means no art exists
 * anywhere and re-probing would be pointless. Without `candidates` the cache
 * stays non-committal on null: a different caller may later supply siblings
 * that reveal art (the artwork-repair route visits tracks individually).
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

  /**
   * Adapter-side artwork fallback. Consulted ONLY when extraction from the
   * source audio body returns null for every candidate (single-source: when
   * `sourceFilePath` extracts null). Returning a Buffer promotes those bytes
   * to the album-level positive cache so every sibling shares them.
   *
   * Lets the directory adapter contribute sidecar bytes (cover.jpg/folder.jpg)
   * and the Subsonic adapter contribute getCoverArt bytes when the served
   * audio file has no embedded picture.
   */
  adapterFallback?: () => Promise<Buffer | null>;
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
 *   await deviceAdapter.setTrackArtwork(ipodTrack, entry.data);
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
   * Behaviour (see also {@link AlbumArtworkGetOptions} for the full matrix):
   * - Cache hit (positive or null): return cached entry immediately.
   * - Cache miss with `options.candidates`: iterate candidates in order,
   *   extract the first positive. If all candidates miss, consult
   *   `options.adapterFallback` (if provided). Cache the outcome — including
   *   null — because all siblings have been enumerated.
   * - Cache miss without `options.candidates`: extract only `sourceFilePath`,
   *   then consult `options.adapterFallback` on miss. Cache positive; do NOT
   *   cache null (the album might still have art reachable via a sibling we
   *   haven't seen yet).
   *
   * @returns Artwork data + hash, or `null` if no source yielded art.
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
      // Every candidate's embedded extraction yielded null. Before pinning a
      // negative cache entry, give the adapter a chance to supply out-of-band
      // bytes (sidecar / API). A positive adapter result is cached so siblings
      // share the bytes; a null adapter result locks in the negative.
      const adapterEntry = await this.tryAdapterFallback(options?.adapterFallback);
      this.cache.set(key, adapterEntry);
      return adapterEntry;
    }

    // Single-source fallback: only extract the requested path. Never cache a
    // negative result — a future caller might pass candidates that reveal art.
    const artwork = await this.extractArtwork(sourceFilePath);
    if (artwork) {
      const entry: AlbumArtworkEntry = { data: artwork.data, hash: hashArtwork(artwork.data) };
      this.cache.set(key, entry);
      return entry;
    }

    // Embed missed; consult adapter fallback (sidecar / API). Cache only on
    // positive — keep single-source caller semantics (no null poisoning).
    const adapterEntry = await this.tryAdapterFallback(options?.adapterFallback);
    if (adapterEntry) {
      this.cache.set(key, adapterEntry);
    }
    return adapterEntry;
  }

  private async tryAdapterFallback(
    fallback: AlbumArtworkGetOptions['adapterFallback']
  ): Promise<AlbumArtworkEntry> {
    if (!fallback) return null;
    const bytes = await fallback();
    if (!bytes) return null;
    return { data: bytes, hash: hashArtwork(bytes) };
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
