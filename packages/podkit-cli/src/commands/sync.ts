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
  'soundcheck-update'?: number;
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
 * JSON output structure for sync command
 */
export interface SyncOutput {
  success: boolean;
  dryRun: boolean;
  source?: string;
  device?: string;
  quality?: string;
  codec?: string;
  codecPreference?: string[];
  transferMode?: string;
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
 * Get effective transfer mode
 *
 * Resolution order: device transferMode > global transferMode > 'fast' (default)
 */
function getEffectiveTransferMode(
  config: PodkitConfig,
  deviceConfig?: DeviceConfig
): import('@podkit/core').TransferMode {
  return deviceConfig?.transferMode ?? config.transferMode ?? 'fast';
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

    // When no --device flag and no default configured, defer to auto-detect
    // (Scenario A). Auto-detection requires DeviceManager from @podkit/core,
    // so the actual detection happens after the core import below.
    const resolvedDevice = deviceResult.success ? deviceResult.device : undefined;
    const cliPath = deviceResult.success ? deviceResult.cliPath : undefined;
    const needsAutoDetect = !deviceResult.success && cliDeviceArg.type === 'none';

    if (!deviceResult.success && !needsAutoDetect) {
      out.result(errorOutput(deviceResult.error), () => out.error(deviceResult.error));
      process.exitCode = 1;
      return;
    }

    // Derive all effective settings from device config.
    // Called once now and potentially re-called after auto-matching.
    function deriveSettings(dc: DeviceConfig | undefined) {
      return {
        transforms: getEffectiveTransforms(config.transforms, dc),
        videoTransforms: getEffectiveVideoTransforms(config.videoTransforms, dc),
        quality: options.audioQuality
          ? (options.audioQuality as QualityPreset)
          : options.quality
            ? (options.quality as QualityPreset)
            : getEffectiveAudioQuality(config, dc),
        videoQuality: options.videoQuality
          ? (options.videoQuality as VideoQualityPreset)
          : options.quality && isVideoQualityCompatible(options.quality as QualityPreset)
            ? (options.quality as VideoQualityPreset)
            : getEffectiveVideoQuality(config, dc),
        artwork:
          options.artwork !== undefined ? options.artwork : getEffectiveArtwork(config.artwork, dc),
        skipUpgrades:
          options.skipUpgrades !== undefined
            ? options.skipUpgrades
            : getEffectiveSkipUpgrades(config.skipUpgrades, dc),
        encoding: options.encoding
          ? (options.encoding as import('@podkit/core').EncodingMode)
          : getEffectiveEncoding(config, dc),
        transferMode: options.transferMode
          ? (options.transferMode as import('@podkit/core').TransferMode)
          : getEffectiveTransferMode(config, dc),
        customBitrate: getEffectiveCustomBitrate(config, dc),
        bitrateTolerance: getEffectiveBitrateTolerance(config, dc),
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
      out.result(errorOutput(resolved.error ?? formatDeviceError(resolved)), () =>
        out.error(resolved.error ?? formatDeviceError(resolved))
      );
      process.exitCode = 1;
      return;
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
      out.result(
        {
          success: false,
          dryRun,
          device: devicePath,
          error: `Device path not found: ${devicePath}`,
        },
        () => {
          const label = isIpodDevice ? 'iPod' : 'Device';
          out.error(`${label} not found at: ${devicePath}`);
          out.error('');
          out.error(`Make sure the ${label.toLowerCase()} is connected and mounted.`);
        }
      );
      process.exitCode = 1;
      return;
    }

    // ----- Check FFmpeg availability -----
    const transcoder = core.createFFmpegTranscoder();
    let transcoderCapabilities: import('@podkit/core').TranscoderCapabilities | undefined;
    try {
      transcoderCapabilities = await transcoder.detect();
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

    // ----- Open device -----
    let adapter: import('@podkit/core').DeviceAdapter;
    let ipod: Awaited<ReturnType<typeof core.IpodDatabase.open>> | undefined;
    let deviceSupportsAlac = false;
    let deviceCapabilities: import('@podkit/core').DeviceCapabilities | undefined;

    {
      const spinnerLabel = isIpodDevice ? 'Opening iPod database...' : 'Opening device...';
      const dbSpinner = out.spinner(spinnerLabel);

      let deviceResult: import('./open-device.js').OpenDeviceResult;
      try {
        deviceResult = await openDevice(core, devicePath, deviceConfig, config.deviceDefaults);
      } catch (err) {
        dbSpinner.stop();
        const isIpodError = err instanceof core.IpodError;
        const message = err instanceof Error ? err.message : 'Failed to open device';

        if (isIpodDevice) {
          out.result(
            {
              success: false,
              dryRun,
              device: devicePath,
              error: `Failed to open iPod: ${message}`,
            },
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
        } else {
          out.result(errorOutput(`Failed to open device: ${message}`), () =>
            out.error(`Failed to open device at: ${devicePath}`)
          );
        }
        process.exitCode = 1;
        return;
      }

      dbSpinner.stop(isIpodDevice ? 'iPod database opened' : 'Device opened');

      adapter = deviceResult.adapter;
      ipod = deviceResult.ipod;
      deviceSupportsAlac = deviceResult.deviceSupportsAlac;
      deviceCapabilities = deviceResult.capabilities;

      // Pre-flight device validation (iPod only)
      if (ipod) {
        const ipodDeviceInfo = ipod.getInfo().device;
        if (ipodDeviceInfo) {
          const deviceValidation = core.validateDevice(ipodDeviceInfo, devicePath);

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

          for (const issue of deviceValidation.issues) {
            out.warn(issue.message);
            if (issue.suggestion) {
              out.print(`  ${issue.suggestion}`);
            }
          }
        }
      }
    }

    // ----- Resolve codec preferences -----
    const effectiveCodecPreference = deviceConfig?.codec ?? config.codec ?? undefined;
    const lossyStack = effectiveCodecPreference?.lossy ?? core.DEFAULT_LOSSY_STACK;
    let resolvedLossyCodec: string | undefined;

    if (hasMusicToSync && deviceCapabilities) {
      const deviceCodecSet = new Set<string>(deviceCapabilities.supportedAudioCodecs);
      // Simple resolution: find first lossy codec supported by device
      // (full resolution with encoder availability happens in the handler)
      for (const codec of lossyStack) {
        if (deviceCodecSet.has(codec)) {
          resolvedLossyCodec = codec;
          break;
        }
      }

      if (!resolvedLossyCodec) {
        const errorMsg = `No compatible lossy codec found. Preference: ${lossyStack.join(', ')}. Device supports: ${deviceCapabilities.supportedAudioCodecs.join(', ')}`;
        out.result(errorOutput(errorMsg), () => out.error(errorMsg));
        adapter.close();
        process.exitCode = 1;
        return;
      }
    }

    // Track overall results
    let totalCompleted = 0;
    let totalFailed = 0;
    let anyError = false;
    let totalArtworkMissingBaseline = 0;
    let totalTransferModeMismatch = 0;

    const shutdown = createShutdownController();
    shutdown.install();

    try {
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

          const musicConfig: MusicContentConfig = {
            type: 'music',
            effectiveTransforms,
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
            checkArtwork:
              options.checkArtwork ?? getEffectiveCheckArtwork(config.checkArtwork, deviceConfig),
            transcoder,
            capabilities: deviceCapabilities,
            effectiveCodecPreference,
            resolvedLossyCodec,
            lossyPreferenceStack: [...lossyStack],
            transcoderCapabilities,
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
            process.exitCode = 130;
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
              process.exitCode = 130;
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

        // JSON output for actual sync completion
        if (!dryRun && out.isJson) {
          let ejectInfo: SyncOutput['eject'];
          if (options.eject && syncSucceeded) {
            const ejectResult = await core.ejectWithRetry(manager, devicePath);
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
              onProgress: (event) => {
                switch (event.phase) {
                  case 'sync':
                    out.verbose1(event.message);
                    break;
                  case 'eject':
                  case 'waiting':
                    out.print(event.message);
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
          process.exitCode = 1;
        }
      }
    } finally {
      shutdown.uninstall();
      adapter.close();
    }
  });
