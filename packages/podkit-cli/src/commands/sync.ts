/**
 * Sync command - synchronize music and/or video collections to iPod
 *
 * This command:
 * 1. Resolves collections and device from config or CLI flags
 * 2. Scans the source directory for audio/video files
 * 3. Opens the iPod database
 * 4. Computes the diff between source and iPod
 * 5. Creates a sync plan (transcode/copy/remove operations)
 * 6. Executes the plan with progress display
 *
 * @example
 * ```bash
 * podkit sync                            # Sync all defaults (music + video)
 * podkit sync -t music                   # Sync music only
 * podkit sync -t video                   # Sync video only
 * podkit sync -t music -t video          # Sync multiple types
 * podkit sync -t music,video             # Comma-separated types
 * podkit sync -c main                    # Sync collection named "main" (both namespaces)
 * podkit sync -t music -c main           # Sync music collection named "main"
 * podkit sync -d terapod                 # Sync to device named "terapod"
 * podkit sync --dry-run                  # Preview changes
 * podkit sync --delete                   # Remove orphaned tracks
 * podkit sync --quality medium           # Use medium quality preset
 * ```
 */
import { existsSync, statfsSync } from '../utils/fs.js';
import { Command } from 'commander';
import { getContext } from '../context.js';
import type {
  QualityPreset,
  TransformsConfig,
  VideoQualityPreset,
  PodkitConfig,
  MusicCollectionConfig,
  VideoCollectionConfig,
  DeviceConfig,
} from '../config/index.js';
import {
  resolveDevicePath,
  formatDeviceError,
  getDeviceIdentity,
  formatDeviceLookupMessage,
  parseCliDeviceArg,
  resolveEffectiveDevice,
} from '../device-resolver.js';
import type { IPodVideo, CollectionVideo, CollectionAdapter } from '@podkit/core';
import { MediaType } from '@podkit/core';
import {
  OutputContext,
  formatBytes,
  formatNumber,
  formatDurationSeconds,
  formatCollectionLabel,
  renderProgressBar,
  formatErrors,
  formatUpdateReason,
  buildTransformPreview,
} from '../output/index.js';
import type { CollectedError } from '../output/index.js';
import { formatProgressLine } from '../utils/progress.js';
import { createMusicAdapter } from '../utils/source-adapter.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Valid sync types
 */
type SyncType = 'music' | 'video';

/**
 * Sync command options
 */
interface SyncOptions {
  type?: string[];
  dryRun?: boolean;
  quality?: QualityPreset;
  audioQuality?: QualityPreset;
  videoQuality?: VideoQualityPreset;
  encoding?: string;
  filter?: string;
  artwork?: boolean;
  skipUpgrades?: boolean;
  forceTranscode?: boolean;
  forceSyncTags?: boolean;
  checkArtwork?: boolean;
  delete?: boolean;
  collection?: string;
  eject?: boolean;
}

/**
 * Categorized error info for JSON output
 */
export interface ErrorInfo {
  track: string;
  category: string;
  message: string;
  retryAttempts: number;
  wasRetried: boolean;
  stack?: string;
}

/**
 * Warning info for JSON output (plan warnings like lossy-to-lossy)
 */
export interface PlanWarningInfo {
  type: string;
  message: string;
  trackCount: number;
  tracks?: string[];
}

/**
 * Execution warning info for JSON output (artwork, metadata issues during sync)
 */
export interface ExecutionWarningInfo {
  type: string;
  track: string;
  message: string;
}

/**
 * Scan warning info for JSON output (file parsing issues)
 */
export interface ScanWarningInfo {
  file: string;
  message: string;
}

/**
 * Transform info for JSON output
 */
export interface TransformInfo {
  name: string;
  enabled: boolean;
  mode?: string;
  format?: string;
}

/**
 * Update breakdown by reason for JSON output
 */
export interface UpdateBreakdown {
  'transform-apply'?: number;
  'transform-remove'?: number;
  'metadata-changed'?: number;
  'format-upgrade'?: number;
  'quality-upgrade'?: number;
  'preset-upgrade'?: number;
  'preset-downgrade'?: number;
  'force-transcode'?: number;
  'sync-tag-write'?: number;
  'artwork-added'?: number;
  'artwork-removed'?: number;
  'artwork-updated'?: number;
  'soundcheck-update'?: number;
  'metadata-correction'?: number;
}

/**
 * JSON output structure for sync command
 */
export interface SyncOutput {
  success: boolean;
  dryRun: boolean;
  source?: string;
  device?: string;
  transforms?: TransformInfo[];
  skipUpgrades?: boolean;
  plan?: {
    tracksToAdd: number;
    tracksToRemove: number;
    tracksToUpdate: number;
    tracksToUpgrade: number;
    updateBreakdown?: UpdateBreakdown;
    tracksToTranscode: number;
    tracksToCopy: number;
    tracksExisting: number;
    estimatedSize: number;
    estimatedTime: number;
    soundCheckTracks?: number;
  };
  operations?: Array<{
    type:
      | 'transcode'
      | 'copy'
      | 'remove'
      | 'update-metadata'
      | 'upgrade'
      | 'video-transcode'
      | 'video-copy'
      | 'video-remove';
    track: string;
    status?: 'pending' | 'completed' | 'failed' | 'skipped';
    error?: string;
    changes?: Array<{ field: string; from: string; to: string }>;
    reason?: string;
  }>;
  result?: {
    completed: number;
    failed: number;
    skipped: number;
    bytesTransferred: number;
    duration: number;
  };
  eject?: {
    requested: boolean;
    success: boolean;
    error?: string;
  };
  planWarnings?: PlanWarningInfo[];
  scanWarnings?: ScanWarningInfo[];
  executionWarnings?: ExecutionWarningInfo[];
  errors?: ErrorInfo[];
  error?: string;
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Format duration in seconds as human-readable time
 * Exported for use by tests
 */
export function formatDuration(seconds: number): string {
  return formatDurationSeconds(seconds);
}

/**
 * Get storage information for a mount point
 */
function getStorageInfo(mountpoint: string): { total: number; free: number; used: number } | null {
  try {
    const stats = statfsSync(mountpoint);
    const total = stats.blocks * stats.bsize;
    const free = stats.bfree * stats.bsize;
    const used = total - free;
    return { total, free, used };
  } catch {
    return null;
  }
}

// Re-export renderProgressBar for tests
export { renderProgressBar };

// =============================================================================
// Transform Display Helpers
// =============================================================================

/**
 * Format transforms configuration for display
 *
 * Returns a human-readable string describing enabled transforms.
 * Returns null if no transforms are enabled.
 */
function formatTransformsConfig(transforms: TransformsConfig): string | null {
  const parts: string[] = [];

  if (transforms.cleanArtists.enabled) {
    if (transforms.cleanArtists.drop) {
      parts.push('Clean artists: enabled (drop mode)');
    } else {
      parts.push(`Clean artists: enabled (format: "${transforms.cleanArtists.format}")`);
    }
  }

  return parts.length > 0 ? parts.join(', ') : null;
}

// =============================================================================
// Collection Resolution
// =============================================================================

/**
 * Resolved collection information
 */
interface ResolvedCollection {
  name: string;
  type: 'music' | 'video';
  config: MusicCollectionConfig | VideoCollectionConfig;
}

/**
 * Resolve collections to sync based on CLI flags and config
 */
function resolveCollections(
  config: PodkitConfig,
  collectionName?: string,
  type?: SyncType
): ResolvedCollection[] {
  const collections: ResolvedCollection[] = [];

  if (collectionName) {
    if ((!type || type === 'music') && config.music?.[collectionName]) {
      collections.push({
        name: collectionName,
        type: 'music',
        config: config.music[collectionName],
      });
    }
    if ((!type || type === 'video') && config.video?.[collectionName]) {
      collections.push({
        name: collectionName,
        type: 'video',
        config: config.video[collectionName],
      });
    }
    return collections;
  }

  // No specific collection name - use defaults
  if (!type || type === 'music') {
    const defaultMusicName = config.defaults?.music;
    if (defaultMusicName && config.music?.[defaultMusicName]) {
      collections.push({
        name: defaultMusicName,
        type: 'music',
        config: config.music[defaultMusicName],
      });
    }
  }

  if (!type || type === 'video') {
    const defaultVideoName = config.defaults?.video;
    if (defaultVideoName && config.video?.[defaultVideoName]) {
      collections.push({
        name: defaultVideoName,
        type: 'video',
        config: config.video[defaultVideoName],
      });
    }
  }

  return collections;
}

/**
 * Get effective transforms config for a device
 */
function getEffectiveTransforms(
  globalTransforms: TransformsConfig,
  deviceConfig?: DeviceConfig
): TransformsConfig {
  if (!deviceConfig?.transforms) {
    return globalTransforms;
  }

  return {
    cleanArtists: {
      ...globalTransforms.cleanArtists,
      ...deviceConfig.transforms.cleanArtists,
    },
  };
}

/**
 * Get effective audio quality preset
 *
 * Resolution order: device audioQuality > device quality > global audioQuality > global quality
 */
function getEffectiveAudioQuality(
  config: { quality: QualityPreset; audioQuality?: QualityPreset },
  deviceConfig?: DeviceConfig
): QualityPreset {
  return (
    deviceConfig?.audioQuality ?? deviceConfig?.quality ?? config.audioQuality ?? config.quality
  );
}

/**
 * Get effective video quality preset
 *
 * Resolution order: device videoQuality > device quality (if valid for video) > global videoQuality > global quality (if valid for video) > 'high'
 */
function getEffectiveVideoQuality(
  config: { quality: QualityPreset; videoQuality?: VideoQualityPreset },
  deviceConfig?: DeviceConfig
): VideoQualityPreset {
  if (deviceConfig?.videoQuality) return deviceConfig.videoQuality;
  if (deviceConfig?.quality && isVideoQualityCompatible(deviceConfig.quality))
    return deviceConfig.quality as VideoQualityPreset;
  if (config.videoQuality) return config.videoQuality;
  if (isVideoQualityCompatible(config.quality)) return config.quality as VideoQualityPreset;
  return 'high';
}

/**
 * Check if an audio quality preset is also valid as a video quality preset
 */
function isVideoQualityCompatible(quality: QualityPreset): boolean {
  return ['max', 'high', 'medium', 'low'].includes(quality);
}

/**
 * Get effective artwork setting for a device
 */
function getEffectiveArtwork(globalArtwork: boolean, deviceConfig?: DeviceConfig): boolean {
  return deviceConfig?.artwork ?? globalArtwork;
}

/**
 * Get effective checkArtwork setting for a device
 *
 * Resolution order: device checkArtwork > global checkArtwork > default (false)
 */
function getEffectiveCheckArtwork(
  globalCheckArtwork: boolean | undefined,
  deviceConfig?: DeviceConfig
): boolean {
  return deviceConfig?.checkArtwork ?? globalCheckArtwork ?? false;
}

/**
 * Get effective skipUpgrades setting for a device
 *
 * Resolution order: device skipUpgrades > global skipUpgrades > default (false)
 */
function getEffectiveSkipUpgrades(
  globalSkipUpgrades: boolean | undefined,
  deviceConfig?: DeviceConfig
): boolean {
  return deviceConfig?.skipUpgrades ?? globalSkipUpgrades ?? false;
}

/**
 * Get effective encoding mode
 *
 * Resolution order: device encoding > global encoding > undefined (defaults to VBR)
 */
function getEffectiveEncoding(
  config: PodkitConfig,
  deviceConfig?: DeviceConfig
): import('@podkit/core').EncodingMode | undefined {
  return deviceConfig?.encoding ?? config.encoding;
}

/**
 * Get effective custom bitrate
 *
 * Resolution order: device customBitrate > global customBitrate > undefined
 */
function getEffectiveCustomBitrate(
  config: PodkitConfig,
  deviceConfig?: DeviceConfig
): number | undefined {
  return deviceConfig?.customBitrate ?? config.customBitrate;
}

/**
 * Get effective bitrate tolerance
 *
 * Resolution order: device bitrateTolerance > global bitrateTolerance > undefined
 */
function getEffectiveBitrateTolerance(
  config: PodkitConfig,
  deviceConfig?: DeviceConfig
): number | undefined {
  return deviceConfig?.bitrateTolerance ?? config.bitrateTolerance;
}

// =============================================================================
// Music Sync Helpers
// =============================================================================

interface MusicSyncContext {
  out: OutputContext;
  collection: ResolvedCollection;
  sourcePath: string;
  devicePath: string;
  dryRun: boolean;
  removeOrphans: boolean;
  effectiveTransforms: TransformsConfig;
  effectiveQuality: QualityPreset;
  effectiveEncoding: import('@podkit/core').EncodingMode | undefined;
  effectiveCustomBitrate: number | undefined;
  effectiveBitrateTolerance: number | undefined;
  deviceSupportsAlac: boolean;
  effectiveArtwork: boolean;
  skipUpgrades: boolean;
  forceTranscode: boolean;
  forceSyncTags: boolean;
  checkArtwork: boolean;
  ipod: Awaited<ReturnType<typeof import('@podkit/core').IpodDatabase.open>>;
  transcoder: ReturnType<typeof import('@podkit/core').createFFmpegTranscoder>;
  core: typeof import('@podkit/core');
}

interface MusicSyncResult {
  success: boolean;
  completed: number;
  failed: number;
  jsonOutput?: SyncOutput;
  artworkMissingBaseline?: number;
}

/**
 * Sync a single music collection
 */
async function syncMusicCollection(ctx: MusicSyncContext): Promise<MusicSyncResult> {
  const {
    out,
    collection,
    sourcePath,
    devicePath,
    dryRun,
    removeOrphans,
    effectiveTransforms,
    effectiveQuality,
    effectiveEncoding,
    effectiveCustomBitrate,
    effectiveBitrateTolerance,
    deviceSupportsAlac,
    effectiveArtwork,
    skipUpgrades,
    forceTranscode,
    forceSyncTags,
    checkArtwork,
    ipod,
    transcoder,
    core,
  } = ctx;

  const collectionLabel = formatCollectionLabel(collection.name, sourcePath, out.isVerbose);

  // Scan source directory
  const spinner = out.spinner(`Scanning music collection${collectionLabel}...`);

  const scanWarnings: Array<{ file: string; message: string }> = [];
  const collectionConfig = collection.config as MusicCollectionConfig;
  let adapter: CollectionAdapter;

  try {
    adapter = createMusicAdapter({
      config: collectionConfig,
      name: collection.name,
      checkArtwork,
      onProgress: (progress) => {
        if (progress.phase === 'discovering') {
          spinner.update(`Discovering audio files from${collectionLabel}...`);
        } else {
          spinner.update(
            `Parsing metadata from${collectionLabel}: ${progress.processed}/${progress.total} files`
          );
        }
      },
      onWarning: (warning) => {
        scanWarnings.push(warning);
      },
    });
  } catch (err) {
    spinner.stop();
    const message = err instanceof Error ? err.message : String(err);
    if (out.isJson) {
      return {
        success: false,
        completed: 0,
        failed: 0,
        jsonOutput: {
          success: false,
          dryRun,
          source: sourcePath,
          device: devicePath,
          error: `Failed to create adapter: ${message}`,
        },
      };
    }
    out.error(`Failed to create adapter for collection '${collection.name}':`);
    out.error(`  ${message}`);
    return { success: false, completed: 0, failed: 0 };
  }

  let collectionTracks: Awaited<ReturnType<typeof adapter.getTracks>>;
  try {
    await adapter.connect();
    collectionTracks = await adapter.getTracks();
  } catch (err) {
    spinner.stop();
    const message = err instanceof Error ? err.message : 'Failed to scan source';
    if (out.isJson) {
      return {
        success: false,
        completed: 0,
        failed: 0,
        jsonOutput: {
          success: false,
          dryRun,
          source: sourcePath,
          device: devicePath,
          error: `Failed to scan source: ${message}`,
        },
      };
    }
    out.error(`Failed to scan source directory: ${message}`);
    return { success: false, completed: 0, failed: 0 };
  }

  spinner.stop(`Found ${formatNumber(collectionTracks.length)} tracks in source`);

  if (scanWarnings.length > 0) {
    out.print(
      `  ${scanWarnings.length} file${scanWarnings.length === 1 ? '' : 's'} could not be parsed`
    );
    if (out.isVerbose) {
      for (const warning of scanWarnings) {
        out.print(`    - ${warning.file}: ${warning.message}`);
      }
    }
  }

  // Compute diff
  const diffSpinner = out.spinner('Computing sync diff...');
  const ipodTracks = ipod.getTracks();
  const isAlacPreset = effectiveQuality === 'max' && deviceSupportsAlac;

  // Resolve quality for sync tag comparison:
  // - max + ALAC device → 'lossless'
  // - max + non-ALAC device → 'high' (max falls back to high)
  // - other → as-is ('high', 'medium', 'low')
  const resolvedQuality = isAlacPreset
    ? 'lossless'
    : effectiveQuality === 'max'
      ? 'high'
      : effectiveQuality;

  const diff = core.computeDiff(collectionTracks, ipodTracks, {
    transforms: effectiveTransforms,
    skipUpgrades,
    forceTranscode,
    forceSyncTags,
    transcodingActive: true,
    presetBitrate: core.getPresetBitrate(effectiveQuality),
    encodingMode: effectiveEncoding,
    bitrateTolerance: effectiveBitrateTolerance,
    isAlacPreset,
    resolvedQuality,
    customBitrate: effectiveCustomBitrate,
  });
  diffSpinner.stop('Diff computed');

  // Count tracks with artwork but no artwork hash baseline (for tip at end of sync)
  let artworkMissingBaseline = 0;
  if (checkArtwork) {
    for (const match of diff.existing) {
      if (match.ipod.hasArtwork === true) {
        const syncTag = core.parseSyncTag(match.ipod.comment);
        if (!syncTag?.artworkHash) {
          artworkMissingBaseline++;
        }
      }
    }
  }

  // Create sync plan
  const transcodeConfig = {
    quality: effectiveQuality,
    encoding: effectiveEncoding,
    customBitrate: effectiveCustomBitrate,
  };
  const plan = core.createPlan(diff, {
    removeOrphans,
    transcodeConfig,
    deviceSupportsAlac,
    artworkEnabled: effectiveArtwork,
  });
  const summary = core.getPlanSummary(plan);
  const storage = getStorageInfo(devicePath);
  const hasEnoughSpace = storage ? core.willFitInSpace(plan, storage.free) : true;

  // Handle dry-run
  if (dryRun) {
    const result = buildMusicDryRunOutput({
      out,
      sourcePath,
      devicePath,
      effectiveQuality,
      effectiveTransforms,
      skipUpgrades,
      diff,
      plan,
      summary,
      storage,
      hasEnoughSpace,
      removeOrphans,
      scanWarnings,
      core,
    });
    await adapter.disconnect();
    return {
      success: true,
      completed: 0,
      failed: 0,
      jsonOutput: out.isJson ? result : undefined,
      artworkMissingBaseline,
    };
  }

  // Check space
  if (!hasEnoughSpace) {
    if (out.isJson) {
      return {
        success: false,
        completed: 0,
        failed: 0,
        jsonOutput: {
          success: false,
          dryRun: false,
          source: sourcePath,
          device: devicePath,
          plan: {
            tracksToAdd: diff.toAdd.length,
            tracksToRemove: removeOrphans ? diff.toRemove.length : 0,
            tracksToUpdate: diff.toUpdate.length,
            tracksToUpgrade: summary.upgradeCount,
            tracksToTranscode: summary.transcodeCount,
            tracksToCopy: summary.copyCount,
            tracksExisting: diff.existing.length,
            estimatedSize: plan.estimatedSize,
            estimatedTime: plan.estimatedTime,
          },
          error: `Not enough space. Need ${formatBytes(plan.estimatedSize)}, have ${formatBytes(storage?.free ?? 0)}`,
        },
      };
    }
    out.error('Not enough space on iPod.');
    out.error(`  Need: ${formatBytes(plan.estimatedSize)}`);
    out.error(`  Have: ${formatBytes(storage?.free ?? 0)}`);
    await adapter.disconnect();
    return { success: false, completed: 0, failed: 0 };
  }

  // Nothing to do
  if (plan.operations.length === 0) {
    out.newline();
    out.print('Music already in sync! No changes needed.');
    out.print(`  Source tracks: ${formatNumber(collectionTracks.length)}`);
    out.print(`  iPod tracks: ${formatNumber(ipodTracks.length)}`);
    await adapter.disconnect();
    return { success: true, completed: 0, failed: 0 };
  }

  // Execute sync
  out.newline();
  out.print('=== Syncing Music ===');
  out.newline();
  out.print(`Tracks to process: ${formatNumber(plan.operations.length)}`);
  out.print(`Estimated size: ${formatBytes(plan.estimatedSize)}`);
  out.print(`Estimated time: ~${formatDuration(plan.estimatedTime)}`);
  out.newline();

  const collectedErrors: CollectedError[] = [];
  let completed = 0;
  let failed = 0;

  const executor = new core.DefaultSyncExecutor({ ipod, transcoder });

  for await (const progress of executor.execute(plan, {
    dryRun: false,
    continueOnError: true,
    artwork: effectiveArtwork,
    adapter,
    syncTagConfig: {
      encodingMode: effectiveEncoding,
      customBitrate: effectiveCustomBitrate,
    },
  })) {
    if (progress.error) {
      const categorized = progress.categorizedError;
      collectedErrors.push({
        trackName: categorized?.trackName ?? core.getOperationDisplayName(progress.operation),
        category: categorized?.category ?? 'unknown',
        message: progress.error.message,
        retryAttempts: categorized?.retryAttempts ?? 0,
        wasRetried: categorized?.wasRetried ?? false,
        stack: progress.error.stack,
      });
      failed++;
    } else if (
      progress.phase !== 'preparing' &&
      progress.phase !== 'updating-db' &&
      progress.phase !== 'complete'
    ) {
      completed++;
    }

    if (progress.phase === 'complete') {
      out.clearLine();
      out.print('Music sync complete!');
    } else if (progress.phase === 'updating-db') {
      out.raw('\r\x1b[KSaving iPod database...');
    } else if (progress.phase !== 'preparing') {
      const bar = renderProgressBar(progress.current + 1, progress.total);
      const phaseStr =
        progress.phase === 'updating-metadata'
          ? 'Updating metadata'
          : progress.phase.charAt(0).toUpperCase() + progress.phase.slice(1);
      const line = formatProgressLine({
        bar,
        phase: phaseStr,
        trackName: progress.currentTrack,
      });
      out.raw(line);
    }
  }

  if (collectedErrors.length > 0) {
    const errorLines = formatErrors(collectedErrors, out.verbosity);
    for (const line of errorLines) {
      out.print(line);
    }
  }

  await adapter.disconnect();
  return { success: failed === 0, completed, failed, artworkMissingBaseline };
}

interface MusicDryRunContext {
  out: OutputContext;
  sourcePath: string;
  devicePath: string;
  effectiveQuality: QualityPreset;
  effectiveTransforms: TransformsConfig;
  skipUpgrades: boolean;
  diff: ReturnType<typeof import('@podkit/core').computeDiff>;
  plan: ReturnType<typeof import('@podkit/core').createPlan>;
  summary: ReturnType<typeof import('@podkit/core').getPlanSummary>;
  storage: { total: number; free: number; used: number } | null;
  hasEnoughSpace: boolean;
  removeOrphans: boolean;
  scanWarnings: Array<{ file: string; message: string }>;
  core: typeof import('@podkit/core');
}

function buildMusicDryRunOutput(ctx: MusicDryRunContext): SyncOutput {
  const {
    out,
    sourcePath,
    devicePath,
    effectiveQuality,
    effectiveTransforms,
    skipUpgrades,
    diff,
    plan,
    summary,
    storage,
    hasEnoughSpace,
    removeOrphans,
    scanWarnings,
    core,
  } = ctx;

  // Build JSON output structure
  const operations: SyncOutput['operations'] = plan.operations.map((op) => {
    const base = {
      type: op.type,
      track: core.getOperationDisplayName(op),
      status: 'pending' as const,
    };
    if (op.type === 'update-metadata') {
      const updateInfo = diff.toUpdate.find(
        (u) => u.ipod.title === op.track.title && u.ipod.artist === op.track.artist
      );
      if (updateInfo) {
        return {
          ...base,
          changes: updateInfo.changes.map((c) => ({
            field: c.field,
            from: c.from,
            to: c.to,
          })),
        };
      }
    }
    if (op.type === 'upgrade') {
      return {
        ...base,
        reason: op.reason,
      };
    }
    return base;
  });

  const planWarningInfos: PlanWarningInfo[] = plan.warnings.map((warning) => ({
    type: warning.type,
    message: warning.message,
    trackCount: warning.tracks.length,
    tracks: out.isVerbose ? warning.tracks.map((t) => `${t.artist} - ${t.title}`) : undefined,
  }));

  const scanWarningInfos: ScanWarningInfo[] = scanWarnings.map((warning) => ({
    file: warning.file,
    message: warning.message,
  }));

  const transformsInfo: TransformInfo[] = [];
  if (effectiveTransforms.cleanArtists.enabled) {
    transformsInfo.push({
      name: 'cleanArtists',
      enabled: true,
      mode: effectiveTransforms.cleanArtists.drop ? 'drop' : 'move',
      format: effectiveTransforms.cleanArtists.drop
        ? undefined
        : effectiveTransforms.cleanArtists.format,
    });
  }

  const updateBreakdown: UpdateBreakdown = {};
  for (const update of diff.toUpdate) {
    const count = updateBreakdown[update.reason] ?? 0;
    updateBreakdown[update.reason] = count + 1;
  }

  // Text output for dry-run
  if (out.isText) {
    out.newline();
    out.print('=== Music Sync Plan (Dry Run) ===');
    out.newline();
    out.print(`Source: ${sourcePath}`);
    out.print(`Device: ${devicePath}`);
    const qualityDisplay = effectiveQuality;
    out.print(`Quality: ${qualityDisplay}`);
    const transformsDisplay = formatTransformsConfig(effectiveTransforms);
    if (transformsDisplay) {
      out.print(`Transforms: ${transformsDisplay}`);
    }
    if (skipUpgrades) {
      out.print(`Skip upgrades: enabled`);
    }
    out.newline();

    out.print('Changes:');
    out.print(`  Tracks to add: ${formatNumber(diff.toAdd.length)}`);
    if (summary.transcodeCount > 0) {
      out.print(`    - Transcode: ${formatNumber(summary.transcodeCount)}`);
    }
    if (summary.copyCount > 0) {
      out.print(`    - Copy: ${formatNumber(summary.copyCount)}`);
    }
    if (removeOrphans && diff.toRemove.length > 0) {
      out.print(`  Tracks to remove: ${formatNumber(diff.toRemove.length)}`);
    }
    out.print(`  Already synced: ${formatNumber(diff.existing.length)}`);

    if (diff.toUpdate.length > 0) {
      const updatesByReason = new Map<string, number>();
      for (const update of diff.toUpdate) {
        const count = updatesByReason.get(update.reason) ?? 0;
        updatesByReason.set(update.reason, count + 1);
      }
      const reasonParts: string[] = [];
      for (const [reason, count] of updatesByReason) {
        reasonParts.push(`${formatUpdateReason(reason)}: ${count}`);
      }
      out.print(
        `  Tracks to update: ${formatNumber(diff.toUpdate.length)} (${reasonParts.join(', ')})`
      );
    }
    out.newline();

    out.print('Estimates:');
    out.print(`  Size: ${formatBytes(plan.estimatedSize)}`);
    out.print(`  Time: ~${formatDuration(plan.estimatedTime)}`);
    if (storage) {
      out.print(`  Available space: ${formatBytes(storage.free)}`);
      if (!hasEnoughSpace) {
        out.print('  WARNING: May not have enough space!');
      }
    }
    // Sound Check stats
    if (diff.toAdd.length > 0) {
      const withSoundcheck = diff.toAdd.filter((t) => t.soundcheck !== undefined).length;
      out.print(
        `  Sound Check: ${formatNumber(withSoundcheck)}/${formatNumber(diff.toAdd.length)} tracks have normalization data`
      );
    }
    out.newline();

    // Transform preview
    if (effectiveTransforms.cleanArtists.enabled) {
      const tracksToTransform = [
        ...diff.toAdd,
        ...diff.toUpdate.filter((u) => u.reason === 'transform-apply').map((u) => u.source),
      ];
      if (tracksToTransform.length > 0) {
        const preview = buildTransformPreview(
          tracksToTransform,
          effectiveTransforms,
          core.applyTransforms
        );
        if (preview.length > 0) {
          out.print('Artist transforms:');
          for (const entry of preview) {
            const countStr = entry.count > 1 ? `  [${entry.count} tracks]` : '';
            out.print(`  "${entry.originalArtist}" \u2192 "${entry.transformedArtist}"${countStr}`);
          }
          out.newline();
        }
      }
    }

    // Operations list
    if (out.isVerbose || plan.operations.length <= 20) {
      if (plan.operations.length > 0) {
        out.print('Operations:');
        for (const op of plan.operations) {
          let symbol: string;
          switch (op.type) {
            case 'remove':
              symbol = '-';
              break;
            case 'update-metadata':
              symbol = '~';
              break;
            default:
              symbol = '+';
          }
          const typeStr = op.type.padEnd(15);
          out.print(`  ${symbol} [${typeStr}] ${core.getOperationDisplayName(op)}`);
        }
        out.newline();
      }
    } else if (plan.operations.length > 20) {
      out.print(`Operations: ${plan.operations.length} total (use --verbose to list all)`);
      out.newline();
    }

    // Warnings
    if (plan.warnings.length > 0) {
      for (const warning of plan.warnings) {
        if (warning.type === 'lossy-to-lossy') {
          out.print(
            `Warning: ${warning.tracks.length} track${warning.tracks.length === 1 ? '' : 's'} require lossy-to-lossy conversion`
          );
        }
      }
      out.newline();
    }
  }

  return {
    success: true,
    dryRun: true,
    source: sourcePath,
    device: devicePath,
    transforms: transformsInfo.length > 0 ? transformsInfo : undefined,
    skipUpgrades: skipUpgrades || undefined,
    plan: {
      tracksToAdd: diff.toAdd.length,
      tracksToRemove: removeOrphans ? diff.toRemove.length : 0,
      tracksToUpdate: diff.toUpdate.length,
      tracksToUpgrade: summary.upgradeCount,
      updateBreakdown: diff.toUpdate.length > 0 ? updateBreakdown : undefined,
      tracksToTranscode: summary.transcodeCount,
      tracksToCopy: summary.copyCount,
      tracksExisting: diff.existing.length,
      estimatedSize: plan.estimatedSize,
      estimatedTime: plan.estimatedTime,
      soundCheckTracks:
        diff.toAdd.length > 0
          ? diff.toAdd.filter((t) => t.soundcheck !== undefined).length
          : undefined,
    },
    operations,
    planWarnings: planWarningInfos.length > 0 ? planWarningInfos : undefined,
    scanWarnings: scanWarningInfos.length > 0 ? scanWarningInfos : undefined,
  };
}

// =============================================================================
// Video Sync Helpers
// =============================================================================

interface VideoSyncContext {
  out: OutputContext;
  collection: ResolvedCollection;
  sourcePath: string;
  devicePath: string;
  dryRun: boolean;
  removeOrphans: boolean;
  effectiveVideoQuality: VideoQualityPreset;
  ipod: Awaited<ReturnType<typeof import('@podkit/core').IpodDatabase.open>>;
  core: typeof import('@podkit/core');
}

interface VideoSyncResult {
  success: boolean;
  completed: number;
  failed: number;
  jsonOutput?: SyncOutput;
}

/**
 * Sync a single video collection (handles both dry-run and execution)
 */
async function syncVideoCollection(ctx: VideoSyncContext): Promise<VideoSyncResult> {
  const {
    out,
    collection,
    sourcePath,
    devicePath,
    dryRun,
    removeOrphans,
    effectiveVideoQuality,
    ipod,
    core,
  } = ctx;

  const collectionLabel = formatCollectionLabel(collection.name, sourcePath, out.isVerbose);

  // Scan video source
  const spinner = out.spinner(`Scanning video collection${collectionLabel}...`);

  const scanWarnings: Array<{ file: string; message: string }> = [];
  const videoAdapter = core.createVideoDirectoryAdapter({
    path: sourcePath,
    onProgress: (progress) => {
      if (progress.phase === 'discovering') {
        spinner.update(`Discovering video files from${collectionLabel}...`);
      } else {
        spinner.update(
          `Analyzing videos from${collectionLabel}: ${progress.processed}/${progress.total} files`
        );
      }
    },
    onWarning: (warning) => {
      scanWarnings.push(warning);
    },
  });

  let collectionVideos: CollectionVideo[];
  try {
    await videoAdapter.connect();
    collectionVideos = await videoAdapter.getVideos();
  } catch (err) {
    spinner.stop();
    const message = err instanceof Error ? err.message : 'Failed to scan source';
    out.error(`Failed to scan video source: ${message}`);
    return { success: false, completed: 0, failed: 0 };
  }

  const movieCount = collectionVideos.filter((v) => v.contentType === 'movie').length;
  const tvShowCount = collectionVideos.filter((v) => v.contentType === 'tvshow').length;

  spinner.stop(
    `Found ${formatNumber(collectionVideos.length)} videos (${movieCount} movies, ${tvShowCount} TV episodes)`
  );

  // Get iPod video tracks
  const allTracks = ipod.getTracks();
  const ipodVideos: IPodVideo[] = allTracks
    .filter((t) => (t.mediaType & MediaType.Movie) !== 0 || (t.mediaType & MediaType.TVShow) !== 0)
    .map((t) => {
      const isMovie = (t.mediaType & MediaType.Movie) !== 0;
      return {
        id: t.filePath,
        filePath: t.filePath,
        contentType: (isMovie ? 'movie' : 'tvshow') as 'movie' | 'tvshow',
        title: t.title,
        year: t.year,
        seriesTitle: t.tvShow,
        seasonNumber: t.seasonNumber,
        episodeNumber: t.episodeNumber,
        duration: t.duration ? Math.floor(t.duration / 1000) : undefined,
        bitrate: t.bitrate || undefined,
        comment: t.comment,
      };
    });

  // Compute video diff (with preset bitrate for preset change detection)
  const diffSpinner = out.spinner('Computing video sync diff...');
  const ipodDevice = ipod.getInfo().device;
  const deviceProfile = core.getDeviceProfileByGeneration(ipodDevice.generation);
  const videoPresetSettings = core.getPresetSettingsWithFallback(
    deviceProfile.name,
    effectiveVideoQuality
  );
  const videoPresetBitrate = videoPresetSettings.videoBitrate + videoPresetSettings.audioBitrate;
  const videoDiff = core.diffVideos(collectionVideos, ipodVideos, {
    presetBitrate: videoPresetBitrate,
    resolvedVideoQuality: effectiveVideoQuality,
  });
  diffSpinner.stop('Video diff computed');

  // Create video plan
  const videoPlan = core.planVideoSync(videoDiff, {
    deviceProfile,
    qualityPreset: effectiveVideoQuality,
    removeOrphans,
    useHardwareAcceleration: true,
  });

  const videoSummary = core.getVideoPlanSummary(videoPlan);
  const storage = getStorageInfo(devicePath);
  const hasEnoughSpace = storage ? core.willVideoPlanFit(videoPlan, storage.free) : true;

  // Handle dry-run output
  if (dryRun) {
    out.newline();
    out.print('=== Video Sync Plan (Dry Run) ===');
    out.newline();
    out.print(`Source: ${sourcePath}`);
    out.print(`Device: ${devicePath}`);
    out.print(`Quality: ${effectiveVideoQuality}`);
    out.newline();
    out.print('Collection:');
    out.print(`  Total videos: ${formatNumber(collectionVideos.length)}`);
    out.print(`    - Movies: ${formatNumber(movieCount)}`);
    out.print(`    - TV Shows: ${formatNumber(tvShowCount)}`);
    out.newline();
    out.print('Changes:');
    out.print(`  Videos to add: ${formatNumber(videoDiff.toAdd.length)}`);
    if (videoSummary.transcodeCount > 0) {
      out.print(`    - Transcode: ${formatNumber(videoSummary.transcodeCount)}`);
    }
    if (videoSummary.copyCount > 0) {
      out.print(`    - Passthrough: ${formatNumber(videoSummary.copyCount)}`);
    }
    if (removeOrphans && videoDiff.toRemove.length > 0) {
      out.print(`  Videos to remove: ${formatNumber(videoDiff.toRemove.length)}`);
    }
    out.print(`  Already synced: ${formatNumber(videoDiff.existing.length)}`);
    out.newline();
    out.print('Estimates:');
    out.print(`  Size: ${formatBytes(videoPlan.estimatedSize)}`);
    out.print(`  Time: ~${formatDuration(videoPlan.estimatedTime)}`);
    out.newline();

    await videoAdapter.disconnect();
    return { success: true, completed: 0, failed: 0 };
  }

  // Check space (execution path)
  if (!hasEnoughSpace) {
    out.error('Not enough space for video sync.');
    out.error(`  Need: ${formatBytes(videoPlan.estimatedSize)}`);
    out.error(`  Have: ${formatBytes(storage?.free ?? 0)}`);
    await videoAdapter.disconnect();
    return { success: false, completed: 0, failed: 0 };
  }

  // Nothing to do
  if (videoPlan.operations.length === 0) {
    out.print('Videos already in sync! No changes needed.');
    await videoAdapter.disconnect();
    return { success: true, completed: 0, failed: 0 };
  }

  // Execute video sync
  out.newline();
  out.print(`Videos to process: ${formatNumber(videoPlan.operations.length)}`);
  out.print(`  - Transcode: ${formatNumber(videoSummary.transcodeCount)}`);
  out.print(`  - Passthrough: ${formatNumber(videoSummary.copyCount)}`);
  out.print(`Estimated size: ${formatBytes(videoPlan.estimatedSize)}`);
  out.newline();

  const videoExecutor = core.createVideoExecutor({ ipod });
  let videoCompleted = 0;

  try {
    for await (const progress of videoExecutor.execute(videoPlan, {
      dryRun: false,
      videoQuality: effectiveVideoQuality,
    })) {
      if (progress.skipped) {
        // Skip tracking for skipped operations
      } else if (progress.phase !== 'preparing' && progress.phase !== 'complete') {
        videoCompleted++;
      }

      if (progress.phase === 'complete') {
        out.print('\nVideo sync complete.');
      } else if (progress.transcodeProgress) {
        const percent = progress.transcodeProgress.percent;
        const bar = renderProgressBar(Math.round(percent), 100);
        const line = formatProgressLine({
          bar,
          phase: 'Transcoding',
          trackName: progress.currentTrack,
          speed: progress.transcodeProgress.speed,
        });
        out.raw(line);
      } else {
        const bar = renderProgressBar(progress.current + 1, progress.total);
        const phaseStr = progress.phase.replace('video-', '');
        const phaseFormatted =
          phaseStr === 'updating-metadata'
            ? 'Updating metadata'
            : phaseStr.charAt(0).toUpperCase() + phaseStr.slice(1);
        const line = formatProgressLine({
          bar,
          phase: phaseFormatted,
          trackName: progress.currentTrack,
        });
        out.raw(line);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Video execution failed';
    out.error(`\nVideo sync error: ${message}`);
    await videoAdapter.disconnect();
    return { success: false, completed: videoCompleted, failed: 1 };
  }

  await videoAdapter.disconnect();
  return { success: true, completed: videoCompleted, failed: 0 };
}

// =============================================================================
// Main Sync Command
// =============================================================================

/**
 * Collect repeatable -t/--type values, splitting comma-separated entries.
 */
function collectTypes(value: string, previous: string[]): string[] {
  return [...previous, ...value.split(',').map((v) => v.trim().toLowerCase())];
}

export const syncCommand = new Command('sync')
  .description('sync music and/or video collections to iPod')
  .option(
    '-t, --type <type>',
    'sync type: music, video (repeatable, default: all)',
    collectTypes,
    [] as string[]
  )
  .option('-c, --collection <name>', 'collection name to sync (searches music and video)')
  .option('-n, --dry-run', 'show what would be synced without making changes')
  .option(
    '--quality <preset>',
    'unified quality preset for audio and video: max, high, medium, low'
  )
  .option(
    '--audio-quality <preset>',
    'audio transcoding quality (overrides --quality): max, high, medium, low'
  )
  .option(
    '--video-quality <preset>',
    'video transcoding quality (overrides --quality): max, high, medium, low'
  )
  .option('--encoding <mode>', 'audio encoding mode: vbr, cbr')
  .option('--filter <pattern>', 'only sync tracks matching pattern')
  .option('--no-artwork', 'skip artwork transfer')
  .option('--skip-upgrades', 'skip file-replacement upgrades for changed source files')
  .option('--force-transcode', 're-transcode all lossless-source tracks regardless of bitrate')
  .option(
    '--force-sync-tags',
    'ensure sync tag consistency by writing tags to all matched transcoded tracks without re-transcoding'
  )
  .option('--check-artwork', 'detect artwork changes by comparing content hashes')
  .option('--delete', 'remove tracks from iPod not in source')
  .option('--eject', 'eject iPod after successful sync')
  .action(async (options: SyncOptions) => {
    const { config, globalOpts, configResult } = getContext();
    const startTime = Date.now();
    const out = OutputContext.fromGlobalOpts(globalOpts, config);

    const dryRun = options.dryRun ?? false;
    const removeOrphans = options.delete ?? false;

    // Helper for JSON error output
    const errorOutput = (error: string): SyncOutput => ({
      success: false,
      dryRun,
      error,
    });

    // ----- Validate type argument -----
    const typeArgs = options.type ?? [];
    const syncTypes: SyncType[] = [];
    for (const t of typeArgs) {
      if (t === 'music' || t === 'video') {
        if (!syncTypes.includes(t)) syncTypes.push(t);
      } else if (t !== 'all') {
        out.result(errorOutput(`Invalid sync type: ${t}. Valid values: music, video`), () => {
          out.error(`Invalid sync type: ${t}`);
          out.error('Valid values: music, video');
        });
        process.exitCode = 1;
        return;
      }
    }
    // If no types specified or 'all' was included, sync everything
    const syncType: SyncType | undefined = syncTypes.length === 1 ? syncTypes[0] : undefined;

    // ----- Resolve device -----
    const cliDeviceArg = parseCliDeviceArg(globalOpts.device, config);
    const deviceResult = resolveEffectiveDevice(cliDeviceArg, undefined, config);

    if (!deviceResult.success) {
      out.result(errorOutput(deviceResult.error), () => out.error(deviceResult.error));
      process.exitCode = 1;
      return;
    }

    const resolvedDevice = deviceResult.device;
    const cliPath = deviceResult.cliPath;

    // Get effective settings from device config
    const deviceConfig = resolvedDevice?.config;
    const effectiveTransforms = getEffectiveTransforms(config.transforms, deviceConfig);

    // Audio quality: CLI --audio-quality > CLI --quality > device/global resolution
    const effectiveQuality = options.audioQuality
      ? (options.audioQuality as QualityPreset)
      : options.quality
        ? (options.quality as QualityPreset)
        : getEffectiveAudioQuality(config, deviceConfig);

    // Video quality: CLI --video-quality > CLI --quality (if video-compatible) > device/global resolution
    const effectiveVideoQuality = options.videoQuality
      ? (options.videoQuality as VideoQualityPreset)
      : options.quality && isVideoQualityCompatible(options.quality as QualityPreset)
        ? (options.quality as VideoQualityPreset)
        : getEffectiveVideoQuality(config, deviceConfig);

    const effectiveArtwork =
      options.artwork !== undefined
        ? options.artwork
        : getEffectiveArtwork(config.artwork, deviceConfig);
    const effectiveSkipUpgrades =
      options.skipUpgrades !== undefined
        ? options.skipUpgrades
        : getEffectiveSkipUpgrades(config.skipUpgrades, deviceConfig);
    // Resolve encoding settings
    const effectiveEncoding = options.encoding
      ? (options.encoding as import('@podkit/core').EncodingMode)
      : getEffectiveEncoding(config, deviceConfig);
    const effectiveCustomBitrate = getEffectiveCustomBitrate(config, deviceConfig);
    const effectiveBitrateTolerance = getEffectiveBitrateTolerance(config, deviceConfig);

    // ----- Resolve collections -----
    const allCollections = resolveCollections(config, options.collection, syncType);
    const musicCollections = allCollections.filter((c) => c.type === 'music');
    const videoCollections = allCollections.filter((c) => c.type === 'video');

    const hasMusicToSync = musicCollections.length > 0;
    const hasVideoToSync = videoCollections.length > 0;

    if (!hasMusicToSync && !hasVideoToSync) {
      const errorMsg = options.collection
        ? `Collection "${options.collection}" not found in config`
        : 'No collections configured to sync';

      out.result(errorOutput(errorMsg), () => {
        if (options.collection) {
          out.error(`Collection "${options.collection}" not found in config.`);
          const musicNames = config.music ? Object.keys(config.music) : [];
          const videoNames = config.video ? Object.keys(config.video) : [];
          if (musicNames.length > 0) {
            out.error(`Available music collections: ${musicNames.join(', ')}`);
          }
          if (videoNames.length > 0) {
            out.error(`Available video collections: ${videoNames.join(', ')}`);
          }
          if (musicNames.length === 0 && videoNames.length === 0) {
            out.error(
              'No collections configured. Add collections to your config file or set PODKIT_MUSIC_PATH via environment variable.'
            );
          }
        } else {
          out.error('No collections configured to sync.');
          out.error('');
          out.error('Add collections to your config file:');
          if (configResult.configPath) {
            out.error(`  ${configResult.configPath}`);
          }
          out.error('');
          out.error('Example:');
          out.error('  [music.main]');
          out.error('  path = "/path/to/music"');
          out.error('');
          out.error('Or set via environment variable:');
          out.error('  PODKIT_MUSIC_PATH=/path/to/music');
        }
      });
      process.exitCode = 1;
      return;
    }

    // Validate collection paths exist
    for (const collection of [...musicCollections, ...videoCollections]) {
      const collConfig = collection.config as MusicCollectionConfig | VideoCollectionConfig;
      const isSubsonic = 'type' in collConfig && collConfig.type === 'subsonic';
      if (!isSubsonic && collConfig.path && !existsSync(collConfig.path)) {
        out.result(
          {
            success: false,
            dryRun,
            source: collConfig.path,
            error: `Source directory not found: ${collConfig.path}`,
          },
          () => {
            out.error(`Source directory not found: ${collConfig.path}`);
            out.error(`  Collection: ${collection.name} (${collection.type})`);
          }
        );
        process.exitCode = 1;
        return;
      }
    }

    // ----- Load dependencies dynamically -----
    let core: typeof import('@podkit/core');

    try {
      core = await import('@podkit/core');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      out.result(errorOutput(message), () => {
        out.error('Failed to load podkit-core.');
        if (out.isVerbose) {
          out.error(`Details: ${message}`);
        }
      });
      process.exitCode = 1;
      return;
    }

    // ----- Resolve device path -----
    const manager = core.getDeviceManager();
    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (deviceIdentity?.volumeUuid) {
      out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
    }

    const resolved = await resolveDevicePath({
      cliDevice: cliPath,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
    });

    if (!resolved.path) {
      out.result(errorOutput(resolved.error ?? formatDeviceError(resolved)), () =>
        out.error(resolved.error ?? formatDeviceError(resolved))
      );
      process.exitCode = 1;
      return;
    }

    const devicePath = resolved.path;

    if (!existsSync(devicePath)) {
      out.result(
        {
          success: false,
          dryRun,
          device: devicePath,
          error: `Device path not found: ${devicePath}`,
        },
        () => {
          out.error(`iPod not found at: ${devicePath}`);
          out.error('');
          out.error('Make sure the iPod is connected and mounted.');
        }
      );
      process.exitCode = 1;
      return;
    }

    // ----- Check FFmpeg availability -----
    const transcoder = core.createFFmpegTranscoder();
    try {
      await transcoder.detect();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'FFmpeg not found';
      out.result(
        { success: false, dryRun, device: devicePath, error: `FFmpeg not available: ${message}` },
        () => {
          out.error('FFmpeg not found or not functional.');
          out.error('');
          out.error('Install FFmpeg:');
          out.error('  macOS: brew install ffmpeg');
          out.error('  Ubuntu: apt install ffmpeg');
          if (out.isVerbose) {
            out.error('');
            out.error(`Details: ${message}`);
          }
        }
      );
      process.exitCode = 1;
      return;
    }

    // ----- Open iPod database -----
    const dbSpinner = out.spinner('Opening iPod database...');

    let ipod: Awaited<ReturnType<typeof core.IpodDatabase.open>>;
    try {
      ipod = await core.IpodDatabase.open(devicePath);
    } catch (err) {
      dbSpinner.stop();
      const isIpodError = err instanceof core.IpodError;
      const message = err instanceof Error ? err.message : 'Failed to open iPod database';
      out.result(
        { success: false, dryRun, device: devicePath, error: `Failed to open iPod: ${message}` },
        () => {
          out.error(`Cannot read iPod database at: ${devicePath}`);
          out.error('');
          if (isIpodError) {
            out.error('This path does not appear to be a valid iPod:');
            out.error('  - Missing iTunesDB file');
            out.error('  - Database may be corrupted');
          } else {
            out.error(`Error: ${message}`);
          }
          if (out.isVerbose) {
            out.error('');
            out.error(`Details: ${message}`);
          }
        }
      );
      process.exitCode = 1;
      return;
    }

    dbSpinner.stop('iPod database opened');

    // ----- Pre-flight device validation -----
    const ipodDeviceInfo = ipod.getInfo().device;
    if (ipodDeviceInfo) {
      const deviceValidation = core.validateDevice(ipodDeviceInfo, devicePath);

      // Block sync for unsupported devices
      if (!deviceValidation.supported) {
        const messages = core.formatValidationMessages(deviceValidation);
        out.result({ success: false, dryRun, device: devicePath, error: messages[0] }, () => {
          out.newline();
          for (const msg of messages) {
            out.print(msg);
          }
        });
        ipod.close();
        process.exitCode = 1;
        return;
      }

      // Show warnings for unknown model
      for (const issue of deviceValidation.issues) {
        out.warn(issue.message);
        if (issue.suggestion) {
          out.print(`  ${issue.suggestion}`);
        }
      }
    }

    // Determine ALAC capability from device generation
    const deviceSupportsAlac = ipodDeviceInfo?.generation
      ? core.supportsAlac(ipodDeviceInfo.generation)
      : false;

    // Track overall results
    let totalCompleted = 0;
    let totalFailed = 0;
    let anyError = false;
    let totalArtworkMissingBaseline = 0;

    try {
      // ----- Sync Music Collections -----
      if (hasMusicToSync) {
        for (const collection of musicCollections) {
          const sourcePath = (collection.config as MusicCollectionConfig).path;

          if (musicCollections.length > 1) {
            out.newline();
            out.print(`=== Music: ${collection.name} ===`);
          }

          const result = await syncMusicCollection({
            out,
            collection,
            sourcePath,
            devicePath,
            dryRun,
            removeOrphans,
            effectiveTransforms,
            effectiveQuality,
            effectiveEncoding,
            effectiveCustomBitrate,
            effectiveBitrateTolerance,
            deviceSupportsAlac,
            effectiveArtwork,
            skipUpgrades: effectiveSkipUpgrades,
            forceTranscode: options.forceTranscode ?? config.forceTranscode ?? false,
            forceSyncTags: options.forceSyncTags ?? config.forceSyncTags ?? false,
            checkArtwork:
              options.checkArtwork ?? getEffectiveCheckArtwork(config.checkArtwork, deviceConfig),
            ipod,
            transcoder,
            core,
          });

          if (result.jsonOutput && out.isJson) {
            out.json(result.jsonOutput);
          }

          totalCompleted += result.completed;
          totalFailed += result.failed;
          totalArtworkMissingBaseline += result.artworkMissingBaseline ?? 0;
          if (!result.success) {
            anyError = true;
          }
        }
      }

      // ----- Sync Video Collections -----
      if (hasVideoToSync) {
        const ipodInfo = ipod.getInfo();
        const supportsVideo = ipodInfo.device?.supportsVideo ?? false;

        if (!supportsVideo) {
          const explicitVideo = syncType === 'video';
          out.newline();
          if (explicitVideo) {
            out.warn('This iPod does not support video playback. No video files will be synced.');
          } else {
            out.print('Skipping video: device does not support video playback.');
          }
        } else {
          for (const collection of videoCollections) {
            const sourcePath = (collection.config as VideoCollectionConfig).path;

            out.newline();
            out.print(`=== Video: ${collection.name} ===`);

            const result = await syncVideoCollection({
              out,
              collection,
              sourcePath,
              devicePath,
              dryRun,
              removeOrphans,
              effectiveVideoQuality,
              ipod,
              core,
            });

            totalCompleted += result.completed;
            totalFailed += result.failed;
            if (!result.success) {
              anyError = true;
            }
          }

          // Save database after video sync (not in dry-run)
          if (!dryRun) {
            ipod.save();
          }
        }
      }

      // Final summary
      const duration = (Date.now() - startTime) / 1000;
      const syncSucceeded = !dryRun && totalFailed === 0 && !anyError;

      if (!dryRun) {
        out.newline();
        out.print('=== Summary ===');
        out.newline();
        if (totalFailed > 0) {
          out.print(
            `Synced ${formatNumber(totalCompleted)} items (${formatNumber(totalFailed)} failed)`
          );
        } else if (totalCompleted > 0) {
          out.print(`Synced ${formatNumber(totalCompleted)} items successfully`);
        } else {
          out.print('Everything already in sync!');
        }
        out.print(`Duration: ${formatDuration(duration)}`);
      }

      // JSON output for actual sync completion
      if (!dryRun && out.isJson) {
        let ejectInfo: SyncOutput['eject'];
        if (options.eject && syncSucceeded) {
          const ejectResult = await manager.eject(devicePath, { force: false });
          ejectInfo = {
            requested: true,
            success: ejectResult.success,
            error: ejectResult.error,
          };
        }

        out.json({
          success: totalFailed === 0 && !anyError,
          dryRun: false,
          result: {
            completed: totalCompleted,
            failed: totalFailed,
            skipped: 0,
            bytesTransferred: 0,
            duration,
          },
          eject: ejectInfo,
        });
      }

      if (dryRun) {
        out.newline();
        out.print('Run without --dry-run to execute this plan.');
      }

      // Show artwork baseline tip at end of sync
      if (totalArtworkMissingBaseline > 0) {
        out.printTips({ artworkMissingBaseline: totalArtworkMissingBaseline });
      }

      // Show eject tip or auto-eject on successful sync
      if (syncSucceeded && out.isText) {
        if (options.eject) {
          out.newline();
          out.print('Ejecting iPod...');
          const ejectResult = await manager.eject(devicePath, { force: false });
          if (ejectResult.success) {
            out.print('iPod ejected. Safe to disconnect.');
          } else {
            out.print('Could not eject iPod automatically.');
            if (ejectResult.error) {
              out.print(`  ${ejectResult.error}`);
            }
            out.print('  Run: podkit eject --force');
          }
        } else {
          out.newline();
          out.tip("Run 'podkit eject' to safely disconnect, or use --eject next time.");
        }
      }

      if (totalFailed > 0 || anyError) {
        process.exitCode = 1;
      }
    } finally {
      ipod.close();
    }
  });
