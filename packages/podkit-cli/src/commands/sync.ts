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
 * podkit sync music                      # Sync music only
 * podkit sync video                      # Sync video only
 * podkit sync -c main                    # Sync collection named "main" (both namespaces)
 * podkit sync -c main music              # Sync music collection named "main"
 * podkit sync -d terapod                 # Sync to device named "terapod"
 * podkit sync music -c main              # Sync music collection named "main"
 * podkit sync --dry-run                  # Preview changes
 * podkit sync --delete                   # Remove orphaned tracks
 * podkit sync --quality medium           # Use medium quality preset
 * ```
 */
import { existsSync, statfsSync } from 'node:fs';
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
import { resolveDevicePath, formatDeviceError, getDeviceIdentity } from '../device-resolver.js';
import type { IPodVideo, CollectionVideo } from '@podkit/core';
import { MediaType } from '@podkit/core';

// =============================================================================
// Types
// =============================================================================

/**
 * AAC-only quality presets (for fallback)
 */
type AacQualityPreset = Exclude<QualityPreset, 'alac'>;

/**
 * Valid sync types
 */
type SyncType = 'music' | 'video';

/**
 * Sync command options
 */
interface SyncOptions {
  dryRun?: boolean;
  quality?: QualityPreset;
  fallback?: AacQualityPreset;
  filter?: string;
  artwork?: boolean;
  delete?: boolean;
  collection?: string;
  deviceName?: string;
  videoQuality?: VideoQualityPreset;
}

/**
 * Categorized error info for JSON output
 */
interface ErrorInfo {
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
interface PlanWarningInfo {
  type: string;
  message: string;
  trackCount: number;
  tracks?: string[];
}

/**
 * Execution warning info for JSON output (artwork, metadata issues during sync)
 */
interface ExecutionWarningInfo {
  type: string;
  track: string;
  message: string;
}

/**
 * Scan warning info for JSON output (file parsing issues)
 */
interface ScanWarningInfo {
  file: string;
  message: string;
}

/**
 * Transform info for JSON output
 */
interface TransformInfo {
  name: string;
  enabled: boolean;
  mode?: string;
  format?: string;
}

/**
 * Update breakdown by reason for JSON output
 */
interface UpdateBreakdown {
  'transform-apply'?: number;
  'transform-remove'?: number;
  'metadata-changed'?: number;
}

/**
 * JSON output structure for sync command
 */
interface SyncOutput {
  success: boolean;
  dryRun: boolean;
  source?: string;
  device?: string;
  transforms?: TransformInfo[];
  plan?: {
    tracksToAdd: number;
    tracksToRemove: number;
    tracksToUpdate: number;
    updateBreakdown?: UpdateBreakdown;
    tracksToTranscode: number;
    tracksToCopy: number;
    estimatedSize: number;
    estimatedTime: number;
  };
  operations?: Array<{
    type: 'transcode' | 'copy' | 'remove' | 'update-metadata' | 'video-transcode' | 'video-copy';
    track: string;
    status?: 'pending' | 'completed' | 'failed' | 'skipped';
    error?: string;
    changes?: Array<{ field: string; from: string; to: string }>;
  }>;
  result?: {
    completed: number;
    failed: number;
    skipped: number;
    bytesTransferred: number;
    duration: number;
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
 * Format bytes as human-readable size
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const value = bytes / Math.pow(k, i);

  return `${value.toFixed(decimals)} ${sizes[i]}`;
}

/**
 * Format duration in seconds as human-readable time
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format a number with thousands separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Get storage information for a mount point
 */
function getStorageInfo(
  mountpoint: string
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
 * Simple spinner for CLI progress
 */
class Spinner {
  private frames = ['|', '/', '-', '\\'];
  private current = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private message = '';

  start(message: string): void {
    this.message = message;
    this.interval = setInterval(() => {
      // \x1b[K clears from cursor to end of line to prevent remnant characters
      process.stdout.write(`\r\x1b[K${this.frames[this.current]} ${this.message}`);
      this.current = (this.current + 1) % this.frames.length;
    }, 100);
  }

  update(message: string): void {
    this.message = message;
  }

  stop(finalMessage?: string): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    // \x1b[K clears from cursor to end of line to prevent remnant characters
    if (finalMessage) {
      process.stdout.write(`\r\x1b[K${finalMessage}\n`);
    } else {
      process.stdout.write('\r\x1b[K');
    }
  }
}

/**
 * Progress bar for CLI
 */
export function renderProgressBar(current: number, total: number, width = 30): string {
  const percent = total > 0 ? current / total : 0;
  const filled = Math.round(width * percent);
  const empty = width - filled;
  const bar = '='.repeat(filled) + (filled < width ? '>' : '') + ' '.repeat(Math.max(0, empty - 1));
  const percentStr = `${Math.round(percent * 100)}%`.padStart(4);
  return `[${bar}] ${percentStr}`;
}

/**
 * Collected error for reporting
 */
interface CollectedError {
  trackName: string;
  category: string;
  message: string;
  retryAttempts: number;
  wasRetried: boolean;
  stack?: string;
}

/**
 * Format errors based on verbosity level
 *
 * Verbosity levels:
 * - 0 (normal): summary only ("5 tracks failed")
 * - 1 (-v): list failed track names
 * - 2 (-vv): show error type/category for each failure
 * - 3 (-vvv): full error details including stack traces
 */
function formatErrors(errors: CollectedError[], verbosity: number): string[] {
  const lines: string[] = [];

  if (errors.length === 0) {
    return lines;
  }

  // Always show summary
  lines.push('');
  lines.push(`Failed: ${errors.length} track${errors.length === 1 ? '' : 's'}`);

  if (verbosity === 0) {
    // Normal: just the summary count
    return lines;
  }

  lines.push('');

  if (verbosity === 1) {
    // -v: list track names
    for (const err of errors) {
      const retryInfo = err.wasRetried ? ` (retried ${err.retryAttempts}x)` : '';
      lines.push(`  - ${err.trackName}${retryInfo}`);
    }
  } else if (verbosity === 2) {
    // -vv: show error type for each
    for (const err of errors) {
      const retryInfo = err.wasRetried ? ` (retried ${err.retryAttempts}x)` : '';
      lines.push(`  - ${err.trackName}${retryInfo}`);
      lines.push(`    [${err.category}] ${err.message}`);
    }
  } else {
    // -vvv: full details including stack
    for (const err of errors) {
      const retryInfo = err.wasRetried ? ` (retried ${err.retryAttempts}x)` : '';
      lines.push(`  - ${err.trackName}${retryInfo}`);
      lines.push(`    Category: ${err.category}`);
      lines.push(`    Error: ${err.message}`);
      if (err.stack) {
        lines.push('    Stack trace:');
        const stackLines = err.stack.split('\n').slice(1); // Skip first line (error message)
        for (const stackLine of stackLines.slice(0, 5)) { // Limit to 5 lines
          lines.push(`      ${stackLine.trim()}`);
        }
        if (stackLines.length > 5) {
          lines.push(`      ... (${stackLines.length - 5} more)`);
        }
      }
      lines.push('');
    }
  }

  return lines;
}

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

  if (transforms.ftintitle.enabled) {
    if (transforms.ftintitle.drop) {
      parts.push('ftintitle: enabled (drop mode)');
    } else {
      parts.push(`ftintitle: enabled (format: "${transforms.ftintitle.format}")`);
    }
  }

  return parts.length > 0 ? parts.join(', ') : null;
}

/**
 * Format update reason for display
 */
function formatUpdateReason(reason: 'transform-apply' | 'transform-remove' | 'metadata-changed'): string {
  switch (reason) {
    case 'transform-apply':
      return 'Apply ftintitle';
    case 'transform-remove':
      return 'Revert ftintitle';
    case 'metadata-changed':
      return 'Metadata changed';
  }
}

/**
 * A grouped artist transform for the preview
 */
interface TransformPreviewEntry {
  originalArtist: string;
  transformedArtist: string;
  count: number;
}

/**
 * Build a transform preview from tracks that will have transforms applied
 *
 * Groups tracks by their unique artist transformation pattern and counts occurrences.
 * Used to show users a summary of how artists will be transformed before syncing.
 */
function buildTransformPreview(
  tracks: Array<{ artist: string; title: string; album: string }>,
  config: TransformsConfig,
  applyTransformsFn: (
    track: { artist: string; title: string; album: string },
    config: TransformsConfig
  ) => { original: { artist: string }; transformed: { artist: string }; applied: boolean }
): TransformPreviewEntry[] {
  // Map of "original → transformed" to count
  const transformMap = new Map<string, TransformPreviewEntry>();

  for (const track of tracks) {
    const result = applyTransformsFn(track, config);

    if (result.applied && result.original.artist !== result.transformed.artist) {
      const key = `${result.original.artist} → ${result.transformed.artist}`;
      const existing = transformMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        transformMap.set(key, {
          originalArtist: result.original.artist,
          transformedArtist: result.transformed.artist,
          count: 1,
        });
      }
    }
  }

  // Sort by count descending, then by original artist name
  return Array.from(transformMap.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.originalArtist.localeCompare(b.originalArtist);
  });
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
 *
 * If collectionName is specified, searches both music and video namespaces.
 * If type is specified, filters to just that type.
 * If neither, uses defaults from config.
 *
 * @param config - The merged config
 * @param collectionName - Optional collection name from -c flag
 * @param type - Optional type filter ('music' or 'video')
 * @returns Array of resolved collections to sync
 */
function resolveCollections(
  config: PodkitConfig,
  collectionName?: string,
  type?: SyncType
): ResolvedCollection[] {
  const collections: ResolvedCollection[] = [];

  // If a specific collection name is given, search for it
  if (collectionName) {
    // Search music namespace
    if ((!type || type === 'music') && config.music?.[collectionName]) {
      collections.push({
        name: collectionName,
        type: 'music',
        config: config.music[collectionName],
      });
    }

    // Search video namespace
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
 * Resolved device information
 */
interface ResolvedDevice {
  name: string;
  config: DeviceConfig;
}

/**
 * Resolve the device to sync to based on CLI flags and config
 *
 * @param config - The merged config
 * @param deviceName - Optional device name from -d flag
 * @returns Resolved device config or undefined if not found
 */
function resolveDevice(
  config: PodkitConfig,
  deviceName?: string
): ResolvedDevice | undefined {
  // If a specific device name is given, look it up
  if (deviceName) {
    if (config.devices?.[deviceName]) {
      return {
        name: deviceName,
        config: config.devices[deviceName],
      };
    }
    return undefined; // Device not found
  }

  // Use default device from config
  const defaultDeviceName = config.defaults?.device;
  if (defaultDeviceName && config.devices?.[defaultDeviceName]) {
    return {
      name: defaultDeviceName,
      config: config.devices[defaultDeviceName],
    };
  }

  return undefined;
}

/**
 * Get effective transforms config for a device
 *
 * Device-specific transforms override global transforms.
 */
function getEffectiveTransforms(
  globalTransforms: TransformsConfig,
  deviceConfig?: DeviceConfig
): TransformsConfig {
  if (!deviceConfig?.transforms) {
    return globalTransforms;
  }

  return {
    ftintitle: {
      ...globalTransforms.ftintitle,
      ...deviceConfig.transforms.ftintitle,
    },
  };
}

/**
 * Get effective quality preset for a device
 */
function getEffectiveQuality(
  globalQuality: QualityPreset,
  deviceConfig?: DeviceConfig
): QualityPreset {
  return deviceConfig?.quality ?? globalQuality;
}

/**
 * Get effective video quality preset for a device
 */
function getEffectiveVideoQuality(
  globalVideoQuality: VideoQualityPreset | undefined,
  deviceConfig?: DeviceConfig
): VideoQualityPreset {
  return deviceConfig?.videoQuality ?? globalVideoQuality ?? 'high';
}

/**
 * Get effective artwork setting for a device
 */
function getEffectiveArtwork(
  globalArtwork: boolean,
  deviceConfig?: DeviceConfig
): boolean {
  return deviceConfig?.artwork ?? globalArtwork;
}

// =============================================================================
// Sync Command
// =============================================================================

export const syncCommand = new Command('sync')
  .description('sync music and/or video collections to iPod')
  .argument('[type]', 'sync type: music, video, or all (default: all)')
  .option('-c, --collection <name>', 'collection name to sync (searches music and video)')
  .option('-d, --device-name <name>', 'device name to sync to (from config)')
  .option('-n, --dry-run', 'show what would be synced without making changes')
  .option(
    '--quality <preset>',
    'music transcoding quality: alac, max, max-cbr, high, high-cbr, medium, medium-cbr, low, low-cbr'
  )
  .option(
    '--video-quality <preset>',
    'video transcoding quality: max, high, medium, low'
  )
  .option(
    '--fallback <preset>',
    'fallback quality for lossy sources when quality=alac (default: max)'
  )
  .option('--filter <pattern>', 'only sync tracks matching pattern')
  .option('--no-artwork', 'skip artwork transfer')
  .option('--delete', 'remove tracks from iPod not in source')
  .action(async (typeArg: string | undefined, options: SyncOptions) => {
    const { config, globalOpts, configResult } = getContext();
    const startTime = Date.now();

    // JSON output helper
    const outputJson = (data: SyncOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    const dryRun = options.dryRun ?? false;
    const removeOrphans = options.delete ?? false;

    // ----- Validate type argument -----
    let syncType: SyncType | undefined;
    if (typeArg) {
      const normalizedType = typeArg.toLowerCase();
      if (normalizedType === 'music' || normalizedType === 'video') {
        syncType = normalizedType;
      } else if (normalizedType !== 'all') {
        if (globalOpts.json) {
          outputJson({
            success: false,
            dryRun,
            error: `Invalid sync type: ${typeArg}. Valid values: music, video, all`,
          });
        } else {
          console.error(`Invalid sync type: ${typeArg}`);
          console.error('Valid values: music, video, all');
        }
        process.exitCode = 1;
        return;
      }
      // 'all' leaves syncType undefined, which means sync both
    }

    // ----- Resolve named device (if -d flag used) -----
    let resolvedDevice: ResolvedDevice | undefined;
    if (options.deviceName) {
      resolvedDevice = resolveDevice(config, options.deviceName);
      if (!resolvedDevice) {
        const availableDevices = config.devices ? Object.keys(config.devices).join(', ') : '(none)';
        if (globalOpts.json) {
          outputJson({
            success: false,
            dryRun,
            error: `Device "${options.deviceName}" not found in config. Available: ${availableDevices}`,
          });
        } else {
          console.error(`Device "${options.deviceName}" not found in config.`);
          console.error(`Available devices: ${availableDevices}`);
        }
        process.exitCode = 1;
        return;
      }
    } else {
      // Try to resolve default device
      resolvedDevice = resolveDevice(config);
    }

    // Get effective settings from device config
    const deviceConfig = resolvedDevice?.config;
    const effectiveTransforms = getEffectiveTransforms(config.transforms, deviceConfig);
    const effectiveQuality = options.quality
      ? (options.quality as QualityPreset)
      : getEffectiveQuality(config.quality, deviceConfig);
    const effectiveVideoQuality = options.videoQuality
      ? (options.videoQuality as VideoQualityPreset)
      : getEffectiveVideoQuality(undefined, deviceConfig);
    const effectiveArtwork = options.artwork !== undefined
      ? options.artwork
      : getEffectiveArtwork(config.artwork, deviceConfig);
    const fallback = options.fallback ?? config.fallback;

    // Build transcode config for music planner
    const transcodeConfig = {
      quality: effectiveQuality,
      fallback,
    };

    // ----- Resolve collections -----
    const allCollections = resolveCollections(config, options.collection, syncType);

    // Separate into music and video
    const musicCollections: ResolvedCollection[] = [];
    const videoCollections: ResolvedCollection[] = [];

    for (const collection of allCollections) {
      if (collection.type === 'music') {
        musicCollections.push(collection);
      } else {
        videoCollections.push(collection);
      }
    }

    // Check if we have any collections to sync
    const hasMusicToSync = musicCollections.length > 0;
    const hasVideoToSync = videoCollections.length > 0;

    if (!hasMusicToSync && !hasVideoToSync) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          dryRun,
          error: options.collection
            ? `Collection "${options.collection}" not found in config`
            : 'No collections configured to sync',
        });
      } else {
        if (options.collection) {
          console.error(`Collection "${options.collection}" not found in config.`);
          const musicNames = config.music ? Object.keys(config.music) : [];
          const videoNames = config.video ? Object.keys(config.video) : [];
          if (musicNames.length > 0) {
            console.error(`Available music collections: ${musicNames.join(', ')}`);
          }
          if (videoNames.length > 0) {
            console.error(`Available video collections: ${videoNames.join(', ')}`);
          }
          if (musicNames.length === 0 && videoNames.length === 0) {
            console.error('No collections configured. Add collections to your config file.');
          }
        } else {
          console.error('No collections configured to sync.');
          console.error('');
          console.error('Add collections to your config file:');
          if (configResult.configPath) {
            console.error(`  ${configResult.configPath}`);
          }
          console.error('');
          console.error('Example:');
          console.error('  [music.main]');
          console.error('  path = "/path/to/music"');
        }
      }
      process.exitCode = 1;
      return;
    }

    // Validate collection paths exist
    for (const collection of [...musicCollections, ...videoCollections]) {
      const collConfig = collection.config as { path: string };
      if (!existsSync(collConfig.path)) {
        if (globalOpts.json) {
          outputJson({
            success: false,
            dryRun,
            source: collConfig.path,
            error: `Source directory not found: ${collConfig.path}`,
          });
        } else {
          console.error(`Source directory not found: ${collConfig.path}`);
          console.error(`  Collection: ${collection.name} (${collection.type})`);
        }
        process.exitCode = 1;
        return;
      }
    }

    // ----- Load dependencies dynamically -----
    let core: typeof import('@podkit/core');

    try {
      core = await import('@podkit/core');
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load podkit-core';
      if (globalOpts.json) {
        outputJson({
          success: false,
          dryRun,
          error: message,
        });
      } else {
        console.error('Failed to load podkit-core.');
        if (globalOpts.verbose) {
          console.error('Details:', message);
        }
      }
      process.exitCode = 1;
      return;
    }

    // ----- Resolve device path -----
    // Priority: CLI --device flag > named device -d > UUID auto-detect
    const manager = core.getDeviceManager();

    // Get device identity for UUID-based auto-detection
    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (!globalOpts.quiet && !globalOpts.json && deviceIdentity?.volumeUuid) {
      console.log('Looking for iPod...');
    }

    const resolved = await resolveDevicePath({
      cliDevice: globalOpts.device,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
    });

    if (!resolved.path) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          dryRun,
          error: resolved.error ?? formatDeviceError(resolved),
        });
      } else {
        console.error(resolved.error ?? formatDeviceError(resolved));
      }
      process.exitCode = 1;
      return;
    }

    const devicePath = resolved.path;

    if (!existsSync(devicePath)) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          dryRun,
          device: devicePath,
          error: `Device path not found: ${devicePath}`,
        });
      } else {
        console.error(`iPod not found at: ${devicePath}`);
        console.error('');
        console.error('Make sure the iPod is connected and mounted.');
      }
      process.exitCode = 1;
      return;
    }

    // ----- Check FFmpeg availability -----
    const transcoder = core.createFFmpegTranscoder();
    try {
      await transcoder.detect();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'FFmpeg not found';
      if (globalOpts.json) {
        outputJson({
          success: false,
          dryRun,
          device: devicePath,
          error: `FFmpeg not available: ${message}`,
        });
      } else {
        console.error('FFmpeg not found or not functional.');
        console.error('');
        console.error('Install FFmpeg:');
        console.error('  macOS: brew install ffmpeg');
        console.error('  Ubuntu: apt install ffmpeg');
        if (globalOpts.verbose) {
          console.error('');
          console.error('Details:', message);
        }
      }
      process.exitCode = 1;
      return;
    }

    // ----- Open iPod database -----
    const spinner = new Spinner();
    if (!globalOpts.json && !globalOpts.quiet) {
      spinner.start('Opening iPod database...');
    }

    let ipod: Awaited<ReturnType<typeof core.IpodDatabase.open>>;
    try {
      ipod = await core.IpodDatabase.open(devicePath);
    } catch (err) {
      spinner.stop();
      const isIpodError = err instanceof core.IpodError;
      const message = err instanceof Error ? err.message : 'Failed to open iPod database';
      if (globalOpts.json) {
        outputJson({
          success: false,
          dryRun,
          device: devicePath,
          error: `Failed to open iPod: ${message}`,
        });
      } else {
        console.error(`Cannot read iPod database at: ${devicePath}`);
        console.error('');
        if (isIpodError) {
          console.error('This path does not appear to be a valid iPod:');
          console.error('  - Missing iTunesDB file');
          console.error('  - Database may be corrupted');
        } else {
          console.error('Error:', message);
        }
        if (globalOpts.verbose) {
          console.error('');
          console.error('Details:', message);
        }
      }
      process.exitCode = 1;
      return;
    }

    if (!globalOpts.json && !globalOpts.quiet) {
      spinner.stop('iPod database opened');
    }

    // Track overall results
    let totalCompleted = 0;
    let totalFailed = 0;
    let anyError = false;

    try {
      // ----- Sync Music Collections -----
      if (hasMusicToSync) {
        for (const collection of musicCollections) {
          const sourcePath = (collection.config as MusicCollectionConfig).path;
          const collectionLabel = musicCollections.length > 1
            ? ` [${collection.name}]`
            : '';

          if (!globalOpts.json && !globalOpts.quiet && musicCollections.length > 1) {
            console.log('');
            console.log(`=== Music: ${collection.name} ===`);
          }

          // Scan source directory
          if (!globalOpts.json && !globalOpts.quiet) {
            spinner.start(`Scanning music source${collectionLabel}...`);
          }

          const scanWarnings: Array<{ file: string; message: string }> = [];
          const adapter = core.createDirectoryAdapter({
            path: sourcePath,
            onProgress: (progress) => {
              if (!globalOpts.json && !globalOpts.quiet) {
                if (progress.phase === 'discovering') {
                  spinner.update(`Discovering audio files${collectionLabel}...`);
                } else {
                  spinner.update(
                    `Parsing metadata${collectionLabel}: ${progress.processed}/${progress.total} files`
                  );
                }
              }
            },
            onWarning: (warning) => {
              scanWarnings.push(warning);
            },
          });

          let collectionTracks: Awaited<ReturnType<typeof adapter.getTracks>>;
          try {
            await adapter.connect();
            collectionTracks = await adapter.getTracks();
          } catch (err) {
            spinner.stop();
            const message = err instanceof Error ? err.message : 'Failed to scan source';
            if (globalOpts.json) {
              outputJson({
                success: false,
                dryRun,
                source: sourcePath,
                device: devicePath,
                error: `Failed to scan source: ${message}`,
              });
            } else {
              console.error(`Failed to scan source directory: ${message}`);
            }
            process.exitCode = 1;
            anyError = true;
            continue;
          }

          if (!globalOpts.json && !globalOpts.quiet) {
            spinner.stop(`Found ${formatNumber(collectionTracks.length)} tracks in source`);
            if (scanWarnings.length > 0) {
              console.log(`  ${scanWarnings.length} file${scanWarnings.length === 1 ? '' : 's'} could not be parsed`);
              if (globalOpts.verbose) {
                for (const warning of scanWarnings) {
                  console.log(`    - ${warning.file}: ${warning.message}`);
                }
              }
            }
          }

          // Compute diff
          if (!globalOpts.json && !globalOpts.quiet) {
            spinner.start('Computing sync diff...');
          }

          const ipodTracks = ipod.getTracks();
          const diff = core.computeDiff(collectionTracks, ipodTracks, { transforms: effectiveTransforms });

          if (!globalOpts.json && !globalOpts.quiet) {
            spinner.stop('Diff computed');
          }

          // Create sync plan
          const plan = core.createPlan(diff, {
            removeOrphans,
            transcodeConfig,
          });

          const summary = core.getPlanSummary(plan);
          const storage = getStorageInfo(devicePath);
          const hasEnoughSpace = storage
            ? core.willFitInSpace(plan, storage.free)
            : true;

          // Dry-run output
          if (dryRun) {
            if (globalOpts.json) {
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
                return base;
              });

              const planWarningInfos: PlanWarningInfo[] = plan.warnings.map((warning) => ({
                type: warning.type,
                message: warning.message,
                trackCount: warning.tracks.length,
                tracks: globalOpts.verbose
                  ? warning.tracks.map((t) => `${t.artist} - ${t.title}`)
                  : undefined,
              }));

              const scanWarningInfos: ScanWarningInfo[] = scanWarnings.map((warning) => ({
                file: warning.file,
                message: warning.message,
              }));

              const transformsInfo: TransformInfo[] = [];
              if (effectiveTransforms.ftintitle.enabled) {
                transformsInfo.push({
                  name: 'ftintitle',
                  enabled: true,
                  mode: effectiveTransforms.ftintitle.drop ? 'drop' : 'move',
                  format: effectiveTransforms.ftintitle.drop ? undefined : effectiveTransforms.ftintitle.format,
                });
              }

              const updateBreakdown: UpdateBreakdown = {};
              for (const update of diff.toUpdate) {
                const count = updateBreakdown[update.reason] ?? 0;
                updateBreakdown[update.reason] = count + 1;
              }

              outputJson({
                success: true,
                dryRun: true,
                source: sourcePath,
                device: devicePath,
                transforms: transformsInfo.length > 0 ? transformsInfo : undefined,
                plan: {
                  tracksToAdd: diff.toAdd.length,
                  tracksToRemove: removeOrphans ? diff.toRemove.length : 0,
                  tracksToUpdate: diff.toUpdate.length,
                  updateBreakdown: diff.toUpdate.length > 0 ? updateBreakdown : undefined,
                  tracksToTranscode: summary.transcodeCount,
                  tracksToCopy: summary.copyCount,
                  estimatedSize: plan.estimatedSize,
                  estimatedTime: plan.estimatedTime,
                },
                operations,
                planWarnings: planWarningInfos.length > 0 ? planWarningInfos : undefined,
                scanWarnings: scanWarningInfos.length > 0 ? scanWarningInfos : undefined,
              });
            } else {
              console.log('');
              console.log('=== Music Sync Plan (Dry Run) ===');
              console.log('');
              console.log(`Source: ${sourcePath}`);
              console.log(`Device: ${devicePath}`);
              const qualityDisplay = fallback ? `${effectiveQuality} (fallback: ${fallback})` : effectiveQuality;
              console.log(`Quality: ${qualityDisplay}`);
              const transformsDisplay = formatTransformsConfig(effectiveTransforms);
              if (transformsDisplay) {
                console.log(`Transforms: ${transformsDisplay}`);
              }
              console.log('');

              console.log('Changes:');
              console.log(`  Tracks to add: ${formatNumber(diff.toAdd.length)}`);
              if (summary.transcodeCount > 0) {
                console.log(`    - Transcode: ${formatNumber(summary.transcodeCount)}`);
              }
              if (summary.copyCount > 0) {
                console.log(`    - Copy: ${formatNumber(summary.copyCount)}`);
              }
              if (removeOrphans && diff.toRemove.length > 0) {
                console.log(`  Tracks to remove: ${formatNumber(diff.toRemove.length)}`);
              }
              console.log(`  Already synced: ${formatNumber(diff.existing.length)}`);
              if (diff.toUpdate.length > 0) {
                const updatesByReason = new Map<string, number>();
                for (const update of diff.toUpdate) {
                  const count = updatesByReason.get(update.reason) ?? 0;
                  updatesByReason.set(update.reason, count + 1);
                }
                const reasonParts: string[] = [];
                for (const [reason, count] of updatesByReason) {
                  reasonParts.push(`${formatUpdateReason(reason as 'transform-apply' | 'transform-remove' | 'metadata-changed')}: ${count}`);
                }
                console.log(`  Tracks to update: ${formatNumber(diff.toUpdate.length)} (${reasonParts.join(', ')})`);
              }
              console.log('');

              console.log('Estimates:');
              console.log(`  Size: ${formatBytes(plan.estimatedSize)}`);
              console.log(`  Time: ~${formatDuration(plan.estimatedTime)}`);
              if (storage) {
                console.log(`  Available space: ${formatBytes(storage.free)}`);
                if (!hasEnoughSpace) {
                  console.log('  WARNING: May not have enough space!');
                }
              }
              console.log('');

              if (effectiveTransforms.ftintitle.enabled) {
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
                    console.log('Artist transforms:');
                    for (const entry of preview) {
                      const countStr = entry.count > 1 ? `  [${entry.count} tracks]` : '';
                      console.log(`  "${entry.originalArtist}" → "${entry.transformedArtist}"${countStr}`);
                    }
                    console.log('');
                  }
                }
              }

              if (globalOpts.verbose || plan.operations.length <= 20) {
                if (plan.operations.length > 0) {
                  console.log('Operations:');
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
                    console.log(`  ${symbol} [${typeStr}] ${core.getOperationDisplayName(op)}`);
                  }
                  console.log('');
                }
              } else if (plan.operations.length > 20) {
                console.log(`Operations: ${plan.operations.length} total (use --verbose to list all)`);
                console.log('');
              }

              if (plan.warnings.length > 0) {
                for (const warning of plan.warnings) {
                  if (warning.type === 'lossy-to-lossy') {
                    console.log(`Warning: ${warning.tracks.length} track${warning.tracks.length === 1 ? '' : 's'} require lossy-to-lossy conversion`);
                  }
                }
                console.log('');
              }
            }

            await adapter.disconnect();
            continue;
          }

          // Check space
          if (!hasEnoughSpace) {
            if (globalOpts.json) {
              outputJson({
                success: false,
                dryRun: false,
                source: sourcePath,
                device: devicePath,
                plan: {
                  tracksToAdd: diff.toAdd.length,
                  tracksToRemove: removeOrphans ? diff.toRemove.length : 0,
                  tracksToUpdate: diff.toUpdate.length,
                  tracksToTranscode: summary.transcodeCount,
                  tracksToCopy: summary.copyCount,
                  estimatedSize: plan.estimatedSize,
                  estimatedTime: plan.estimatedTime,
                },
                error: `Not enough space. Need ${formatBytes(plan.estimatedSize)}, have ${formatBytes(storage?.free ?? 0)}`,
              });
            } else {
              console.error('Not enough space on iPod.');
              console.error(`  Need: ${formatBytes(plan.estimatedSize)}`);
              console.error(`  Have: ${formatBytes(storage?.free ?? 0)}`);
            }
            process.exitCode = 1;
            await adapter.disconnect();
            anyError = true;
            continue;
          }

          // Nothing to do
          if (plan.operations.length === 0) {
            if (!globalOpts.json && !globalOpts.quiet) {
              console.log('');
              console.log('Music already in sync! No changes needed.');
              console.log(`  Source tracks: ${formatNumber(collectionTracks.length)}`);
              console.log(`  iPod tracks: ${formatNumber(ipodTracks.length)}`);
            }
            await adapter.disconnect();
            continue;
          }

          // Execute sync
          if (!globalOpts.json && !globalOpts.quiet) {
            console.log('');
            console.log('=== Syncing Music ===');
            console.log('');
            console.log(`Tracks to process: ${formatNumber(plan.operations.length)}`);
            console.log(`Estimated size: ${formatBytes(plan.estimatedSize)}`);
            console.log(`Estimated time: ~${formatDuration(plan.estimatedTime)}`);
            console.log('');
          }

          const collectedErrors: CollectedError[] = [];
          let completed = 0;
          let failed = 0;

          const executor = new core.DefaultSyncExecutor({ ipod, transcoder });

          for await (const progress of executor.execute(plan, { dryRun: false, continueOnError: true, artwork: effectiveArtwork })) {
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
            } else if (progress.phase !== 'preparing' && progress.phase !== 'updating-db' && progress.phase !== 'complete') {
              completed++;
            }

            if (!globalOpts.json && !globalOpts.quiet) {
              if (progress.phase === 'complete') {
                process.stdout.write('\x1b[2K\r');
                console.log('Music sync complete!');
              } else if (progress.phase === 'updating-db') {
                process.stdout.write('\r\x1b[KSaving iPod database...');
              } else if (progress.phase !== 'preparing') {
                const bar = renderProgressBar(progress.current + 1, progress.total);
                const phaseStr = progress.phase.charAt(0).toUpperCase() + progress.phase.slice(1);
                const trackStr = progress.currentTrack
                  ? ` ${progress.currentTrack.substring(0, 40)}`
                  : '';
                process.stdout.write(`\r\x1b[K${bar} ${phaseStr}${trackStr}`);
              }
            }
          }

          totalCompleted += completed;
          totalFailed += failed;

          if (!globalOpts.json && !globalOpts.quiet && collectedErrors.length > 0) {
            const errorLines = formatErrors(collectedErrors, globalOpts.verbose);
            for (const line of errorLines) {
              console.log(line);
            }
          }

          await adapter.disconnect();
        }
      }

      // ----- Sync Video Collections -----
      if (hasVideoToSync && !dryRun) {
        // Check video support
        const ipodInfo = ipod.getInfo();
        const supportsVideo = ipodInfo.device?.supportsVideo ?? false;

        if (!supportsVideo) {
          if (!globalOpts.json && !globalOpts.quiet) {
            console.log('');
            console.log('Skipping video sync: This iPod does not support video playback.');
          }
        } else {
          for (const collection of videoCollections) {
            const sourcePath = (collection.config as VideoCollectionConfig).path;
            const collectionLabel = videoCollections.length > 1
              ? ` [${collection.name}]`
              : '';

            if (!globalOpts.json && !globalOpts.quiet) {
              console.log('');
              console.log(`=== Video: ${collection.name} ===`);
            }

            // Scan video source
            if (!globalOpts.json && !globalOpts.quiet) {
              spinner.start(`Scanning video source${collectionLabel}...`);
            }

            const scanWarnings: Array<{ file: string; message: string }> = [];
            const videoAdapter = core.createVideoDirectoryAdapter({
              path: sourcePath,
              onProgress: (progress) => {
                if (!globalOpts.json && !globalOpts.quiet) {
                  if (progress.phase === 'discovering') {
                    spinner.update(`Discovering video files${collectionLabel}...`);
                  } else {
                    spinner.update(
                      `Analyzing videos${collectionLabel}: ${progress.processed}/${progress.total} files`
                    );
                  }
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
              if (!globalOpts.json) {
                console.error(`Failed to scan video source: ${message}`);
              }
              anyError = true;
              continue;
            }

            const movieCount = collectionVideos.filter(v => v.contentType === 'movie').length;
            const tvShowCount = collectionVideos.filter(v => v.contentType === 'tvshow').length;

            if (!globalOpts.json && !globalOpts.quiet) {
              spinner.stop(`Found ${formatNumber(collectionVideos.length)} videos (${movieCount} movies, ${tvShowCount} TV episodes)`);
            }

            // Get iPod video tracks
            const allTracks = ipod.getTracks();
            const ipodVideos: IPodVideo[] = allTracks
              .filter(t =>
                (t.mediaType & MediaType.Movie) !== 0 ||
                (t.mediaType & MediaType.TVShow) !== 0
              )
              .map(t => {
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
                };
              });

            // Compute video diff
            if (!globalOpts.json && !globalOpts.quiet) {
              spinner.start('Computing video sync diff...');
            }

            const videoDiff = core.diffVideos(collectionVideos, ipodVideos);

            if (!globalOpts.json && !globalOpts.quiet) {
              spinner.stop('Video diff computed');
            }

            // Create video plan
            const ipodDevice = ipod.getInfo().device;
            const deviceProfile = core.getDeviceProfileByGeneration(ipodDevice.generation);
            const videoPlan = core.planVideoSync(videoDiff, {
              deviceProfile,
              qualityPreset: effectiveVideoQuality,
              removeOrphans,
              useHardwareAcceleration: true,
            });

            const videoSummary = core.getVideoPlanSummary(videoPlan);
            const storage = getStorageInfo(devicePath);
            const hasEnoughSpace = storage
              ? core.willVideoPlanFit(videoPlan, storage.free)
              : true;

            if (!hasEnoughSpace) {
              if (!globalOpts.json) {
                console.error('Not enough space for video sync.');
                console.error(`  Need: ${formatBytes(videoPlan.estimatedSize)}`);
                console.error(`  Have: ${formatBytes(storage?.free ?? 0)}`);
              }
              anyError = true;
              await videoAdapter.disconnect();
              continue;
            }

            if (videoPlan.operations.length === 0) {
              if (!globalOpts.json && !globalOpts.quiet) {
                console.log('Videos already in sync! No changes needed.');
              }
              await videoAdapter.disconnect();
              continue;
            }

            // Execute video sync
            if (!globalOpts.json && !globalOpts.quiet) {
              console.log('');
              console.log(`Videos to process: ${formatNumber(videoPlan.operations.length)}`);
              console.log(`  - Transcode: ${formatNumber(videoSummary.transcodeCount)}`);
              console.log(`  - Passthrough: ${formatNumber(videoSummary.copyCount)}`);
              console.log(`Estimated size: ${formatBytes(videoPlan.estimatedSize)}`);
              console.log('');
            }

            const videoExecutor = core.createVideoExecutor({ ipod });
            let videoCompleted = 0;

            try {
              for await (const progress of videoExecutor.execute(videoPlan, { dryRun: false })) {
                if (progress.skipped) {
                  // Skip tracking for skipped operations
                } else if (progress.phase !== 'preparing' && progress.phase !== 'complete') {
                  videoCompleted++;
                }

                if (!globalOpts.json && !globalOpts.quiet) {
                  if (progress.phase === 'complete') {
                    console.log('\nVideo sync complete.');
                  } else if (progress.transcodeProgress) {
                    const percent = progress.transcodeProgress.percent;
                    const bar = renderProgressBar(Math.round(percent), 100);
                    const speed = progress.transcodeProgress.speed
                      ? ` (${progress.transcodeProgress.speed.toFixed(1)}x)`
                      : '';
                    process.stdout.write(`\r\x1b[K${bar} transcoding${speed}: ${progress.currentTrack}`);
                  } else {
                    const bar = renderProgressBar(progress.current + 1, progress.total);
                    const phaseStr = progress.phase.replace('video-', '');
                    process.stdout.write(`\r\x1b[K${bar} ${phaseStr}: ${progress.currentTrack}`);
                  }
                }
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Video execution failed';
              if (!globalOpts.json) {
                console.error(`\nVideo sync error: ${message}`);
              }
              anyError = true;
            }

            totalCompleted += videoCompleted;
            await videoAdapter.disconnect();
          }

          // Save database after video sync
          if (!dryRun && hasVideoToSync) {
            ipod.save();
          }
        }
      } else if (hasVideoToSync && dryRun) {
        // Video dry-run
        const ipodInfo = ipod.getInfo();
        const supportsVideo = ipodInfo.device?.supportsVideo ?? false;

        if (!supportsVideo) {
          if (!globalOpts.json && !globalOpts.quiet) {
            console.log('');
            console.log('Note: This iPod does not support video playback.');
          }
        } else {
          for (const collection of videoCollections) {
            const sourcePath = (collection.config as VideoCollectionConfig).path;

            if (!globalOpts.json && !globalOpts.quiet) {
              spinner.start('Scanning video source...');
            }

            const videoAdapter = core.createVideoDirectoryAdapter({
              path: sourcePath,
              onProgress: () => {},
              onWarning: () => {},
            });

            let collectionVideos: CollectionVideo[];
            try {
              await videoAdapter.connect();
              collectionVideos = await videoAdapter.getVideos();
            } catch {
              spinner.stop();
              continue;
            }

            const allTracks = ipod.getTracks();
            const ipodVideos: IPodVideo[] = allTracks
              .filter(t =>
                (t.mediaType & MediaType.Movie) !== 0 ||
                (t.mediaType & MediaType.TVShow) !== 0
              )
              .map(t => ({
                id: t.filePath,
                filePath: t.filePath,
                contentType: ((t.mediaType & MediaType.Movie) !== 0 ? 'movie' : 'tvshow') as 'movie' | 'tvshow',
                title: t.title,
                year: t.year,
                seriesTitle: t.tvShow,
                seasonNumber: t.seasonNumber,
                episodeNumber: t.episodeNumber,
                duration: t.duration ? Math.floor(t.duration / 1000) : undefined,
              }));

            const videoDiff = core.diffVideos(collectionVideos, ipodVideos);
            const ipodDevice = ipod.getInfo().device;
            const deviceProfile = core.getDeviceProfileByGeneration(ipodDevice.generation);
            const videoPlan = core.planVideoSync(videoDiff, {
              deviceProfile,
              qualityPreset: effectiveVideoQuality,
              removeOrphans,
              useHardwareAcceleration: true,
            });

            const videoSummary = core.getVideoPlanSummary(videoPlan);
            const movieCount = collectionVideos.filter(v => v.contentType === 'movie').length;
            const tvShowCount = collectionVideos.filter(v => v.contentType === 'tvshow').length;

            if (!globalOpts.json && !globalOpts.quiet) {
              spinner.stop();
              console.log('');
              console.log('=== Video Sync Plan (Dry Run) ===');
              console.log('');
              console.log(`Source: ${sourcePath}`);
              console.log(`Device: ${devicePath}`);
              console.log(`Quality: ${effectiveVideoQuality}`);
              console.log('');
              console.log('Collection:');
              console.log(`  Total videos: ${formatNumber(collectionVideos.length)}`);
              console.log(`    - Movies: ${formatNumber(movieCount)}`);
              console.log(`    - TV Shows: ${formatNumber(tvShowCount)}`);
              console.log('');
              console.log('Changes:');
              console.log(`  Videos to add: ${formatNumber(videoDiff.toAdd.length)}`);
              if (videoSummary.transcodeCount > 0) {
                console.log(`    - Transcode: ${formatNumber(videoSummary.transcodeCount)}`);
              }
              if (videoSummary.copyCount > 0) {
                console.log(`    - Passthrough: ${formatNumber(videoSummary.copyCount)}`);
              }
              if (removeOrphans && videoDiff.toRemove.length > 0) {
                console.log(`  Videos to remove: ${formatNumber(videoDiff.toRemove.length)}`);
              }
              console.log(`  Already synced: ${formatNumber(videoDiff.existing.length)}`);
              console.log('');
              console.log('Estimates:');
              console.log(`  Size: ${formatBytes(videoPlan.estimatedSize)}`);
              console.log(`  Time: ~${formatDuration(videoPlan.estimatedTime)}`);
              console.log('');
            }

            await videoAdapter.disconnect();
          }
        }
      }

      // Final summary
      const duration = (Date.now() - startTime) / 1000;
      if (!dryRun && !globalOpts.json && !globalOpts.quiet) {
        console.log('');
        console.log('=== Summary ===');
        console.log('');
        if (totalFailed > 0) {
          console.log(`Synced ${formatNumber(totalCompleted)} items (${formatNumber(totalFailed)} failed)`);
        } else if (totalCompleted > 0) {
          console.log(`Synced ${formatNumber(totalCompleted)} items successfully`);
        } else {
          console.log('Everything already in sync!');
        }
        console.log(`Duration: ${formatDuration(duration)}`);
      }

      // JSON output for actual sync completion
      if (!dryRun && globalOpts.json) {
        outputJson({
          success: totalFailed === 0 && !anyError,
          dryRun: false,
          result: {
            completed: totalCompleted,
            failed: totalFailed,
            skipped: 0,
            bytesTransferred: 0,
            duration,
          },
        });
      }

      if (dryRun && !globalOpts.json && !globalOpts.quiet) {
        console.log('');
        console.log('Run without --dry-run to execute this plan.');
      }

      if (totalFailed > 0 || anyError) {
        process.exitCode = 1;
      }
    } finally {
      ipod.close();
    }
  });
