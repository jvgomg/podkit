/**
 * Video diff engine for comparing collection videos to iPod videos
 *
 * This module implements comparison logic for video content sync.
 * It determines what video files need to be added, removed, or updated
 * between a video collection source and an iPod device.
 *
 * ## Matching Algorithm
 *
 * Videos are matched using a composite key:
 * - Content type (movie or tvshow)
 * - For movies: title + year (if available)
 * - For TV shows: series title + season + episode number
 *
 * This allows for accurate matching even when file names differ.
 *
 * @module
 */

import type { CollectionVideo } from '../video/directory-adapter.js';
import type { ContentType } from '../video/metadata.js';
import type { VideoTransformsConfig } from '../transforms/types.js';
import {
  getVideoTransformMatchKeys,
  hasEnabledVideoTransforms,
} from '../transforms/video-pipeline.js';
import { buildVideoSyncTag, parseSyncTag, syncTagMatchesConfig } from './sync-tags.js';
import { detectBitratePresetMismatch } from './upgrades.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Representation of a video on the iPod
 *
 * This is the iPod-side video data used for diff comparison.
 * Note: Full implementation depends on libgpod video support (TASK-069.14).
 */
export interface IPodVideo {
  /** Unique identifier on iPod (dbid or similar) */
  id: string;

  /** Path to video file on iPod */
  filePath: string;

  /** Content type: movie or tvshow */
  contentType: ContentType;

  /** Video title */
  title: string;

  /** Release year (for matching) */
  year?: number;

  /** Series title (for TV shows) */
  seriesTitle?: string;

  /** Season number (for TV shows) */
  seasonNumber?: number;

  /** Episode number (for TV shows) */
  episodeNumber?: number;

  /** Duration in seconds */
  duration?: number;

  /** Combined video+audio bitrate in kbps (from iPod database) */
  bitrate?: number;

  /** Comment field from iPod database (may contain sync tags) */
  comment?: string;
}

/**
 * A matched pair of collection video and iPod video
 */
export interface MatchedVideo {
  /** Video from collection source */
  collection: CollectionVideo;
  /** Video on iPod */
  ipod: IPodVideo;
}

/**
 * Reason why a video needs a metadata-only update
 */
export type VideoUpdateReason = 'transform-apply' | 'transform-remove';

/**
 * A video that needs a metadata-only update (no file re-transfer)
 */
export interface VideoUpdateTrack {
  /** Video from collection source */
  collection: CollectionVideo;
  /** Video on iPod */
  ipod: IPodVideo;
  /** Why the update is needed */
  reason: VideoUpdateReason;
  /** The transformed series title to write (or original to revert to) */
  newSeriesTitle?: string;
}

/**
 * Result of comparing video collection to iPod
 */
export interface VideoSyncDiff {
  /** Videos in collection but not on iPod */
  toAdd: CollectionVideo[];
  /** Videos on iPod but not in collection (candidates for removal) */
  toRemove: IPodVideo[];
  /** Videos that exist in both and are in sync */
  existing: MatchedVideo[];
  /** Videos that need re-transcoding due to quality preset change */
  toReplace: MatchedVideo[];
  /** Videos that need metadata-only updates (e.g., transform changes) */
  toUpdate: VideoUpdateTrack[];
}

/**
 * Options for video diff computation
 */
export interface VideoDiffOptions {
  /**
   * Whether to use strict matching (requires exact metadata match)
   * Default: false (uses fuzzy matching for titles)
   */
  strictMatch?: boolean;

  /**
   * Target combined bitrate (kbps) for the active video quality preset.
   * When set, existing videos with bitrates significantly different from
   * this target are moved to `toReplace` for re-transcoding.
   */
  presetBitrate?: number;

  /**
   * Resolved video quality preset name for sync tag comparison.
   * When set, enables sync tag-based preset change detection for video.
   */
  resolvedVideoQuality?: string;

  /**
   * Video transform configuration for show language, etc.
   * When set, enables dual-key matching for transform-aware sync.
   */
  videoTransforms?: VideoTransformsConfig;
}

// =============================================================================
// Match Key Generation
// =============================================================================

/**
 * Normalize a string for comparison (lowercase, trim, remove special chars)
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove special characters
    .replace(/\s+/g, ' '); // Normalize whitespace
}

/**
 * Generate a match key for a movie
 *
 * Format: "movie:title" or "movie:title:year" if year is available
 */
function generateMovieKey(title: string, year?: number): string {
  const normalizedTitle = normalizeString(title);
  if (year && year > 1800 && year < 2100) {
    return `movie:${normalizedTitle}:${year}`;
  }
  return `movie:${normalizedTitle}`;
}

/**
 * Generate a match key for a TV episode
 *
 * Format: "tvshow:series:sXXeYY" where XX is season, YY is episode
 */
function generateTVShowKey(
  seriesTitle: string | undefined,
  title: string,
  seasonNumber?: number,
  episodeNumber?: number
): string {
  // Use series title if available, otherwise use episode title
  const series = seriesTitle ? normalizeString(seriesTitle) : normalizeString(title);

  // If we have season and episode numbers, include them
  if (seasonNumber !== undefined && episodeNumber !== undefined) {
    const season = String(seasonNumber).padStart(2, '0');
    const episode = String(episodeNumber).padStart(2, '0');
    return `tvshow:${series}:s${season}e${episode}`;
  }

  // Fall back to just series title (less reliable matching)
  return `tvshow:${series}:${normalizeString(title)}`;
}

/**
 * Generate a match key for a video (movie or TV show)
 */
export function generateVideoMatchKey(video: {
  contentType: ContentType;
  title: string;
  year?: number;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}): string {
  if (video.contentType === 'movie') {
    return generateMovieKey(video.title, video.year);
  } else {
    return generateTVShowKey(
      video.seriesTitle,
      video.title,
      video.seasonNumber,
      video.episodeNumber
    );
  }
}

// =============================================================================
// Index Building
// =============================================================================

/**
 * Build an index of iPod videos for O(1) lookup during diff
 */
function buildIpodVideoIndex(ipodVideos: IPodVideo[]): Map<string, IPodVideo> {
  const index = new Map<string, IPodVideo>();

  for (const video of ipodVideos) {
    const key = generateVideoMatchKey(video);
    // First occurrence wins (handles duplicates)
    if (!index.has(key)) {
      index.set(key, video);
    }
  }

  return index;
}

// =============================================================================
// Diff Computation
// =============================================================================

/**
 * Compute the diff between collection videos and iPod videos
 *
 * This function determines:
 * - Which collection videos need to be added to the iPod
 * - Which iPod videos should be removed (not in collection)
 * - Which videos exist on both (matched pairs)
 *
 * The algorithm runs in O(n + m) time where n = collection size, m = iPod size.
 *
 * @param collectionVideos - Videos from the collection source
 * @param ipodVideos - Videos currently on the iPod
 * @param options - Diff options
 * @returns The computed diff
 *
 * @example
 * ```typescript
 * const diff = diffVideos(collectionVideos, ipodVideos);
 * console.log(`${diff.toAdd.length} videos to add`);
 * console.log(`${diff.toRemove.length} videos to remove`);
 * console.log(`${diff.existing.length} videos already synced`);
 * ```
 */
export function diffVideos(
  collectionVideos: CollectionVideo[],
  ipodVideos: IPodVideo[],
  _options?: VideoDiffOptions
): VideoSyncDiff {
  // Build index from iPod videos for O(1) lookup
  const ipodIndex = buildIpodVideoIndex(ipodVideos);

  // Track which iPod video IDs have been matched
  const matchedIpodIds = new Set<string>();

  // Output arrays
  const toAdd: CollectionVideo[] = [];
  const existing: MatchedVideo[] = [];
  const toUpdate: VideoUpdateTrack[] = [];

  // Check if video transforms are configured
  const videoTransforms = _options?.videoTransforms;
  const transformsEnabled = videoTransforms && hasEnabledVideoTransforms(videoTransforms);

  // Process each collection video
  for (const collectionVideo of collectionVideos) {
    // Get both original and transformed keys for dual-key matching
    const { originalKey, transformedKey, transformApplied, transformedSeriesTitle } =
      getVideoTransformMatchKeys(collectionVideo, generateVideoMatchKey, videoTransforms);

    // Try to find iPod match - check original key first, then transformed
    let ipodMatch = ipodIndex.get(originalKey);
    let matchedByOriginalKey = !!ipodMatch;

    // If no match by original key and transform was applied, try transformed key
    if (!ipodMatch && transformApplied) {
      ipodMatch = ipodIndex.get(transformedKey);
      matchedByOriginalKey = false;
    }

    if (ipodMatch) {
      // Video exists on iPod - mark as matched
      matchedIpodIds.add(ipodMatch.id);

      // Determine if update is needed for transforms
      if (transformApplied) {
        if (matchedByOriginalKey && transformsEnabled) {
          // iPod has original metadata, transforms are enabled → apply transform
          toUpdate.push({
            collection: collectionVideo,
            ipod: ipodMatch,
            reason: 'transform-apply',
            newSeriesTitle: transformedSeriesTitle,
          });
          continue;
        } else if (!matchedByOriginalKey && !transformsEnabled) {
          // iPod has transformed metadata, transforms are disabled → revert
          toUpdate.push({
            collection: collectionVideo,
            ipod: ipodMatch,
            reason: 'transform-remove',
            newSeriesTitle: collectionVideo.seriesTitle,
          });
          continue;
        }
      }

      existing.push({
        collection: collectionVideo,
        ipod: ipodMatch,
      });
    } else {
      // Video not on iPod - needs to be added
      toAdd.push(collectionVideo);
    }
  }

  // Find iPod videos that weren't matched (candidates for removal)
  const toRemove: IPodVideo[] = [];
  for (const ipodVideo of ipodVideos) {
    if (!matchedIpodIds.has(ipodVideo.id)) {
      toRemove.push(ipodVideo);
    }
  }

  // Post-processing: detect quality preset changes on existing videos.
  // Sync tag priority: if a video has a sync tag, use exact comparison.
  // Otherwise fall back to bitrate comparison.
  const toReplace: MatchedVideo[] = [];
  if (_options?.presetBitrate) {
    const presetBitrate = _options.presetBitrate;
    const resolvedVideoQuality = _options.resolvedVideoQuality;
    const expectedSyncTag = resolvedVideoQuality
      ? buildVideoSyncTag(resolvedVideoQuality)
      : undefined;
    const stillExisting: MatchedVideo[] = [];

    for (const match of existing) {
      // Try sync tag comparison first
      const syncTag = parseSyncTag(match.ipod.comment);
      let mismatch = false;

      if (syncTag && expectedSyncTag) {
        // Sync tag exists — use exact comparison
        mismatch = !syncTagMatchesConfig(syncTag, expectedSyncTag);
      } else {
        // No sync tag — fall back to bitrate comparison
        mismatch = detectBitratePresetMismatch(match.ipod.bitrate, presetBitrate) !== null;
      }

      if (mismatch) {
        toReplace.push(match);
      } else {
        stillExisting.push(match);
      }
    }

    existing.length = 0;
    existing.push(...stillExisting);
  }

  return {
    toAdd,
    toRemove,
    existing,
    toReplace,
    toUpdate,
  };
}

// =============================================================================
// Interface and Factory
// =============================================================================

/**
 * Interface for video diff computation
 */
export interface VideoSyncDiffer {
  /**
   * Compare collection videos to iPod videos
   */
  diff(
    collectionVideos: CollectionVideo[],
    ipodVideos: IPodVideo[],
    options?: VideoDiffOptions
  ): VideoSyncDiff;
}

/**
 * Default implementation of VideoSyncDiffer
 */
export class DefaultVideoSyncDiffer implements VideoSyncDiffer {
  /**
   * Compare collection videos to iPod videos
   */
  diff(
    collectionVideos: CollectionVideo[],
    ipodVideos: IPodVideo[],
    options?: VideoDiffOptions
  ): VideoSyncDiff {
    return diffVideos(collectionVideos, ipodVideos, options);
  }
}

/**
 * Create a new VideoSyncDiffer instance
 */
export function createVideoDiffer(): VideoSyncDiffer {
  return new DefaultVideoSyncDiffer();
}
