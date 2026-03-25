/**
 * MusicPresenter — CLI presenter for music sync operations.
 *
 * @module
 */

import type { CollectionTrack, IPodTrack, SyncDiff, SyncPlan, SyncOperation } from '@podkit/core';
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
import type {
  ContentTypePresenter,
  MusicContentConfig,
  VideoContentConfig,
} from './sync-presenter.js';
import { formatDuration, formatTransformsConfig } from './sync-presenter.js';
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
      forceTransferMode: config.forceTransferMode,
      effectiveTransferMode: config.effectiveTransferMode,
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
    let transferModeMismatch = 0;
    const effectiveTransferMode = config.effectiveTransferMode ?? 'fast';

    for (const match of diff.existing) {
      if (config.checkArtwork && match.ipod.hasArtwork === true) {
        const syncTag = core.parseSyncTag(match.ipod.comment);
        if (!syncTag?.artworkHash) {
          artworkMissingBaseline++;
        }
      }

      // Count tracks whose sync tag transfer mode doesn't match the effective setting.
      // Missing transferMode (legacy sync tags) counts as a mismatch — these tracks
      // need --force-transfer-mode to have their sync tag updated.
      const syncTag = core.parseSyncTag(match.ipod.comment);
      if (syncTag) {
        if (syncTag.transferMode !== effectiveTransferMode) {
          transferModeMismatch++;
        }
      }
    }
    return { artworkMissingBaseline, transferModeMismatch };
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
      capabilities: config.capabilities,
      transferMode: config.effectiveTransferMode,
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
    if (config.effectiveTransferMode) {
      out.print(`Transfer mode: ${config.effectiveTransferMode}`);
    }
    if (config.skipUpgrades) {
      out.print(`Skip upgrades: enabled`);
    }
    out.newline();

    out.print('Changes:');
    out.print(`  Tracks to add: ${formatNumber(diff.toAdd.length)}`);
    if (summary.addTranscodeCount > 0) {
      out.print(`    - Transcode: ${formatNumber(summary.addTranscodeCount)}`);
    }
    if (summary.addDirectCopyCount + summary.addOptimizedCopyCount > 0) {
      out.print(
        `    - Copy: ${formatNumber(summary.addDirectCopyCount + summary.addOptimizedCopyCount)}`
      );
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
        } else if (warning.type === 'embedded-artwork-resize') {
          out.print(`Warning: ${warning.message}`);
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
      if (
        op.type === 'upgrade-transcode' ||
        op.type === 'upgrade-direct-copy' ||
        op.type === 'upgrade-optimized-copy' ||
        op.type === 'upgrade-artwork'
      ) {
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
      quality: config.effectiveQuality,
      transferMode: config.effectiveTransferMode,
      transforms: transformsInfo.length > 0 ? transformsInfo : undefined,
      skipUpgrades: config.skipUpgrades || undefined,
      plan: {
        tracksToAdd: diff.toAdd.length,
        tracksToRemove: removeOrphans ? diff.toRemove.length : 0,
        tracksToUpdate: diff.toUpdate.length,
        tracksToUpgrade:
          summary.upgradeTranscodeCount +
          summary.upgradeDirectCopyCount +
          summary.upgradeOptimizedCopyCount +
          summary.upgradeArtworkCount,
        updateBreakdown: diff.toUpdate.length > 0 ? updateBreakdown : undefined,
        tracksToTranscode: summary.addTranscodeCount,
        tracksToCopy: summary.addDirectCopyCount + summary.addOptimizedCopyCount,
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
    out.print(`  Device tracks: ${formatNumber(deviceCount)}`);
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

    const artworkResize =
      config.capabilities?.artworkSources[0] === 'embedded'
        ? config.capabilities.artworkMaxResolution
        : undefined;
    const executor = new core.MusicExecutor({ device: ipod, transcoder: config.transcoder });
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
          transferMode: config.effectiveTransferMode,
        },
        transferMode: config.effectiveTransferMode,
        artworkResize,
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
          out.raw('Saving device database...');
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

    // Check if aborted after normal generator completion (belt-and-suspenders
    // — MusicExecutor throws on abort, but check here too in case it doesn't)
    if (signal?.aborted) {
      musicDisplay.finish();
      return { completed, failed, interrupted: true, collectedErrors };
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
