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
import type { EncodingMode, FileMode } from '@podkit/core';
import type { OutputContext, CollectedError } from '../output/index.js';
import { formatBytes } from '../output/index.js';
import type { SyncOutput } from './sync.js';

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
  effectiveFileMode: FileMode | undefined;
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
  fileModeMismatch?: number;
}

// =============================================================================
// Utility Functions (shared by presenters)
// =============================================================================

/**
 * Format duration in seconds as human-readable time
 */
export function formatDuration(seconds: number): string {
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
export function formatTransformsConfig(transforms: TransformsConfig): string | null {
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
export function formatVideoTransformsConfig(videoTransforms: VideoTransformsConfig): string | null {
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
  shutdown?: Pick<import('../shutdown.js').ShutdownController, 'protect' | 'unprotect'>,
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
      ...(postDiffData.fileModeMismatch !== undefined
        ? { fileModeMismatch: postDiffData.fileModeMismatch as number }
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

  // 11. Execute sync (protected — Ctrl+C triggers graceful shutdown, not immediate exit)
  shutdown?.protect();
  let execResult;
  try {
    execResult = await presenter.executeSync(out, plan, adapter, contentConfig, ipod, core, signal);
  } finally {
    shutdown?.unprotect();
  }

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
    ...(postDiffData.fileModeMismatch !== undefined
      ? { fileModeMismatch: postDiffData.fileModeMismatch as number }
      : {}),
  };
}
