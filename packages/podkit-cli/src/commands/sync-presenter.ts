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
} from '../config/index.js';
import type { EncodingMode, TransferMode } from '@podkit/core';
import type { OutputContext, CollectedError } from '../output/index.js';
import { formatBytes } from '../output/index.js';
import type { SyncOutput, ErrorInfo, ResolvedCollection, SyncErrorCode } from './sync.js';
import { CliError } from '../errors.js';
import { confirmNo } from '../utils/confirm.js';
import { decideEmptyPlaylist } from './empty-playlist-guard.js';

// =============================================================================
// Free-space JSON envelope helpers (TASK-378 AC #8)
// =============================================================================

/**
 * Build a structured ErrorInfo for the plan-time not-enough-space exit
 * path (see `genericSyncCollection` step 8 below). Synthesises a typed
 * payload that mirrors the {@link CategorizedSyncError} hierarchy even
 * though no actual exception is thrown at this point — the planner
 * decides the sync cannot proceed before any track is attempted.
 */
function buildPlanTimeSpaceErrorInfo(args: {
  bytesNeeded: number;
  bytesAvailable: number;
}): ErrorInfo {
  return {
    track: '',
    category: 'space',
    class: 'NotEnoughSpacePlanTime',
    message: `Not enough space. Need ${formatBytes(args.bytesNeeded)}, have ${formatBytes(args.bytesAvailable)}`,
    retryAttempts: 0,
    wasRetried: false,
    causes: [],
  };
}

/**
 * Build a structured ErrorInfo for the post-sweep not-enough-space exit
 * path (ADR-018). Surfaces the typed-error detail so JSON consumers can
 * render `bytesFreedBySweep` + `failedSweepPaths` without scraping the
 * message body.
 */
export function buildPostSweepSpaceErrorInfo(detail: {
  bytesNeeded: number;
  bytesAvailable: number;
  bytesFreedBySweep: number;
  failedSweepPaths: readonly string[];
  message: string;
}): ErrorInfo {
  return {
    track: '',
    category: 'space',
    class: 'InsufficientSpaceAfterCleanup',
    message: detail.message,
    retryAttempts: 0,
    wasRetried: false,
    causes: detail.failedSweepPaths,
  };
}

// =============================================================================
// Types
// =============================================================================

/**
 * Music-specific configuration passed through the presenter context
 */
export interface MusicContentConfig {
  type: 'music';
  effectiveTransforms: TransformsConfig;
  /** Why the cleanArtists transform is in its current state (capability gating) */
  cleanArtistsResolutionReason?: import('./transform-warnings.js').CleanArtistsResolutionReason;
  /** Transform warnings to display */
  transformWarnings?: import('./transform-warnings.js').TransformWarning[];
  effectiveQuality: QualityPreset;
  effectiveEncoding: EncodingMode | undefined;
  effectiveTransferMode: TransferMode | undefined;
  effectiveCustomBitrate: number | undefined;
  effectiveBitrateTolerance: number | undefined;
  effectiveBitrateSync: import('@podkit/core').BitrateSyncMode;
  effectiveToleranceUp: number | undefined;
  effectiveToleranceDown: number | undefined;
  deviceSupportsAlac: boolean;
  effectiveArtwork: boolean;
  skipUpgrades: boolean;
  forceTranscode: boolean;
  forceTransferMode: boolean;
  forceSyncTags: boolean;
  forceMetadata: boolean;
  checkArtwork: boolean;
  transcoder: ReturnType<typeof import('@podkit/core').createFFmpegTranscoder>;
  capabilities?: import('@podkit/core').DeviceCapabilities;
  /** Effective codec preference config (per-key device → global → defaults). Always defined; sync.ts fills both stacks. */
  effectiveCodecPreference: { lossy: string[]; lossless: string[] };
  /** Resolved lossy codec name (first compatible from preference stack) */
  resolvedLossyCodec?: string;
  /** Full lossy preference stack for display */
  lossyPreferenceStack?: string[];
  /** Transcoder capabilities (for encoder availability in codec resolution) */
  transcoderCapabilities?: import('@podkit/core').TranscoderCapabilities;
  /**
   * Sync-wide decisions with provenance, surfaced in `--json` output via the
   * `decisions` block. Built by {@link buildSyncDecisions} in sync.ts. See
   * doc-040 (PRD) for the JSON contract.
   */
  decisions?: import('./sync-decisions.js').SyncDecisions;
}

/**
 * Video-specific configuration passed through the presenter context
 */
export interface VideoContentConfig {
  type: 'video';
  effectiveVideoQuality: VideoQualityPreset;
  effectiveVideoTransforms: VideoTransformsConfig;
  effectiveTransferMode: TransferMode | undefined;
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
  transferModeMismatch?: number;
  /**
   * Execute-phase warnings drained from the pipeline. Sync.ts aggregates
   * these across collections before constructing the final JSON output.
   */
  warnings?: import('@podkit/core').Warning[];
  /**
   * Per-track typed errors from the execute phase (TASK-378 AC #8).
   * Sync.ts aggregates these into the final JSON output's `errors[]` array
   * so consumers can read `{class, category, causes}` without scraping
   * the message body.
   */
  collectedErrors?: CollectedError[];
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

  /**
   * Resolve the source path for a collection. Music collections may carry
   * either a filesystem `path` or a subsonic `url`; video collections are
   * always filesystem paths. Returning the right string is the presenter's
   * job so the orchestrator stays content-type-agnostic.
   */
  getSourcePath(collection: ResolvedCollection): string;

  /**
   * Suffix printed after `Database saved. ` when a sync is interrupted
   * mid-collection. Music returns `Sync interrupted.`; video returns
   * `Video sync interrupted.` (preserved byte-identical from the
   * pre-helper-extraction prints).
   */
  getInterruptedSuffix(): string;

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

  /** Reconcile file paths on mass-storage devices (move entries to toUpdate when paths mismatch) */
  reconcilePaths?(diff: any, ipod: any): void;

  /** Collect post-diff data (e.g., artworkMissingBaseline for music) */
  collectPostDiffData?(
    diff: any,
    contentConfig: MusicContentConfig | VideoContentConfig
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
    /** Execute-phase warnings drained from the pipeline (optional per presenter). */
    warnings?: import('@podkit/core').Warning[];
  }>;

  /** Render completion (errors, etc.) */
  renderCompletion(out: OutputContext, errors: CollectedError[]): void;

  /** Extract collision check inputs from add operations in a plan */
  getCollisionCheckInputs?(plan: any): import('@podkit/core').CollisionCheckInput[];
}

// =============================================================================
// Generic syncCollection function
// =============================================================================

/**
 * Argument bag for {@link genericSyncCollection}. Generic over source +
 * device shapes through the presenter.
 */
export interface GenericSyncCollectionArgs<TSource, TDevice> {
  presenter: ContentTypePresenter<TSource, TDevice>;
  out: OutputContext;
  collection: ResolvedCollection;
  sourcePath: string;
  devicePath: string;
  dryRun: boolean;
  removeOrphans: boolean;
  contentConfig: MusicContentConfig | VideoContentConfig;
  ipod: any;
  core: typeof import('@podkit/core');
  signal?: AbortSignal;
  shutdown?: Pick<import('../shutdown.js').ShutdownController, 'protect' | 'unprotect'>;
  statfsSyncFn?: (path: string) => { blocks: number; bsize: number; bfree: number };
  /**
   * Device-level pre-sync sweep result. The orchestrator runs the sweep
   * once per device and passes it to the FIRST collection's
   * genericSyncCollection call only — subsequent collections receive
   * undefined so the executor's pre-flight runs the cleanup exactly once.
   */
  preliminaries?: import('@podkit/core').PlanPreliminaries;
  /**
   * Empty-playlist override. True when the user explicitly opted into
   * syncing a playlist-scoped collection that resolves to zero tracks —
   * via `--yes` (one-off) or the `allowEmptyPlaylist` config key (daemon).
   * Only consulted when the collection is playlist-scoped; ignored
   * otherwise.
   */
  allowEmptyPlaylist?: boolean;
  /**
   * @internal Injection seam for the empty-playlist confirm prompt.
   * Defaults to {@link confirmNo}. Tests pass a stub to drive the
   * interactive guard branch without a real TTY.
   */
  confirm?: (question: string) => Promise<boolean>;
}

/**
 * Error code for the empty-playlist guard's headless / declined-confirm
 * abort. Distinct so JSON consumers and tests can branch without scraping
 * the message body.
 *
 * The string must match `SyncErrorCodes.EMPTY_PLAYLIST_ABORT` — the type
 * annotation enforces this. Defined here (not imported) to avoid a circular
 * module initialisation issue: `sync-presenter` and `sync` import each other,
 * and a value import of `SyncErrorCodes` would hit the TDZ on that cycle.
 */
export const EMPTY_PLAYLIST_ABORT_CODE: SyncErrorCode = 'EMPTY_PLAYLIST_ABORT';

/**
 * A music collection is "playlist-scoped" when it carries a non-empty
 * subsonic `playlist` constraint. The empty-result guard only applies to
 * these — an ordinary empty directory/library collection keeps its
 * existing skip behaviour.
 */
function isPlaylistScoped(collection: ResolvedCollection): boolean {
  if (collection.type !== 'music') return false;
  const config = collection.config as { playlist?: string };
  return typeof config.playlist === 'string' && config.playlist.trim() !== '';
}

/**
 * Generic sync function that works with any content type via a presenter.
 *
 * This replaces the old syncMusicCollection, syncVideoCollection, and
 * syncCollection (unified) functions with a single generic implementation.
 *
 * @internal Exported for testing only
 */
export async function genericSyncCollection<TSource, TDevice>(
  args: GenericSyncCollectionArgs<TSource, TDevice>
): Promise<GenericSyncResult> {
  const {
    presenter,
    out,
    collection,
    sourcePath,
    devicePath,
    dryRun,
    removeOrphans,
    contentConfig,
    ipod,
    core,
    signal,
    shutdown,
    statfsSyncFn,
    preliminaries,
    allowEmptyPlaylist,
    confirm,
  } = args;

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

  // 1b. Empty-playlist guard.
  //
  // ONLY for a playlist-scoped subsonic collection. When such a collection
  // resolves to zero tracks, an unguarded sync would remove every track the
  // device holds for it — an emptied or mistyped server playlist would
  // silently wipe the device. The pure decision fn says what to do; this
  // caller acts on it. An ordinary empty directory/library collection does
  // NOT pass through here — it falls through to the step-2 skip unchanged.
  let emptyPlaylistProceedApproved = false;
  if (isPlaylistScoped(collection) && sourceItems.length === 0) {
    const interactive = !out.isJson && out.isTty;
    // sourceItems.length is always 0 here — the outer guard requires it.
    // The function's >0 branch (→ 'proceed') exists for its own unit-level
    // completeness and is not reachable from this call site.
    const decision = decideEmptyPlaylist(sourceItems.length, {
      interactive,
      allowEmpty: allowEmptyPlaylist ?? false,
    });

    const deviceItemCount = presenter.getDeviceItems(ipod, core).length;
    const warningBody =
      `Playlist-scoped collection '${collection.name}' resolved to zero tracks. ` +
      (deviceItemCount > 0
        ? `Proceeding will remove all ${deviceItemCount} ${presenter.itemNoun} this collection put on the device.`
        : `The device has no ${presenter.itemNoun} for this collection yet — syncing an empty playlist will add nothing.`);

    const abort = (): never => {
      // CliError propagates up to runAction → non-zero exit. The caller
      // disconnects the source first so the connection isn't leaked.
      throw new CliError({
        message: warningBody,
        code: EMPTY_PLAYLIST_ABORT_CODE,
        details: {
          collection: collection.name,
          source: sourcePath,
          device: devicePath,
          deviceItems: deviceItemCount,
        },
        printText: (o) => {
          o.error(warningBody);
          o.error(
            'Re-run with --yes (or set allowEmptyPlaylist = true) to sync the empty playlist anyway.'
          );
        },
      });
    };

    if (decision === 'abort') {
      await adapter.disconnect();
      abort();
    }

    if (decision === 'confirm') {
      out.warn(warningBody);
      const proceed = await (confirm ?? confirmNo)('Sync the empty playlist anyway?');
      if (!proceed) {
        await adapter.disconnect();
        // User declined — treat as an abort: stop without wiping the device.
        out.print('Aborted. Device music for this collection was left untouched.');
        abort();
      }
    }
    // decision === 'proceed' (or confirmed) — fall through to the normal
    // sync flow, which will remove the device's tracks for this collection.
    emptyPlaylistProceedApproved = true;
  }

  // 2. Safety check: refuse to sync when adapter returns zero items.
  // Skipped when the empty-playlist guard explicitly approved proceeding —
  // the user deliberately opted to sync (and thereby wipe) an empty
  // playlist-scoped collection.
  if (sourceItems.length === 0 && !emptyPlaylistProceedApproved) {
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

  // 4b. Path reconciliation (mass-storage: detect path mismatches from template/metadata changes)
  if (presenter.reconcilePaths) {
    presenter.reconcilePaths(diff, ipod);
  }

  // 5. Post-diff analysis
  let postDiffData: Record<string, unknown> = {};
  if (presenter.collectPostDiffData) {
    postDiffData = presenter.collectPostDiffData(diff, contentConfig);
  }

  // 6. Create plan + check space
  const { plan, summary } = presenter.createPlan(diff, removeOrphans, contentConfig, ipod, core);

  // Attach device-level pre-flight (TASK-398) to the FIRST collection's
  // plan. Orchestrator (sync.ts) ensures this is only set for one
  // collection per device — subsequent calls receive `preliminaries =
  // undefined` so the executor's pre-flight runs exactly once.
  if (preliminaries) {
    plan.preliminaries = preliminaries;
  }

  const storage = getStorageInfo(devicePath, statfsSync);
  // Free-space accounting (TASK-398 §5): expand the available envelope by
  // the bytes the pre-sync sweep estimates it will free. We add to the
  // *available* side rather than subtracting from `plan.estimatedSize` —
  // subtracting would suppress a real space warning if the sweep
  // partially fails. The estimate is generous by design; the executor's
  // transfer phase still surfaces ENOSPC if actual freed bytes fall
  // short. Coordinate with TASK-378 (free-space probe rewrite) if the
  // accounting model evolves.
  const debrisFreedEstimate = plan.preliminaries?.debrisCleanup?.totalBytes ?? 0;
  const effectiveFreeSpace = (storage?.free ?? 0) + debrisFreedEstimate;
  const hasEnoughSpace = storage ? presenter.willFit(plan, effectiveFreeSpace, core) : true;

  // 6b. Check for unmanaged file collisions (mass-storage only)
  if (typeof ipod.checkAddCollisions === 'function' && presenter.getCollisionCheckInputs) {
    const collisionInputs = presenter.getCollisionCheckInputs(plan);
    if (collisionInputs.length > 0) {
      const collisions = ipod.checkAddCollisions(collisionInputs);
      if (collisions.length > 0) {
        const lines = collisions.map(
          (c: { path: string; description: string }) => `  ${c.description} → ${c.path}`
        );
        const message = `${collisions.length} file(s) would collide with unmanaged files on device:\n${lines.join('\n')}\nRemove the conflicting files or run \`podkit doctor\` to resolve.`;

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
    }
  }

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
      ...(postDiffData.transferModeMismatch !== undefined
        ? { transferModeMismatch: postDiffData.transferModeMismatch as number }
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
            tracksToUpgrade:
              (summary.upgradeTranscodeCount ?? 0) +
              (summary.upgradeDirectCopyCount ?? 0) +
              (summary.upgradeOptimizedCopyCount ?? 0) +
              (summary.upgradeArtworkCount ?? 0),
            tracksToTranscode: summary.addTranscodeCount,
            tracksToCopy: (summary.addDirectCopyCount ?? 0) + (summary.addOptimizedCopyCount ?? 0),
            tracksExisting: diff.existing.length,
            estimatedSize: plan.estimatedSize,
            estimatedTime: plan.estimatedTime,
          },
          error: `Not enough space. Need ${formatBytes(plan.estimatedSize)}, have ${formatBytes(storage?.free ?? 0)}`,
          errors: [
            buildPlanTimeSpaceErrorInfo({
              bytesNeeded: plan.estimatedSize,
              bytesAvailable: storage?.free ?? 0,
            }),
          ],
        },
      };
    }
    out.error(
      presenter.type === 'video'
        ? 'Not enough space for video sync.'
        : 'Not enough space on device.'
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
    return {
      success: true,
      completed: 0,
      failed: 0,
      ...(postDiffData.artworkMissingBaseline !== undefined
        ? { artworkMissingBaseline: postDiffData.artworkMissingBaseline as number }
        : {}),
      ...(postDiffData.transferModeMismatch !== undefined
        ? { transferModeMismatch: postDiffData.transferModeMismatch as number }
        : {}),
    };
  }

  // 10. Execution header
  presenter.renderExecutionHeader(out, plan, summary);

  // 11. Execute sync (protected — Ctrl+C triggers graceful shutdown, not immediate exit)
  shutdown?.protect();
  let execResult;
  try {
    try {
      execResult = await presenter.executeSync(
        out,
        plan,
        adapter,
        contentConfig,
        ipod,
        core,
        signal
      );
    } catch (err) {
      // ADR-018: post-sweep recompute may throw InsufficientSpaceAfterCleanup
      // before any track is attempted. Convert to the same not-enough-space
      // exit shape as the plan-time gate so JSON consumers see a structured
      // `errors[]` entry instead of an unhandled crash.
      if (err instanceof core.InsufficientSpaceAfterCleanup) {
        if (out.isJson) {
          await adapter.disconnect();
          return {
            success: false,
            completed: 0,
            failed: 0,
            jsonOutput: {
              success: false,
              dryRun: false,
              source: sourcePath,
              device: devicePath,
              error: err.message,
              errors: [
                buildPostSweepSpaceErrorInfo({
                  bytesNeeded: err.detail.bytesNeeded,
                  bytesAvailable: err.detail.bytesAvailable,
                  bytesFreedBySweep: err.detail.bytesFreedBySweep,
                  failedSweepPaths: err.detail.failedSweepPaths,
                  message: err.message,
                }),
              ],
            },
          };
        }
        out.error(err.message);
        await adapter.disconnect();
        return { success: false, completed: 0, failed: 0 };
      }
      throw err;
    }
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
    warnings: execResult.warnings,
    collectedErrors: execResult.collectedErrors,
    ...(postDiffData.artworkMissingBaseline !== undefined
      ? { artworkMissingBaseline: postDiffData.artworkMissingBaseline as number }
      : {}),
    ...(postDiffData.transferModeMismatch !== undefined
      ? { transferModeMismatch: postDiffData.transferModeMismatch as number }
      : {}),
  };
}
