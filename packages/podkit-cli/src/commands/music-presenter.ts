/**
 * MusicPresenter — CLI presenter for music sync operations.
 *
 * @module
 */

import type {
  CollectionTrack,
  DeviceTrack,
  SyncPlan,
  MusicOperation,
  UnifiedSyncDiff,
  MusicHandler,
  CollectionAdapter,
} from '@podkit/core';
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
export class MusicPresenter implements ContentTypePresenter<CollectionTrack, DeviceTrack> {
  readonly type = 'music' as const;
  readonly itemNoun = 'tracks';
  readonly sectionTitle = 'Music';

  private handler?: MusicHandler;
  private sourceAdapter?: CollectionAdapter;

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

    this.sourceAdapter = adapter as CollectionAdapter;

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

  getDeviceItems(ipod: any, core: typeof import('@podkit/core')): DeviceTrack[] {
    return ipod.getTracks().filter((t: any) => core.isMusicMediaType(t.mediaType));
  }

  computeDiff(
    sourceItems: CollectionTrack[],
    deviceItems: DeviceTrack[],
    contentConfig: MusicContentConfig | VideoContentConfig,
    _ipod: any,
    core: typeof import('@podkit/core')
  ): UnifiedSyncDiff<CollectionTrack, DeviceTrack> {
    const config = contentConfig as MusicContentConfig;

    // The handler derives isAlacPreset, resolvedQuality, presetBitrate, etc.
    // internally from the MusicSyncConfig.
    // Derive encoder availability from the transcoder's cached capabilities
    // so the handler can resolve codec preferences with full encoder knowledge.
    const encoderAvailability = config.transcoderCapabilities
      ? core.encoderAvailabilityFrom(config.transcoderCapabilities)
      : undefined;

    this.handler = core.createMusicHandler({
      quality: config.effectiveQuality,
      transcoder: config.transcoder,
      capabilities: config.capabilities,
      encoding: config.effectiveEncoding,
      customBitrate: config.effectiveCustomBitrate,
      bitrateTolerance: config.effectiveBitrateTolerance,
      transferMode: config.effectiveTransferMode,
      artwork: config.effectiveArtwork,
      transforms: config.effectiveTransforms,
      forceTranscode: config.forceTranscode,
      forceMetadata: config.forceMetadata,
      forceSyncTags: config.forceSyncTags,
      forceTransferMode: config.forceTransferMode,
      skipUpgrades: config.skipUpgrades,
      adapter: this.sourceAdapter,
      codecPreference: config.effectiveCodecPreference,
      encoderAvailability,
    });
    const differ = core.createSyncDiffer(this.handler);

    return differ.diff(sourceItems, deviceItems);
  }

  collectPostDiffData(
    diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>,
    contentConfig: MusicContentConfig | VideoContentConfig
  ) {
    const config = contentConfig as MusicContentConfig;
    let artworkMissingBaseline = 0;
    let transferModeMismatch = 0;
    const effectiveTransferMode = config.effectiveTransferMode ?? 'fast';

    for (const match of diff.existing) {
      if (config.checkArtwork && match.device.hasArtwork === true) {
        const syncTag = match.device.syncTag;
        if (!syncTag?.artworkHash) {
          artworkMissingBaseline++;
        }
      }

      // Count tracks whose sync tag transfer mode doesn't match the effective setting.
      // Missing transferMode (legacy sync tags) counts as a mismatch — these tracks
      // need --force-transfer-mode to have their sync tag updated.
      const syncTag = match.device.syncTag;
      if (syncTag) {
        if (syncTag.transferMode !== effectiveTransferMode) {
          transferModeMismatch++;
        }
      }
    }
    return { artworkMissingBaseline, transferModeMismatch };
  }

  createPlan(
    diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>,
    removeOrphans: boolean,
    contentConfig: MusicContentConfig | VideoContentConfig,
    _ipod: any,
    core: typeof import('@podkit/core')
  ) {
    const config = contentConfig as MusicContentConfig;
    const planner = core.createSyncPlanner(this.handler!);
    const plan = planner.plan(diff, {
      removeOrphans,
      artworkEnabled: config.effectiveArtwork,
    });
    const summary = this.buildPlanSummary(plan);
    return { plan, summary };
  }

  /**
   * Build a plan summary by counting operation types.
   * Replaces the legacy `getMusicPlanSummary()`.
   */
  private buildPlanSummary(plan: SyncPlan<MusicOperation>) {
    let addTranscodeCount = 0;
    let addDirectCopyCount = 0;
    let addOptimizedCopyCount = 0;
    let upgradeTranscodeCount = 0;
    let upgradeDirectCopyCount = 0;
    let upgradeOptimizedCopyCount = 0;
    let upgradeArtworkCount = 0;

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
      }
    }

    return {
      addTranscodeCount,
      addDirectCopyCount,
      addOptimizedCopyCount,
      upgradeTranscodeCount,
      upgradeDirectCopyCount,
      upgradeOptimizedCopyCount,
      upgradeArtworkCount,
    };
  }

  willFit(
    plan: SyncPlan<MusicOperation>,
    freeSpace: number,
    _core: typeof import('@podkit/core')
  ): boolean {
    return plan.estimatedSize <= freeSpace;
  }

  renderDryRunText(
    out: OutputContext,
    sourcePath: string,
    devicePath: string,
    diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>,
    plan: SyncPlan<MusicOperation>,
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
    if (config.resolvedLossyCodec && config.lossyPreferenceStack) {
      const chain = config.lossyPreferenceStack.join(' \u2192 ');
      out.print(`Codec: ${config.resolvedLossyCodec} (first supported from preference: ${chain})`);
    }

    // Codec change count
    const codecChangeCount = diff.toUpdate.filter((u) =>
      u.reasons.includes('codec-changed')
    ).length;
    if (codecChangeCount > 0) {
      out.print(`Codec change: ${formatNumber(codecChangeCount)} tracks need re-transcoding`);
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
        const reason = update.reasons[0]!;
        const count = updatesByReason.get(reason) ?? 0;
        updatesByReason.set(reason, count + 1);
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
        ...diff.toUpdate.filter((u) => u.reasons[0] === 'transform-apply').map((u) => u.source),
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
            case 'update-sync-tag':
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
    diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>,
    plan: SyncPlan<MusicOperation>,
    summary: any,
    removeOrphans: boolean,
    contentConfig: MusicContentConfig | VideoContentConfig,
    core: typeof import('@podkit/core'),
    scanWarnings: Array<{ file: string; message: string }>,
    _sourceItems: CollectionTrack[]
  ): SyncOutput {
    const config = contentConfig as MusicContentConfig;

    const operations: SyncOutput['operations'] = plan.operations.map((op: MusicOperation) => {
      const base = {
        type: op.type,
        track: core.getMusicOperationDisplayName(op),
        status: 'pending' as const,
      };
      if (op.type === 'update-metadata') {
        const updateInfo = diff.toUpdate.find(
          (u) => u.device.title === op.track.title && u.device.artist === op.track.artist
        );
        if (updateInfo) {
          return {
            ...base,
            changes: (updateInfo.changes ?? []).map((c: any) => ({
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
      const reason = update.reasons[0]!;
      const count = updateBreakdown[reason as keyof UpdateBreakdown] ?? 0;
      updateBreakdown[reason as keyof UpdateBreakdown] = count + 1;
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
      codec: config.resolvedLossyCodec,
      codecPreference: config.lossyPreferenceStack,
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

  renderExecutionHeader(out: OutputContext, plan: SyncPlan<MusicOperation>): void {
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
    plan: SyncPlan<MusicOperation>,
    _adapter: any,
    _contentConfig: MusicContentConfig | VideoContentConfig,
    ipod: any,
    core: typeof import('@podkit/core'),
    signal?: AbortSignal
  ) {
    const collectedErrors: CollectedError[] = [];
    let completed = 0;
    let failed = 0;

    const executor = core.createSyncExecutor(this.handler!);
    const musicDisplay = new DualProgressDisplay((content) => out.raw(content));

    try {
      for await (const progress of executor.execute(plan, {
        device: ipod,
        continueOnError: true,
        signal,
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
        } else if (progress.phase !== 'preparing') {
          completed++;
        }

        if (progress.phase !== 'preparing') {
          const overallLine = formatOverallLine(completed, progress.total, 'tracks');
          const phaseStr =
            progress.phase === 'updating-metadata'
              ? 'Updating metadata'
              : progress.phase.charAt(0).toUpperCase() + progress.phase.slice(1);
          const currentLine = formatCurrentLineText({
            phase: phaseStr,
            trackName: progress.currentTrack,
          });
          if (out.isTty) {
            musicDisplay.update(overallLine, currentLine);
          } else {
            // Non-interactive mode: print plain-text progress to stdout so
            // scripts, CI pipelines, and E2E tests can observe sync progress.
            out.print(
              `${overallLine}  ${phaseStr}${progress.currentTrack ? ': ' + progress.currentTrack : ''}`
            );
          }
        }
      }
    } catch (err) {
      if (signal?.aborted) {
        musicDisplay.finish();
        return { completed, failed, interrupted: true, collectedErrors };
      }
      throw err;
    }

    musicDisplay.finish();

    // Check if aborted after normal generator completion
    if (signal?.aborted) {
      return { completed, failed, interrupted: true, collectedErrors };
    }

    out.print('Music sync complete!');

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
