/**
 * Artwork database operations — reset and rebuild
 *
 * Two primitive operations for managing iPod artwork state:
 *
 * - **resetArtworkDatabase**: Wipe all artwork and clear sync tags. Fast, no
 *   source collection needed. After a reset, the next `podkit sync` will
 *   naturally re-add artwork (since sync tags are cleared), so reset + sync
 *   is an alternative path to a full rebuild — just spread across two commands.
 *
 * - **rebuildArtworkDatabase**: Reset + re-extract all artwork from source
 *   collections in one operation. Slower, but restores artwork immediately.
 *
 * Batched saves are necessary because libgpod holds full image data in memory
 * for MEMORY-type thumbnails until save() converts them to on-disk IPOD-type.
 * Without batching, a 2,500-track library can consume 1+ GB of RAM.
 *
 * Album-level artwork caching avoids redundant downloads/extractions — tracks
 * sharing the same (artist, album) reuse cached artwork data. For remote sources
 * like Subsonic, this reduces network traffic by ~10x (avg 10 tracks per album).
 *
 * @see ADR-013 for the full corruption investigation
 */

import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { IpodDatabase } from '../ipod/database.js';
import type { CollectionTrack, CollectionAdapter } from '../adapters/interface.js';
import { getMatchKey } from '../metadata/matching.js';
import { cleanupAllTempArtwork as defaultCleanupAllTempArtwork } from './extractor.js';
import type { ExtractedArtwork } from './types.js';
// repair.ts operates at the IpodDatabase level, not the DeviceAdapter level,
// so it uses the raw sync tag functions instead of adapter.writeSyncTag().
import { parseSyncTag, writeSyncTag } from '../metadata/sync-tags.js';
import { AlbumArtworkCache } from './album-cache.js';
import { streamToTempFile, cleanupTempFile } from '../utils/stream.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** Number of tracks to process before saving to flush memory */
const BATCH_SIZE = 200;

/** Timeout for downloading a source file (ms) */
const DOWNLOAD_TIMEOUT_MS = 60_000;

// ── Reset types ─────────────────────────────────────────────────────────────

export interface ResetResult {
  /** Number of tracks that had artwork cleared */
  tracksCleared: number;
  /** Total tracks on the iPod */
  totalTracks: number;
  /** Number of orphaned .ithmb files cleaned up after libgpod save */
  orphanedFilesRemoved: number;
}

export interface ResetOptions {
  /** If true, don't modify the iPod — just report what would change */
  dryRun?: boolean;
}

// ── Rebuild types ───────────────────────────────────────────────────────────

export interface RebuildProgress {
  current: number;
  total: number;
  matched: number;
  noSource: number;
  noArtwork: number;
  errors: number;
  /** Current track being processed (for display) */
  currentTrack?: { artist: string; title: string };
}

export interface RebuildResult {
  totalTracks: number;
  matched: number;
  noSource: number;
  noArtwork: number;
  errors: number;
  errorDetails: Array<{ artist: string; title: string; error: string }>;
}

export interface RebuildOptions {
  /** If true, don't modify the iPod — just report what would change */
  dryRun?: boolean;
  /** Called after each track is processed */
  onProgress?: (progress: RebuildProgress) => void;
  /** Abort signal for cancellation — partial repair is saved on abort */
  signal?: AbortSignal;
}

export interface RebuildDependencies {
  /** Open iPod database */
  db: IpodDatabase;
  /** Source collection adapters (already connected) */
  adapters: CollectionAdapter[];
  /** Override artwork extraction (for testing) */
  extractArtwork?: (filePath: string) => Promise<ExtractedArtwork | null>;
  /** Override temp artwork cleanup (for testing) */
  cleanupAllTempArtwork?: () => Promise<void>;
}

// ── Implementation ──────────────────────────────────────────────────────────

/**
 * Clear the art= hash from a track's sync tag.
 * Called when artwork is removed but not replaced, so the next sync
 * knows it needs to re-add artwork rather than skipping it.
 */
function clearArtworkSyncTag(
  db: IpodDatabase,
  track: Parameters<IpodDatabase['updateTrack']>[0]
): void {
  const existingTag = parseSyncTag(track.comment);
  if (existingTag?.artworkHash) {
    existingTag.artworkHash = undefined;
    const updatedComment = writeSyncTag(track.comment, existingTag);
    db.updateTrack(track, { comment: updatedComment });
  }
}

/**
 * Check for orphaned .ithmb files after libgpod save and remove them.
 * libgpod should clean these up, but if the ArtworkDB was corrupt it may not.
 */
function cleanupOrphanedIthmb(mountPoint: string): number {
  const artworkDir = join(mountPoint, 'iPod_Control', 'Artwork');

  if (!existsSync(artworkDir)) {
    return 0;
  }

  let removed = 0;
  try {
    const files = readdirSync(artworkDir);
    for (const file of files) {
      if (file.endsWith('.ithmb')) {
        try {
          unlinkSync(join(artworkDir, file));
          removed++;
        } catch {
          // Best-effort cleanup
        }
      }
    }
  } catch {
    // Can't read artwork dir — nothing to clean up
  }

  return removed;
}

/**
 * Reset the artwork database: remove all artwork from all tracks, clear
 * sync tag artwork hashes, and save.
 *
 * This is a fast operation that doesn't require source collections. After
 * a reset, the next `podkit sync` will naturally re-add artwork since the
 * cleared sync tags signal that artwork needs to be set.
 */
export async function resetArtworkDatabase(
  db: IpodDatabase,
  mountPoint: string,
  options: ResetOptions = {}
): Promise<ResetResult> {
  const { dryRun = false } = options;
  const ipodTracks = db.getTracks();
  const total = ipodTracks.length;
  let tracksCleared = 0;

  if (!dryRun) {
    // Remove artwork from all tracks
    for (const ipodTrack of ipodTracks) {
      try {
        db.removeTrackArtwork(ipodTrack);
        tracksCleared++;
      } catch {
        // May fail if track has no artwork — that's fine
      }
      // Clear artwork sync tag hash
      clearArtworkSyncTag(db, ipodTrack);
    }

    // Save to flush artwork removal to disk
    await db.save();

    // Verify ithmb files are cleaned up — libgpod should handle this on save,
    // but if the ArtworkDB was corrupt it may leave orphaned files behind
    const orphanedFilesRemoved = cleanupOrphanedIthmb(mountPoint);

    return { tracksCleared, totalTracks: total, orphanedFilesRemoved };
  }

  // Dry run: count tracks that have artwork
  for (const ipodTrack of ipodTracks) {
    if (ipodTrack.hasArtwork) {
      tracksCleared++;
    }
  }

  return { tracksCleared, totalTracks: total, orphanedFilesRemoved: 0 };
}

/**
 * Build a match index from all source collections.
 * Returns a map from match key to { adapter, track } for artwork extraction.
 */
async function buildSourceIndex(
  adapters: CollectionAdapter[]
): Promise<Map<string, { adapter: CollectionAdapter; track: CollectionTrack }>> {
  const index = new Map<string, { adapter: CollectionAdapter; track: CollectionTrack }>();

  for (const adapter of adapters) {
    const tracks = await adapter.getItems();
    for (const track of tracks) {
      const key = getMatchKey(track);
      if (!index.has(key)) {
        index.set(key, { adapter, track });
      }
    }
  }

  return index;
}

/**
 * Get the local file path for artwork extraction from a source track.
 * For local sources, returns the file path directly.
 * For remote sources (Subsonic), downloads to a temp file first.
 *
 * @returns { path, cleanup } where cleanup() removes any temp file
 */
async function getArtworkSourcePath(
  adapter: CollectionAdapter,
  track: CollectionTrack
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const fileAccess = await adapter.getFileAccess(track);

  if (fileAccess.type === 'path') {
    return { path: fileAccess.path, cleanup: async () => {} };
  }

  // Stream source — download to temp file with timeout
  const downloadPromise = streamToTempFile(fileAccess.getStream, fileAccess.size);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Download timed out')), DOWNLOAD_TIMEOUT_MS)
  );

  const tempPath = await Promise.race([downloadPromise, timeoutPromise]);
  return {
    path: tempPath,
    cleanup: () => cleanupTempFile(tempPath),
  };
}

/**
 * Rebuild all artwork on an iPod from source collections.
 *
 * Strategy:
 * 1. Reset artwork database (remove all artwork, clear sync tags, clean up ithmb files)
 * 2. Process tracks in batches: extract artwork from source, set on track
 * 3. Save after each batch to flush MEMORY-type thumbnails to disk
 *
 * Artwork is cached per album — tracks sharing the same (artist, album)
 * reuse cached artwork data, avoiding redundant downloads and extractions.
 */
export async function rebuildArtworkDatabase(
  deps: RebuildDependencies,
  options: RebuildOptions = {}
): Promise<RebuildResult> {
  const { db, adapters } = deps;
  const cleanupAllTempArtwork = deps.cleanupAllTempArtwork ?? defaultCleanupAllTempArtwork;
  const { dryRun = false, onProgress, signal } = options;

  // Album-level artwork cache — deduplicates extraction across tracks on the same album
  const artworkCache = new AlbumArtworkCache({
    extractArtwork: deps.extractArtwork,
  });

  // Build source track index from all adapters
  const sourceIndex = await buildSourceIndex(adapters);

  // Get all iPod tracks
  const ipodTracks = db.getTracks();
  const total = ipodTracks.length;

  const progress: RebuildProgress = {
    current: 0,
    total,
    matched: 0,
    noSource: 0,
    noArtwork: 0,
    errors: 0,
  };

  const errorDetails: RebuildResult['errorDetails'] = [];

  try {
    // Phase 1: Remove all existing artwork and save to clear corrupt ithmb files
    if (!dryRun) {
      for (const ipodTrack of ipodTracks) {
        try {
          db.removeTrackArtwork(ipodTrack);
        } catch {
          // May fail if track has no artwork — that's fine
        }
      }
      await db.save();
    }

    // Phase 2: Set new artwork in batches
    let batchCount = 0;

    for (const ipodTrack of ipodTracks) {
      // Check for abort — save partial progress (partial repair is better than none)
      if (signal?.aborted) {
        break;
      }

      progress.current++;
      progress.currentTrack = { artist: ipodTrack.artist, title: ipodTrack.title };

      // Find matching source track
      const key = getMatchKey(ipodTrack);
      const source = sourceIndex.get(key);

      if (!source) {
        // No source match — artwork was cleared in phase 1, clear sync tag art= hash
        if (!dryRun) {
          clearArtworkSyncTag(db, ipodTrack);
        }
        progress.noSource++;
        onProgress?.(progress);
        continue;
      }

      // Extract artwork from source and set on track
      if (!dryRun) {
        try {
          // Get source file path (downloads to temp for remote sources)
          const { path: sourcePath, cleanup } = await getArtworkSourcePath(
            source.adapter,
            source.track
          );

          let cached;
          try {
            cached = await artworkCache.get(ipodTrack, sourcePath);
          } finally {
            await cleanup();
          }

          if (!cached) {
            // Source has no artwork — artwork was cleared in phase 1, clear sync tag art= hash
            clearArtworkSyncTag(db, ipodTrack);
            progress.noArtwork++;
            onProgress?.(progress);
            continue;
          }

          // Set artwork on the iPod track
          db.setTrackArtworkFromData(ipodTrack, cached.data);

          // Update sync tag art= hash (preserve all other fields)
          const existingTag = parseSyncTag(ipodTrack.comment);
          if (existingTag) {
            existingTag.artworkHash = cached.hash;
            const updatedComment = writeSyncTag(ipodTrack.comment, existingTag);
            db.updateTrack(ipodTrack, { comment: updatedComment });
          }

          progress.matched++;
          batchCount++;

          // Save after each batch to flush MEMORY-type thumbnails and free memory
          if (batchCount >= BATCH_SIZE) {
            await db.save();
            batchCount = 0;
          }
        } catch (error) {
          // Artwork was cleared in phase 1 but replacement failed — clear sync tag
          clearArtworkSyncTag(db, ipodTrack);
          progress.errors++;
          errorDetails.push({
            artist: ipodTrack.artist,
            title: ipodTrack.title,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        // Dry run: just count what would be matched
        progress.matched++;
      }

      onProgress?.(progress);
    }

    // Final save for any remaining tracks in the last partial batch
    if (!dryRun && batchCount > 0) {
      await db.save();
    }
  } finally {
    await cleanupAllTempArtwork();
  }

  return {
    totalTracks: total,
    matched: progress.matched,
    noSource: progress.noSource,
    noArtwork: progress.noArtwork,
    errors: progress.errors,
    errorDetails,
  };
}
