/**
 * VideoPresenter — CLI presenter for video sync operations.
 *
 * @module
 */

import type { CollectionVideo, SyncPlan, VideoSyncDiff } from '@podkit/core';
import type { IPodVideo } from '@podkit/core';
import type { OutputContext, CollectedError } from '../output/index.js';
import {
  formatBytes,
  formatNumber,
  formatCollectionLabel,
  formatUpdateReason,
} from '../output/index.js';
import {
  formatOverallLine,
  formatCurrentLineWithBar,
  formatCurrentLineText,
  DualProgressDisplay,
} from '../utils/progress.js';
import type { SyncOutput } from './sync.js';
import type {
  ContentTypePresenter,
  MusicContentConfig,
  VideoContentConfig,
} from './sync-presenter.js';
import { formatDuration, formatVideoTransformsConfig } from './sync-presenter.js';
import type { MusicCollectionConfig } from '../config/index.js';

/**
 * Resolved collection information (matches the type in sync.ts)
 */
interface ResolvedCollection {
  name: string;
  type: 'music' | 'video';
  config: MusicCollectionConfig | import('../config/index.js').VideoCollectionConfig;
}

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

    let displayCount = 0;

    try {
      for await (const progress of videoExecutor.execute(plan, {
        dryRun: false,
        ipod,
        signal,
      })) {
        if (!progress.error && progress.index !== lastIndex && !progress.skipped) {
          // New operation started — previous one (if any) is complete
          if (lastIndex >= 0) {
            videoCompleted++;
          }
          displayCount++;
          lastIndex = progress.index;
        }

        const overallLine = formatOverallLine(displayCount, progress.total, 'videos');

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

    // Check if aborted after normal generator completion (generic SyncExecutor
    // doesn't throw on abort — it breaks and returns, so the for-await ends
    // without entering the catch block)
    if (signal?.aborted) {
      videoDisplay.finish();
      return {
        completed: videoCompleted,
        failed: 0,
        interrupted: true,
        collectedErrors: [] as CollectedError[],
      };
    }

    // Last operation completed successfully (no abort, no error)
    if (lastIndex >= 0) {
      videoCompleted++;
    }

    videoDisplay.finish();
    out.print('Video sync complete.');

    return { completed: videoCompleted, failed: 0, collectedErrors: [] as CollectedError[] };
  }

  renderCompletion(): void {
    // Video doesn't have error rendering in the current implementation
  }
}
