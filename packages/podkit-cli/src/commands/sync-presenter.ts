/**
 * ContentTypePresenter pattern for CLI sync functions
 *
 * Each presenter encapsulates content-type-specific presentation/configuration
 * differences, allowing a single generic syncCollection function to handle
 * both music and video sync.
 *
 * @module
 */

import type {
  QualityPreset,
  TransformsConfig,
  VideoQualityPreset,
  VideoTransformsConfig,
  MusicCollectionConfig,
} from '../config/index.js';
import type {
  CollectionTrack,
  CollectionVideo,
  IPodTrack,
  SyncDiff,
  SyncPlan,
  SyncOperation,
  VideoSyncDiff,
  EncodingMode,
} from '@podkit/core';
import type { IPodVideo } from '@podkit/core';
import type { OutputContext, CollectedError } from '../output/index.js';
import {
  formatBytes,
  formatNumber,
  formatCollectionLabel,
  formatUpdateReason,
  formatErrors,
  buildTransformPreview,
} from '../output/index.js';
import {
  formatOverallLine,
  formatCurrentLineWithBar,
  formatCurrentLineText,
  DualProgressDisplay,
} from '../utils/progress.js';
import { createMusicAdapter } from '../utils/source-adapter.js';
import type {
  SyncOutput,
  PlanWarningInfo,
  ScanWarningInfo,
  TransformInfo,
  UpdateBreakdown,
} from './sync.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Resolved collection information (matches the type in sync.ts)
 */
interface ResolvedCollection {
  name: string;
  type: 'music' | 'video';
  config: MusicCollectionConfig | import('../config/index.js').VideoCollectionConfig;
}

/**
 * Music-specific configuration passed through the presenter context
 */
export interface MusicContentConfig {
  type: 'music';
  effectiveTransforms: TransformsConfig;
  effectiveQuality: QualityPreset;
  effectiveEncoding: EncodingMode | undefined;
  effectiveCustomBitrate: number | undefined;
  effectiveBitrateTolerance: number | undefined;
  deviceSupportsAlac: boolean;
  effectiveArtwork: boolean;
  skipUpgrades: boolean;
  forceTranscode: boolean;
  forceSyncTags: boolean;
  forceMetadata: boolean;
  checkArtwork: boolean;
  transcoder: ReturnType<typeof import('@podkit/core').createFFmpegTranscoder>;
}

/**
 * Video-specific configuration passed through the presenter context
 */
export interface VideoContentConfig {
  type: 'video';
  effectiveVideoQuality: VideoQualityPreset;
  effectiveVideoTransforms: VideoTransformsConfig;
  forceMetadata: boolean;
}

/**
 * Result from the generic syncCollection function
 *
 * @internal Exported for testing only
 */
export interface GenericSyncResult {
  success: boolean;
  completed: number;
  failed: number;
  interrupted?: boolean;
  jsonOutput?: SyncOutput;
  artworkMissingBaseline?: number;
}

// =============================================================================
// Utility Functions (shared by presenters)
// =============================================================================

/**
 * Format duration in seconds as human-readable time
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${minutes}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

/**
 * Get storage information for a mount point
 */
function getStorageInfo(
  mountpoint: string,
  statfsSync: (path: string) => { blocks: number; bsize: number; bfree: number }
): { total: number; free: number; used: number } | null {
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

/**
 * Format transforms configuration for display
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

/**
 * Format video transforms configuration for display
 */
function formatVideoTransformsConfig(videoTransforms: VideoTransformsConfig): string | null {
  const parts: string[] = [];

  if (videoTransforms.showLanguage.enabled) {
    const expandStr = videoTransforms.showLanguage.expand ? ', expand' : '';
    parts.push(
      `Show language: enabled (format: "${videoTransforms.showLanguage.format}"${expandStr})`
    );
  }

  return parts.length > 0 ? parts.join(', ') : null;
}

// =============================================================================
// ContentTypePresenter Interface
// =============================================================================

/**
 * CLI-level presenter interface that encapsulates content-type-specific
 * presentation, configuration, and orchestration differences.
 *
 * The generic syncCollection function delegates all content-type-specific
 * decisions to the presenter, keeping the main flow content-type-agnostic.
 */
export interface ContentTypePresenter<TSource, TDevice> {
  /** Content type identifier */
  readonly type: 'music' | 'video';
  /** Noun for items (e.g., 'tracks', 'videos') */
  readonly itemNoun: string;
  /** Section title (e.g., 'Music', 'Video') */
  readonly sectionTitle: string;

  /** Create the source adapter and set up spinner + scan warnings collector */
  createAdapter(
    out: OutputContext,
    collection: ResolvedCollection,
    sourcePath: string,
    contentConfig: MusicContentConfig | VideoContentConfig,
    core: typeof import('@podkit/core')
  ): {
    adapter: {
      connect(): Promise<void>;
      disconnect(): Promise<void>;
      getItems(): Promise<TSource[]>;
    };
    scanWarnings: Array<{ file: string; message: string }>;
    spinner: { stop(msg?: string): void; update(msg: string): void };
  };

  /** Format the scan result for spinner stop message */
  formatScanResult(items: TSource[]): string;

  /** Display scan warnings (if any) */
  displayScanWarnings(
    out: OutputContext,
    scanWarnings: Array<{ file: string; message: string }>
  ): void;

  /** Get device items of this content type from the iPod */
  getDeviceItems(ipod: any, core: typeof import('@podkit/core')): TDevice[];

  /** Compute the diff between source and device items */
  computeDiff(
    sourceItems: TSource[],
    deviceItems: TDevice[],
    contentConfig: MusicContentConfig | VideoContentConfig,
    ipod: any,
    core: typeof import('@podkit/core')
  ): { toAdd: TSource[]; toRemove: TDevice[]; toUpdate: any[]; existing: any[] };

  /** Collect post-diff data (e.g., artworkMissingBaseline for music) */
  collectPostDiffData?(
    diff: any,
    contentConfig: MusicContentConfig | VideoContentConfig,
    core: typeof import('@podkit/core')
  ): Record<string, unknown>;

  /** Create a sync plan from the diff */
  createPlan(
    diff: any,
    removeOrphans: boolean,
    contentConfig: MusicContentConfig | VideoContentConfig,
    ipod: any,
    core: typeof import('@podkit/core')
  ): { plan: any; summary: any };

  /** Check if the plan fits in available space */
  willFit(plan: any, freeSpace: number, core: typeof import('@podkit/core')): boolean;

  /** Render dry-run text output */
  renderDryRunText(
    out: OutputContext,
    sourcePath: string,
    devicePath: string,
    diff: any,
    plan: any,
    summary: any,
    storage: { total: number; free: number; used: number } | null,
    hasEnoughSpace: boolean,
    removeOrphans: boolean,
    contentConfig: MusicContentConfig | VideoContentConfig,
    core: typeof import('@podkit/core'),
    scanWarnings: Array<{ file: string; message: string }>,
    sourceItems: TSource[]
  ): void;

  /** Build dry-run JSON output */
  buildDryRunJson(
    out: OutputContext,
    sourcePath: string,
    devicePath: string,
    diff: any,
    plan: any,
    summary: any,
    removeOrphans: boolean,
    contentConfig: MusicContentConfig | VideoContentConfig,
    core: typeof import('@podkit/core'),
    scanWarnings: Array<{ file: string; message: string }>,
    sourceItems: TSource[]
  ): SyncOutput;

  /** Format the "already in sync" message */
  formatAlreadySynced(out: OutputContext, sourceCount: number, deviceCount: number): void;

  /** Render the execution header */
  renderExecutionHeader(out: OutputContext, plan: any, summary: any): void;

  /** Execute the sync plan, handling all execution logic including progress display */
  executeSync(
    out: OutputContext,
    plan: any,
    adapter: {
      connect(): Promise<void>;
      disconnect(): Promise<void>;
      getItems(): Promise<TSource[]>;
    },
    contentConfig: MusicContentConfig | VideoContentConfig,
    ipod: any,
    core: typeof import('@podkit/core'),
    signal?: AbortSignal
  ): Promise<{
    completed: number;
    failed: number;
    interrupted?: boolean;
    collectedErrors: CollectedError[];
  }>;

  /** Render completion (errors, etc.) */
  renderCompletion(out: OutputContext, errors: CollectedError[]): void;
}

// =============================================================================
// MusicPresenter
// =============================================================================

/**
 * Presenter for music content type.
 */
export class MusicPresenter implements ContentTypePresenter<CollectionTrack, IPodTrack> {
  readonly type = 'music' as const;
  readonly itemNoun = 'tracks';
  readonly sectionTitle = 'Music';

  createAdapter(
    out: OutputContext,
    collection: ResolvedCollection,
    sourcePath: string,
    contentConfig: MusicContentConfig | VideoContentConfig,
    _core: typeof import('@podkit/core')
  ) {
    const config = contentConfig as MusicContentConfig;
    const collectionConfig = collection.config as MusicCollectionConfig;
    const collectionLabel = formatCollectionLabel(collection.name, sourcePath, out.isVerbose);
    const scanWarnings: Array<{ file: string; message: string }> = [];

    const spinner = out.spinner(`Scanning music collection${collectionLabel}...`);

    const adapter = createMusicAdapter({
      config: collectionConfig,
      name: collection.name,
      checkArtwork: config.checkArtwork,
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

    return { adapter, scanWarnings, spinner };
  }

  formatScanResult(items: CollectionTrack[]): string {
    return `Found ${formatNumber(items.length)} tracks in source`;
  }

  displayScanWarnings(
    out: OutputContext,
    scanWarnings: Array<{ file: string; message: string }>
  ): void {
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
  }

  getDeviceItems(ipod: any, core: typeof import('@podkit/core')): IPodTrack[] {
    return ipod.getTracks().filter((t: any) => core.isMusicMediaType(t.mediaType));
  }

  computeDiff(
    sourceItems: CollectionTrack[],
    deviceItems: IPodTrack[],
    contentConfig: MusicContentConfig | VideoContentConfig,
    _ipod: any,
    core: typeof import('@podkit/core')
  ) {
    const config = contentConfig as MusicContentConfig;
    const isAlacPreset = config.effectiveQuality === 'max' && config.deviceSupportsAlac;
    const resolvedQuality = isAlacPreset
      ? 'lossless'
      : config.effectiveQuality === 'max'
        ? 'high'
        : config.effectiveQuality;

    return core.computeMusicDiff(sourceItems, deviceItems, {
      transforms: config.effectiveTransforms,
      skipUpgrades: config.skipUpgrades,
      forceTranscode: config.forceTranscode,
      forceSyncTags: config.forceSyncTags,
      forceMetadata: config.forceMetadata,
      transcodingActive: true,
      presetBitrate: core.getPresetBitrate(config.effectiveQuality),
      encodingMode: config.effectiveEncoding,
      bitrateTolerance: config.effectiveBitrateTolerance,
      isAlacPreset,
      resolvedQuality,
      customBitrate: config.effectiveCustomBitrate,
    });
  }

  collectPostDiffData(
    diff: SyncDiff,
    contentConfig: MusicContentConfig | VideoContentConfig,
    core: typeof import('@podkit/core')
  ) {
    const config = contentConfig as MusicContentConfig;
    let artworkMissingBaseline = 0;
    if (config.checkArtwork) {
      for (const match of diff.existing) {
        if (match.ipod.hasArtwork === true) {
          const syncTag = core.parseSyncTag(match.ipod.comment);
          if (!syncTag?.artworkHash) {
            artworkMissingBaseline++;
          }
        }
      }
    }
    return { artworkMissingBaseline };
  }

  createPlan(
    diff: SyncDiff,
    removeOrphans: boolean,
    contentConfig: MusicContentConfig | VideoContentConfig,
    _ipod: any,
    core: typeof import('@podkit/core')
  ) {
    const config = contentConfig as MusicContentConfig;
    const transcodeConfig = {
      quality: config.effectiveQuality,
      encoding: config.effectiveEncoding,
      customBitrate: config.effectiveCustomBitrate,
    };
    const plan = core.createMusicPlan(diff, {
      removeOrphans,
      transcodeConfig,
      deviceSupportsAlac: config.deviceSupportsAlac,
      artworkEnabled: config.effectiveArtwork,
    });
    const summary = core.getMusicPlanSummary(plan);
    return { plan, summary };
  }

  willFit(plan: SyncPlan, freeSpace: number, core: typeof import('@podkit/core')): boolean {
    return core.willMusicFitInSpace(plan, freeSpace);
  }

  renderDryRunText(
    out: OutputContext,
    sourcePath: string,
    devicePath: string,
    diff: SyncDiff,
    plan: SyncPlan,
    summary: any,
    storage: { total: number; free: number; used: number } | null,
    hasEnoughSpace: boolean,
    removeOrphans: boolean,
    contentConfig: MusicContentConfig | VideoContentConfig,
    core: typeof import('@podkit/core'),
    _scanWarnings: Array<{ file: string; message: string }>
  ): void {
    const config = contentConfig as MusicContentConfig;

    out.newline();
    out.print('=== Music Sync Plan (Dry Run) ===');
    out.newline();
    out.print(`Source: ${sourcePath}`);
    out.print(`Device: ${devicePath}`);
    out.print(`Quality: ${config.effectiveQuality}`);
    const transformsDisplay = formatTransformsConfig(config.effectiveTransforms);
    if (transformsDisplay) {
      out.print(`Transforms: ${transformsDisplay}`);
    }
    if (config.skipUpgrades) {
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
    if (diff.toAdd.length > 0) {
      const withSoundcheck = diff.toAdd.filter((t) => t.soundcheck !== undefined).length;
      out.print(
        `  Sound Check: ${formatNumber(withSoundcheck)}/${formatNumber(diff.toAdd.length)} tracks have normalization data`
      );
    }
    out.newline();

    // Transform preview
    if (config.effectiveTransforms.cleanArtists.enabled) {
      const tracksToTransform = [
        ...diff.toAdd,
        ...diff.toUpdate.filter((u) => u.reason === 'transform-apply').map((u) => u.source),
      ];
      if (tracksToTransform.length > 0) {
        const preview = buildTransformPreview(
          tracksToTransform,
          config.effectiveTransforms,
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
          out.print(`  ${symbol} [${typeStr}] ${core.getMusicOperationDisplayName(op)}`);
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

  buildDryRunJson(
    out: OutputContext,
    sourcePath: string,
    devicePath: string,
    diff: SyncDiff,
    plan: SyncPlan,
    summary: any,
    removeOrphans: boolean,
    contentConfig: MusicContentConfig | VideoContentConfig,
    core: typeof import('@podkit/core'),
    scanWarnings: Array<{ file: string; message: string }>,
    _sourceItems: CollectionTrack[]
  ): SyncOutput {
    const config = contentConfig as MusicContentConfig;

    const operations: SyncOutput['operations'] = plan.operations.map((op: SyncOperation) => {
      const base = {
        type: op.type,
        track: core.getMusicOperationDisplayName(op),
        status: 'pending' as const,
      };
      if (op.type === 'update-metadata') {
        const updateInfo = diff.toUpdate.find(
          (u) => u.ipod.title === op.track.title && u.ipod.artist === op.track.artist
        );
        if (updateInfo) {
          return {
            ...base,
            changes: updateInfo.changes.map((c: any) => ({
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

    const planWarningInfos: PlanWarningInfo[] = plan.warnings.map((warning: any) => ({
      type: warning.type,
      message: warning.message,
      trackCount: warning.tracks.length,
      tracks: out.isVerbose
        ? warning.tracks.map((t: any) => `${t.artist} - ${t.title}`)
        : undefined,
    }));

    const scanWarningInfos: ScanWarningInfo[] = scanWarnings.map((warning) => ({
      file: warning.file,
      message: warning.message,
    }));

    const transformsInfo: TransformInfo[] = [];
    if (config.effectiveTransforms.cleanArtists.enabled) {
      transformsInfo.push({
        name: 'cleanArtists',
        enabled: true,
        mode: config.effectiveTransforms.cleanArtists.drop ? 'drop' : 'move',
        format: config.effectiveTransforms.cleanArtists.drop
          ? undefined
          : config.effectiveTransforms.cleanArtists.format,
      });
    }

    const updateBreakdown: UpdateBreakdown = {};
    for (const update of diff.toUpdate) {
      const count = updateBreakdown[update.reason as keyof UpdateBreakdown] ?? 0;
      updateBreakdown[update.reason as keyof UpdateBreakdown] = count + 1;
    }

    let albumCount: number | undefined;
    let artistCount: number | undefined;
    if (diff.toAdd.length > 0) {
      const uniqueAlbums = new Set(diff.toAdd.map((t) => t.album).filter(Boolean));
      const uniqueArtists = new Set(
        diff.toAdd.map((t) => t.albumArtist || t.artist).filter(Boolean)
      );
      albumCount = uniqueAlbums.size;
      artistCount = uniqueArtists.size;
    }

    return {
      success: true,
      dryRun: true,
      source: sourcePath,
      device: devicePath,
      transforms: transformsInfo.length > 0 ? transformsInfo : undefined,
      skipUpgrades: config.skipUpgrades || undefined,
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
        albumCount,
        artistCount,
      },
      operations,
      planWarnings: planWarningInfos.length > 0 ? planWarningInfos : undefined,
      scanWarnings: scanWarningInfos.length > 0 ? scanWarningInfos : undefined,
    };
  }

  formatAlreadySynced(out: OutputContext, sourceCount: number, deviceCount: number): void {
    out.newline();
    out.print('Music already in sync! No changes needed.');
    out.print(`  Source tracks: ${formatNumber(sourceCount)}`);
    out.print(`  iPod tracks: ${formatNumber(deviceCount)}`);
  }

  renderExecutionHeader(out: OutputContext, plan: SyncPlan): void {
    out.newline();
    out.print('=== Syncing Music ===');
    out.newline();
    out.print(`Tracks to process: ${formatNumber(plan.operations.length)}`);
    out.print(`Estimated size: ${formatBytes(plan.estimatedSize)}`);
    out.print(`Estimated time: ~${formatDuration(plan.estimatedTime)}`);
    out.newline();
  }

  async executeSync(
    out: OutputContext,
    plan: SyncPlan,
    adapter: any,
    contentConfig: MusicContentConfig | VideoContentConfig,
    ipod: any,
    core: typeof import('@podkit/core'),
    signal?: AbortSignal
  ) {
    const config = contentConfig as MusicContentConfig;
    const collectedErrors: CollectedError[] = [];
    let completed = 0;
    let failed = 0;

    const executor = new core.MusicExecutor({ ipod, transcoder: config.transcoder });
    const musicDisplay = new DualProgressDisplay((content) => out.raw(content));

    try {
      for await (const progress of executor.execute(plan, {
        dryRun: false,
        continueOnError: true,
        artwork: config.effectiveArtwork,
        adapter,
        signal,
        syncTagConfig: {
          encodingMode: config.effectiveEncoding,
          customBitrate: config.effectiveCustomBitrate,
        },
      })) {
        if (progress.error) {
          const categorized = progress.categorizedError;
          collectedErrors.push({
            trackName:
              categorized?.trackName ?? core.getMusicOperationDisplayName(progress.operation),
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
          musicDisplay.finish();
          out.print('Music sync complete!');
        } else if (progress.phase === 'updating-db') {
          musicDisplay.finish();
          out.raw('Saving iPod database...');
        } else if (progress.phase !== 'preparing') {
          const overallLine = formatOverallLine(completed, progress.total, 'tracks');
          const phaseStr =
            progress.phase === 'updating-metadata'
              ? 'Updating metadata'
              : progress.phase.charAt(0).toUpperCase() + progress.phase.slice(1);
          const currentLine = formatCurrentLineText({
            phase: phaseStr,
            trackName: progress.currentTrack,
          });
          musicDisplay.update(overallLine, currentLine);
        }
      }
    } catch (err) {
      if (signal?.aborted) {
        musicDisplay.finish();
        return { completed, failed, interrupted: true, collectedErrors };
      }
      throw err;
    }

    return { completed, failed, collectedErrors };
  }

  renderCompletion(out: OutputContext, errors: CollectedError[]): void {
    if (errors.length > 0) {
      const errorLines = formatErrors(errors, out.verbosity);
      for (const line of errorLines) {
        out.print(line);
      }
    }
  }
}

// =============================================================================
// VideoPresenter
// =============================================================================

/**
 * Presenter for video content type.
 */
export class VideoPresenter implements ContentTypePresenter<CollectionVideo, IPodVideo> {
  readonly type = 'video' as const;
  readonly itemNoun = 'videos';
  readonly sectionTitle = 'Video';

  createAdapter(
    out: OutputContext,
    collection: ResolvedCollection,
    sourcePath: string,
    _contentConfig: MusicContentConfig | VideoContentConfig,
    core: typeof import('@podkit/core')
  ) {
    const collectionLabel = formatCollectionLabel(collection.name, sourcePath, out.isVerbose);
    const scanWarnings: Array<{ file: string; message: string }> = [];

    const spinner = out.spinner(`Scanning video collection${collectionLabel}...`);

    const adapter = core.createVideoDirectoryAdapter({
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

    return { adapter, scanWarnings, spinner };
  }

  formatScanResult(items: CollectionVideo[]): string {
    const movieCount = items.filter((v) => v.contentType === 'movie').length;
    const tvShowCount = items.filter((v) => v.contentType === 'tvshow').length;
    return `Found ${formatNumber(items.length)} videos (${movieCount} movies, ${tvShowCount} TV episodes)`;
  }

  displayScanWarnings(): void {
    // Video doesn't display scan warnings in the current implementation
  }

  getDeviceItems(ipod: any, core: typeof import('@podkit/core')): IPodVideo[] {
    const handler = core.createVideoHandler();
    return handler.getDeviceItems(ipod);
  }

  /** Stored during computeDiff for use in createPlan */
  private _deviceProfile: any;

  computeDiff(
    sourceItems: CollectionVideo[],
    deviceItems: IPodVideo[],
    contentConfig: MusicContentConfig | VideoContentConfig,
    ipod: any,
    core: typeof import('@podkit/core')
  ) {
    const config = contentConfig as VideoContentConfig;
    const ipodDevice = ipod.getInfo().device;
    const deviceProfile = core.getDeviceProfileByGeneration(ipodDevice.generation);
    this._deviceProfile = deviceProfile;

    const videoPresetSettings = core.getPresetSettingsWithFallback(
      deviceProfile.name,
      config.effectiveVideoQuality
    );
    const videoPresetBitrate = videoPresetSettings.videoBitrate + videoPresetSettings.audioBitrate;

    return core.diffVideos(sourceItems, deviceItems, {
      presetBitrate: videoPresetBitrate,
      resolvedVideoQuality: config.effectiveVideoQuality,
      videoTransforms: config.effectiveVideoTransforms,
      forceMetadata: config.forceMetadata,
    });
  }

  createPlan(
    diff: VideoSyncDiff,
    removeOrphans: boolean,
    contentConfig: MusicContentConfig | VideoContentConfig,
    _ipod: any,
    core: typeof import('@podkit/core')
  ) {
    const config = contentConfig as VideoContentConfig;
    const plan = core.planVideoSync(diff, {
      deviceProfile: this._deviceProfile,
      qualityPreset: config.effectiveVideoQuality,
      removeOrphans,
      useHardwareAcceleration: true,
      videoTransforms: config.effectiveVideoTransforms,
    });
    const summary = core.getVideoPlanSummary(plan);
    return { plan, summary };
  }

  willFit(plan: SyncPlan, freeSpace: number, core: typeof import('@podkit/core')): boolean {
    return core.willVideoPlanFit(plan, freeSpace);
  }

  renderDryRunText(
    out: OutputContext,
    sourcePath: string,
    devicePath: string,
    diff: VideoSyncDiff,
    plan: SyncPlan,
    summary: any,
    _storage: { total: number; free: number; used: number } | null,
    _hasEnoughSpace: boolean,
    removeOrphans: boolean,
    contentConfig: MusicContentConfig | VideoContentConfig,
    core: typeof import('@podkit/core'),
    _scanWarnings: Array<{ file: string; message: string }>,
    sourceItems: CollectionVideo[]
  ): void {
    const config = contentConfig as VideoContentConfig;

    const movieCount = sourceItems.filter((v) => v.contentType === 'movie').length;
    const tvShowCount = sourceItems.filter((v) => v.contentType === 'tvshow').length;

    // Use handler for dry-run summary (for consistent estimated size/time)
    const handler = core.createVideoHandler();
    const dryRunSummary = handler.formatDryRun(plan);

    out.newline();
    out.print('=== Video Sync Plan (Dry Run) ===');
    out.newline();
    out.print(`Source: ${sourcePath}`);
    out.print(`Device: ${devicePath}`);
    out.print(`Quality: ${config.effectiveVideoQuality}`);
    const videoTransformsDisplay = formatVideoTransformsConfig(config.effectiveVideoTransforms);
    if (videoTransformsDisplay) {
      out.print(`Transforms: ${videoTransformsDisplay}`);
    }
    out.newline();
    out.print('Collection:');
    out.print(`  Total videos: ${formatNumber(sourceItems.length)}`);
    out.print(`    - Movies: ${formatNumber(movieCount)}`);
    out.print(`    - TV Shows: ${formatNumber(tvShowCount)}`);
    out.newline();
    out.print('Changes:');
    out.print(`  Videos to add: ${formatNumber(diff.toAdd.length)}`);
    if (summary.transcodeCount > 0) {
      out.print(`    - Transcode: ${formatNumber(summary.transcodeCount)}`);
    }
    if (summary.copyCount > 0) {
      out.print(`    - Passthrough: ${formatNumber(summary.copyCount)}`);
    }
    if (removeOrphans && diff.toRemove.length > 0) {
      out.print(`  Videos to remove: ${formatNumber(diff.toRemove.length)}`);
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
        `  Videos to update: ${formatNumber(diff.toUpdate.length)} (${reasonParts.join(', ')})`
      );
    }
    out.newline();
    out.print('Estimates:');
    out.print(`  Size: ${formatBytes(dryRunSummary.estimatedSize)}`);
    out.print(`  Time: ~${formatDuration(dryRunSummary.estimatedTime)}`);
    out.newline();
  }

  buildDryRunJson(
    _out: OutputContext,
    sourcePath: string,
    devicePath: string,
    diff: VideoSyncDiff,
    plan: SyncPlan,
    summary: any,
    removeOrphans: boolean,
    _contentConfig: MusicContentConfig | VideoContentConfig,
    core: typeof import('@podkit/core'),
    _scanWarnings: Array<{ file: string; message: string }>,
    _sourceItems: CollectionVideo[]
  ): SyncOutput {
    const handler = core.createVideoHandler();
    const dryRunSummary = handler.formatDryRun(plan);

    const moviesToAdd = diff.toAdd.filter((v) => v.contentType === 'movie').length;
    const showsToAdd = diff.toAdd.filter((v) => v.contentType === 'tvshow');
    const uniqueShows = new Set(showsToAdd.map((v) => v.seriesTitle).filter(Boolean));

    const videoOperations: NonNullable<SyncOutput['operations']> = dryRunSummary.operations.map(
      (op) => ({
        type: op.type as
          | 'video-transcode'
          | 'video-copy'
          | 'video-remove'
          | 'video-update-metadata'
          | 'video-upgrade',
        track: op.displayName,
        status: 'pending' as const,
      })
    );

    return {
      success: true,
      dryRun: true,
      source: sourcePath,
      device: devicePath,
      plan: {
        tracksToAdd: diff.toAdd.length,
        tracksToRemove: removeOrphans ? diff.toRemove.length : 0,
        tracksToUpdate: diff.toUpdate.length,
        tracksToUpgrade: 0,
        tracksToTranscode: summary.transcodeCount,
        tracksToCopy: summary.copyCount,
        tracksExisting: diff.existing.length,
        estimatedSize: dryRunSummary.estimatedSize,
        estimatedTime: dryRunSummary.estimatedTime,
        videoSummary:
          diff.toAdd.length > 0
            ? {
                movieCount: moviesToAdd,
                showCount: uniqueShows.size,
                episodeCount: showsToAdd.length,
              }
            : undefined,
      },
      operations: videoOperations,
    };
  }

  formatAlreadySynced(out: OutputContext): void {
    out.print('Videos already in sync! No changes needed.');
  }

  renderExecutionHeader(out: OutputContext, plan: SyncPlan, summary: any): void {
    out.newline();
    out.print(`Videos to process: ${formatNumber(plan.operations.length)}`);
    out.print(`  - Transcode: ${formatNumber(summary.transcodeCount)}`);
    out.print(`  - Passthrough: ${formatNumber(summary.copyCount)}`);
    out.print(`Estimated size: ${formatBytes(plan.estimatedSize)}`);
    out.newline();
  }

  async executeSync(
    out: OutputContext,
    plan: SyncPlan,
    _adapter: any,
    contentConfig: MusicContentConfig | VideoContentConfig,
    ipod: any,
    core: typeof import('@podkit/core'),
    signal?: AbortSignal
  ) {
    const config = contentConfig as VideoContentConfig;
    let videoCompleted = 0;
    let lastIndex = -1;
    const videoDisplay = new DualProgressDisplay((content) => out.raw(content));

    const handler = core.createVideoHandler();
    handler.setVideoQuality(config.effectiveVideoQuality);

    const videoExecutor = core.createSyncExecutor(handler);

    try {
      for await (const progress of videoExecutor.execute(plan, {
        dryRun: false,
        ipod,
        signal,
      })) {
        if (progress.skipped) {
          // Skip tracking for skipped operations
        } else if (
          progress.phase !== 'preparing' &&
          progress.phase !== 'complete' &&
          progress.index !== lastIndex
        ) {
          videoCompleted++;
          lastIndex = progress.index;
        }

        const overallLine = formatOverallLine(videoCompleted, progress.total, 'videos');

        if (progress.transcodeProgress) {
          const currentLine = formatCurrentLineWithBar({
            percent: progress.transcodeProgress.percent,
            phase: 'Transcoding',
            trackName: progress.currentTrack,
            speed: progress.transcodeProgress.speed,
          });
          videoDisplay.update(overallLine, currentLine);
        } else {
          const displayName = handler.getDisplayName(progress.operation);
          const phaseStr = progress.phase.replace('video-', '');
          const phaseFormatted =
            phaseStr === 'updating-metadata'
              ? 'Updating metadata'
              : phaseStr.charAt(0).toUpperCase() + phaseStr.slice(1);
          const currentLine = formatCurrentLineText({
            phase: phaseFormatted,
            trackName: displayName,
          });
          videoDisplay.update(overallLine, currentLine);
        }
      }
    } catch (err) {
      if (signal?.aborted) {
        videoDisplay.finish();
        return {
          completed: videoCompleted,
          failed: 0,
          interrupted: true,
          collectedErrors: [] as CollectedError[],
        };
      }
      const message = err instanceof Error ? err.message : 'Video execution failed';
      out.error(`\nVideo sync error: ${message}`);
      return { completed: videoCompleted, failed: 1, collectedErrors: [] as CollectedError[] };
    }

    videoDisplay.finish();
    out.print('Video sync complete.');

    return { completed: videoCompleted, failed: 0, collectedErrors: [] as CollectedError[] };
  }

  renderCompletion(): void {
    // Video doesn't have error rendering in the current implementation
  }
}

// =============================================================================
// Generic syncCollection function
// =============================================================================

/**
 * Generic sync function that works with any content type via a presenter.
 *
 * This replaces the old syncMusicCollection, syncVideoCollection, and
 * syncCollection (unified) functions with a single generic implementation.
 *
 * @internal Exported for testing only
 */
export async function genericSyncCollection<TSource, TDevice>(
  presenter: ContentTypePresenter<TSource, TDevice>,
  out: OutputContext,
  collection: ResolvedCollection,
  sourcePath: string,
  devicePath: string,
  dryRun: boolean,
  removeOrphans: boolean,
  contentConfig: MusicContentConfig | VideoContentConfig,
  ipod: any,
  core: typeof import('@podkit/core'),
  signal?: AbortSignal,
  statfsSyncFn?: (path: string) => { blocks: number; bsize: number; bfree: number }
): Promise<GenericSyncResult> {
  // Import statfsSync dynamically if not provided
  const statfsSync = statfsSyncFn ?? (await import('../utils/fs.js')).statfsSync;

  // 1. Create adapter + scan source
  let adapterResult: ReturnType<typeof presenter.createAdapter>;
  try {
    adapterResult = presenter.createAdapter(out, collection, sourcePath, contentConfig, core);
  } catch (err) {
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

  const { adapter, scanWarnings, spinner } = adapterResult;

  let sourceItems: TSource[];
  try {
    await adapter.connect();
    sourceItems = await adapter.getItems();
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

  spinner.stop(presenter.formatScanResult(sourceItems));

  // 2. Safety check: refuse to sync when adapter returns zero items
  if (sourceItems.length === 0) {
    const noun = presenter.itemNoun;
    const message = `Collection '${collection.name}' returned zero ${noun} \u2014 skipping sync. Check your source configuration.`;
    await adapter.disconnect();
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
          error: message,
        },
      };
    }
    out.error(message);
    return { success: false, completed: 0, failed: 0 };
  }

  // 3. Display scan warnings
  presenter.displayScanWarnings(out, scanWarnings);

  // 4. Get device items + compute diff
  const diffSpinner = out.spinner(`Computing ${presenter.type} sync diff...`);
  const deviceItems = presenter.getDeviceItems(ipod, core);
  const diff = presenter.computeDiff(sourceItems, deviceItems, contentConfig, ipod, core);
  diffSpinner.stop(presenter.type === 'music' ? 'Diff computed' : 'Video diff computed');

  // 5. Post-diff analysis
  let postDiffData: Record<string, unknown> = {};
  if (presenter.collectPostDiffData) {
    postDiffData = presenter.collectPostDiffData(diff, contentConfig, core);
  }

  // 6. Create plan + check space
  const { plan, summary } = presenter.createPlan(diff, removeOrphans, contentConfig, ipod, core);
  const storage = getStorageInfo(devicePath, statfsSync);
  const hasEnoughSpace = storage ? presenter.willFit(plan, storage.free, core) : true;

  // 7. Handle dry-run
  if (dryRun) {
    if (out.isText) {
      presenter.renderDryRunText(
        out,
        sourcePath,
        devicePath,
        diff,
        plan,
        summary,
        storage,
        hasEnoughSpace,
        removeOrphans,
        contentConfig,
        core,
        scanWarnings,
        sourceItems
      );
    }

    await adapter.disconnect();

    const jsonOutput = presenter.buildDryRunJson(
      out,
      sourcePath,
      devicePath,
      diff,
      plan,
      summary,
      removeOrphans,
      contentConfig,
      core,
      scanWarnings,
      sourceItems
    );

    return {
      success: true,
      completed: 0,
      failed: 0,
      jsonOutput: out.isJson ? jsonOutput : undefined,
      ...(postDiffData.artworkMissingBaseline !== undefined
        ? { artworkMissingBaseline: postDiffData.artworkMissingBaseline as number }
        : {}),
    };
  }

  // 8. Check space (execution path)
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
            tracksToUpgrade: summary.upgradeCount ?? 0,
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
    out.error(
      presenter.type === 'video' ? 'Not enough space for video sync.' : 'Not enough space on iPod.'
    );
    out.error(`  Need: ${formatBytes(plan.estimatedSize)}`);
    out.error(`  Have: ${formatBytes(storage?.free ?? 0)}`);
    await adapter.disconnect();
    return { success: false, completed: 0, failed: 0 };
  }

  // 9. Nothing to do
  if (plan.operations.length === 0) {
    presenter.formatAlreadySynced(out, sourceItems.length, deviceItems.length);
    await adapter.disconnect();
    return { success: true, completed: 0, failed: 0 };
  }

  // 10. Execution header
  presenter.renderExecutionHeader(out, plan, summary);

  // 11. Execute sync
  const execResult = await presenter.executeSync(
    out,
    plan,
    adapter,
    contentConfig,
    ipod,
    core,
    signal
  );

  // 12. Render completion (errors)
  presenter.renderCompletion(out, execResult.collectedErrors);

  await adapter.disconnect();

  return {
    success: execResult.failed === 0,
    completed: execResult.completed,
    failed: execResult.failed,
    interrupted: execResult.interrupted,
    ...(postDiffData.artworkMissingBaseline !== undefined
      ? { artworkMissingBaseline: postDiffData.artworkMissingBaseline as number }
      : {}),
  };
}
