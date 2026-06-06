/**
 * MusicArtworkManager — encapsulates the music pipeline's artwork concerns.
 *
 * Owns the three caches that used to live on `MusicPipeline`:
 *   - the per-album artwork extraction cache (dedup FFmpeg/network spawns
 *     across tracks on the same album);
 *   - the per-album resized-artwork cache (dedup sharp/FFmpeg resize spawns);
 *   - the per-album sibling candidate map (deterministic album-cache
 *     resolution under non-deterministic scan ordering).
 *
 * Exposed surface:
 *   - `transferArtwork(track, sourceFilePath, sourceTrack, ctx)` — the core
 *     write dispatcher. Returns the hex hash of bytes that landed on the
 *     device, or `undefined` when nothing was written (so callers can suppress
 *     the `syncTag.artworkHash` claim and avoid the doc-041 §3.6 churn loop).
 *   - `buildAlbumCandidates(plan, ctx)` — called once per `execute()` to
 *     precompute the sibling candidate map.
 *   - `clearCaches()` — called at `execute()` entry to reset all three caches.
 *
 * Warnings collected during extraction (artwork is non-fatal) are emitted
 * via the `WarningSink` passed at construction time, so
 * `pipeline.getWarnings()` sees them in the order they fired.
 *
 * @module
 */

import { extname } from 'node:path';

import { AlbumArtworkCache, getAlbumKey } from '../../artwork/album-cache.js';
import { resizeArtwork } from '../../artwork/resize.js';
import type { CollectionTrack } from '../../adapters/interface.js';
import type { DeviceAdapter, DeviceTrack } from '../../device/adapter.js';
import type { SyncPlan, WarningSink } from '../engine/types.js';
import type { ExecutionContext } from './execution-context.js';

/**
 * Container preference rank for album-artwork resolution.
 *
 * Lower = more likely to actually carry embedded art in the wild and so a
 * better choice for the album cache to extract from first. Used by
 * {@link MusicArtworkManager.buildAlbumCandidates} to sort sibling source
 * paths.
 *
 * Real-world expectation: FLAC/ALAC/MP3/AAC/AIFF reliably carry an
 * `attached_pic` / ID3v2 APIC frame. WAV / OGG / Opus *can* carry art
 * (`id3 ` RIFF chunk; `METADATA_BLOCK_PICTURE` Vorbis comment), but most
 * casual encoders don't emit it.
 */
function artworkContainerRank(filePath: string): number {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.flac':
    case '.m4a':
    case '.aac':
    case '.mp3':
    case '.aiff':
    case '.aif':
      return 0;
    case '.wav':
    case '.ogg':
    case '.opus':
      return 1;
    default:
      return 2;
  }
}

/**
 * Encapsulates the music pipeline's artwork extraction, resize, and transfer
 * concerns.
 *
 * One instance per {@link MusicPipeline}. The caches survive across
 * sequential `execute()` calls (the pipeline calls `clearCaches()` at the
 * start of each run), matching the pre-refactor instance-scoped lifetime.
 */
export class MusicArtworkManager {
  /** Album-level artwork cache — deduplicates extraction across tracks on the same album */
  private readonly artworkCache = new AlbumArtworkCache();

  /**
   * Per-album sibling candidate paths used to make album-cache resolution
   * deterministic across scan orderings.
   *
   * Populated once per `execute()` by {@link buildAlbumCandidates} when the
   * adapter exposes local files (directory adapter). Empty for remote
   * adapters (Subsonic) — those fall back to the cache's single-source mode
   * so non-local sibling paths don't poison the album with extraction
   * failures.
   */
  private readonly albumCandidates = new Map<string, readonly string[]>();

  /** Album-level cache for resized artwork — avoids redundant FFmpeg spawns for tracks on the same album */
  private readonly resizedArtworkCache = new Map<string, Buffer>();

  constructor(
    private readonly device: DeviceAdapter,
    private readonly warnings: WarningSink
  ) {}

  /**
   * Clear all three per-execution caches.
   *
   * Called at `MusicPipeline.execute()` entry. The caches are instance-scoped
   * performance caches, not per-execute state — wiping them is correct
   * sequential-reuse behaviour but unsafe under overlapping `execute()` calls
   * (which is why `MusicPipeline` rejects overlap with `PipelineBusyError`).
   */
  clearCaches(): void {
    this.artworkCache.clear();
    this.albumCandidates.clear();
    this.resizedArtworkCache.clear();
  }

  /**
   * Build per-album sibling candidate lists from the sync plan.
   *
   * Only meaningful for adapters where `source.filePath` resolves to a real
   * local file (currently just the directory adapter). For remote adapters
   * (Subsonic) the field is a server-side path or a `subsonic://` URI that
   * the local FFmpeg can't read — leaving the candidate map empty means the
   * cache falls back to single-source mode (which never caches a null).
   *
   * Within each album, candidates are sorted by container preference: paths
   * whose extension is known to support embedded art reliably come first,
   * so the cache stops at the first sibling that actually carries a cover.
   */
  buildAlbumCandidates(plan: SyncPlan, ctx: ExecutionContext): void {
    if (ctx.adapter?.adapterType !== 'directory') return;

    const groups = new Map<string, string[]>();
    for (const op of plan.operations) {
      const source = (op as { source?: CollectionTrack }).source;
      if (!source) continue;
      const key = getAlbumKey({ artist: source.artist ?? '', album: source.album ?? '' });
      const list = groups.get(key);
      if (list) {
        list.push(source.filePath);
      } else {
        groups.set(key, [source.filePath]);
      }
    }

    for (const [key, paths] of groups) {
      paths.sort((a, b) => artworkContainerRank(a) - artworkContainerRank(b));
      this.albumCandidates.set(key, paths);
    }
  }

  /**
   * Extract and transfer artwork for a track.
   *
   * Delegates the actual write to `adapter.setTrackArtwork`, which knows how
   * the device stores artwork (iPod ArtworkDB, mass-storage embedded tag,
   * sidecar `cover.jpg`, or no-op). The manager only decides:
   *
   *   1. whether to skip the byte extraction entirely (`artworkSink === 'noop'`
   *      — no destination on the device, so even the FFmpeg work is wasted);
   *   2. whether to resize bytes before handing them to the adapter
   *      (`'embedded'` / `'sidecar'` paths key off the album-level resize
   *      cache so siblings share a single resize spawn);
   *   3. whether to honestly claim success on the sync tag — `'noop'` MUST
   *      return undefined so the next sync doesn't re-fire `artwork-added`
   *      on every track (the churn loop documented in doc-041 §3.6).
   *
   * Errors are caught and collected as warnings, but don't fail the sync.
   *
   * @returns Artwork hash (8-char hex) if bytes landed on the device,
   *          `undefined` otherwise — caller MUST treat `undefined` as
   *          "no claim of success" and skip writing `syncTag.artworkHash`.
   */
  async transferArtwork(
    track: DeviceTrack,
    sourceFilePath: string,
    sourceTrack: CollectionTrack,
    ctx: ExecutionContext
  ): Promise<string | undefined> {
    // Defense-in-depth gate for global artwork disable. Callers are
    // expected to gate the whole artwork block at their level (the
    // surrounding `if (ctx.artworkEnabled && ...)` is the load-bearing
    // check — without it, the stale-cleanup `removeTrackArtwork` branch
    // would wipe existing device artwork on `artwork=false` syncs). This
    // inner short-circuit is the belt to that suspenders: any future write
    // path that lands in transferArtwork without going through the outer
    // gate still returns `undefined` here, suppressing both the bytes and
    // the syncTag.artworkHash claim.
    if (!ctx.artworkEnabled) {
      return undefined;
    }

    // Early-skip the noop sink BEFORE extracting bytes. The adapter would
    // drop them anyway; doing the FFmpeg/network work first is wasted I/O.
    // The doc-041 §3.6 churn-loop pin still holds: returning undefined here
    // suppresses the syncTag.artworkHash claim.
    if (track.artworkSink === 'noop') {
      return undefined;
    }

    try {
      const albumKey = getAlbumKey({ artist: track.artist ?? '', album: track.album ?? '' });
      const candidates = this.albumCandidates.get(albumKey);
      const adapterFallback = this.buildAdapterFallback(sourceTrack, ctx);
      const cached = await this.artworkCache.get(
        { artist: track.artist ?? '', album: track.album ?? '' },
        sourceFilePath,
        { candidates, adapterFallback }
      );
      if (!cached) {
        return undefined;
      }

      // Resize before the adapter writes:
      //   - `'embedded'` keys off `ctx.artworkResize`
      //   - `'sidecar'` keys off `ctx.sidecarResize`
      //   - `'database'` (iPod) doesn't resize here — libgpod owns the iPod's
      //     thumbnail rescale, so the original bytes go straight through.
      const imageData =
        track.artworkSink === 'database'
          ? cached.data
          : await this.getResizedArtwork(track, cached.data, ctx);
      await this.device.setTrackArtwork(track, imageData);
      return cached.hash;
    } catch (error) {
      // Collect warning but don't fail the sync - artwork is optional
      this.warnings.emit({
        phase: 'execute',
        type: 'artwork',
        tracks: [
          {
            artist: track.artist ?? 'Unknown Artist',
            title: track.title ?? 'Unknown Title',
            album: track.album,
          },
        ],
        message: `Failed to extract/transfer artwork: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return undefined;
    }
  }

  /**
   * Build an adapter-side artwork fallback closure for the album cache.
   *
   * Returned when the current execution's adapter exposes `getArtwork()` AND
   * the caller can supply a source track to identify the album. Lets the
   * directory adapter contribute sidecar bytes and the Subsonic adapter
   * contribute getCoverArt bytes when the audio body has no embedded picture.
   *
   * Returns `undefined` when no fallback is available — the cache then keeps
   * its embed-only behaviour.
   */
  private buildAdapterFallback(
    sourceTrack: CollectionTrack,
    ctx: ExecutionContext
  ): (() => Promise<Buffer | null>) | undefined {
    const adapter = ctx.adapter;
    if (!adapter?.getArtwork) return undefined;
    return () => adapter.getArtwork!(sourceTrack);
  }

  /**
   * Get resized artwork for embed / sidecar writes, using an album-level cache.
   *
   * Picks the right resize dimension based on the track's sink:
   *   - `'embedded'` → `ctx.artworkResize`
   *   - `'sidecar'`  → `ctx.sidecarResize`
   *   - any other    → no resize (caller doesn't reach this path today)
   *
   * Both dimensions key off `capabilities.artworkMaxResolution`; they stay
   * separate context fields so the FFmpeg embed path only fires on embedded-
   * primary devices (sidecar-primary wants the file body art-free).
   *
   * Avoids redundant resize spawns for tracks on the same album. Falls back
   * to original data when the relevant resize value is 0 or unset.
   */
  private async getResizedArtwork(
    track: DeviceTrack,
    originalData: Buffer,
    ctx: ExecutionContext
  ): Promise<Buffer> {
    const resize = track.artworkSink === 'sidecar' ? ctx.sidecarResize : ctx.artworkResize;
    if (!resize || resize <= 0) {
      return originalData;
    }

    const key = getAlbumKey({ artist: track.artist ?? '', album: track.album ?? '' });
    const cached = this.resizedArtworkCache.get(key);
    if (cached) {
      return cached;
    }

    const resized = await resizeArtwork(originalData, resize);
    this.resizedArtworkCache.set(key, resized);
    return resized;
  }
}
