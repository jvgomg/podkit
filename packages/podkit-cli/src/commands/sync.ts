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
import { OutputContext, formatDurationSeconds, renderProgressBar } from '../output/index.js';
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
  LOCK_HELD: 'LOCK_HELD',
  LOCK_UNAVAILABLE: 'LOCK_UNAVAILABLE',
} as const;
export type SyncErrorCode = (typeof SyncErrorCodes)[keyof typeof SyncErrorCodes];

/**
 * Exit code emitted when another podkit process holds the per-device sync
 * lock. Distinct from the generic command-error code (1) and the
 * partial-failure code (2) so callers (including the daemon) can branch
 * on it without scraping stderr.
 */
export const SYNC_LOCK_HELD_EXIT_CODE = 4;

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
import { runCollectionPhase } from './sync-collection-phase.js';
import { buildSyncDecisions } from './sync-decisions.js';
import { printInterruptedSummary, printSuccessSummary } from './sync-summary-render.js';
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

// JSON envelope types live in `./sync-output-types.ts` — imported here
// for sync.ts's own internal use and re-exported so existing consumers
// (test surface in ../types.ts, the music/video presenters) keep their
// familiar `from './sync.js'` import paths.
import type {
  ErrorInfo,
  WarningInfo,
  ScanWarningInfo,
  TransformInfo,
  UpdateBreakdown,
  VideoSummary,
  SyncOutput,
} from './sync-output-types.js';
export type {
  ErrorInfo,
  WarningInfo,
  ScanWarningInfo,
  TransformInfo,
  UpdateBreakdown,
  VideoSummary,
  SyncOutput,
} from './sync-output-types.js';

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
 * Compact human-readable bytes for the pre-sync sweep preamble line.
 * Inline here rather than imported from core to keep the CLI's text
 * rendering self-contained.
 */
function formatPreambleBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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

  // ----- Acquire per-device sync lock -----
  //
  // Dry-run is read-only by design — it inspects state without writing
  // to the iTunesDB, manifest, or track files. The lock exists to prevent
  // concurrent corrupt writes, so dry-run does NOT take the lock. Trade-off:
  // a dry-run inspecting state during a concurrent real sync may show a
  // stale plan, but it cannot cause corruption.
  //
  // Lock path:
  //   - mass-storage: `<mountPoint>/.podkit/sync.lock` (we create
  //     `.podkit/` if needed; virgin devices have no such dir yet).
  //   - iPod:         `<mountPoint>/iPod_Control/.podkit-sync.lock`
  //                   (iPod_Control already exists; no extra mkdir).
  let lockHandle: import('@podkit/core').LockHandle | null = null;
  if (!dryRun) {
    const lockPath = await core.resolveSyncLockPath(devicePath, isIpodDevice);
    try {
      lockHandle = await core.acquireLock(lockPath);
    } catch (err) {
      // Close the adapter we just opened so we don't leak a database
      // handle when another process is already syncing.
      try {
        adapter.close();
      } catch {
        // Best-effort.
      }
      if (err instanceof core.LockHeldError) {
        const heldPid = err.pid;
        throw new CliError({
          message: `Another podkit process is already syncing ${devicePath} (pid ${heldPid}). Wait for it to finish or kill it.`,
          code: SyncErrorCodes.LOCK_HELD,
          exitCode: SYNC_LOCK_HELD_EXIT_CODE,
          details: { device: devicePath, holderPid: heldPid, lockPath: err.lockPath },
          printText: (o) => {
            o.error(`Another podkit process is already syncing ${devicePath} (pid ${heldPid}).`);
            o.error('Wait for it to finish or kill it.');
            if (o.isVerbose) {
              o.error('');
              o.error(`Lock file: ${err.lockPath}`);
            }
          },
        });
      }
      if (err instanceof core.LockContestedError) {
        throw new CliError({
          message: err.message,
          code: SyncErrorCodes.LOCK_HELD,
          exitCode: SYNC_LOCK_HELD_EXIT_CODE,
          details: { device: devicePath, lockPath: err.lockPath },
          printText: (o) => {
            o.error(err.message);
          },
        });
      }
      if (err instanceof core.LockUnavailableError) {
        // FS-level write refusal on the lock path itself (e.g.
        // `.podkit/` chmod 0555, read-only mount, ext4 +i). Surface as
        // a typed error so the matrix observes errorCategory + JS-stack
        // hygiene rather than an uncaught EACCES propagating past the
        // sync orchestrator.
        throw new CliError({
          message: err.message,
          code: SyncErrorCodes.LOCK_UNAVAILABLE,
          details: { device: devicePath, lockPath: err.lockPath, errno: err.code },
          printText: (o) => {
            o.error(`Cannot acquire sync lock at ${err.lockPath} (${err.code}).`);
            o.error(
              'The directory containing the lock file is not writable. ' +
                'Check permissions and that the device is mounted read-write.'
            );
          },
        });
      }
      throw err;
    }
  }

  // Track overall results — declared here so they're visible after the
  // adapter try/finally block for the final summary.
  let totalCompleted = 0;
  let totalFailed = 0;
  let anyError = false;
  let totalArtworkMissingBaseline = 0;
  let totalTransferModeMismatch = 0;
  const allWarnings: import('@podkit/core').Warning[] = [];
  const allErrors: import('../output/index.js').CollectedError[] = [];
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

    // ----- Pre-sync debris sweep (TASK-398) -----
    //
    // Run once per device sync, before any track ops. The result is
    // attached to the FIRST collection's plan only (subsequent plans see
    // undefined) so the executor's pre-flight runs cleanup exactly once
    // even when music + video share a device. Sweep failures are
    // non-fatal — the next sync retries.
    let preSyncPreliminaries: import('@podkit/core').PlanPreliminaries | undefined;
    try {
      const deviceType: 'ipod' | 'mass-storage' = isIpodDevice ? 'ipod' : 'mass-storage';
      preSyncPreliminaries = await core.runPreSyncSweep({
        mountPoint: devicePath,
        deviceType,
        contentPaths: openResult.contentPaths,
      });
      const hasWork =
        (preSyncPreliminaries.debrisCleanup?.paths.length ?? 0) > 0 ||
        (preSyncPreliminaries.phantomPrune?.paths.length ?? 0) > 0;
      if (hasWork && !out.isJson) {
        const debrisCount = preSyncPreliminaries.debrisCleanup?.paths.length ?? 0;
        const totalBytes = preSyncPreliminaries.debrisCleanup?.totalBytes ?? 0;
        if (debrisCount > 0) {
          const action = dryRun ? 'Would clean' : 'Cleaning';
          const bytesStr = formatPreambleBytes(totalBytes);
          out.print(
            `${action} ${debrisCount} incomplete-write file${debrisCount === 1 ? '' : 's'} (${bytesStr}) from a previous interrupted sync`
          );
        }
        const phantomCount = preSyncPreliminaries.phantomPrune?.paths.length ?? 0;
        if (phantomCount > 0) {
          out.print(
            `Detected ${phantomCount} phantom manifest entr${phantomCount === 1 ? 'y' : 'ies'} — run \`podkit doctor --repair orphan-files\` to prune.`
          );
        }
      }
    } catch (sweepError) {
      // Top-level sweep failures are non-fatal — the next sync retries.
      // But silence is wrong: the user just lost their automatic debris
      // cleanup and may need to fall back to `podkit doctor --repair
      // debris-files` if the failure is persistent. Surface a single
      // warning so the cause isn't invisible.
      preSyncPreliminaries = undefined;
      const message = sweepError instanceof Error ? sweepError.message : String(sweepError);
      if (!out.isJson) {
        out.warn(
          `Pre-sync debris sweep failed: ${message}. Sync will proceed without cleanup; run \`podkit doctor --repair debris-files\` if debris persists.`
        );
      }
      // Also push into the run-level warning accumulator so JSON consumers
      // see it on the aggregate envelope at the end of the sync.
      allWarnings.push({
        phase: 'plan',
        type: 'debris-cleanup-failure',
        message: `Pre-sync sweep failed: ${message}`,
        tracks: [],
      });
    }
    // Flag: only the FIRST collection's genericSyncCollection call
    // receives the preliminaries. After that, the executor's pre-flight
    // for any subsequent plan sees undefined and short-circuits.
    let preliminariesConsumed = false;

    // ----- Sync Music Collections -----
    if (hasMusicToSync) {
      // Decision provenance + music content config are device-wide, not
      // per-collection — hoisted out of the loop so they're built once
      // per sync regardless of collection count.
      //
      // The `''` second arg is the device-name slot in the resolver.
      // It populates `resolvedForDecisions.name` only, which we don't
      // read here (we only consume `.transferMode`, `.audio`,
      // `.checkArtwork`), so the empty string is safe.
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

      const musicResult = await runCollectionPhase(
        {
          presenter: new MusicPresenter(),
          collections: musicCollections,
          contentConfig: musicConfig,
          renderPerCollectionHeader: musicCollections.length > 1,
          preSyncPreliminaries: preliminariesConsumed ? undefined : preSyncPreliminaries,
          priorPhaseCompleted: totalCompleted,
        },
        { out, adapter, core, shutdown, dryRun, removeOrphans, devicePath }
      );

      if (musicResult.consumedPreliminaries) preliminariesConsumed = true;
      totalCompleted += musicResult.completed;
      totalFailed += musicResult.failed;
      totalArtworkMissingBaseline += musicResult.artworkMissingBaseline;
      totalTransferModeMismatch += musicResult.transferModeMismatch;
      allWarnings.push(...musicResult.warnings);
      allErrors.push(...musicResult.errors);
      if (musicResult.anyError) anyError = true;
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
        const videoConfig: VideoContentConfig = {
          type: 'video',
          effectiveVideoQuality,
          effectiveVideoTransforms,
          effectiveTransferMode,
          forceMetadata: options.forceMetadata ?? false,
        };

        const videoResult = await runCollectionPhase(
          {
            presenter: new VideoPresenter(),
            collections: videoCollections,
            contentConfig: videoConfig,
            renderPerCollectionHeader: true,
            preSyncPreliminaries: preliminariesConsumed ? undefined : preSyncPreliminaries,
            priorPhaseCompleted: totalCompleted,
          },
          { out, adapter, core, shutdown, dryRun, removeOrphans, devicePath }
        );

        if (videoResult.consumedPreliminaries) preliminariesConsumed = true;
        totalCompleted += videoResult.completed;
        totalFailed += videoResult.failed;
        allWarnings.push(...videoResult.warnings);
        allErrors.push(...videoResult.errors);
        if (videoResult.anyError) anyError = true;
        // Final save lives inside the engine executor now
        // (`sync/engine/executor.ts` — matches the music pipeline's
        // post-loop save at `sync/music/pipeline.ts:1349`). The
        // interrupt-path save lives in `runCollectionPhase`.
      }
    }

    // Final summary
    const duration = (Date.now() - startTime) / 1000;

    if (shutdown.isShuttingDown) {
      // Interrupted — show abbreviated summary, skip eject
      printInterruptedSummary(out, {
        dryRun,
        totalCompleted,
        totalFailed,
        durationSeconds: duration,
      });
    } else {
      const syncSucceeded = !dryRun && totalFailed === 0 && !anyError;

      printSuccessSummary(out, {
        dryRun,
        totalCompleted,
        totalFailed,
        durationSeconds: duration,
        allWarnings,
      });

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
        const warningInfos =
          allWarnings.length > 0
            ? allWarnings.map((w) => ({
                phase: w.phase,
                type: w.type,
                message: w.message,
                trackCount: w.tracks.length,
                tracks: out.isVerbose && w.tracks.length > 0 ? w.tracks : undefined,
              }))
            : undefined;
        const errorInfos: ErrorInfo[] | undefined =
          allErrors.length > 0
            ? allErrors.map((e) => ({
                track: e.trackName,
                category: e.category,
                message: e.message,
                retryAttempts: e.retryAttempts,
                wasRetried: e.wasRetried,
                ...(e.stack !== undefined ? { stack: e.stack } : {}),
                ...(e.errorClass !== undefined ? { class: e.errorClass } : {}),
                ...(e.causes !== undefined ? { causes: e.causes } : {}),
              }))
            : undefined;
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
          warnings: warningInfos,
          errors: errorInfos,
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
    // Release the per-device sync lock only if we actually acquired it.
    // Dry-run skips the lock entirely (lockHandle stays null). Idempotent —
    // safe even if a prior path already released. Errors are swallowed: an
    // unlinkable lock file is harmless because the next sync's liveness
    // probe will reclaim it.
    if (lockHandle !== null) {
      try {
        await lockHandle.release();
      } catch {
        // See LockHandle.release: tolerant by design.
      }
    }
  }
}
