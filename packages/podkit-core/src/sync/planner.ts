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
 * ## Audio Decision Tree (ADR-010)
 *
 * | Source | max + ALAC device | max + non-ALAC device | high/medium/low |
 * |--------|-------------------|-----------------------|-----------------|
 * | Lossless (FLAC, WAV, AIFF) | Transcode to ALAC | AAC at high bitrate | AAC at preset bitrate |
 * | Lossless (ALAC) | Copy as-is | AAC at high bitrate | AAC at preset bitrate |
 * | Compatible Lossy (MP3, AAC) | Copy as-is | Copy as-is | Copy as-is |
 * | Incompatible Lossy (OGG, Opus) | AAC capped at source | AAC capped at source | AAC capped at source |
 *
 * @module
 */

import type { CollectionTrack } from '../adapters/interface.js';
import type { AudioFileType } from '../types.js';
import { type QualityPreset, type TranscodeConfig, getPresetBitrate } from '../transcode/types.js';
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
  UpgradeReason,
} from './types.js';
import type { TrackMetadata } from '../types.js';
import { estimateTransferTime } from './estimation.js';
import { calculateVideoOperationSize, calculateVideoOperationTime } from './video-planner.js';
import { isFileReplacementUpgrade } from './upgrades.js';

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
const IPOD_COMPATIBLE_FORMATS: Set<AudioFileType> = new Set(['mp3', 'm4a', 'aac', 'alac']);

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
const INCOMPATIBLE_LOSSY_FORMATS: Set<AudioFileType> = new Set(['ogg', 'opus']);

/**
 * Default transcode configuration
 */
const DEFAULT_CONFIG: TranscodeConfig = { quality: 'high' };

/**
 * Average overhead for M4A container (headers, atoms, etc.)
 * This is added to the calculated audio data size
 */
const M4A_CONTAINER_OVERHEAD_BYTES = 2048;

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
 * and device capabilities.
 *
 * The `max` preset is device-aware:
 * - If the device supports ALAC and the source is lossless → 'lossless' (ALAC)
 * - If the device does NOT support ALAC → 'high' (same as high preset)
 * - For lossy sources, `max` behaves like 'high'
 *
 * @param config - Transcode configuration
 * @param category - Source file category
 * @param deviceSupportsAlac - Whether the target device supports ALAC playback
 * @returns The effective quality preset to use ('lossless' | 'high' | 'medium' | 'low')
 */
function resolveEffectivePreset(
  config: TranscodeConfig,
  category: SourceCategory,
  deviceSupportsAlac: boolean
): Exclude<QualityPreset, 'max'> | 'lossless' {
  if (config.quality === 'max') {
    if (category === 'lossless' && deviceSupportsAlac) {
      return 'lossless';
    }
    // max without ALAC support, or for lossy sources → same as high
    return 'high';
  }

  // high, medium, low pass through as-is
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
export function estimateTranscodedSize(durationMs: number, bitrateKbps: number): number {
  // Convert: duration(ms) * bitrate(kbps) / 8 = bytes
  // duration_ms / 1000 = seconds
  // bitrate_kbps * 1000 / 8 = bytes per second
  const audioBytes = (durationMs / 1000) * ((bitrateKbps * 1000) / 8);
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
      case 'genre':
        metadata.genre = change.to;
        break;
      case 'year':
        metadata.year = change.to ? Number(change.to) : undefined;
        break;
      case 'trackNumber':
        metadata.trackNumber = change.to ? Number(change.to) : undefined;
        break;
      case 'discNumber':
        metadata.discNumber = change.to ? Number(change.to) : undefined;
        break;
      case 'compilation':
        metadata.compilation = change.to === 'true';
        break;
      case 'soundcheck':
        metadata.soundcheck = change.to ? Number(change.to) : undefined;
        break;
      case 'comment':
        metadata.comment = change.to || undefined;
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
 * Resolve the effective bitrate for an incompatible lossy source.
 *
 * Caps the target bitrate at the source's bitrate to avoid creating larger
 * files with no quality benefit (lossy-to-lossy transcoding).
 *
 * @param track - The source track
 * @param config - Transcode configuration
 * @returns The effective bitrate in kbps
 */
function resolveIncompatibleLossyBitrate(track: CollectionTrack, config: TranscodeConfig): number {
  const presetBitrate = config.customBitrate ?? getPresetBitrate(config.quality);
  const sourceBitrate = track.bitrate;

  if (sourceBitrate && sourceBitrate > 0) {
    return Math.min(sourceBitrate, presetBitrate);
  }
  // Unknown source bitrate — use preset as safe default
  return presetBitrate;
}

/**
 * Create a TranscodePresetRef for a resolved preset, with optional bitrate override.
 *
 * @param preset - The resolved preset ('lossless' | 'high' | 'medium' | 'low')
 * @param bitrateOverride - Optional bitrate override (for incompatible lossy capping or custom bitrate)
 */
function makePresetRef(
  preset: Exclude<QualityPreset, 'max'> | 'lossless',
  bitrateOverride?: number
): TranscodePresetRef {
  return {
    name: preset,
    ...(bitrateOverride !== undefined && { bitrateOverride }),
  };
}

/**
 * Plan operations for tracks to be added with source categorization
 *
 * Uses source categorization to determine the appropriate operation for each
 * track and collects lossy-to-lossy warnings.
 */
function planAddOperations(
  tracks: CollectionTrack[],
  config: TranscodeConfig,
  deviceSupportsAlac: boolean
): PlanAddResult {
  const operations: SyncOperation[] = [];
  const lossyToLossyTracks: CollectionTrack[] = [];

  for (const track of tracks) {
    const category = categorizeSource(track);
    const effectivePreset = resolveEffectivePreset(config, category, deviceSupportsAlac);

    // Track lossy-to-lossy conversions for warnings
    if (willWarnLossyToLossy(category)) {
      lossyToLossyTracks.push(track);
    }

    switch (category) {
      case 'lossless':
        if (effectivePreset === 'lossless') {
          // Check if source is already ALAC - can copy directly
          if (track.codec?.toLowerCase() === 'alac') {
            operations.push(createCopyOperation(track));
          } else {
            // Transcode to ALAC
            operations.push(createTranscodeOperation(track, makePresetRef('lossless')));
          }
        } else {
          // Transcode lossless to AAC — apply custom bitrate if set
          const bitrateOverride = config.customBitrate;
          operations.push(
            createTranscodeOperation(track, makePresetRef(effectivePreset, bitrateOverride))
          );
        }
        break;

      case 'compatible-lossy':
        // MP3/AAC: always copy (no benefit to re-encoding)
        operations.push(createCopyOperation(track));
        break;

      case 'incompatible-lossy': {
        // OGG/Opus: must transcode (warning already collected)
        // Cap bitrate at source bitrate to avoid inflating file size
        const effectiveBitrate = resolveIncompatibleLossyBitrate(track, config);
        operations.push(
          createTranscodeOperation(track, makePresetRef(effectivePreset, effectiveBitrate))
        );
        break;
      }
    }
  }

  return { operations, lossyToLossyTracks };
}

/**
 * Plan operations for tracks to be removed
 */
function planRemoveOperations(tracks: IPodTrack[], removeOrphans: boolean): SyncOperation[] {
  if (!removeOrphans) {
    return [];
  }
  return tracks.map((track) => createRemoveOperation(track));
}

/**
 * Result of planning update/upgrade operations
 */
interface PlanUpdateResult {
  operations: SyncOperation[];
  lossyToLossyTracks: CollectionTrack[];
}

/**
 * Plan operations for tracks that need metadata updates or file upgrades
 *
 * Routes update tracks based on their reason:
 * - File-replacement upgrades (format-upgrade, quality-upgrade, artwork-added)
 *   create `upgrade` operations with transcode/copy preset decisions
 * - Metadata-only updates (soundcheck-update, metadata-correction, transform-apply/remove)
 *   create `update-metadata` operations
 *
 * When a track has multiple upgrade reasons (e.g., format-upgrade + soundcheck-update),
 * the highest-priority file-replacement reason is used for the upgrade operation.
 * Metadata updates are handled as part of the upgrade transfer.
 */
function planUpdateOperations(
  tracks: UpdateTrack[],
  config: TranscodeConfig,
  deviceSupportsAlac: boolean
): PlanUpdateResult {
  const operations: SyncOperation[] = [];
  const lossyToLossyTracks: CollectionTrack[] = [];

  for (const updateTrack of tracks) {
    const { reason } = updateTrack;

    // artwork-updated needs source file access (to re-extract artwork bytes) but does NOT
    // replace the audio file. Route it as an upgrade operation so the executor can access
    // the source, but without a preset (no transcode/copy needed).
    // artwork-removed is similar — metadata-only, removes artwork from iPod track.
    if (
      reason === 'artwork-updated' ||
      reason === 'artwork-removed' ||
      reason === 'force-artwork'
    ) {
      operations.push({
        type: 'upgrade',
        source: updateTrack.source,
        target: updateTrack.ipod,
        reason: reason as UpgradeReason,
        // No preset — audio file is not replaced
      });
      continue;
    }

    // Check if this is a file-replacement upgrade
    if (isFileReplacementUpgrade(reason)) {
      const category = categorizeSource(updateTrack.source);
      const effectivePreset = resolveEffectivePreset(config, category, deviceSupportsAlac);

      // Track lossy-to-lossy conversions for warnings
      if (willWarnLossyToLossy(category)) {
        lossyToLossyTracks.push(updateTrack.source);
      }

      // Determine if upgrade needs a transcode preset
      let preset: TranscodePresetRef | undefined;

      switch (category) {
        case 'lossless':
          if (effectivePreset === 'lossless') {
            // ALAC source can be copied directly
            if (updateTrack.source.codec?.toLowerCase() === 'alac') {
              preset = undefined; // copy
            } else {
              preset = makePresetRef('lossless');
            }
          } else {
            const bitrateOverride = config.customBitrate;
            preset = makePresetRef(effectivePreset, bitrateOverride);
          }
          break;
        case 'compatible-lossy':
          preset = undefined; // copy
          break;
        case 'incompatible-lossy': {
          const effectiveBitrate = resolveIncompatibleLossyBitrate(updateTrack.source, config);
          preset = makePresetRef(effectivePreset, effectiveBitrate);
          break;
        }
      }

      operations.push({
        type: 'upgrade',
        source: updateTrack.source,
        target: updateTrack.ipod,
        reason: reason as UpgradeReason,
        ...(preset !== undefined && { preset }),
      });
    } else {
      // Metadata-only update (transforms, soundcheck, metadata-correction)
      operations.push(createUpdateMetadataOperation(updateTrack));
    }
  }

  return { operations, lossyToLossyTracks };
}

/**
 * Calculate estimated size for an operation
 */
export function calculateOperationSize(operation: SyncOperation): number {
  switch (operation.type) {
    case 'transcode': {
      const duration = operation.source.duration ?? 240000; // default 4 min
      const bitrate = operation.preset.bitrateOverride ?? getPresetBitrate(operation.preset.name);
      return estimateTranscodedSize(duration, bitrate);
    }
    case 'copy': {
      return estimateCopySize(operation.source);
    }
    case 'upgrade': {
      // artwork-updated / force-artwork only transfers artwork bytes (~200KB), not the whole track
      if (operation.reason === 'artwork-updated' || operation.reason === 'force-artwork') {
        return 200 * 1024;
      }
      // artwork-removed is metadata-only (no file transfer)
      if (operation.reason === 'artwork-removed') {
        return 0;
      }
      // Upgrades replace a file, so estimate based on preset (transcode) or source (copy)
      if (operation.preset) {
        const duration = operation.source.duration ?? 240000;
        const bitrate = operation.preset.bitrateOverride ?? getPresetBitrate(operation.preset.name);
        return estimateTranscodedSize(duration, bitrate);
      }
      return estimateCopySize(operation.source);
    }
    case 'remove':
    case 'update-metadata':
      // These operations free space rather than consume it
      return 0;
    case 'video-transcode':
    case 'video-copy':
    case 'video-remove':
    case 'video-update-metadata':
      return calculateVideoOperationSize(operation);
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
    case 'upgrade': {
      // artwork-updated / force-artwork is nearly instant (small artwork data, no audio transfer)
      if (operation.reason === 'artwork-updated' || operation.reason === 'force-artwork') {
        return 0.1;
      }
      // artwork-removed is instant (metadata-only)
      if (operation.reason === 'artwork-removed') {
        return 0.01;
      }
      // Upgrade time is similar to transcode/copy — based on transfer size
      const size = calculateOperationSize(operation);
      return estimateTransferTime(size);
    }
    case 'remove':
      // Removal is nearly instant (database update)
      return 0.1;
    case 'update-metadata':
      // Metadata update is instant
      return 0.01;
    case 'video-transcode':
    case 'video-copy':
    case 'video-remove':
    case 'video-update-metadata':
      return calculateVideoOperationTime(operation);
  }
}

/**
 * Order operations for efficient execution
 *
 * Strategy:
 * 1. Remove operations first (free up space before adding)
 * 2. Copy operations next (fast, not CPU intensive)
 * 3. Upgrade operations next (replace existing files — similar cost to copy/transcode)
 * 4. Transcode operations next (CPU intensive, benefits from pipeline parallelism)
 * 5. Update-metadata operations last (in-database only, instant)
 */
function orderOperations(operations: SyncOperation[]): SyncOperation[] {
  const removes: SyncOperation[] = [];
  const copies: SyncOperation[] = [];
  const transcodes: SyncOperation[] = [];
  const upgrades: SyncOperation[] = [];
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
      case 'upgrade':
        upgrades.push(op);
        break;
      case 'update-metadata':
        updates.push(op);
        break;
    }
  }

  // Upgrades run after removes (free space) and before adds (similar transfer work)
  return [...removes, ...copies, ...upgrades, ...transcodes, ...updates];
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
export function createPlan(diff: SyncDiff, options: PlanOptions = {}): SyncPlan {
  const { removeOrphans = false, deviceSupportsAlac = false } = options;

  // Get transcode config (handles both legacy and new formats)
  const config = getTranscodeConfig(options);

  // Plan add operations using source categorization logic
  const addResult = planAddOperations(diff.toAdd, config, deviceSupportsAlac);

  // Plan remove operations (if enabled)
  const removeOperations = planRemoveOperations(diff.toRemove, removeOrphans);

  // Filter out artwork upgrades when artwork is disabled — they would be no-ops
  const artworkEnabled = options.artworkEnabled ?? true;
  const effectiveUpdates = artworkEnabled
    ? diff.toUpdate
    : diff.toUpdate.filter(
        (u) =>
          u.reason !== 'artwork-updated' &&
          u.reason !== 'artwork-removed' &&
          u.reason !== 'force-artwork'
      );

  // Plan update/upgrade operations for metadata changes and file replacements
  const updateResult = planUpdateOperations(effectiveUpdates, config, deviceSupportsAlac);

  // Combine and order operations
  const allOperations = [...addResult.operations, ...removeOperations, ...updateResult.operations];
  const orderedOperations = orderOperations(allOperations);

  // Calculate totals
  let estimatedSize = 0;
  let estimatedTime = 0;

  for (const op of orderedOperations) {
    estimatedSize += calculateOperationSize(op);
    estimatedTime += calculateOperationTime(op);
  }

  // Build warnings — combine lossy-to-lossy tracks from adds and upgrades
  const warnings: SyncWarning[] = [];
  const allLossyToLossyTracks = [
    ...addResult.lossyToLossyTracks,
    ...updateResult.lossyToLossyTracks,
  ];

  if (allLossyToLossyTracks.length > 0) {
    warnings.push({
      type: 'lossy-to-lossy',
      message: `${allLossyToLossyTracks.length} track${allLossyToLossyTracks.length === 1 ? '' : 's'} require lossy-to-lossy conversion (OGG, Opus). This is unavoidable but results in quality loss.`,
      tracks: allLossyToLossyTracks,
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
export function willFitInSpace(plan: SyncPlan, availableSpace: number): boolean {
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
  upgradeCount: number;
} {
  let transcodeCount = 0;
  let copyCount = 0;
  let removeCount = 0;
  let updateCount = 0;
  let upgradeCount = 0;

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
      case 'upgrade':
        upgradeCount++;
        break;
    }
  }

  return { transcodeCount, copyCount, removeCount, updateCount, upgradeCount };
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
