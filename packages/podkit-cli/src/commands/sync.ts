/**
 * Sync command - synchronize music and/or video collections to device
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
import { existsSync } from '../utils/fs.js';
import { Command, Option } from 'commander';
import { getContext } from '../context.js';
import type {
  QualityPreset,
  TransformsConfig,
  VideoQualityPreset,
  VideoTransformsConfig,
  PodkitConfig,
  MusicCollectionConfig,
  VideoCollectionConfig,
  DeviceConfig,
} from '../config/index.js';
import { QUALITY_PRESETS, ENCODING_MODES, CONTENT_TYPES, TRANSFER_MODES } from '../config/index.js';
import { resolveDeviceSettings } from '../config/resolve.js';
import {
  resolveDevicePath,
  formatDeviceError,
  getDeviceIdentity,
  formatDeviceLookupMessage,
  parseCliDeviceArg,
  resolveEffectiveDevice,
  autoDetectDevice,
} from '../device-resolver.js';
import {
  OutputContext,
  formatNumber,
  formatDurationSeconds,
  renderProgressBar,
} from '../output/index.js';
import { CliError, runAction, type CliErrorOutput } from '../errors.js';
import { loadCoreOrFail, type CoreLoaderDeps } from '../handler-deps.js';
import { withCleanOptions } from '../utils/option-source.js';

/**
 * Error codes emitted by `podkit sync`.
 *
 * Exhaustive — every CliError thrown from this command's runner uses one
 * of these. Consumers branching on `output.code` can rely on this union.
 */
export const SyncErrorCodes = {
  INVALID_SYNC_TYPE: 'INVALID_SYNC_TYPE',
  DEVICE_NOT_RESOLVED: 'DEVICE_NOT_RESOLVED',
  COLLECTION_NOT_FOUND: 'COLLECTION_NOT_FOUND',
  NO_COLLECTIONS: 'NO_COLLECTIONS',
  SOURCE_NOT_FOUND: 'SOURCE_NOT_FOUND',
  CORE_LOAD_FAILED: 'CORE_LOAD_FAILED',
  DEVICE_PATH_UNRESOLVED: 'DEVICE_PATH_UNRESOLVED',
  DEVICE_PATH_NOT_FOUND: 'DEVICE_PATH_NOT_FOUND',
  FFMPEG_UNAVAILABLE: 'FFMPEG_UNAVAILABLE',
  IPOD_OPEN_FAILED: 'IPOD_OPEN_FAILED',
  DEVICE_OPEN_FAILED: 'DEVICE_OPEN_FAILED',
  DEVICE_UNSUPPORTED: 'DEVICE_UNSUPPORTED',
  NO_COMPATIBLE_CODEC: 'NO_COMPATIBLE_CODEC',
} as const;
export type SyncErrorCode = (typeof SyncErrorCodes)[keyof typeof SyncErrorCodes];

export type SyncErrorOutput = CliErrorOutput & { code: SyncErrorCode };
import { createShutdownController } from '../shutdown.js';
import { MusicPresenter } from './music-presenter.js';
import { VideoPresenter } from './video-presenter.js';
import { openDevice } from './open-device.js';
import {
  genericSyncCollection,
  type MusicContentConfig,
  type VideoContentConfig,
  type GenericSyncResult,
} from './sync-presenter.js';
import { buildSyncDecisions } from './sync-decisions.js';
import {
  resolveCleanArtistsTransform,
  computeTransformWarnings,
  type CleanArtistsResolutionReason,
  type TransformWarning,
} from './transform-warnings.js';

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
  transferMode?: string;
  filter?: string;
  artwork?: boolean;
  skipUpgrades?: boolean;
  forceTranscode?: boolean;
  forceTransferMode?: boolean;
  forceSyncTags?: boolean;
  forceMetadata?: boolean;
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
  /** Why the transform is in its current state (capability gating) */
  reason?: string;
  /** Warnings about this transform's configuration */
  warnings?: string[];
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
  'transfer-mode-changed'?: number;
  'sync-tag-write'?: number;
  'artwork-added'?: number;
  'artwork-removed'?: number;
  'artwork-updated'?: number;
  'normalization-update'?: number;
  'metadata-correction'?: number;
  'force-metadata'?: number;
}

/**
 * Summary of video content by type
 */
export interface VideoSummary {
  movieCount: number;
  showCount: number;
  episodeCount: number;
}

/**
 * JSON output structure for sync command.
 *
 * `success: true` means the sync ran. `status` reads the outcome:
 * - `'ok'`: every collection synced cleanly, exit code 0
 * - `'partial-failure'`: ran but some items failed, exit code 2
 *
 * Per-collection adapter/scan failures (sync-presenter) emit `success: false`
 * with an `error` field — those are scoped to a single collection inside a
 * multi-collection run. Hard command errors (device unreachable, ffmpeg
 * missing, etc.) are emitted via `CliErrorOutput`, exit code 1.
 */
export interface SyncOutput {
  success: boolean;
  status?: 'ok' | 'partial-failure';
  dryRun: boolean;
  source?: string;
  device?: string;
  /**
   * Sync-wide decisions with provenance attribution. Replaces the previous
   * top-level `quality`/`codec`/`codecPreference`/`transferMode` strings.
   * Consumers that need only the value read `decisions.transferMode.value`,
   * etc.; consumers that need to assert "where did this come from?" (matrix
   * tests, doctor surfaces) read `decisions.transferMode.source`. See
   * doc-040 (PRD) and {@link SyncDecisions}.
   */
  decisions?: import('./sync-decisions.js').SyncDecisions;
  transforms?: TransformInfo[];
  skipUpgrades?: boolean;
  /**
   * Sync plan summary. **Populated under `--dry-run`** and on the **not-enough-
   * space error path** (where `success: false, dryRun: false, error: '...'`
   * accompany it; see `sync-presenter.ts` around line 537). A clean real (non-
   * dry) sync emits `result` instead. Tests that ran `sync` without `--dry-run`
   * and asserted against `plan.tracksToUpdate` etc. on a successful sync are
   * silently asserting against `undefined`; use `result.completed` to inspect
   * what a real sync did.
   *
   * Field naming is shared with music sync — video sync also populates
   * `tracksToAdd` / `tracksToCopy` / `tracksToTranscode` (NOT `videosTo*`) and
   * surfaces movie/show split via `videoSummary`.
   */
  plan?: {
    tracksToAdd: number;
    tracksToRemove: number;
    tracksToUpdate: number;
    tracksToUpgrade: number;
    tracksToRelocate?: number;
    updateBreakdown?: UpdateBreakdown;
    tracksToTranscode: number;
    tracksToCopy: number;
    tracksExisting: number;
    estimatedSize: number;
    estimatedTime: number;
    normalizedTracks?: number;
    albumCount?: number;
    artistCount?: number;
    videoSummary?: VideoSummary;
  };
  operations?: Array<{
    type:
      | 'add-transcode'
      | 'add-direct-copy'
      | 'add-optimized-copy'
      | 'upgrade-transcode'
      | 'upgrade-direct-copy'
      | 'upgrade-optimized-copy'
      | 'upgrade-artwork'
      | 'remove'
      | 'update-metadata'
      | 'update-sync-tag'
      | 'relocate'
      | 'video-transcode'
      | 'video-copy'
      | 'video-remove'
      | 'video-update-metadata'
      | 'video-upgrade';
    track: string;
    status?: 'pending' | 'completed' | 'failed' | 'skipped';
    error?: string;
    changes?: Array<{ field: string; from: string; to: string }>;
    reason?: string;
    /**
     * Source track's codec (e.g. 'flac', 'mp3'). Set for add/upgrade variants
     * where a source file exists; undefined for `remove`/`update-metadata`/
     * `update-sync-tag`/`relocate` (no source codec).
     */
    inputCodec?: string;
    /**
     * Resolved output codec the planner chose (e.g. 'aac' for `add-transcode`,
     * 'flac' for `add-direct-copy` of a FLAC source). Disambiguates which
     * codec a `transcode` op targets without scraping operation type strings.
     * Undefined for ops that don't write a file.
     */
    outputCodec?: string;
  }>;
  /**
   * Real-run outcome counts. **Populated only on non-dry-run syncs.** A
   * `--dry-run` emits `plan` instead. Idempotency tests should assert
   * `result.completed === 0`; detect+apply tests should assert
   * `result.completed > 0` (or an exact count where the fixture pins it).
   */
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

// Re-export renderProgressBar for tests
export { renderProgressBar };

// =============================================================================
// Collection Resolution
// =============================================================================

/**
 * Resolved collection information
 */
/** @internal Exported for testing and sync-presenter */
export interface ResolvedCollection {
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
 * Get effective video transforms config for a device
 */
function getEffectiveVideoTransforms(
  globalVideoTransforms: VideoTransformsConfig,
  deviceConfig?: DeviceConfig
): VideoTransformsConfig {
  if (!deviceConfig?.videoTransforms) {
    return globalVideoTransforms;
  }

  return {
    showLanguage: {
      ...globalVideoTransforms.showLanguage,
      ...deviceConfig.videoTransforms.showLanguage,
    },
  };
}

// Quality/audio/video/artwork/encoding/transferMode/customBitrate/bitrateTolerance
// resolution is handled by resolveDeviceSettings() from config/resolve.ts.

// =============================================================================
// Re-exports from sync-presenter (for backward compatibility and testing)
// =============================================================================

export { MusicPresenter } from './music-presenter.js';
export { VideoPresenter } from './video-presenter.js';
export {
  genericSyncCollection,
  type MusicContentConfig,
  type VideoContentConfig,
  type GenericSyncResult,
  type ContentTypePresenter,
} from './sync-presenter.js';

// =============================================================================
// NOTE: syncMusicCollection, syncVideoCollection, syncCollection, and
// buildMusicDryRunOutput have been replaced by genericSyncCollection +
// MusicPresenter/VideoPresenter. See sync-presenter.ts.
// =============================================================================
// Main Sync Command
// =============================================================================

/**
 * Collect repeatable -t/--type values, splitting comma-separated entries.
 */
function collectTypes(value: string, previous: string[]): string[] {
  return [...previous, ...value.split(',').map((v) => v.trim().toLowerCase())];
}

const syncTypeOption = new Option(
  '-t, --type <type>',
  'sync type (repeatable, comma-separated, default: all)'
).default([] as string[]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(syncTypeOption as any).parseArg = collectTypes;
syncTypeOption.argChoices = [...CONTENT_TYPES];

export const syncCommand = new Command('sync')
  .description('sync music and/or video collections to device')
  .addOption(syncTypeOption)
  .option('-c, --collection <name>', 'collection name to sync (searches music and video)')
  .option('-n, --dry-run', 'show what would be synced without making changes')
  .addOption(
    new Option('--quality <preset>', 'unified quality preset for audio and video').choices([
      ...QUALITY_PRESETS,
    ])
  )
  .addOption(
    new Option(
      '--audio-quality <preset>',
      'audio transcoding quality (overrides --quality)'
    ).choices([...QUALITY_PRESETS])
  )
  .addOption(
    new Option(
      '--video-quality <preset>',
      'video transcoding quality (overrides --quality)'
    ).choices([...QUALITY_PRESETS])
  )
  .addOption(new Option('--encoding <mode>', 'audio encoding mode').choices([...ENCODING_MODES]))
  .addOption(
    new Option(
      '--transfer-mode <mode>',
      'transfer mode: fast (default), optimized, or portable — controls whether extra file data is preserved or stripped during sync'
    ).choices([...TRANSFER_MODES])
  )
  .option('--filter <pattern>', 'only sync tracks matching pattern')
  .option('--no-artwork', 'skip artwork transfer')
  .option('--skip-upgrades', 'skip file-replacement upgrades for changed source files')
  .option('--force-transcode', 're-transcode all lossless-source tracks regardless of bitrate')
  .addOption(
    new Option('--force-transfer-mode', 'reprocess tracks synced with different transfer mode')
  )
  .option(
    '--force-sync-tags',
    'ensure sync tag consistency by writing tags to all matched transcoded tracks without re-transcoding'
  )
  .option(
    '--force-metadata',
    'rewrite metadata on all matched tracks without re-transcoding or re-transferring files'
  )
  .option('--check-artwork', 'detect artwork changes by comparing content hashes')
  .option('--delete', 'remove tracks from device not in source')
  .option('--eject', 'eject device after successful sync')
  .action(
    withCleanOptions(async (options: SyncOptions) => {
      const { config, globalOpts } = getContext();
      const out = OutputContext.fromGlobalOpts(globalOpts, config);
      await runAction(out, () => runSync(options, out));
    })
  );

/**
 * Dependency injection seam for `runSync`. Tests pass stubs to avoid real
 * USB walks and disk operations. Production passes nothing — the defaults
 * are the real implementations.
 */
export interface SyncDeps extends CoreLoaderDeps {
  getDeviceManager?: () => import('@podkit/core').DeviceManager;
}

export async function runSync(
  options: SyncOptions,
  out: OutputContext,
  deps: SyncDeps = {}
): Promise<void> {
  const { config, globalOpts, configResult } = getContext();
  const startTime = Date.now();

  const dryRun = options.dryRun ?? false;
  const removeOrphans = options.delete ?? false;

  // ----- Validate type argument -----
  const typeArgs = options.type ?? [];
  const syncTypes: SyncType[] = [];
  for (const t of typeArgs) {
    if (t === 'music' || t === 'video') {
      if (!syncTypes.includes(t)) syncTypes.push(t);
    } else if (t !== 'all') {
      throw new CliError({
        message: `Invalid sync type: ${t}. Valid values: music, video`,
        code: SyncErrorCodes.INVALID_SYNC_TYPE,
        details: { dryRun },
        printText: (o) => {
          o.error(`Invalid sync type: ${t}`);
          o.error('Valid values: music, video');
        },
      });
    }
  }
  // If no types specified or 'all' was included, sync everything
  const syncType: SyncType | undefined = syncTypes.length === 1 ? syncTypes[0] : undefined;

  // ----- Resolve device -----
  const cliDeviceArg = parseCliDeviceArg(globalOpts.device, config);
  const deviceResult = resolveEffectiveDevice(cliDeviceArg, undefined, config);

  // When no --device flag and no default configured, defer to auto-detect
  // (Scenario A). Auto-detection requires DeviceManager from @podkit/core,
  // so the actual detection happens after the core import below.
  const resolvedDevice = deviceResult.success ? deviceResult.device : undefined;
  const cliPath = deviceResult.success ? deviceResult.cliPath : undefined;
  const needsAutoDetect = !deviceResult.success && cliDeviceArg.type === 'none';

  if (!deviceResult.success && !needsAutoDetect) {
    throw new CliError({
      message: deviceResult.error,
      code: SyncErrorCodes.DEVICE_NOT_RESOLVED,
      details: { dryRun },
    });
  }

  // Derive all effective settings from device config.
  // Called once now and potentially re-called after auto-matching.
  // Uses the config resolver for device → global → default chain,
  // then overlays CLI options (highest priority).
  function deriveSettings(dc: DeviceConfig | undefined) {
    const resolved = resolveDeviceSettings(config, '', dc ?? {}, null, false, false);

    return {
      transforms: getEffectiveTransforms(config.transforms, dc),
      videoTransforms: getEffectiveVideoTransforms(config.videoTransforms, dc),
      quality: options.audioQuality
        ? (options.audioQuality as QualityPreset)
        : options.quality
          ? (options.quality as QualityPreset)
          : resolved.audio.value,
      videoQuality: options.videoQuality
        ? (options.videoQuality as VideoQualityPreset)
        : options.quality
          ? (options.quality as VideoQualityPreset)
          : (resolved.video.value ?? ('high' as VideoQualityPreset)),
      artwork: options.artwork !== undefined ? options.artwork : (resolved.artwork.value ?? true),
      skipUpgrades:
        options.skipUpgrades !== undefined ? options.skipUpgrades : resolved.skipUpgrades.value,
      encoding: options.encoding
        ? (options.encoding as import('@podkit/core').EncodingMode)
        : resolved.encoding.value,
      transferMode: options.transferMode
        ? (options.transferMode as import('@podkit/core').TransferMode)
        : resolved.transferMode.value,
      customBitrate: resolved.customBitrate.value,
      bitrateTolerance: resolved.bitrateTolerance.value,
    };
  }

  let deviceConfig = resolvedDevice?.config;

  // Determine device type — undefined or 'ipod' means iPod (backward compat)
  let deviceType = deviceConfig?.type;
  let isIpodDevice = !deviceType || deviceType === 'ipod';

  let derived = deriveSettings(deviceConfig);
  // Unpack into local variables that downstream code uses
  let effectiveTransforms = derived.transforms;
  let effectiveVideoTransforms = derived.videoTransforms;
  let effectiveQuality = derived.quality;
  let effectiveVideoQuality = derived.videoQuality;
  let effectiveArtwork = derived.artwork;
  let effectiveSkipUpgrades = derived.skipUpgrades;
  let effectiveEncoding = derived.encoding;
  let effectiveTransferMode = derived.transferMode;
  let effectiveCustomBitrate = derived.customBitrate;
  let effectiveBitrateTolerance = derived.bitrateTolerance;
  let cleanArtistsResolutionReason: CleanArtistsResolutionReason | undefined;
  let transformWarnings: TransformWarning[] = [];

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

    throw new CliError({
      message: errorMsg,
      code: options.collection
        ? SyncErrorCodes.COLLECTION_NOT_FOUND
        : SyncErrorCodes.NO_COLLECTIONS,
      details: { dryRun },
      printText: (o) => {
        if (options.collection) {
          o.error(`Collection "${options.collection}" not found in config.`);
          const musicNames = config.music ? Object.keys(config.music) : [];
          const videoNames = config.video ? Object.keys(config.video) : [];
          if (musicNames.length > 0) {
            o.error(`Available music collections: ${musicNames.join(', ')}`);
          }
          if (videoNames.length > 0) {
            o.error(`Available video collections: ${videoNames.join(', ')}`);
          }
          if (musicNames.length === 0 && videoNames.length === 0) {
            o.error(
              'No collections configured. Add collections to your config file or set PODKIT_MUSIC_PATH via environment variable.'
            );
          }
        } else {
          o.error('No collections configured to sync.');
          o.error('');
          o.error('Add collections to your config file:');
          if (configResult.configPath) {
            o.error(`  ${configResult.configPath}`);
          }
          o.error('');
          o.error('Example:');
          o.error('  [music.main]');
          o.error('  path = "/path/to/music"');
          o.error('');
          o.error('Or set via environment variable:');
          o.error('  PODKIT_MUSIC_PATH=/path/to/music');
        }
      },
    });
  }

  // Validate collection paths exist
  for (const collection of [...musicCollections, ...videoCollections]) {
    const collConfig = collection.config as MusicCollectionConfig | VideoCollectionConfig;
    const isSubsonic = 'type' in collConfig && collConfig.type === 'subsonic';
    if (!isSubsonic && collConfig.path && !existsSync(collConfig.path)) {
      throw new CliError({
        message: `Source directory not found: ${collConfig.path}`,
        code: SyncErrorCodes.SOURCE_NOT_FOUND,
        details: { dryRun, source: collConfig.path },
        printText: (o) => {
          o.error(`Source directory not found: ${collConfig.path}`);
          o.error(`  Collection: ${collection.name} (${collection.type})`);
        },
      });
    }
  }

  // ----- Load dependencies dynamically -----
  const core = await loadCoreOrFail(deps, SyncErrorCodes.CORE_LOAD_FAILED);

  // ----- Resolve device path -----
  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();
  let resolved: Awaited<ReturnType<typeof resolveDevicePath>>;

  if (needsAutoDetect) {
    // Scenario A: no --device flag, no default — auto-detect connected iPod
    resolved = await autoDetectDevice(manager, config);
  } else {
    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (deviceIdentity?.volumeUuid || deviceIdentity?.path) {
      out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
    }

    resolved = await resolveDevicePath({
      cliDevice: cliPath,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
      config,
    });
  }

  if (!resolved.path) {
    const message = resolved.error ?? formatDeviceError(resolved);
    throw new CliError({
      message,
      code: SyncErrorCodes.DEVICE_PATH_UNRESOLVED,
      details: { dryRun },
    });
  }

  // If auto-matching found a configured device, apply its settings
  if (resolved.matchedDevice) {
    deviceConfig = resolved.matchedDevice.config;
    derived = deriveSettings(deviceConfig);
    effectiveTransforms = derived.transforms;
    effectiveVideoTransforms = derived.videoTransforms;
    effectiveQuality = derived.quality;
    effectiveVideoQuality = derived.videoQuality;
    effectiveArtwork = derived.artwork;
    effectiveSkipUpgrades = derived.skipUpgrades;
    effectiveEncoding = derived.encoding;
    effectiveTransferMode = derived.transferMode;
    effectiveCustomBitrate = derived.customBitrate;
    effectiveBitrateTolerance = derived.bitrateTolerance;

    // Re-derive device type after auto-match (the matched device may have a type)
    deviceType = deviceConfig?.type;
    isIpodDevice = !deviceType || deviceType === 'ipod';

    out.verbose1(`Auto-matched device to configured device '${resolved.matchedDevice.name}'`);
  }

  // Show hint if resolver provided one (e.g., "Run 'podkit device add'")
  if (resolved.hint) {
    out.tip(resolved.hint);
  }

  const devicePath = resolved.path;

  if (!existsSync(devicePath)) {
    const label = isIpodDevice ? 'iPod' : 'Device';
    throw new CliError({
      message: `Device path not found: ${devicePath}`,
      code: SyncErrorCodes.DEVICE_PATH_NOT_FOUND,
      details: { dryRun, device: devicePath },
      printText: (o) => {
        o.error(`${label} not found at: ${devicePath}`);
        o.error('');
        o.error(`Make sure the ${label.toLowerCase()} is connected and mounted.`);
      },
    });
  }

  // ----- Unsupported-device gate (TASK-317.03) -----
  // Refuse cleanly before any heavy work (FFmpeg detect, DB open, planning)
  // when the cascade resolves to an unsupported generation. No track plan,
  // no DB open. Uses the same primitive (`assessIpodIdentity` →
  // `assessment.model?.unsupportedReason`) as `device add` / `device info` /
  // `doctor` so wording stays consistent.
  //
  // Also honours the `unsupported: true` opt-in flag persisted at `device add`
  // — that flag records the user's choice for visibility, but sync still
  // refuses because libgpod cannot produce a valid iTunesDB for these
  // generations regardless of consent.
  if (isIpodDevice) {
    let syncAssessment: import('@podkit/core').IpodIdentityAssessment | null = null;
    try {
      syncAssessment = await core.assessIpodIdentity(devicePath);
    } catch {
      // Assessment is best-effort — a failure here lets the normal sync path
      // continue and surface its own error. The cascade refusal we care
      // about (a known unsupported generation) only fires when assessment
      // actually returns a model with `unsupportedReason`.
    }
    const syncUnsupportedReason = syncAssessment?.model?.unsupportedReason;
    if (syncUnsupportedReason || deviceConfig?.unsupported) {
      const reason = syncUnsupportedReason ?? {
        kind: 'unsupported-device' as const,
        headline:
          'This device is recorded as unsupported in config. ' + 'podkit cannot sync to it.',
        docsUrl: core.DOCS_URLS.supportedDevices,
      };
      const lines = [reason.headline];
      if (reason.details) lines.push(...reason.details);
      lines.push(`See: ${reason.docsUrl ?? core.DOCS_URLS.supportedDevices}`);
      throw new CliError({
        message: lines.join('\n'),
        code: SyncErrorCodes.DEVICE_UNSUPPORTED,
        details: {
          dryRun,
          device: devicePath,
          unsupported: reason,
          ...(syncAssessment?.model?.generationId
            ? { generation: syncAssessment.model.generationId }
            : {}),
        },
        printText: (o) => {
          o.newline();
          o.error(reason.headline);
          if (reason.details) {
            for (const line of reason.details) {
              o.print(`  ${line}`);
            }
          }
          o.print(`See: ${reason.docsUrl ?? core.DOCS_URLS.supportedDevices}`);
        },
      });
    }
  }

  // ----- Check FFmpeg availability -----
  const transcoder = core.createFFmpegTranscoder();
  let transcoderCapabilities: import('@podkit/core').TranscoderCapabilities | undefined;
  try {
    transcoderCapabilities = await transcoder.detect();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FFmpeg not found';
    throw new CliError({
      message: `FFmpeg not available: ${message}`,
      code: SyncErrorCodes.FFMPEG_UNAVAILABLE,
      details: { dryRun, device: devicePath },
      printText: (o) => {
        o.error('FFmpeg not found or not functional.');
        o.error('');
        o.error('Install FFmpeg:');
        o.error('  macOS: brew install ffmpeg');
        o.error('  Ubuntu: apt install ffmpeg');
        if (o.isVerbose) {
          o.error('');
          o.error(`Details: ${message}`);
        }
      },
    });
  }

  // ----- Open device -----
  const spinnerLabel = isIpodDevice ? 'Opening iPod database...' : 'Opening device...';
  const dbSpinner = out.spinner(spinnerLabel);

  let openResult: import('./open-device.js').OpenDeviceResult;
  try {
    openResult = await openDevice(core, devicePath, deviceConfig, config.deviceDefaults);
  } catch (err) {
    dbSpinner.stop();
    const isIpodError = err instanceof core.IpodError;
    const message = err instanceof Error ? err.message : 'Failed to open device';

    if (isIpodDevice) {
      throw new CliError({
        message: `Failed to open iPod: ${message}`,
        code: SyncErrorCodes.IPOD_OPEN_FAILED,
        details: { dryRun, device: devicePath },
        printText: (o) => {
          o.error(`Cannot read iPod database at: ${devicePath}`);
          o.error('');
          if (isIpodError) {
            o.error('This path does not appear to be a valid iPod:');
            o.error('  - Missing iTunesDB file');
            o.error('  - Database may be corrupted');
          } else {
            o.error(`Error: ${message}`);
          }
          if (o.isVerbose) {
            o.error('');
            o.error(`Details: ${message}`);
          }
        },
      });
    } else {
      throw new CliError({
        message: `Failed to open device: ${message}`,
        code: SyncErrorCodes.DEVICE_OPEN_FAILED,
        details: { dryRun, device: devicePath },
        printText: (o) => o.error(`Failed to open device at: ${devicePath}`),
      });
    }
  }

  dbSpinner.stop(isIpodDevice ? 'iPod database opened' : 'Device opened');

  const adapter: import('@podkit/core').DeviceAdapter = openResult.adapter;
  const ipod = openResult.ipod;
  const deviceSupportsAlac = openResult.deviceSupportsAlac;
  const deviceCapabilities = openResult.capabilities;

  // Track overall results — declared here so they're visible after the
  // adapter try/finally block for the final summary.
  let totalCompleted = 0;
  let totalFailed = 0;
  let anyError = false;
  let totalArtworkMissingBaseline = 0;
  let totalTransferModeMismatch = 0;
  // Captured per-collection inside the music loop so the non-dry-run
  // aggregate JSON can surface decision provenance. Decisions are device-wide,
  // so the last collection's value is equivalent to any other's.
  let lastDecisions: import('./sync-decisions.js').SyncDecisions | undefined;

  const shutdown = createShutdownController();
  shutdown.install();

  try {
    // Apply capability-gated transform resolution
    if (deviceCapabilities) {
      const hasPerDeviceCleanArtists = deviceConfig?.transforms?.cleanArtists !== undefined;
      const resolution = resolveCleanArtistsTransform(
        effectiveTransforms,
        deviceCapabilities.supportsAlbumArtistBrowsing,
        hasPerDeviceCleanArtists
      );
      effectiveTransforms = resolution.transforms;
      cleanArtistsResolutionReason = resolution.reason;

      const hasCapabilityOverride = deviceConfig?.supportsAlbumArtistBrowsing !== undefined;
      transformWarnings = computeTransformWarnings(
        resolution,
        deviceCapabilities.supportsAlbumArtistBrowsing,
        hasCapabilityOverride
      );
    }

    // Pre-flight device validation (iPod only)
    if (ipod) {
      const ipodDeviceInfo = ipod.getInfo().device;
      if (ipodDeviceInfo) {
        const deviceValidation = core.validateDevice(ipodDeviceInfo, devicePath);

        if (!deviceValidation.supported) {
          const messages = core.formatValidationMessages(deviceValidation);
          throw new CliError({
            message: messages[0] ?? 'Device validation failed',
            code: SyncErrorCodes.DEVICE_UNSUPPORTED,
            details: { dryRun, device: devicePath },
            printText: (o) => {
              o.newline();
              for (const msg of messages) {
                o.print(msg);
              }
            },
          });
        }

        for (const issue of deviceValidation.issues) {
          out.warn(issue.message);
          if (issue.suggestion) {
            out.print(`  ${issue.suggestion}`);
          }
        }
      }
    }

    // ----- Resolve codec preferences -----
    // Per-key fallback (device → global → default). Object-level coalesce
    // would let `[devices.<n>.codec] lossless = [...]` silently shadow a
    // global `[codec] lossy = [...]`; per-key keeps each stack pinned to
    // the most-specific level that defined it.
    const lossyStack =
      deviceConfig?.codec?.lossy ?? config.codec?.lossy ?? core.DEFAULT_LOSSY_STACK;
    const losslessStack =
      deviceConfig?.codec?.lossless ?? config.codec?.lossless ?? core.DEFAULT_LOSSLESS_STACK;
    // Synthetic effective object — downstream consumers (music-presenter,
    // MusicContentConfig) read the resolved per-key stacks via this shape.
    const effectiveCodecPreference = { lossy: [...lossyStack], lossless: [...losslessStack] };
    // Source attribution mirrors the resolution chain — independently per key.
    const lossyCodecSource: 'device' | 'global' | 'default' =
      deviceConfig?.codec?.lossy !== undefined
        ? 'device'
        : config.codec?.lossy !== undefined
          ? 'global'
          : 'default';
    const losslessCodecSource: 'device' | 'global' | 'default' =
      deviceConfig?.codec?.lossless !== undefined
        ? 'device'
        : config.codec?.lossless !== undefined
          ? 'global'
          : 'default';
    let resolvedLossyCodec: string | undefined;

    if (hasMusicToSync && deviceCapabilities) {
      const deviceCodecSet = new Set<string>(deviceCapabilities.supportedAudioCodecs);
      for (const codec of lossyStack) {
        if (deviceCodecSet.has(codec)) {
          resolvedLossyCodec = codec;
          break;
        }
      }

      if (!resolvedLossyCodec) {
        throw new CliError({
          message: `No compatible lossy codec found. Preference: ${lossyStack.join(', ')}. Device supports: ${deviceCapabilities.supportedAudioCodecs.join(', ')}`,
          code: SyncErrorCodes.NO_COMPATIBLE_CODEC,
          details: { dryRun, device: devicePath },
        });
      }
    }

    // ----- Sync Music Collections -----
    if (hasMusicToSync) {
      for (const collection of musicCollections) {
        const musicCollectionConfig = collection.config as MusicCollectionConfig;
        const sourcePath =
          musicCollectionConfig.type === 'subsonic'
            ? musicCollectionConfig.url!
            : musicCollectionConfig.path;

        if (musicCollections.length > 1) {
          out.newline();
          out.print(`=== Music: ${collection.name} ===`);
        }

        // Resolve once for both checkArtwork value and decisions provenance.
        const resolvedForDecisions = resolveDeviceSettings(
          config,
          '',
          deviceConfig ?? {},
          null,
          false,
          false
        );
        // The lossless stack may be the literal string 'source' (pass-through
        // sentinel). Normalise to null for the JSON shape — `null` means "no
        // lossless transcode target chosen". The preference array itself
        // preserves 'source' as the first entry for assertion purposes.
        const firstLossless = losslessStack[0];
        const resolvedLossless =
          firstLossless === 'source' || firstLossless === undefined ? null : firstLossless;
        const decisions = buildSyncDecisions({
          resolved: {
            transferMode: resolvedForDecisions.transferMode,
            audio: resolvedForDecisions.audio,
            checkArtwork: resolvedForDecisions.checkArtwork,
          },
          overrides: {
            transferMode: options.transferMode,
            quality: options.quality,
            audioQuality: options.audioQuality,
            checkArtwork: options.checkArtwork,
          },
          resolvedLossyCodec,
          resolvedLosslessCodec: resolvedLossless,
          lossyPreference: lossyStack,
          losslessPreference: losslessStack,
          // Per-key codec source attribution — see `lossyCodecSource` /
          // `losslessCodecSource` above. Treats key presence as "user
          // configured" (presence, not length) so `[codec] lossy = []` still
          // attributes to global.
          lossyCodecSource,
          losslessCodecSource,
        });
        // Capture for the aggregate non-dry-run JSON emitted after all
        // collections complete (sync.ts further down). Decisions are
        // device-wide — the last collection's decisions are equivalent.
        lastDecisions = decisions;

        const musicConfig: MusicContentConfig = {
          type: 'music',
          effectiveTransforms,
          cleanArtistsResolutionReason,
          transformWarnings,
          effectiveQuality,
          effectiveEncoding,
          effectiveTransferMode,
          effectiveCustomBitrate,
          effectiveBitrateTolerance,
          deviceSupportsAlac,
          effectiveArtwork,
          skipUpgrades: effectiveSkipUpgrades,
          forceTranscode: options.forceTranscode ?? config.forceTranscode ?? false,
          forceTransferMode: options.forceTransferMode ?? config.forceTransferMode ?? false,
          forceSyncTags: options.forceSyncTags ?? config.forceSyncTags ?? false,
          forceMetadata: options.forceMetadata ?? false,
          checkArtwork: decisions.checkArtwork.value,
          transcoder,
          capabilities: deviceCapabilities,
          effectiveCodecPreference,
          resolvedLossyCodec,
          lossyPreferenceStack: [...lossyStack],
          transcoderCapabilities,
          decisions,
        };
        const result = await genericSyncCollection(
          new MusicPresenter(),
          out,
          collection,
          sourcePath,
          devicePath,
          dryRun,
          removeOrphans,
          musicConfig,
          adapter,
          core,
          shutdown.signal,
          shutdown
        );

        if (result.jsonOutput && out.isJson) {
          out.json(result.jsonOutput);
        }

        totalCompleted += result.completed;
        totalFailed += result.failed;
        totalArtworkMissingBaseline += result.artworkMissingBaseline ?? 0;
        totalTransferModeMismatch += result.transferModeMismatch ?? 0;
        if (!result.success) {
          anyError = true;
        }

        if (result.interrupted) {
          if (!dryRun && totalCompleted > 0) {
            out.print('Saving device database...');
            await adapter.save();
            out.print('Database saved. Sync interrupted.');
          }
          out.setExitCode(130);
          break;
        }
      }
    }

    // ----- Sync Video Collections -----
    if (hasVideoToSync && !shutdown.isShuttingDown) {
      // Check video support via device capabilities
      if (!(deviceCapabilities?.supportsVideo ?? false)) {
        const explicitVideo = syncType === 'video';
        out.newline();
        if (explicitVideo) {
          out.warn('This device does not support video playback. No video files will be synced.');
        } else {
          out.print('Skipping video: device does not support video playback.');
        }
      } else {
        for (const collection of videoCollections) {
          const sourcePath = (collection.config as VideoCollectionConfig).path;

          out.newline();
          out.print(`=== Video: ${collection.name} ===`);

          const videoConfig: VideoContentConfig = {
            type: 'video',
            effectiveVideoQuality,
            effectiveVideoTransforms,
            effectiveTransferMode,
            forceMetadata: options.forceMetadata ?? false,
          };
          const result = await genericSyncCollection(
            new VideoPresenter(),
            out,
            collection,
            sourcePath,
            devicePath,
            dryRun,
            removeOrphans,
            videoConfig,
            adapter,
            core,
            shutdown.signal,
            shutdown
          );

          if (result.jsonOutput && out.isJson) {
            out.json(result.jsonOutput);
          }

          totalCompleted += result.completed;
          totalFailed += result.failed;
          if (!result.success) {
            anyError = true;
          }

          if (result.interrupted) {
            if (!dryRun && totalCompleted > 0) {
              out.print('Saving device database...');
              await adapter.save();
              out.print('Database saved. Video sync interrupted.');
            }
            out.setExitCode(130);
            break;
          }
        }

        // Save database after video sync (not in dry-run)
        if (!dryRun && !shutdown.isShuttingDown) {
          await adapter.save();
        }
      }
    }

    // Final summary
    const duration = (Date.now() - startTime) / 1000;

    if (shutdown.isShuttingDown) {
      // Interrupted — show abbreviated summary, skip eject
      if (!dryRun) {
        out.newline();
        out.print('=== Sync Interrupted ===');
        out.newline();
        if (totalCompleted > 0) {
          out.print(`Saved ${formatNumber(totalCompleted)} completed items to device.`);
        }
        if (totalFailed > 0) {
          out.print(`${formatNumber(totalFailed)} items failed before interruption.`);
        }
        out.print(`Duration: ${formatDuration(duration)}`);
      }
    } else {
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

      // Discover sibling volumes for dual-LUN devices before ejecting
      let siblingMountPoints: string[] = [];
      if (options.eject && syncSucceeded) {
        try {
          siblingMountPoints = await manager.getSiblingVolumes(devicePath);
        } catch {
          // Best-effort
        }
      }

      // JSON output for actual sync completion
      if (!dryRun && out.isJson) {
        let ejectInfo: SyncOutput['eject'];
        if (options.eject && syncSucceeded) {
          const ejectResult = await core.ejectWithRetry(manager, devicePath, {
            additionalMountPoints: siblingMountPoints,
          });
          ejectInfo = {
            requested: true,
            success: ejectResult.success,
            error: ejectResult.error,
          };
        }

        const cleanRun = totalFailed === 0 && !anyError;
        out.json({
          success: true,
          status: cleanRun ? 'ok' : 'partial-failure',
          dryRun: false,
          decisions: lastDecisions,
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

      // Show tips at end of sync
      if (totalArtworkMissingBaseline > 0 || totalTransferModeMismatch > 0) {
        out.printTips({
          artworkMissingBaseline: totalArtworkMissingBaseline || undefined,
          transferModeMismatch: totalTransferModeMismatch || undefined,
        });
      }

      // Show eject tip or auto-eject on successful sync
      if (syncSucceeded && out.isText) {
        if (options.eject) {
          out.newline();
          const ejectResult = await core.ejectWithRetry(manager, devicePath, {
            additionalMountPoints: siblingMountPoints,
            onProgress: (event) => {
              switch (event.phase) {
                case 'sync':
                  out.verbose1(event.message);
                  break;
                case 'eject':
                case 'waiting':
                  out.print(event.message);
                  break;
                case 'eject-sibling':
                  out.verbose1(event.message);
                  break;
              }
            },
          });
          if (ejectResult.success) {
            out.print('Device ejected. Safe to disconnect.');
          } else {
            out.print('Could not eject device automatically.');
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
        // Sync ran cleanly but some items failed — exit 2 distinguishes
        // this from a command error (exit 1).
        out.setExitCode(2);
      }
    }
  } finally {
    shutdown.uninstall();
    adapter.close();
  }
}
