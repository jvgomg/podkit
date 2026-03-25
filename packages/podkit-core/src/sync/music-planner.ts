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
 * When `DeviceCapabilities.supportedAudioCodecs` is provided, the planner first
 * checks whether the source codec is natively supported by the device. If yes,
 * the file is copied as-is regardless of category. Otherwise:
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
import type { AudioCodec } from '../device/capabilities.js';
import {
  type QualityPreset,
  type TranscodeConfig,
  type TransferMode,
  getPresetBitrate,
} from '../transcode/types.js';
import type {
  IPodTrack,
  MetadataChange,
  PlanOptions,
  SourceCategory,
  SyncDiff,
  SyncOperation,
  SyncPlan,
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

/**
 * Map a track's file type and codec to the AudioCodec used in device capabilities.
 *
 * - m4a/aac files: use the codec field to distinguish AAC vs ALAC
 * - Other file types map directly to AudioCodec names
 *
 * Returns undefined if the file type cannot be mapped (unknown format).
 */
export function fileTypeToAudioCodec(
  fileType: AudioFileType,
  codec?: string
): AudioCodec | undefined {
  switch (fileType) {
    case 'mp3':
      return 'mp3';
    case 'flac':
      return 'flac';
    case 'ogg':
      return 'ogg';
    case 'opus':
      return 'opus';
    case 'wav':
      return 'wav';
    case 'aiff':
      return 'aiff';
    case 'alac':
      return 'alac';
    case 'm4a':
    case 'aac':
      // M4A can be AAC or ALAC — check codec field
      if (codec?.toLowerCase() === 'alac') return 'alac';
      return 'aac';
    default:
      return undefined;
  }
}

/**
 * Check if a track's format is natively supported by the device.
 *
 * When the device provides a supportedAudioCodecs list, this checks whether
 * the track's codec is in that list. This is used to skip transcoding for
 * devices that support formats like FLAC, OGG, etc. natively.
 *
 * @returns true if the device can play this track without transcoding
 */
export function isDeviceCompatible(
  track: CollectionTrack,
  supportedCodecs: AudioCodec[] | undefined
): boolean {
  if (!supportedCodecs || supportedCodecs.length === 0) {
    return false;
  }
  const codec = fileTypeToAudioCodec(track.fileType, track.codec);
  return codec !== undefined && supportedCodecs.includes(codec);
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
      case 'flac':
        // FLAC is lossless, typically ~900 kbps for CD quality
        typicalBitrateKbps = 900;
        break;
      case 'ogg':
      case 'opus':
        typicalBitrateKbps = 192;
        break;
      case 'wav':
      case 'aiff':
        // Uncompressed audio, ~1411 kbps for CD quality (16-bit/44.1kHz stereo)
        typicalBitrateKbps = 1411;
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
 * Create an add-transcode operation for a track
 */
function createTranscodeOperation(
  track: CollectionTrack,
  preset: TranscodePresetRef
): SyncOperation {
  return {
    type: 'add-transcode',
    source: track,
    preset,
  };
}

/**
 * Create a direct copy operation for a track (fast/portable mode)
 */
function createDirectCopyOperation(track: CollectionTrack): SyncOperation {
  return {
    type: 'add-direct-copy',
    source: track,
  };
}

/**
 * Create an optimized copy operation for a track (optimized mode)
 */
function createOptimizedCopyOperation(track: CollectionTrack): SyncOperation {
  return {
    type: 'add-optimized-copy',
    source: track,
  };
}

/**
 * Create a copy operation for a track, routing by transfer mode
 */
function createCopyOperation(track: CollectionTrack, transferMode: TransferMode): SyncOperation {
  return transferMode === 'optimized'
    ? createOptimizedCopyOperation(track)
    : createDirectCopyOperation(track);
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
export function changesToMetadata(changes: MetadataChange[]): Partial<TrackMetadata> {
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
  deviceSupportsAlac: boolean,
  transferMode: TransferMode,
  primaryArtworkSource?: 'database' | 'embedded' | 'sidecar',
  supportedAudioCodecs?: AudioCodec[]
): PlanAddResult {
  const operations: SyncOperation[] = [];
  const lossyToLossyTracks: CollectionTrack[] = [];

  for (const track of tracks) {
    // Device-level codec check: if the device natively supports this format,
    // copy directly regardless of source category (lossless, lossy, etc.)
    if (isDeviceCompatible(track, supportedAudioCodecs)) {
      if (primaryArtworkSource === 'embedded') {
        operations.push(createOptimizedCopyOperation(track));
      } else {
        operations.push(createCopyOperation(track, transferMode));
      }
      continue;
    }

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
            operations.push(createCopyOperation(track, transferMode));
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
        // Embedded-artwork devices need FFmpeg to resize artwork in all modes
        if (primaryArtworkSource === 'embedded') {
          operations.push(createOptimizedCopyOperation(track));
        } else {
          // MP3/AAC: copy (no benefit to re-encoding)
          operations.push(createCopyOperation(track, transferMode));
        }
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
  deviceSupportsAlac: boolean,
  transferMode: TransferMode,
  primaryArtworkSource?: 'database' | 'embedded' | 'sidecar',
  supportedAudioCodecs?: AudioCodec[]
): PlanUpdateResult {
  const operations: SyncOperation[] = [];
  const lossyToLossyTracks: CollectionTrack[] = [];

  for (const updateTrack of tracks) {
    const { reason } = updateTrack;

    // artwork-updated needs source file access (to re-extract artwork bytes) but does NOT
    // replace the audio file. Route as upgrade-artwork so the executor can access
    // the source without replacing the audio.
    // artwork-removed is similar — metadata-only, removes artwork from iPod track.
    if (reason === 'artwork-updated' || reason === 'artwork-removed') {
      operations.push({
        type: 'upgrade-artwork',
        source: updateTrack.source,
        target: updateTrack.ipod,
        reason: reason as UpgradeReason,
      });
      continue;
    }

    // Check if this is a file-replacement upgrade
    if (isFileReplacementUpgrade(reason)) {
      // Device-level codec check: if the device natively supports this format,
      // always use a copy upgrade regardless of source category
      const deviceNative = isDeviceCompatible(updateTrack.source, supportedAudioCodecs);

      const category = categorizeSource(updateTrack.source);
      const effectivePreset = resolveEffectivePreset(config, category, deviceSupportsAlac);

      // Track lossy-to-lossy conversions for warnings (only when actually transcoding)
      if (!deviceNative && willWarnLossyToLossy(category)) {
        lossyToLossyTracks.push(updateTrack.source);
      }

      // Determine the granular upgrade operation type
      let upgradePreset: TranscodePresetRef | undefined;
      let needsTranscode = false;

      if (deviceNative) {
        // Device supports this codec natively — copy, no transcode
        needsTranscode = false;
      } else {
        switch (category) {
          case 'lossless':
            if (effectivePreset === 'lossless') {
              // ALAC source can be copied directly
              if (updateTrack.source.codec?.toLowerCase() === 'alac') {
                needsTranscode = false;
              } else {
                needsTranscode = true;
                upgradePreset = makePresetRef('lossless');
              }
            } else {
              needsTranscode = true;
              const bitrateOverride = config.customBitrate;
              upgradePreset = makePresetRef(effectivePreset, bitrateOverride);
            }
            break;
          case 'compatible-lossy':
            needsTranscode = false;
            break;
          case 'incompatible-lossy': {
            needsTranscode = true;
            const effectiveBitrate = resolveIncompatibleLossyBitrate(updateTrack.source, config);
            upgradePreset = makePresetRef(effectivePreset, effectiveBitrate);
            break;
          }
        }
      }

      if (needsTranscode && upgradePreset) {
        operations.push({
          type: 'upgrade-transcode',
          source: updateTrack.source,
          target: updateTrack.ipod,
          reason: reason as UpgradeReason,
          preset: upgradePreset,
        });
      } else {
        // Copy upgrade — embedded-artwork devices always use optimized copy,
        // database-artwork devices route by transfer mode
        const upgradeType =
          primaryArtworkSource === 'embedded'
            ? 'upgrade-optimized-copy'
            : transferMode === 'optimized'
              ? 'upgrade-optimized-copy'
              : 'upgrade-direct-copy';
        operations.push({
          type: upgradeType,
          source: updateTrack.source,
          target: updateTrack.ipod,
          reason: reason as UpgradeReason,
        });
      }
    } else if (reason === 'sync-tag-write' && updateTrack.syncTag) {
      // Sync tag write — direct operation, no metadata conversion needed
      operations.push({
        type: 'update-sync-tag',
        track: updateTrack.ipod,
        syncTag: updateTrack.syncTag,
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
export function calculateMusicOperationSize(operation: SyncOperation): number {
  switch (operation.type) {
    case 'add-transcode': {
      const duration = operation.source.duration ?? 240000; // default 4 min
      const bitrate = operation.preset.bitrateOverride ?? getPresetBitrate(operation.preset.name);
      return estimateTranscodedSize(duration, bitrate);
    }
    case 'add-direct-copy':
    case 'add-optimized-copy': {
      return estimateCopySize(operation.source);
    }
    case 'upgrade-transcode': {
      const duration = operation.source.duration ?? 240000;
      const bitrate = operation.preset.bitrateOverride ?? getPresetBitrate(operation.preset.name);
      return estimateTranscodedSize(duration, bitrate);
    }
    case 'upgrade-direct-copy':
    case 'upgrade-optimized-copy': {
      return estimateCopySize(operation.source);
    }
    case 'upgrade-artwork': {
      // artwork-updated only transfers artwork bytes (~200KB), not the whole track
      if (operation.reason === 'artwork-updated') {
        return 200 * 1024;
      }
      // artwork-removed is metadata-only (no file transfer)
      return 0;
    }
    case 'remove':
    case 'update-metadata':
    case 'update-sync-tag':
      // These operations free space rather than consume it
      return 0;
    case 'video-transcode':
    case 'video-copy':
    case 'video-remove':
    case 'video-update-metadata':
    case 'video-upgrade':
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
    case 'add-transcode':
    case 'add-direct-copy':
    case 'add-optimized-copy':
    case 'upgrade-transcode':
    case 'upgrade-direct-copy':
    case 'upgrade-optimized-copy': {
      const size = calculateMusicOperationSize(operation);
      return estimateTransferTime(size);
    }
    case 'upgrade-artwork': {
      // artwork-updated is nearly instant (small artwork data, no audio transfer)
      if (operation.reason === 'artwork-updated') {
        return 0.1;
      }
      // artwork-removed is instant (metadata-only)
      return 0.01;
    }
    case 'remove':
      // Removal is nearly instant (database update)
      return 0.1;
    case 'update-metadata':
    case 'update-sync-tag':
      // Metadata update is instant
      return 0.01;
    case 'video-transcode':
    case 'video-copy':
    case 'video-remove':
    case 'video-update-metadata':
    case 'video-upgrade':
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
  const directCopies: SyncOperation[] = [];
  const optimizedCopies: SyncOperation[] = [];
  const transcodes: SyncOperation[] = [];
  const upgrades: SyncOperation[] = [];
  const updates: SyncOperation[] = [];

  for (const op of operations) {
    switch (op.type) {
      case 'remove':
        removes.push(op);
        break;
      case 'add-direct-copy':
        directCopies.push(op);
        break;
      case 'add-optimized-copy':
        optimizedCopies.push(op);
        break;
      case 'add-transcode':
        transcodes.push(op);
        break;
      case 'upgrade-direct-copy':
      case 'upgrade-optimized-copy':
      case 'upgrade-transcode':
      case 'upgrade-artwork':
        upgrades.push(op);
        break;
      case 'update-metadata':
      case 'update-sync-tag':
        updates.push(op);
        break;
    }
  }

  // Upgrades run after removes (free space) and before adds (similar transfer work)
  return [...removes, ...directCopies, ...optimizedCopies, ...upgrades, ...transcodes, ...updates];
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
export function createMusicPlan(diff: SyncDiff, options: PlanOptions = {}): SyncPlan {
  const { removeOrphans = false } = options;
  const deviceSupportsAlac =
    options.capabilities?.supportedAudioCodecs.includes('alac') ??
    options.deviceSupportsAlac ??
    false;
  const transferMode: TransferMode = options.transferMode ?? 'fast';
  const primaryArtworkSource = options.capabilities?.artworkSources[0];
  const supportedAudioCodecs = options.capabilities?.supportedAudioCodecs;

  // Get transcode config (handles both legacy and new formats)
  const config = getTranscodeConfig(options);

  // Plan add operations using source categorization logic
  const addResult = planAddOperations(
    diff.toAdd,
    config,
    deviceSupportsAlac,
    transferMode,
    primaryArtworkSource,
    supportedAudioCodecs
  );

  // Plan remove operations (if enabled)
  const removeOperations = planRemoveOperations(diff.toRemove, removeOrphans);

  // Filter out artwork upgrades when artwork is disabled — they would be no-ops
  const artworkEnabled = options.artworkEnabled ?? true;
  const effectiveUpdates = artworkEnabled
    ? diff.toUpdate
    : diff.toUpdate.filter((u) => u.reason !== 'artwork-updated' && u.reason !== 'artwork-removed');

  // Plan update/upgrade operations for metadata changes and file replacements
  const updateResult = planUpdateOperations(
    effectiveUpdates,
    config,
    deviceSupportsAlac,
    transferMode,
    primaryArtworkSource,
    supportedAudioCodecs
  );

  // Combine and order operations
  const allOperations = [...addResult.operations, ...removeOperations, ...updateResult.operations];
  const orderedOperations = orderOperations(allOperations);

  // Calculate totals
  let estimatedSize = 0;
  let estimatedTime = 0;

  for (const op of orderedOperations) {
    estimatedSize += calculateMusicOperationSize(op);
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

  // Warn when portable mode is used with an embedded-artwork device
  if (
    primaryArtworkSource === 'embedded' &&
    transferMode === 'portable' &&
    options.capabilities?.artworkMaxResolution &&
    orderedOperations.length > 0
  ) {
    warnings.push({
      type: 'embedded-artwork-resize',
      message: `Artwork resized to device maximum (${options.capabilities.artworkMaxResolution}px) — this device reads artwork from embedded file data and cannot use full-resolution images. Portable mode preserves audio quality but artwork is optimized for the device.`,
      tracks: [],
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
export function willMusicFitInSpace(plan: SyncPlan, availableSpace: number): boolean {
  return plan.estimatedSize <= availableSpace;
}

/**
 * Get a summary of operations in a plan
 */
export function getMusicPlanSummary(plan: SyncPlan): {
  removeCount: number;
  updateCount: number;
  addTranscodeCount: number;
  addDirectCopyCount: number;
  addOptimizedCopyCount: number;
  upgradeTranscodeCount: number;
  upgradeDirectCopyCount: number;
  upgradeOptimizedCopyCount: number;
  upgradeArtworkCount: number;
  videoTranscodeCount: number;
  videoCopyCount: number;
  videoRemoveCount: number;
  videoUpdateCount: number;
  videoUpgradeCount: number;
} {
  let addTranscodeCount = 0;
  let addDirectCopyCount = 0;
  let addOptimizedCopyCount = 0;
  let upgradeTranscodeCount = 0;
  let upgradeDirectCopyCount = 0;
  let upgradeOptimizedCopyCount = 0;
  let upgradeArtworkCount = 0;
  let removeCount = 0;
  let updateCount = 0;
  let videoTranscodeCount = 0;
  let videoCopyCount = 0;
  let videoRemoveCount = 0;
  let videoUpdateCount = 0;
  let videoUpgradeCount = 0;

  for (const op of plan.operations) {
    switch (op.type) {
      case 'add-transcode':
        addTranscodeCount++;
        break;
      case 'add-direct-copy':
        addDirectCopyCount++;
        break;
      case 'add-optimized-copy':
        addOptimizedCopyCount++;
        break;
      case 'upgrade-transcode':
        upgradeTranscodeCount++;
        break;
      case 'upgrade-direct-copy':
        upgradeDirectCopyCount++;
        break;
      case 'upgrade-optimized-copy':
        upgradeOptimizedCopyCount++;
        break;
      case 'upgrade-artwork':
        upgradeArtworkCount++;
        break;
      case 'remove':
        removeCount++;
        break;
      case 'update-metadata':
      case 'update-sync-tag':
        updateCount++;
        break;
      case 'video-transcode':
        videoTranscodeCount++;
        break;
      case 'video-copy':
        videoCopyCount++;
        break;
      case 'video-remove':
        videoRemoveCount++;
        break;
      case 'video-update-metadata':
        videoUpdateCount++;
        break;
      case 'video-upgrade':
        videoUpgradeCount++;
        break;
    }
  }

  return {
    removeCount,
    updateCount,
    addTranscodeCount,
    addDirectCopyCount,
    addOptimizedCopyCount,
    upgradeTranscodeCount,
    upgradeDirectCopyCount,
    upgradeOptimizedCopyCount,
    upgradeArtworkCount,
    videoTranscodeCount,
    videoCopyCount,
    videoRemoveCount,
    videoUpdateCount,
    videoUpgradeCount,
  };
}
