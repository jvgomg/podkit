/**
 * Sync planner for converting diffs into execution plans
 *
 * The planner takes a SyncDiff (from the diff engine) and produces a SyncPlan
 * containing ordered operations. It determines whether each track needs
 * transcoding or can be copied directly, estimates output sizes, and checks
 * available space on the iPod.
 *
 * ## Source File Categories
 *
 * | Category | Formats | Behavior |
 * |----------|---------|----------|
 * | **Lossless** | FLAC, WAV, AIFF, ALAC | Transcode to target preset |
 * | **Compatible Lossy** | MP3, M4A (AAC) | Copy as-is (no re-encoding) |
 * | **Incompatible Lossy** | OGG, Opus | Transcode + lossy→lossy warning |
 *
 * ## Decision Matrix
 *
 * | Source | Target: ALAC | Target: AAC preset |
 * |--------|--------------|-------------------|
 * | Lossless | Convert to ALAC | Transcode to AAC |
 * | Compatible Lossy | Copy as-is | Copy as-is |
 * | Incompatible Lossy | Transcode + warn | Transcode + warn |
 *
 * @module
 */

import type { CollectionTrack } from '../adapters/interface.js';
import type { AudioFileType } from '../types.js';
import {
  type QualityPreset,
  type TranscodeConfig,
  getPresetBitrate,
  resolveFallback,
} from '../transcode/types.js';
import type {
  IPodTrack,
  MetadataChange,
  PlanOptions,
  SourceCategory,
  SyncDiff,
  SyncOperation,
  SyncPlan,
  SyncPlanner,
  SyncWarning,
  TranscodePresetRef,
  UpdateTrack,
} from './types.js';
import type { TrackMetadata } from '../types.js';

// =============================================================================
// Constants
// =============================================================================

/**
 * Audio formats that are natively compatible with iPod (no transcoding needed)
 *
 * - mp3: MPEG Audio Layer 3 - universally supported
 * - m4a: AAC in MP4 container - native iTunes format
 * - aac: Raw AAC - supported but less common
 * - alac: Apple Lossless - supported on newer iPods
 */
const IPOD_COMPATIBLE_FORMATS: Set<AudioFileType> = new Set([
  'mp3',
  'm4a',
  'aac',
  'alac',
]);

/**
 * Formats that require transcoding to iPod-compatible format
 *
 * - flac: Free Lossless Audio Codec - needs transcoding
 * - ogg: Ogg Vorbis - needs transcoding
 * - opus: Opus codec - needs transcoding
 * - wav: Uncompressed PCM - needs transcoding (and would waste space)
 * - aiff: Audio Interchange File Format - needs transcoding
 */
const TRANSCODE_REQUIRED_FORMATS: Set<AudioFileType> = new Set([
  'flac',
  'ogg',
  'opus',
  'wav',
  'aiff',
]);

/**
 * Lossy formats that are NOT iPod-compatible (require lossy→lossy conversion)
 */
const INCOMPATIBLE_LOSSY_FORMATS: Set<AudioFileType> = new Set([
  'ogg',
  'opus',
]);

/**
 * Default transcode configuration
 */
const DEFAULT_CONFIG: TranscodeConfig = { quality: 'high' };

/**
 * Average overhead for M4A container (headers, atoms, etc.)
 * This is added to the calculated audio data size
 */
const M4A_CONTAINER_OVERHEAD_BYTES = 2048;

/**
 * Estimated USB transfer speed in bytes per second.
 *
 * With pipeline execution, transcoding happens in parallel with USB transfer,
 * so USB transfer is the bottleneck. Based on observed real-world throughput
 * of ~2.7 MB/s during E2E testing with USB 2.0 iPod.
 *
 * Using 2.5 MB/s as a conservative estimate.
 */
const USB_TRANSFER_SPEED_BYTES_PER_SEC = 2.5 * 1024 * 1024; // 2.5 MB/s observed

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if an audio format is iPod-compatible (can be copied directly)
 */
export function isIPodCompatible(fileType: AudioFileType): boolean {
  return IPOD_COMPATIBLE_FORMATS.has(fileType);
}

/**
 * Check if an audio format requires transcoding
 */
export function requiresTranscoding(fileType: AudioFileType): boolean {
  return TRANSCODE_REQUIRED_FORMATS.has(fileType);
}

// =============================================================================
// Source Categorization
// =============================================================================

/**
 * Categorize a track's source format for transcoding decisions
 *
 * Categories:
 * - lossless: FLAC, WAV, AIFF, ALAC - can convert to any target
 * - compatible-lossy: MP3, AAC/M4A - already iPod-playable, copy as-is
 * - incompatible-lossy: OGG, Opus - must transcode (lossy→lossy warning)
 *
 * Note: M4A files can be either AAC (lossy) or ALAC (lossless).
 * Uses the codec field for accurate detection.
 */
export function categorizeSource(track: CollectionTrack): SourceCategory {
  // Check if explicitly marked as lossless
  if (track.lossless === true) {
    return 'lossless';
  }

  // Unambiguously lossless by file extension
  if (['flac', 'wav', 'aiff'].includes(track.fileType)) {
    return 'lossless';
  }

  // Incompatible lossy (requires transcoding)
  if (INCOMPATIBLE_LOSSY_FORMATS.has(track.fileType)) {
    return 'incompatible-lossy';
  }

  // MP3 is always compatible lossy
  if (track.fileType === 'mp3') {
    return 'compatible-lossy';
  }

  // M4A/AAC requires codec detection (could be AAC or ALAC)
  if (track.fileType === 'm4a' || track.fileType === 'aac') {
    // Check codec if available
    if (track.codec?.toLowerCase() === 'alac') {
      return 'lossless';
    }
    // Assume AAC (lossy) if no codec info or codec is aac
    return 'compatible-lossy';
  }

  // ALAC extension is unambiguously lossless
  if (track.fileType === 'alac') {
    return 'lossless';
  }

  // Unknown formats: treat as incompatible (safe default, triggers warning)
  return 'incompatible-lossy';
}

/**
 * Check if a source category is lossless
 */
export function isLosslessSource(category: SourceCategory): boolean {
  return category === 'lossless';
}

/**
 * Check if a source will produce a lossy-to-lossy warning
 */
export function willWarnLossyToLossy(category: SourceCategory): boolean {
  return category === 'incompatible-lossy';
}

/**
 * Resolve the effective quality preset for a track based on its source category
 *
 * @param config - Transcode configuration
 * @param category - Source file category
 * @returns The effective quality preset to use
 */
function resolveEffectivePreset(
  config: TranscodeConfig,
  category: SourceCategory
): QualityPreset {
  // ALAC only valid for lossless sources
  if (config.quality === 'alac') {
    if (category === 'lossless') {
      return 'alac';
    }
    // Fallback for lossy sources
    return resolveFallback(config);
  }

  // Non-ALAC presets use quality directly
  return config.quality;
}

/**
 * Convert PlanOptions to TranscodeConfig
 */
function getTranscodeConfig(options: PlanOptions): TranscodeConfig {
  return options.transcodeConfig ?? DEFAULT_CONFIG;
}

/**
 * Estimate output file size for a transcoded track
 *
 * Formula: (duration_ms / 1000) * (bitrate_kbps / 8) * 1000 + overhead
 *        = (duration_ms * bitrate_kbps) / 8 + overhead
 *
 * @param durationMs - Track duration in milliseconds
 * @param bitrateKbps - Target bitrate in kilobits per second
 * @returns Estimated file size in bytes
 */
export function estimateTranscodedSize(
  durationMs: number,
  bitrateKbps: number
): number {
  // Convert: duration(ms) * bitrate(kbps) / 8 = bytes
  // duration_ms / 1000 = seconds
  // bitrate_kbps * 1000 / 8 = bytes per second
  const audioBytes = (durationMs / 1000) * (bitrateKbps * 1000 / 8);
  return Math.ceil(audioBytes + M4A_CONTAINER_OVERHEAD_BYTES);
}

/**
 * Estimate size for a track that will be copied directly
 *
 * For compatible formats, we need to estimate based on existing bitrate
 * if available, or use duration with assumed bitrate.
 *
 * @param track - The collection track to estimate
 * @returns Estimated file size in bytes
 */
export function estimateCopySize(track: CollectionTrack): number {
  // If duration is available, estimate based on typical bitrate for format
  if (track.duration && track.duration > 0) {
    // Assume typical bitrates for different formats
    let typicalBitrateKbps: number;
    switch (track.fileType) {
      case 'mp3':
        typicalBitrateKbps = 256;
        break;
      case 'm4a':
      case 'aac':
        typicalBitrateKbps = 256;
        break;
      case 'alac':
        // ALAC is lossless, typically ~800-1000 kbps for CD quality
        typicalBitrateKbps = 900;
        break;
      default:
        typicalBitrateKbps = 256;
    }
    return estimateTranscodedSize(track.duration, typicalBitrateKbps);
  }

  // Fallback: assume 4 minutes at 256 kbps
  return estimateTranscodedSize(240000, 256);
}

/**
 * Estimate time to transfer a file to iPod.
 *
 * With pipeline execution, transcoding happens in parallel with USB transfer,
 * so all time estimates are based on USB transfer speed (the bottleneck).
 *
 * @param sizeBytes - File size in bytes
 * @returns Estimated transfer time in seconds
 */
function estimateTransferTime(sizeBytes: number): number {
  return sizeBytes / USB_TRANSFER_SPEED_BYTES_PER_SEC;
}

// =============================================================================
// Planning Functions
// =============================================================================

/**
 * Create a transcode operation for a track
 */
function createTranscodeOperation(
  track: CollectionTrack,
  preset: TranscodePresetRef
): SyncOperation {
  return {
    type: 'transcode',
    source: track,
    preset,
  };
}

/**
 * Create a copy operation for a track
 */
function createCopyOperation(track: CollectionTrack): SyncOperation {
  return {
    type: 'copy',
    source: track,
  };
}

/**
 * Create a remove operation for an iPod track
 */
function createRemoveOperation(track: IPodTrack): SyncOperation {
  return {
    type: 'remove',
    track,
  };
}

/**
 * Convert MetadataChange array to Partial<TrackMetadata>
 *
 * Extracts the 'to' values from each change to create the target metadata.
 */
function changesToMetadata(changes: MetadataChange[]): Partial<TrackMetadata> {
  const metadata: Partial<TrackMetadata> = {};

  for (const change of changes) {
    switch (change.field) {
      case 'artist':
        metadata.artist = change.to;
        break;
      case 'title':
        metadata.title = change.to;
        break;
      case 'album':
        metadata.album = change.to;
        break;
      case 'albumArtist':
        metadata.albumArtist = change.to;
        break;
    }
  }

  return metadata;
}

/**
 * Create an update-metadata operation for an iPod track
 */
function createUpdateMetadataOperation(updateTrack: UpdateTrack): SyncOperation {
  return {
    type: 'update-metadata',
    track: updateTrack.ipod,
    metadata: changesToMetadata(updateTrack.changes),
  };
}

/**
 * Result of planning add operations, including warnings
 */
interface PlanAddResult {
  operations: SyncOperation[];
  lossyToLossyTracks: CollectionTrack[];
}

/**
 * Plan operations for tracks to be added with source categorization
 *
 * This version uses source categorization to determine the appropriate
 * operation for each track and collects lossy-to-lossy warnings.
 */
function planAddOperationsV2(
  tracks: CollectionTrack[],
  config: TranscodeConfig
): PlanAddResult {
  const operations: SyncOperation[] = [];
  const lossyToLossyTracks: CollectionTrack[] = [];

  for (const track of tracks) {
    const category = categorizeSource(track);
    const effectivePreset = resolveEffectivePreset(config, category);

    // Track lossy-to-lossy conversions for warnings
    if (willWarnLossyToLossy(category)) {
      lossyToLossyTracks.push(track);
    }

    switch (category) {
      case 'lossless':
        if (effectivePreset === 'alac') {
          // Check if source is already ALAC - can copy directly
          if (track.codec?.toLowerCase() === 'alac') {
            operations.push(createCopyOperation(track));
          } else {
            // Transcode to ALAC
            operations.push(createTranscodeOperation(track, { name: effectivePreset }));
          }
        } else {
          // Transcode lossless to AAC
          operations.push(createTranscodeOperation(track, { name: effectivePreset }));
        }
        break;

      case 'compatible-lossy':
        // MP3/AAC: always copy (no benefit to re-encoding)
        operations.push(createCopyOperation(track));
        break;

      case 'incompatible-lossy':
        // OGG/Opus: must transcode (warning already collected)
        operations.push(createTranscodeOperation(track, { name: effectivePreset }));
        break;
    }
  }

  return { operations, lossyToLossyTracks };
}

/**
 * Plan operations for tracks to be removed
 */
function planRemoveOperations(
  tracks: IPodTrack[],
  removeOrphans: boolean
): SyncOperation[] {
  if (!removeOrphans) {
    return [];
  }
  return tracks.map((track) => createRemoveOperation(track));
}

/**
 * Plan operations for tracks that need metadata updates
 *
 * These are tracks that already exist on the iPod but need metadata changes,
 * typically due to transform configuration changes (enable/disable ftintitle).
 */
function planUpdateOperations(tracks: UpdateTrack[]): SyncOperation[] {
  return tracks.map((track) => createUpdateMetadataOperation(track));
}

/**
 * Calculate estimated size for an operation
 */
export function calculateOperationSize(
  operation: SyncOperation
): number {
  switch (operation.type) {
    case 'transcode': {
      const duration = operation.source.duration ?? 240000; // default 4 min
      // Use getPresetBitrate for new presets, fall back to legacy behavior
      const bitrate = getPresetBitrate(operation.preset.name);
      return estimateTranscodedSize(duration, bitrate);
    }
    case 'copy': {
      return estimateCopySize(operation.source);
    }
    case 'remove':
    case 'update-metadata':
      // These operations free space rather than consume it
      return 0;
    case 'video-transcode': {
      // Estimate video size based on duration and bitrate
      const duration = operation.source.duration ?? 3600; // default 1 hour in seconds
      const videoBitrate = operation.settings.targetVideoBitrate ?? 1500; // kbps
      const audioBitrate = operation.settings.targetAudioBitrate ?? 128; // kbps
      const totalBitrate = videoBitrate + audioBitrate; // kbps
      return Math.round((duration * totalBitrate * 1000) / 8); // bytes
    }
    case 'video-copy': {
      // For passthrough, estimate based on source duration and typical bitrate
      const duration = operation.source.duration ?? 3600;
      return Math.round((duration * 2000 * 1000) / 8); // ~2 Mbps estimate
    }
  }
}

/**
 * Calculate estimated time for an operation.
 *
 * With pipeline execution, all file transfer operations are bottlenecked
 * by USB transfer speed. Transcoding happens in parallel and is hidden.
 */
function calculateOperationTime(operation: SyncOperation): number {
  switch (operation.type) {
    case 'transcode': {
      // Time is based on transfer size, not transcode time (pipeline hides transcode)
      const size = calculateOperationSize(operation);
      return estimateTransferTime(size);
    }
    case 'copy': {
      const size = calculateOperationSize(operation);
      return estimateTransferTime(size);
    }
    case 'remove':
      // Removal is nearly instant (database update)
      return 0.1;
    case 'update-metadata':
      // Metadata update is instant
      return 0.01;
    case 'video-transcode': {
      // Video transcoding is slow - estimate based on duration
      const duration = operation.source.duration ?? 3600;
      // Assume ~0.5x realtime for video transcoding + transfer
      return duration * 2;
    }
    case 'video-copy': {
      // Video copy is transfer-limited
      const size = calculateOperationSize(operation);
      return estimateTransferTime(size);
    }
  }
}

/**
 * Order operations for efficient execution
 *
 * Strategy:
 * 1. Remove operations first (free up space)
 * 2. Copy operations next (faster, no CPU intensive)
 * 3. Transcode operations last (CPU intensive, can parallelize)
 */
function orderOperations(operations: SyncOperation[]): SyncOperation[] {
  const removes: SyncOperation[] = [];
  const copies: SyncOperation[] = [];
  const transcodes: SyncOperation[] = [];
  const updates: SyncOperation[] = [];

  for (const op of operations) {
    switch (op.type) {
      case 'remove':
        removes.push(op);
        break;
      case 'copy':
        copies.push(op);
        break;
      case 'transcode':
        transcodes.push(op);
        break;
      case 'update-metadata':
        updates.push(op);
        break;
    }
  }

  return [...removes, ...copies, ...transcodes, ...updates];
}

// =============================================================================
// Main Planning Logic
// =============================================================================

/**
 * Create a sync plan from a diff
 *
 * This function analyzes the diff and produces an ordered list of operations
 * to execute, along with estimated time and size requirements.
 *
 * @param diff - The diff from the diff engine
 * @param options - Planning options
 * @returns The sync plan with operations, estimated time, size, and warnings
 *
 * @example
 * const diff = computeDiff(collectionTracks, ipodTracks);
 * const plan = createPlan(diff, { removeOrphans: true });
 * console.log(`${plan.operations.length} operations to execute`);
 * console.log(`Estimated size: ${plan.estimatedSize} bytes`);
 * if (plan.warnings.length > 0) {
 *   console.log(`Warnings: ${plan.warnings.length}`);
 * }
 */
export function createPlan(
  diff: SyncDiff,
  options: PlanOptions = {}
): SyncPlan {
  const {
    removeOrphans = false,
  } = options;

  // Get transcode config (handles both legacy and new formats)
  const config = getTranscodeConfig(options);

  // Plan add operations using new categorization logic
  const addResult = planAddOperationsV2(diff.toAdd, config);

  // Plan remove operations (if enabled)
  const removeOperations = planRemoveOperations(diff.toRemove, removeOrphans);

  // Plan update operations for metadata changes (e.g., transforms)
  const updateOperations = planUpdateOperations(diff.toUpdate);

  // Combine and order operations
  const allOperations = [...addResult.operations, ...removeOperations, ...updateOperations];
  const orderedOperations = orderOperations(allOperations);

  // Calculate totals
  let estimatedSize = 0;
  let estimatedTime = 0;

  for (const op of orderedOperations) {
    estimatedSize += calculateOperationSize(op);
    estimatedTime += calculateOperationTime(op);
  }

  // Build warnings
  const warnings: SyncWarning[] = [];

  if (addResult.lossyToLossyTracks.length > 0) {
    warnings.push({
      type: 'lossy-to-lossy',
      message: `${addResult.lossyToLossyTracks.length} track${addResult.lossyToLossyTracks.length === 1 ? '' : 's'} require lossy-to-lossy conversion (OGG, Opus). This is unavoidable but results in quality loss.`,
      tracks: addResult.lossyToLossyTracks,
    });
  }

  return {
    operations: orderedOperations,
    estimatedTime,
    estimatedSize,
    warnings,
  };
}

/**
 * Check if a plan will fit within available space
 *
 * @param plan - The sync plan to check
 * @param availableSpace - Available space in bytes
 * @returns true if plan fits, false otherwise
 */
export function willFitInSpace(
  plan: SyncPlan,
  availableSpace: number
): boolean {
  return plan.estimatedSize <= availableSpace;
}

/**
 * Get a summary of operations in a plan
 */
export function getPlanSummary(plan: SyncPlan): {
  transcodeCount: number;
  copyCount: number;
  removeCount: number;
  updateCount: number;
} {
  let transcodeCount = 0;
  let copyCount = 0;
  let removeCount = 0;
  let updateCount = 0;

  for (const op of plan.operations) {
    switch (op.type) {
      case 'transcode':
        transcodeCount++;
        break;
      case 'copy':
        copyCount++;
        break;
      case 'remove':
        removeCount++;
        break;
      case 'update-metadata':
        updateCount++;
        break;
    }
  }

  return { transcodeCount, copyCount, removeCount, updateCount };
}

// =============================================================================
// SyncPlanner Implementation
// =============================================================================

/**
 * Default implementation of SyncPlanner interface
 */
export class DefaultSyncPlanner implements SyncPlanner {
  /**
   * Create an execution plan from a diff
   */
  plan(diff: SyncDiff, options?: PlanOptions): SyncPlan {
    return createPlan(diff, options);
  }
}

/**
 * Create a new SyncPlanner instance
 */
export function createPlanner(): SyncPlanner {
  return new DefaultSyncPlanner();
}
