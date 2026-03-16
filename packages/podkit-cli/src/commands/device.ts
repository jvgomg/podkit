/**
 * Device command - manage iPod devices
 *
 * Provides subcommands for device management and content operations.
 *
 * @example
 * ```bash
 * podkit device                       # list configured devices
 * podkit device add -d <name>         # detect and add iPod
 * podkit device remove -d <name>      # remove from config
 * podkit device info [-d name]        # config + live status
 * podkit device music [-d name]       # list music on device
 * podkit device video [-d name]       # list video on device
 * podkit device clear [-d name]       # clear all content
 * podkit device reset [-d name]       # reset database
 * podkit device eject [-d name]       # eject device
 * podkit device mount [-d name]       # mount device
 * podkit device init [-d name]        # initialize iPod database
 * ```
 */
import { Command } from 'commander';
import { confirm, confirmNo } from '../utils/confirm.js';
import { existsSync, statfsSync } from '../utils/fs.js';
import { getContext } from '../context.js';
import {
  addDevice,
  updateDevice,
  removeDevice,
  setDefaultDevice,
  DEFAULT_CONFIG_PATH,
} from '../config/index.js';
import { QUALITY_PRESETS, VIDEO_QUALITY_PRESETS } from '../config/index.js';
import {
  resolveDevicePath,
  formatDeviceError,
  getDeviceIdentity,
  formatDeviceLookupMessage,
  parseCliDeviceArg,
  resolveEffectiveDevice,
} from '../device-resolver.js';
import type { DeviceConfig } from '../config/index.js';
import type { ResolvedDevice } from '../device-resolver.js';
import {
  type DisplayTrack,
  type FieldName,
  AVAILABLE_FIELDS,
  DEFAULT_FIELDS,
  parseFields,
  formatTable,
  formatCsv,
  computeStats,
  formatStatsText,
  aggregateAlbums,
  formatAlbumsTable,
  aggregateArtists,
  formatArtistsTable,
  escapeCsv,
} from './display-utils.js';
import { OutputContext, formatBytes, formatNumber, bold, printTips } from '../output/index.js';
import { formatGeneration, validateDevice, formatValidationMessages, parseSyncTag } from '@podkit/core';
import type { DeviceAssessment, IFlashEvidence } from '@podkit/core';
import type { DeviceValidationResult } from '@podkit/core';

// =============================================================================
// Shared utilities
// =============================================================================

// Re-export formatting utilities for backward compatibility
export { formatBytes, formatNumber } from '../output/index.js';
export { formatGeneration } from '@podkit/core';

/**
 * Get storage information for a mount point.
 */
export function getStorageInfo(
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
 * Format a table row with consistent column widths
 */
function formatRow(columns: string[], widths: number[]): string {
  return columns.map((col, i) => col.padEnd(widths[i] || 10)).join('  ');
}

type DeviceArgResult =
  | { error: string }
  | {
      resolvedDevice: ResolvedDevice;
      cliPath?: string;
      config: ReturnType<typeof getContext>['config'];
      globalOpts: ReturnType<typeof getContext>['globalOpts'];
    };

/**
 * Resolve device from CLI arguments (global --device flag or default)
 */
function resolveDeviceArg(): DeviceArgResult {
  const { config, globalOpts } = getContext();

  const cliArg = parseCliDeviceArg(globalOpts.device, config);
  const result = resolveEffectiveDevice(cliArg, undefined, config);

  if (!result.success) {
    return { error: result.error };
  }

  if (result.cliPath && !result.device) {
    return {
      resolvedDevice: undefined as unknown as ResolvedDevice,
      cliPath: result.cliPath,
      config,
      globalOpts,
    };
  }

  return {
    resolvedDevice: result.device!,
    cliPath: result.cliPath,
    config,
    globalOpts,
  };
}

// =============================================================================
// Output types
// =============================================================================

export interface DeviceListOutput {
  success: boolean;
  devices: Array<{
    name: string;
    isDefault: boolean;
    volumeUuid: string;
    volumeName: string;
    quality?: string;
    audioQuality?: string;
    videoQuality?: string;
    artwork?: boolean;
  }>;
  defaultDevice?: string;
  error?: string;
}

export interface DeviceAddOutput {
  success: boolean;
  device?: {
    name: string;
    identifier: string;
    volumeName: string;
    volumeUuid: string;
    size: number;
    isMounted: boolean;
    mountPoint?: string;
    trackCount?: number;
    modelName?: string;
  };
  initialized?: boolean;
  saved?: boolean;
  configPath?: string;
  isDefault?: boolean;
  error?: string;
}

export interface DeviceRemoveOutput {
  success: boolean;
  device?: string;
  wasDefault?: boolean;
  error?: string;
}

export interface DeviceInfoOutput {
  success: boolean;
  device?: {
    name: string;
    volumeUuid: string;
    volumeName: string;
    quality?: string;
    audioQuality?: string;
    videoQuality?: string;
    artwork?: boolean;
    transforms?: Record<string, unknown>;
    isDefault: boolean;
  };
  status?: {
    mounted: boolean;
    mountPoint?: string;
    model?: {
      name: string;
      number: string | null;
      generation: string;
      capacity: number;
    };
    capabilities?: {
      music: boolean;
      artwork: boolean;
      video: boolean;
      podcast: boolean;
    };
    validation?: {
      supported: boolean;
      issues: Array<{
        type: string;
        message: string;
        suggestion?: string;
        reason?: string;
      }>;
      warnings: Array<{
        type: string;
        message: string;
      }>;
    };
    storage?: {
      used: number;
      total: number;
      free: number;
      percentUsed: number;
    };
    musicCount?: number;
    videoCount?: number;
    syncTagCount?: number;
  };
  error?: string;
}

export interface DeviceMusicOutput {
  success: boolean;
  tracks?: Array<Record<string, unknown>>;
  count?: number;
  error?: string;
}

export interface DeviceVideoOutput {
  success: boolean;
  videos?: Array<Record<string, unknown>>;
  count?: number;
  error?: string;
}

export interface DeviceClearOutput {
  success: boolean;
  contentType?: 'music' | 'video' | 'all';
  tracksRemoved?: number;
  totalTracks?: number;
  totalSize?: number;
  dryRun?: boolean;
  error?: string;
  fileDeleteErrors?: string[];
}

export interface DeviceResetOutput {
  success: boolean;
  mountPoint?: string;
  modelName?: string;
  tracksRemoved?: number;
  dryRun?: boolean;
  error?: string;
}

export interface DeviceEjectOutput {
  success: boolean;
  device?: string;
  forced?: boolean;
  error?: string;
}

export interface DeviceMountOutput {
  success: boolean;
  device?: string;
  mountPoint?: string;
  dryRunCommand?: string;
  error?: string;
  requiresSudo?: boolean;
  assessment?: import('@podkit/core').DeviceAssessment;
}

export interface DeviceInitOutput {
  success: boolean;
  device?: string;
  mountPoint?: string;
  modelName?: string;
  error?: string;
}

export interface DeviceSetOutput {
  success: boolean;
  device?: string;
  updated?: Record<string, unknown>;
  error?: string;
}

export interface DeviceDefaultOutput {
  success: boolean;
  device?: string;
  cleared?: boolean;
  error?: string;
}

// =============================================================================
// Re-export display utilities for backward compatibility
// =============================================================================

export type { DisplayTrack, FieldName } from './display-utils.js';
export { AVAILABLE_FIELDS, DEFAULT_FIELDS } from './display-utils.js';

// =============================================================================
// Device-specific format helpers
// =============================================================================

/**
 * Helper to escape a single CSV field value.
 */
function escapeCsvField(value: string): string {
  return escapeCsv(value);
}

/**
 * Map an IPodTrack to a full JSON object with all metadata fields.
 */
function ipodTrackToFullJson(t: {
  title: string;
  artist: string;
  album: string;
  albumArtist?: string;
  genre?: string;
  composer?: string;
  comment?: string;
  grouping?: string;
  trackNumber?: number;
  totalTracks?: number;
  discNumber?: number;
  totalDiscs?: number;
  year?: number;
  bpm?: number;
  compilation: boolean;
  duration: number;
  bitrate: number;
  sampleRate: number;
  size: number;
  filetype?: string;
  mediaType: number;
  filePath: string;
  timeAdded: number;
  timeModified: number;
  timePlayed: number;
  playCount: number;
  skipCount: number;
  rating: number;
  hasArtwork: boolean;
  hasFile: boolean;
  tvShow?: string;
  tvEpisode?: string;
  sortTvShow?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  soundcheck?: number;
  movieFlag?: boolean;
}): Record<string, unknown> {
  return {
    title: t.title,
    artist: t.artist,
    album: t.album,
    albumArtist: t.albumArtist || null,
    genre: t.genre || null,
    composer: t.composer || null,
    comment: t.comment || null,
    grouping: t.grouping || null,
    trackNumber: t.trackNumber || null,
    totalTracks: t.totalTracks || null,
    discNumber: t.discNumber || null,
    totalDiscs: t.totalDiscs || null,
    year: t.year || null,
    bpm: t.bpm || null,
    compilation: t.compilation,
    duration: t.duration,
    bitrate: t.bitrate,
    sampleRate: t.sampleRate,
    size: t.size,
    filetype: t.filetype || null,
    mediaType: t.mediaType,
    filePath: t.filePath,
    timeAdded: t.timeAdded,
    timeModified: t.timeModified,
    timePlayed: t.timePlayed,
    playCount: t.playCount,
    skipCount: t.skipCount,
    rating: t.rating,
    hasArtwork: t.hasArtwork,
    hasFile: t.hasFile,
    tvShow: t.tvShow || null,
    tvEpisode: t.tvEpisode || null,
    sortTvShow: t.sortTvShow || null,
    seasonNumber: t.seasonNumber || null,
    episodeNumber: t.episodeNumber || null,
    soundcheck: t.soundcheck || null,
    movieFlag: t.movieFlag || null,
  };
}

function parseFormat(filetype: string | undefined): string {
  if (!filetype) return '';

  const match = filetype.match(/^(AAC|MPEG|MP3|ALAC|Apple Lossless|WAV|FLAC)/i);
  if (match && match[1]) {
    const format = match[1].toUpperCase();
    if (format === 'MPEG') return 'MP3';
    if (format === 'APPLE LOSSLESS') return 'ALAC';
    return format;
  }

  return filetype;
}

// =============================================================================
// List subcommand
// =============================================================================

const listSubcommand = new Command('list')
  .description('list configured devices')
  .action(async () => {
    const { config, globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);

    const devices = config.devices || {};
    const defaultDevice = config.defaults?.device;
    const deviceNames = Object.keys(devices);

    if (deviceNames.length === 0) {
      out.result<DeviceListOutput>({ success: true, devices: [], defaultDevice: undefined }, () =>
        out.print("No devices configured. Run 'podkit device add -d <name>' to add one.")
      );
      return;
    }

    const deviceList = deviceNames.map((name) => {
      const device = devices[name]!;
      return {
        name,
        isDefault: name === defaultDevice,
        volumeUuid: device.volumeUuid,
        volumeName: device.volumeName,
        quality: device.quality,
        audioQuality: device.audioQuality,
        videoQuality: device.videoQuality,
        artwork: device.artwork,
      };
    });

    out.result<DeviceListOutput>({ success: true, devices: deviceList, defaultDevice }, () => {
      out.print('Configured devices:');
      out.newline();

      const headers = ['NAME', 'VOLUME', 'QUALITY', 'AUDIO', 'VIDEO', 'ARTWORK'];
      const widths = [
        Math.max(6, ...deviceNames.map((n) => n.length + 2)),
        Math.max(8, ...deviceNames.map((n) => (devices[n]?.volumeName || '').length)),
        8,
        8,
        6,
        7,
      ];

      out.print('  ' + formatRow(headers, widths));

      for (const name of deviceNames) {
        const device = devices[name]!;
        const isDefault = name === defaultDevice;
        const prefix = isDefault ? '* ' : '  ';

        const row = formatRow(
          [
            name,
            device.volumeName || '-',
            device.quality || '-',
            device.audioQuality || '-',
            device.videoQuality || '-',
            device.artwork === true ? 'yes' : device.artwork === false ? 'no' : '-',
          ],
          widths
        );

        out.print(prefix + row);
      }

      out.newline();
      out.print('* = default device');
    });
  });

// =============================================================================
// Add subcommand
// =============================================================================

/**
 * Format the iFlash evidence list into a sentence suitable for display.
 * e.g. "2048-byte block size; Capacity exceeds iPod Classic maximum"
 */
function formatIFlashEvidence(evidence: IFlashEvidence[]): string {
  return evidence.map((e) => e.signal).join('; ');
}

/**
 * Build a multi-line explanation of why macOS cannot mount an iFlash device,
 * including all detected signals with their details.
 */
function formatIFlashMountExplanation(assessment: DeviceAssessment): string[] {
  const lines: string[] = [];
  lines.push('macOS cannot automatically mount this device.');
  lines.push('');
  lines.push('iFlash confirmed by:');
  for (const e of assessment.iFlash.evidence) {
    lines.push(`  • ${e.signal}: ${e.value}`);
    lines.push(`    ${e.detail}`);
  }
  lines.push('');
  lines.push('macOS refuses to mount large FAT32 volumes through its normal mechanisms.');
  lines.push('Elevated privileges are required to mount this device directly.');
  return lines;
}

interface AddOptions {
  yes?: boolean;
  quality?: string;
  audioQuality?: string;
  videoQuality?: string;
  encoding?: string;
  artwork?: boolean;
}

const addSubcommand = new Command('add')
  .description('detect connected iPod and add to config')
  .option('--path <path>', 'explicit path to iPod mount point')
  .option('-y, --yes', 'skip confirmation prompts')
  .option(
    '--quality <preset>',
    'transcoding quality preset: max, high, medium, low'
  )
  .option(
    '--audio-quality <preset>',
    'audio quality (overrides --quality): max, high, medium, low'
  )
  .option('--video-quality <preset>', 'video quality (overrides --quality): max, high, medium, low')
  .option('--encoding <mode>', 'encoding mode: vbr, cbr')
  .option('--artwork', 'sync artwork to this device')
  .option('--no-artwork', 'do not sync artwork to this device')
  .action(async (options: AddOptions & { path?: string }) => {
    const { globalOpts, configResult } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const name = globalOpts.device;
    const explicitPath = options.path;
    const autoConfirm = options.yes ?? false;

    // Require --device flag
    if (!name) {
      const error = 'Missing required --device flag. Usage: podkit device add -d <name>';
      out.result<DeviceAddOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    // Validate device name
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
      const error =
        'Invalid device name. Must start with a letter and contain only letters, numbers, hyphens, and underscores.';
      out.result<DeviceAddOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    const existingDevices = configResult.config.devices || {};
    if (name in existingDevices) {
      const error = `Device "${name}" already exists in config. Use a different name or remove it first.`;
      out.result<DeviceAddOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    // Validate quality options
    if (options.quality !== undefined && !QUALITY_PRESETS.includes(options.quality as any)) {
      const error = `Invalid quality preset "${options.quality}". Valid values: ${QUALITY_PRESETS.join(', ')}`;
      out.result<DeviceAddOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }
    if (
      options.audioQuality !== undefined &&
      !QUALITY_PRESETS.includes(options.audioQuality as any)
    ) {
      const error = `Invalid audio quality preset "${options.audioQuality}". Valid values: ${QUALITY_PRESETS.join(', ')}`;
      out.result<DeviceAddOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }
    if (
      options.videoQuality !== undefined &&
      !VIDEO_QUALITY_PRESETS.includes(options.videoQuality as any)
    ) {
      const error = `Invalid video quality preset "${options.videoQuality}". Valid values: ${VIDEO_QUALITY_PRESETS.join(', ')}`;
      out.result<DeviceAddOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }
    if (
      options.encoding !== undefined &&
      options.encoding !== 'vbr' &&
      options.encoding !== 'cbr'
    ) {
      const error = `Invalid encoding mode "${options.encoding}". Valid values: vbr, cbr`;
      out.result<DeviceAddOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    // Load core dependencies
    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;
    let IpodDatabase: typeof import('@podkit/core').IpodDatabase;

    try {
      const core = await import('@podkit/core');
      getDeviceManager = core.getDeviceManager;
      IpodDatabase = core.IpodDatabase;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      out.result<DeviceAddOutput>({ success: false, error: message }, () => {
        out.error('Failed to load podkit-core.');
        out.verbose1(`Details: ${message}`);
      });
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();

    // If explicit path provided, use it directly
    if (explicitPath) {
      if (!existsSync(explicitPath)) {
        const error = `Path not found: ${explicitPath}`;
        out.result<DeviceAddOutput>({ success: false, error }, () => out.error(error));
        process.exitCode = 1;
        return;
      }

      // Check if database exists
      const hasDb = await IpodDatabase.hasDatabase(explicitPath);
      let trackCount = 0;
      let modelName = 'Unknown';
      let initialized = false;

      if (!hasDb) {
        out.print('');
        out.print('This iPod needs to be initialized (no iTunesDB found).');

        const shouldInit =
          autoConfirm || out.isJson || (await confirm('Initialize iPod database now?'));

        if (!shouldInit) {
          out.print('Cancelled. iPod not initialized.');
          return;
        }

        try {
          out.print('Initializing iPod database...');
          const ipod = await IpodDatabase.initializeIpod(explicitPath);
          modelName = ipod.device.modelName;
          ipod.close();
          initialized = true;
          out.print(`Initialized as ${modelName}.`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          out.result<DeviceAddOutput>(
            { success: false, error: `Failed to initialize: ${message}` },
            () => out.error(`Failed to initialize iPod: ${message}`)
          );
          process.exitCode = 1;
          return;
        }
      } else {
        // Database exists, read info
        try {
          const ipod = await IpodDatabase.open(explicitPath);
          try {
            trackCount = ipod.trackCount;
            modelName = ipod.device.modelName;
          } finally {
            ipod.close();
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          out.verbose1(`Warning: Could not read database: ${message}`);
        }
      }

      // Get volume UUID if possible (for macOS)
      let volumeUuid = '';
      let volumeName = explicitPath.split('/').pop() || 'iPod';

      if (manager.isSupported) {
        const ipods = await manager.findIpodDevices();
        const matchingDevice = ipods.find((d) => d.mountPoint === explicitPath);
        if (matchingDevice) {
          volumeUuid = matchingDevice.volumeUuid;
          volumeName = matchingDevice.volumeName;
        }
      }

      // If no UUID found, generate a stable one from the path
      if (!volumeUuid) {
        volumeUuid = `manual-${Buffer.from(explicitPath).toString('base64').replace(/[/+=]/g, '').slice(0, 16)}`;
      }

      const deviceInfo = {
        name,
        identifier: 'unknown',
        volumeName,
        volumeUuid,
        size: 0,
        isMounted: true,
        mountPoint: explicitPath,
        trackCount,
        modelName,
      };

      const deviceCount = Object.keys(existingDevices).length;
      const isFirstDevice = deviceCount === 0;
      const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
      const deviceConfig: DeviceConfig = { volumeUuid, volumeName };
      if (options.quality) deviceConfig.quality = options.quality as any;
      if (options.audioQuality) deviceConfig.audioQuality = options.audioQuality as any;
      if (options.videoQuality) deviceConfig.videoQuality = options.videoQuality as any;
      if (options.encoding) deviceConfig.encoding = options.encoding as any;
      if (options.artwork !== undefined) deviceConfig.artwork = options.artwork;

      // Validate device if database is available
      let addValidation: DeviceValidationResult | undefined;
      try {
        const ipodForValidation = await IpodDatabase.open(explicitPath);
        try {
          addValidation = validateDevice(ipodForValidation.device, explicitPath);
        } finally {
          ipodForValidation.close();
        }
      } catch {
        // Database may not be readable yet (e.g., just initialized)
      }

      if (addValidation && !addValidation.supported) {
        const messages = formatValidationMessages(addValidation);
        out.result<DeviceAddOutput>({ success: false, error: messages[0] }, () => {
          out.newline();
          for (const msg of messages) {
            out.print(msg);
          }
        });
        process.exitCode = 1;
        return;
      }

      // Interactive confirmation (skip if auto-confirm or JSON mode)
      if (!autoConfirm && out.isText) {
        out.newline();
        out.print('iPod at path:');
        out.print(`  Path:        ${explicitPath}`);
        out.print(`  Model:       ${modelName}`);
        out.print(`  Tracks:      ${formatNumber(trackCount)}`);

        // Show validation warnings during add
        if (addValidation) {
          if (addValidation.issues.length > 0) {
            out.newline();
            for (const issue of addValidation.issues) {
              out.warn(issue.message);
              if (issue.suggestion) {
                out.print(`  ${issue.suggestion}`);
              }
            }
          }

          // Show capability summary
          if (addValidation.capabilities) {
            out.print('  Capabilities:');
            const caps = addValidation.capabilities;
            const capEntries: Array<[string, boolean]> = [
              ['Music', caps.music],
              ['Artwork', caps.artwork],
              ['Video', caps.video],
              ['Podcasts', caps.podcast],
            ];
            for (const [capName, supported] of capEntries) {
              if (supported) {
                out.print(`    + ${capName}`);
              } else {
                out.print(`    - ${capName}`);
              }
            }
          }
        }

        out.newline();

        const shouldSave = await confirm(`Add this iPod as "${name}"?`);

        if (!shouldSave) {
          out.print('Cancelled. No changes made.');
          return;
        }
      }

      // Save device to config
      const result = addDevice(name, deviceConfig, { configPath });

      if (!result.success) {
        out.result<DeviceAddOutput>(
          { success: false, device: deviceInfo, error: result.error },
          () => out.error(`Failed to save config: ${result.error}`)
        );
        process.exitCode = 1;
        return;
      }

      if (isFirstDevice) {
        setDefaultDevice(name, { configPath });
      }

      out.result<DeviceAddOutput>(
        {
          success: true,
          device: deviceInfo,
          initialized,
          saved: true,
          configPath: result.configPath,
          isDefault: isFirstDevice,
        },
        () => {
          out.newline();
          out.print(
            result.created
              ? `Created config file: ${result.configPath}`
              : `Updated config file: ${result.configPath}`
          );
          out.newline();
          out.print(`Device "${name}" added to config.`);
          if (isFirstDevice) {
            out.print(`Set as default device.`);
          }
          if (initialized) {
            out.print(`Database initialized (${modelName}).`);
          }
          out.newline();
          out.print('Next steps:');
          out.print(
            '  podkit collection add -t music -c <name> --path <path>   # Add your music library'
          );
          out.print(`  podkit sync                    # Sync to this device`);
        }
      );
      return;
    }

    // No explicit path - scan for devices
    if (!manager.isSupported) {
      const error = `Device scanning is not supported on ${manager.platform}. Specify a path explicitly.`;
      out.result<DeviceAddOutput>({ success: false, error }, () => {
        out.error(error);
        out.newline();
        out.error('Usage: podkit device add -d <name> --path <path>');
        out.error('Example: podkit device add -d myipod --path /Volumes/IPOD');
      });
      process.exitCode = 1;
      return;
    }

    out.print('Scanning for attached iPods...');

    const ipods = await manager.findIpodDevices();

    if (ipods.length === 0) {
      out.result<DeviceAddOutput>({ success: false, error: 'No iPod devices found' }, () => {
        out.error('No iPod devices found.');
        out.newline();
        out.error('Make sure your iPod is connected.');
        out.newline();
        out.error('Or specify a path explicitly:');
        out.error(`  podkit device add -d ${name} --path /path/to/ipod`);
      });
      process.exitCode = 1;
      return;
    }

    // Multiple iPods found - error with guidance
    if (ipods.length > 1) {
      out.result<DeviceAddOutput>(
        {
          success: false,
          error: `Multiple iPod devices found (${ipods.length}). Specify a path explicitly.`,
        },
        () => {
          out.error(`Found ${ipods.length} iPod devices. Specify which one to add:`);
          out.newline();
          for (const ipod of ipods) {
            const path = ipod.mountPoint ?? ipod.identifier;
            out.error(`  podkit device add -d ${name} --path ${path}`);
            out.error(`    ${ipod.volumeName || '(unnamed)'} - ${formatBytes(ipod.size)}`);
            out.newline();
          }
        }
      );
      process.exitCode = 1;
      return;
    }

    let ipod = ipods[0]!;

    // Handle unmounted device: assess, attempt mount, guide user if sudo required
    if (!ipod.isMounted) {
      const assessment = await manager.assessDevice(ipod.identifier);

      out.newline();
      out.print(`Found iPod: ${ipod.volumeName} (${formatBytes(ipod.size)}) — not mounted`);
      if (assessment?.usb?.modelName) {
        out.print(`  Model:   ${assessment.usb.modelName}`);
      } else if (assessment?.usb?.productId) {
        out.print(`  Model:   iPod (USB ${assessment.usb.productId})`);
      }
      if (assessment?.iFlash.confirmed) {
        out.print(
          `  Storage: iFlash confirmed — ${formatIFlashEvidence(assessment.iFlash.evidence)}`
        );
      }
      out.newline();
      out.print('Attempting to mount...');

      const mountResult = await manager.mount(ipod.identifier);

      if (mountResult.success && mountResult.mountPoint) {
        out.print(`Mounted at ${mountResult.mountPoint}.`);
        // Re-fetch device info so subsequent code has the mount point
        const updated = await manager.findByVolumeUuid(ipod.volumeUuid);
        if (updated?.isMounted) ipod = updated;
      } else if (mountResult.requiresSudo) {
        const explanationLines = assessment?.iFlash.confirmed
          ? formatIFlashMountExplanation(assessment)
          : ['Mounting requires elevated privileges.'];

        out.result<DeviceAddOutput>(
          { success: false, error: 'Elevated privileges required to mount device' },
          () => {
            for (const line of explanationLines) {
              out.error(line);
            }
            out.newline();
            out.error(`Run:  ${bold('sudo')} podkit device add -d ${name}`);
          }
        );
        process.exitCode = 1;
        return;
      } else {
        out.result<DeviceAddOutput>(
          { success: false, error: mountResult.error ?? 'Failed to mount device' },
          () => out.error(`Failed to mount: ${mountResult.error}`)
        );
        process.exitCode = 1;
        return;
      }
    }

    // Check if the iPod has a database
    let trackCount = 0;
    let modelName = 'Unknown';
    let initialized = false;

    if (ipod.mountPoint) {
      const hasDb = await IpodDatabase.hasDatabase(ipod.mountPoint);

      if (!hasDb) {
        out.newline();
        out.print('This iPod needs to be initialized (no iTunesDB found).');

        const shouldInit =
          autoConfirm || out.isJson || (await confirm('Initialize iPod database now?'));

        if (!shouldInit) {
          out.print('Cancelled. iPod not initialized.');
          return;
        }

        try {
          out.print('Initializing iPod database...');
          const db = await IpodDatabase.initializeIpod(ipod.mountPoint);
          modelName = db.device.modelName;
          db.close();
          initialized = true;
          out.print(`Initialized as ${modelName}.`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          out.result<DeviceAddOutput>(
            { success: false, error: `Failed to initialize: ${message}` },
            () => out.error(`Failed to initialize iPod: ${message}`)
          );
          process.exitCode = 1;
          return;
        }
      } else {
        // Database exists, read info
        try {
          const db = await IpodDatabase.open(ipod.mountPoint);
          try {
            trackCount = db.trackCount;
            modelName = db.device.modelName;
          } finally {
            db.close();
          }
        } catch {
          // Couldn't read database info, continue anyway
        }
      }
    }

    const deviceInfo = {
      name,
      identifier: ipod.identifier,
      volumeName: ipod.volumeName,
      volumeUuid: ipod.volumeUuid,
      size: ipod.size,
      isMounted: ipod.isMounted,
      mountPoint: ipod.mountPoint,
      trackCount,
      modelName,
    };

    const deviceCount = Object.keys(existingDevices).length;
    const isFirstDevice = deviceCount === 0;
    const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
    const deviceConfig: DeviceConfig = {
      volumeUuid: ipod.volumeUuid,
      volumeName: ipod.volumeName,
    };
    if (options.quality) deviceConfig.quality = options.quality as any;
    if (options.audioQuality) deviceConfig.audioQuality = options.audioQuality as any;
    if (options.videoQuality) deviceConfig.videoQuality = options.videoQuality as any;
    if (options.encoding) deviceConfig.encoding = options.encoding as any;
    if (options.artwork !== undefined) deviceConfig.artwork = options.artwork;

    // Validate detected device
    let autoDetectValidation: DeviceValidationResult | undefined;
    if (ipod.mountPoint) {
      try {
        const db = await IpodDatabase.open(ipod.mountPoint);
        try {
          autoDetectValidation = validateDevice(db.device, ipod.mountPoint);
        } finally {
          db.close();
        }
      } catch {
        // Couldn't validate, continue anyway
      }
    }

    if (autoDetectValidation && !autoDetectValidation.supported) {
      const messages = formatValidationMessages(autoDetectValidation);
      out.result<DeviceAddOutput>({ success: false, error: messages[0] }, () => {
        out.newline();
        for (const msg of messages) {
          out.print(msg);
        }
      });
      process.exitCode = 1;
      return;
    }

    // Interactive mode (skip if auto-confirm or JSON mode)
    if (!autoConfirm && out.isText) {
      out.newline();
      out.print('Found attached iPod:');
      out.print(`  Name:        ${ipod.volumeName || '(unnamed)'}`);
      out.print(`  Model:       ${modelName}`);
      out.print(`  Size:        ${formatBytes(ipod.size)}`);
      out.print(`  Tracks:      ${formatNumber(trackCount)}`);
      out.print(`  Volume UUID: ${ipod.volumeUuid}`);
      out.print(`  Mounted:     ${ipod.isMounted ? 'Yes' : 'No'}`);
      if (ipod.mountPoint) {
        out.print(`  Mount point: ${ipod.mountPoint}`);
      }
      out.print(`  Device:      /dev/${ipod.identifier}`);

      // Show validation warnings during add
      if (autoDetectValidation) {
        if (autoDetectValidation.issues.length > 0) {
          out.newline();
          for (const issue of autoDetectValidation.issues) {
            out.warn(issue.message);
            if (issue.suggestion) {
              out.print(`  ${issue.suggestion}`);
            }
          }
        }

        // Show capability summary
        if (autoDetectValidation.capabilities) {
          out.print('  Capabilities:');
          const caps = autoDetectValidation.capabilities;
          const capEntries: Array<[string, boolean]> = [
            ['Music', caps.music],
            ['Artwork', caps.artwork],
            ['Video', caps.video],
            ['Podcasts', caps.podcast],
          ];
          for (const [capName, supported] of capEntries) {
            if (supported) {
              out.print(`    + ${capName}`);
            } else {
              out.print(`    - ${capName}`);
            }
          }
        }
      }

      out.newline();

      const shouldSave = await confirm(`Add this iPod as "${name}"?`);

      if (!shouldSave) {
        out.print('Cancelled. No changes made.');
        return;
      }
    }

    // Save device to config
    const result = addDevice(name, deviceConfig, { configPath });

    if (!result.success) {
      out.result<DeviceAddOutput>({ success: false, device: deviceInfo, error: result.error }, () =>
        out.error(`Failed to save config: ${result.error}`)
      );
      process.exitCode = 1;
      return;
    }

    if (isFirstDevice) {
      setDefaultDevice(name, { configPath });
    }

    out.result<DeviceAddOutput>(
      {
        success: true,
        device: deviceInfo,
        initialized,
        saved: true,
        configPath: result.configPath,
        isDefault: isFirstDevice,
      },
      () => {
        out.newline();
        out.print(
          result.created
            ? `Created config file: ${result.configPath}`
            : `Updated config file: ${result.configPath}`
        );
        out.newline();
        out.print(`Device "${name}" added to config.`);
        if (isFirstDevice) {
          out.print(`Set as default device.`);
        }
        if (initialized) {
          out.print(`Database initialized (${modelName}).`);
        }
        out.newline();
        out.print('Next steps:');
        out.print(
          '  podkit collection add -t music -c <name> --path <path>   # Add your music library'
        );
        out.print(`  podkit sync                    # Sync to this device`);
      }
    );
  });

// =============================================================================
// Remove subcommand
// =============================================================================

const removeSubcommand = new Command('remove')
  .description('remove a device from config')
  .option('--confirm', 'skip confirmation prompt')
  .action(async (options: { confirm?: boolean }) => {
    const { config, globalOpts, configResult } = getContext();
    const name = globalOpts.device;
    const out = OutputContext.fromGlobalOpts(globalOpts);

    if (!name) {
      const error = 'Missing required --device flag. Usage: podkit device remove -d <name>';
      out.result<DeviceRemoveOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    const devices = config.devices || {};
    const defaultDevice = config.defaults?.device;

    if (!(name in devices)) {
      const error = `Device "${name}" not found in config.`;
      out.result<DeviceRemoveOutput>({ success: false, error }, () => {
        out.error(error);
        const available = Object.keys(devices);
        if (available.length > 0) {
          out.error(`Available devices: ${available.join(', ')}`);
        }
      });
      process.exitCode = 1;
      return;
    }

    const wasDefault = name === defaultDevice;

    if (!options.confirm && out.isText) {
      out.print(`This will remove device "${name}" from the config.`);
      if (wasDefault) {
        out.print('This device is currently set as the default.');
      }
      out.newline();

      const confirmed = await confirmNo(`Remove device "${name}"?`);
      if (!confirmed) {
        out.print('Cancelled. No changes made.');
        return;
      }
    }

    const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
    const result = removeDevice(name, { configPath });

    if (!result.success) {
      out.result<DeviceRemoveOutput>({ success: false, error: result.error }, () =>
        out.error(`Failed to remove device: ${result.error}`)
      );
      process.exitCode = 1;
      return;
    }

    if (wasDefault) {
      setDefaultDevice('', { configPath });
    }

    out.result<DeviceRemoveOutput>({ success: true, device: name, wasDefault }, () => {
      out.print(`Device "${name}" removed from config.`);
      if (wasDefault) {
        out.print('Cleared default device setting.');
      }
    });
  });

// =============================================================================
// Info subcommand
// =============================================================================

const infoSubcommand = new Command('info')
  .description('display device configuration and live status')
  .action(async () => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);

    const resolved = resolveDeviceArg();
    if ('error' in resolved) {
      out.result<DeviceInfoOutput>({ success: false, error: resolved.error }, () =>
        out.error(resolved.error)
      );
      process.exitCode = 1;
      return;
    }

    const { resolvedDevice, cliPath, config } = resolved;
    const device = resolvedDevice?.config;
    const deviceName = resolvedDevice?.name;
    const defaultDevice = config.defaults?.device;
    const isDefault = deviceName === defaultDevice;

    // Try to get live status if device is connected
    let liveStatus: DeviceInfoOutput['status'] | undefined;

    try {
      const core = await import('@podkit/core');
      const manager = core.getDeviceManager();
      const deviceIdentity = getDeviceIdentity(resolvedDevice);

      if (cliPath || deviceIdentity) {
        const resolveResult = await resolveDevicePath({
          cliDevice: cliPath,
          deviceIdentity,
          manager,
          requireMounted: true,
          quiet: true,
        });

        if (resolveResult.path && existsSync(resolveResult.path)) {
          try {
            const ipod = await core.IpodDatabase.open(resolveResult.path);
            try {
              const info = ipod.getInfo();
              const storage = getStorageInfo(resolveResult.path);

              const tracks = ipod.getTracks();
              const musicCount = tracks.filter((t) => core.isMusicMediaType(t.mediaType)).length;
              const videoCount = tracks.filter((t) => core.isVideoMediaType(t.mediaType)).length;
              const syncTagCount = tracks.filter((t) => parseSyncTag(t.comment) !== null).length;

              const deviceValidation = validateDevice(info.device, resolveResult.path);

              liveStatus = {
                mounted: true,
                mountPoint: resolveResult.path,
                model: {
                  name: info.device.modelName,
                  number: info.device.modelNumber,
                  generation: info.device.generation,
                  capacity: info.device.capacity,
                },
                capabilities: deviceValidation.capabilities,
                validation: {
                  supported: deviceValidation.supported,
                  issues: deviceValidation.issues,
                  warnings: deviceValidation.warnings,
                },
                musicCount,
                videoCount,
                syncTagCount,
              };

              if (storage) {
                liveStatus.storage = {
                  used: storage.used,
                  total: storage.total,
                  free: storage.free,
                  percentUsed: Math.round((storage.used / storage.total) * 100),
                };
              }
            } finally {
              ipod.close();
            }
          } catch {
            liveStatus = { mounted: true, mountPoint: resolveResult.path };
          }
        } else if (resolveResult.deviceInfo) {
          liveStatus = { mounted: false };
        }
      }
    } catch {
      // podkit-core not available, skip live status
    }

    out.result<DeviceInfoOutput>(
      {
        success: true,
        device: device
          ? {
              name: deviceName!,
              volumeUuid: device.volumeUuid,
              volumeName: device.volumeName,
              quality: device.quality,
              audioQuality: device.audioQuality,
              videoQuality: device.videoQuality,
              artwork: device.artwork,
              transforms: device.transforms as unknown as Record<string, unknown> | undefined,
              isDefault,
            }
          : undefined,
        status: liveStatus,
      },
      () => {
        // Human-readable output
        if (device) {
          out.print(`Device: ${deviceName}${isDefault ? ' (default)' : ''}`);
          out.print(`  Volume UUID:   ${device.volumeUuid}`);
          out.print(`  Volume Name:   ${device.volumeName}`);
        } else if (cliPath) {
          out.print(`Device: ${cliPath} (path mode)`);
        }

        if (liveStatus) {
          if (liveStatus.mounted && liveStatus.mountPoint) {
            out.print(`  Status:        Mounted at ${liveStatus.mountPoint}`);
          } else if (liveStatus.mounted === false) {
            out.print(`  Status:        Not mounted`);
          }

          if (liveStatus.model) {
            const capacityStr =
              liveStatus.model.capacity > 0 ? ` (${liveStatus.model.capacity}GB)` : '';
            const genStr = formatGeneration(liveStatus.model.generation);
            out.print(`  Model:         ${liveStatus.model.name}${capacityStr} - ${genStr}`);
          }

          // Show validation issues/warnings
          if (liveStatus.validation) {
            for (const issue of liveStatus.validation.issues) {
              if (issue.type === 'unsupported_device') {
                out.print(`  ** ${issue.message}`);
              } else {
                out.warn(issue.message);
              }
              if (issue.suggestion) {
                out.print(`     ${issue.suggestion}`);
              }
            }
          }

          // Show capabilities
          if (liveStatus.capabilities && liveStatus.model) {
            out.print('  Capabilities:');
            const caps = liveStatus.capabilities;
            const gen = formatGeneration(liveStatus.model.generation);
            const capEntries: Array<[string, boolean]> = [
              ['Music', caps.music],
              ['Artwork', caps.artwork],
              ['Video', caps.video],
              ['Podcasts', caps.podcast],
            ];
            for (const [name, supported] of capEntries) {
              if (supported) {
                out.print(`    + ${name}`);
              } else {
                out.print(`    - ${name} (not supported on ${gen})`);
              }
            }
          }

          if (liveStatus.storage) {
            const usedStr = formatBytes(liveStatus.storage.used);
            const totalStr = formatBytes(liveStatus.storage.total);
            out.print(
              `  Storage:       ${usedStr} used / ${totalStr} total (${liveStatus.storage.percentUsed}%)`
            );
          }

          if (liveStatus.musicCount !== undefined) {
            const syncSuffix =
              liveStatus.syncTagCount && liveStatus.syncTagCount > 0
                ? ` (${formatNumber(liveStatus.syncTagCount)} with sync tags)`
                : '';
            out.print(`  Music:         ${formatNumber(liveStatus.musicCount)} tracks${syncSuffix}`);
          }
          if (liveStatus.videoCount !== undefined && liveStatus.videoCount > 0) {
            out.print(`  Video:         ${formatNumber(liveStatus.videoCount)} videos`);
          }
        }

        if (device) {
          out.print(`  Quality:       ${device.quality || '(not set)'}`);
          if (device.audioQuality) {
            out.print(`  Audio Quality: ${device.audioQuality}`);
          }
          if (device.videoQuality) {
            out.print(`  Video Quality: ${device.videoQuality}`);
          }
          out.print(
            `  Artwork:       ${device.artwork === true ? 'yes' : device.artwork === false ? 'no' : '(not set)'}`
          );

          if (device.transforms) {
            out.print('  Transforms:');
            for (const [transformName, transformConfig] of Object.entries(device.transforms)) {
              const cfg = transformConfig as Record<string, unknown>;
              const enabled = cfg.enabled !== false;
              const details: string[] = [];

              if ('format' in cfg && cfg.format) {
                details.push(`format: "${cfg.format}"`);
              }
              if ('drop' in cfg && cfg.drop === true) {
                details.push('drop');
              }

              const detailStr = details.length > 0 ? ` (${details.join(', ')})` : '';
              out.print(`    ${transformName}: ${enabled ? 'enabled' : 'disabled'}${detailStr}`);
            }
          }
        }
      }
    );
  });

// =============================================================================
// Music subcommand
// =============================================================================

interface MusicVideoOptions {
  format?: string;
  fields?: string;
  tracks?: boolean;
  albums?: boolean;
  artists?: boolean;
}

const musicSubcommand = new Command('music')
  .description('list music on device (shows stats by default)')
  .option('--tracks', 'list all tracks')
  .option('--albums', 'list albums with track counts')
  .option('--artists', 'list artists with album/track counts')
  .option('--format <fmt>', 'output format: table, json, csv', 'table')
  .option('--fields <list>', 'fields to show (comma-separated, for --tracks)')
  .action(async (options: MusicVideoOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const format = out.isJson ? 'json' : options.format;
    const fields = parseFields(options.fields);
    const mode = options.tracks
      ? 'tracks'
      : options.albums
        ? 'albums'
        : options.artists
          ? 'artists'
          : 'stats';

    const outputError = (error: string) => {
      if (format === 'json') {
        out.stdout(JSON.stringify({ error: true, message: error }, null, 2));
      } else {
        out.error(`Error: ${error}`);
      }
      process.exitCode = 1;
    };

    if (options.fields && mode !== 'tracks') {
      outputError('--fields can only be used with --tracks');
      return;
    }

    const resolved = resolveDeviceArg();
    if ('error' in resolved) {
      outputError(resolved.error);
      return;
    }

    const { resolvedDevice, cliPath } = resolved;

    try {
      const core = await import('@podkit/core');
      const manager = core.getDeviceManager();
      const deviceIdentity = getDeviceIdentity(resolvedDevice);

      if (deviceIdentity?.volumeUuid && format !== 'json') {
        out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
      }

      const resolveResult = await resolveDevicePath({
        cliDevice: cliPath,
        deviceIdentity,
        manager,
        requireMounted: true,
        quiet: globalOpts.quiet,
      });

      if (!resolveResult.path) {
        outputError(resolveResult.error ?? formatDeviceError(resolveResult));
        return;
      }

      if (!existsSync(resolveResult.path)) {
        outputError(`iPod not found at path: ${resolveResult.path}`);
        return;
      }

      const ipod = await core.IpodDatabase.open(resolveResult.path);
      try {
        const allTracks = ipod.getTracks();
        const musicTracks = allTracks.filter((t) => core.isMusicMediaType(t.mediaType));
        const deviceName = resolvedDevice?.name?.toUpperCase() || 'iPod';
        const heading = `Music on ${deviceName}:`;

        const displayTracks: DisplayTrack[] = musicTracks.map((t) => ({
          title: t.title || 'Unknown Title',
          artist: t.artist || 'Unknown Artist',
          album: t.album || 'Unknown Album',
          duration: t.duration,
          albumArtist: t.albumArtist || undefined,
          genre: t.genre || undefined,
          year: t.year && t.year > 0 ? t.year : undefined,
          trackNumber: t.trackNumber && t.trackNumber > 0 ? t.trackNumber : undefined,
          discNumber: t.discNumber && t.discNumber > 0 ? t.discNumber : undefined,
          filePath: t.filePath || undefined,
          artwork: t.hasArtwork,
          compilation: t.compilation,
          format: parseFormat(t.filetype),
          bitrate: t.bitrate > 0 ? t.bitrate : undefined,
          soundcheck: t.soundcheck || undefined,
          syncTag: parseSyncTag(t.comment) !== null,
        }));

        if (mode === 'stats') {
          const stats = computeStats(displayTracks);
          if (format === 'json') {
            out.stdout(JSON.stringify(stats, null, 2));
          } else {
            out.stdout(formatStatsText(stats, heading, { verbose: out.isVerbose }));
          }
        } else if (mode === 'albums') {
          const albums = aggregateAlbums(displayTracks);
          if (format === 'json') {
            out.stdout(JSON.stringify(albums, null, 2));
          } else if (format === 'csv') {
            const lines = ['Album,Artist,Tracks'];
            for (const a of albums) {
              lines.push(`${escapeCsvField(a.album)},${escapeCsvField(a.artist)},${a.tracks}`);
            }
            out.stdout(lines.join('\n'));
          } else {
            out.stdout(formatAlbumsTable(albums, heading));
          }
        } else if (mode === 'artists') {
          const artists = aggregateArtists(displayTracks);
          if (format === 'json') {
            out.stdout(JSON.stringify(artists, null, 2));
          } else if (format === 'csv') {
            const lines = ['Artist,Albums,Tracks'];
            for (const a of artists) {
              lines.push(`${escapeCsvField(a.artist)},${a.albums},${a.tracks}`);
            }
            out.stdout(lines.join('\n'));
          } else {
            out.stdout(formatArtistsTable(artists, heading));
          }
        } else {
          // tracks mode
          if (format === 'json') {
            const fullTracks = musicTracks.map((t) => ({
              ...ipodTrackToFullJson(t),
              syncTag: parseSyncTag(t.comment) !== null,
            }));
            out.stdout(JSON.stringify(fullTracks, null, 2));
          } else if (format === 'csv') {
            out.stdout(formatCsv(displayTracks, fields));
          } else {
            out.stdout(formatTable(displayTracks, fields));
          }
        }
      } finally {
        ipod.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputError(message);
    }
  });

// =============================================================================
// Video subcommand
// =============================================================================

const videoSubcommand = new Command('video')
  .description('list video content on device (shows stats by default)')
  .option('--tracks', 'list all tracks')
  .option('--albums', 'list albums with track counts')
  .option('--artists', 'list artists with album/track counts')
  .option('--format <fmt>', 'output format: table, json, csv', 'table')
  .option('--fields <list>', 'fields to show (comma-separated, for --tracks)')
  .action(async (options: MusicVideoOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const format = out.isJson ? 'json' : options.format;
    const fields = parseFields(options.fields);
    const mode = options.tracks
      ? 'tracks'
      : options.albums
        ? 'albums'
        : options.artists
          ? 'artists'
          : 'stats';

    const outputError = (error: string) => {
      if (format === 'json') {
        out.stdout(JSON.stringify({ error: true, message: error }, null, 2));
      } else {
        out.error(`Error: ${error}`);
      }
      process.exitCode = 1;
    };

    if (options.fields && mode !== 'tracks') {
      outputError('--fields can only be used with --tracks');
      return;
    }

    const resolved = resolveDeviceArg();
    if ('error' in resolved) {
      outputError(resolved.error);
      return;
    }

    const { resolvedDevice, cliPath } = resolved;

    try {
      const core = await import('@podkit/core');
      const manager = core.getDeviceManager();
      const deviceIdentity = getDeviceIdentity(resolvedDevice);

      if (deviceIdentity?.volumeUuid && format !== 'json') {
        out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
      }

      const resolveResult = await resolveDevicePath({
        cliDevice: cliPath,
        deviceIdentity,
        manager,
        requireMounted: true,
        quiet: globalOpts.quiet,
      });

      if (!resolveResult.path) {
        outputError(resolveResult.error ?? formatDeviceError(resolveResult));
        return;
      }

      if (!existsSync(resolveResult.path)) {
        outputError(`iPod not found at path: ${resolveResult.path}`);
        return;
      }

      const ipod = await core.IpodDatabase.open(resolveResult.path);
      try {
        const allTracks = ipod.getTracks();
        const videoTracks = allTracks.filter((t) => core.isVideoMediaType(t.mediaType));
        const deviceName = resolvedDevice?.name?.toUpperCase() || 'iPod';
        const heading = `Video on ${deviceName}:`;

        const displayTracks: DisplayTrack[] = videoTracks.map((t) => ({
          title: t.title || 'Unknown Title',
          artist: t.artist || 'Unknown Artist',
          album: t.album || 'Unknown Album',
          duration: t.duration,
          albumArtist: t.albumArtist || undefined,
          genre: t.genre || undefined,
          year: t.year && t.year > 0 ? t.year : undefined,
          trackNumber: t.trackNumber && t.trackNumber > 0 ? t.trackNumber : undefined,
          discNumber: t.discNumber && t.discNumber > 0 ? t.discNumber : undefined,
          filePath: t.filePath || undefined,
          artwork: t.hasArtwork,
          compilation: t.compilation,
          format: parseFormat(t.filetype),
          bitrate: t.bitrate > 0 ? t.bitrate : undefined,
          syncTag: parseSyncTag(t.comment) !== null,
        }));

        if (mode === 'stats') {
          const stats = computeStats(displayTracks);
          if (format === 'json') {
            out.stdout(JSON.stringify(stats, null, 2));
          } else {
            out.stdout(formatStatsText(stats, heading, { verbose: out.isVerbose }));
          }
        } else if (mode === 'albums') {
          const albums = aggregateAlbums(displayTracks);
          if (format === 'json') {
            out.stdout(JSON.stringify(albums, null, 2));
          } else if (format === 'csv') {
            const lines = ['Album,Artist,Tracks'];
            for (const a of albums) {
              lines.push(`${escapeCsvField(a.album)},${escapeCsvField(a.artist)},${a.tracks}`);
            }
            out.stdout(lines.join('\n'));
          } else {
            out.stdout(formatAlbumsTable(albums, heading));
          }
        } else if (mode === 'artists') {
          const artists = aggregateArtists(displayTracks);
          if (format === 'json') {
            out.stdout(JSON.stringify(artists, null, 2));
          } else if (format === 'csv') {
            const lines = ['Artist,Albums,Tracks'];
            for (const a of artists) {
              lines.push(`${escapeCsvField(a.artist)},${a.albums},${a.tracks}`);
            }
            out.stdout(lines.join('\n'));
          } else {
            out.stdout(formatArtistsTable(artists, heading));
          }
        } else {
          // tracks mode
          if (format === 'json') {
            const fullTracks = videoTracks.map((t) => ({
              ...ipodTrackToFullJson(t),
              syncTag: parseSyncTag(t.comment) !== null,
            }));
            out.stdout(JSON.stringify(fullTracks, null, 2));
          } else if (format === 'csv') {
            out.stdout(formatCsv(displayTracks, fields));
          } else {
            out.stdout(formatTable(displayTracks, fields));
          }
        }
      } finally {
        ipod.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputError(message);
    }
  });

// =============================================================================
// Clear subcommand
// =============================================================================

interface ClearOptions {
  confirm?: boolean;
  dryRun?: boolean;
  type?: 'music' | 'video' | 'all';
}

const clearSubcommand = new Command('clear')
  .description('remove content from the iPod (all, music only, or video only)')
  .option('--confirm', 'skip confirmation prompt (for scripts)')
  .option('--dry-run', 'show what would be removed without removing')
  .option(
    '--type <type>',
    'content type to clear: "music", "video", or "all" (default: all)',
    'all'
  )
  .action(async (options: ClearOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);

    const resolved = resolveDeviceArg();
    if ('error' in resolved) {
      out.result<DeviceClearOutput>({ success: false, error: resolved.error }, () =>
        out.error(resolved.error)
      );
      process.exitCode = 1;
      return;
    }

    const { resolvedDevice, cliPath } = resolved;

    let IpodDatabase: typeof import('@podkit/core').IpodDatabase;
    let IpodError: typeof import('@podkit/core').IpodError;
    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;

    try {
      const core = await import('@podkit/core');
      IpodDatabase = core.IpodDatabase;
      IpodError = core.IpodError;
      getDeviceManager = core.getDeviceManager;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      out.result<DeviceClearOutput>({ success: false, error: message }, () => {
        out.error('Failed to load podkit-core.');
        out.verbose1(`Details: ${message}`);
      });
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();
    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (deviceIdentity?.volumeUuid) {
      out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
    }

    const resolveResult = await resolveDevicePath({
      cliDevice: cliPath,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
    });

    if (!resolveResult.path) {
      out.result<DeviceClearOutput>(
        { success: false, error: resolveResult.error ?? formatDeviceError(resolveResult) },
        () => out.error(resolveResult.error ?? formatDeviceError(resolveResult))
      );
      process.exitCode = 1;
      return;
    }

    const devicePath = resolveResult.path;

    if (!existsSync(devicePath)) {
      out.result<DeviceClearOutput>(
        { success: false, error: `Device path not found: ${devicePath}` },
        () => {
          out.error(`iPod not found at: ${devicePath}`);
          out.newline();
          out.error('Make sure the iPod is connected and mounted.');
        }
      );
      process.exitCode = 1;
      return;
    }

    let ipod;
    try {
      ipod = await IpodDatabase.open(devicePath);
    } catch (err) {
      const isIpodError = err instanceof IpodError;
      const message = err instanceof Error ? err.message : String(err);

      out.result<DeviceClearOutput>(
        {
          success: false,
          error: isIpodError ? `Not an iPod or database corrupted: ${message}` : message,
        },
        () => {
          out.error(`Cannot read iPod database at: ${devicePath}`);
          out.newline();
          if (isIpodError) {
            out.error('This path does not appear to be a valid iPod:');
            out.error('  - Missing iTunesDB file');
            out.error('  - Database may be corrupted');
          } else {
            out.error(`Error: ${message}`);
          }
        }
      );
      process.exitCode = 1;
      return;
    }

    // Validate type option
    const contentType = options.type ?? 'all';
    if (!['music', 'video', 'all'].includes(contentType)) {
      const errorMsg = `Invalid type "${contentType}". Must be "music", "video", or "all".`;
      out.result<DeviceClearOutput>({ success: false, error: errorMsg }, () => out.error(errorMsg));
      process.exitCode = 1;
      ipod.close();
      return;
    }

    try {
      const { isMusicMediaType, isVideoMediaType } = await import('@podkit/core');

      const allTracks = ipod.getTracks();

      // Filter tracks based on content type
      let targetTracks;
      if (contentType === 'all') {
        targetTracks = allTracks;
      } else if (contentType === 'music') {
        targetTracks = allTracks.filter((t) => isMusicMediaType(t.mediaType));
      } else {
        targetTracks = allTracks.filter((t) => isVideoMediaType(t.mediaType));
      }

      const targetCount = targetTracks.length;
      const targetSize = targetTracks.reduce((sum, track) => sum + track.size, 0);

      const contentLabel =
        contentType === 'all' ? 'content' : contentType === 'music' ? 'music tracks' : 'videos';

      if (targetCount === 0) {
        out.result<DeviceClearOutput>(
          { success: true, contentType, tracksRemoved: 0, totalTracks: 0, dryRun: options.dryRun },
          () => out.print(`iPod has no ${contentLabel} to remove.`)
        );
        return;
      }

      if (options.dryRun) {
        out.result<DeviceClearOutput>(
          {
            success: true,
            contentType,
            tracksRemoved: targetCount,
            totalTracks: targetCount,
            totalSize: targetSize,
            dryRun: true,
          },
          () => {
            out.print(
              `Found ${formatNumber(targetCount)} ${contentLabel} (${formatBytes(targetSize)})`
            );
            out.newline();
            out.print(`Dry run: would remove ${contentLabel} and files.`);
          }
        );
        return;
      }

      if (!options.confirm && out.isText) {
        out.print(
          `Found ${formatNumber(targetCount)} ${contentLabel} (${formatBytes(targetSize)})`
        );
        out.newline();
        if (contentType === 'all') {
          out.print('This will remove ALL content from the iPod. Files will be deleted.');
        } else {
          out.print(`This will remove all ${contentLabel} from the iPod. Files will be deleted.`);
        }
        out.print('This action cannot be undone.');
        out.newline();

        const confirmPrompt =
          contentType === 'all' ? 'Delete all content?' : `Delete all ${contentLabel}?`;
        const confirmed = await confirmNo(confirmPrompt);
        if (!confirmed) {
          out.result<DeviceClearOutput>(
            { success: false, error: 'Operation cancelled by user' },
            () => out.print('Operation cancelled.')
          );
          process.exitCode = 1;
          return;
        }
      }

      out.print(`Removing ${contentLabel}...`);

      // Perform the removal based on content type
      let result;
      if (contentType === 'all') {
        result = ipod.removeAllTracks({ deleteFiles: true });
      } else {
        result = ipod.removeTracksByContentType(contentType, { deleteFiles: true });
      }
      await ipod.save();

      if (result.fileDeleteErrors.length > 0) {
        for (const error of result.fileDeleteErrors) {
          out.warn(error);
        }
      }

      out.result<DeviceClearOutput>(
        {
          success: true,
          contentType,
          tracksRemoved: result.removedCount,
          totalTracks: targetCount,
          totalSize: targetSize,
          fileDeleteErrors:
            result.fileDeleteErrors.length > 0 ? result.fileDeleteErrors : undefined,
        },
        () =>
          out.print(
            `Removed ${formatNumber(result.removedCount)} ${contentLabel}, freed ${formatBytes(targetSize)}.`
          )
      );
    } finally {
      ipod.close();
    }
  });

// =============================================================================
// Reset subcommand
// =============================================================================

interface ResetOptions {
  yes?: boolean;
  dryRun?: boolean;
}

const resetSubcommand = new Command('reset')
  .description(
    'recreate iPod database from scratch (note: does not delete orphaned audio files in iPod_Control/Music/; use "device clear --type all" first to remove all content)'
  )
  .option('-y, --yes', 'skip confirmation prompt')
  .option('--dry-run', 'show what would happen without making changes')
  .action(async (options: ResetOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const autoConfirm = options.yes ?? false;

    const resolved = resolveDeviceArg();
    if ('error' in resolved) {
      out.result<DeviceResetOutput>({ success: false, error: resolved.error }, () =>
        out.error(resolved.error)
      );
      process.exitCode = 1;
      return;
    }

    const { resolvedDevice, cliPath } = resolved;

    let IpodDatabase: typeof import('@podkit/core').IpodDatabase;
    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;

    try {
      const core = await import('@podkit/core');
      IpodDatabase = core.IpodDatabase;
      getDeviceManager = core.getDeviceManager;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      out.result<DeviceResetOutput>({ success: false, error: message }, () => {
        out.error('Failed to load podkit-core.');
        out.verbose1(`Details: ${message}`);
      });
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();
    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (deviceIdentity?.volumeUuid) {
      out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
    }

    const resolveResult = await resolveDevicePath({
      cliDevice: cliPath,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
    });

    if (!resolveResult.path) {
      out.result<DeviceResetOutput>(
        { success: false, error: resolveResult.error ?? formatDeviceError(resolveResult) },
        () => out.error(resolveResult.error ?? formatDeviceError(resolveResult))
      );
      process.exitCode = 1;
      return;
    }

    const devicePath = resolveResult.path;

    if (!existsSync(devicePath)) {
      out.result<DeviceResetOutput>(
        { success: false, error: `Device path not found: ${devicePath}` },
        () => {
          out.error(`iPod not found at: ${devicePath}`);
          out.newline();
          out.error('Make sure the iPod is connected and mounted.');
        }
      );
      process.exitCode = 1;
      return;
    }

    // Check if database exists and get current track count
    const hasDb = await IpodDatabase.hasDatabase(devicePath);
    let currentTrackCount = 0;

    if (hasDb) {
      try {
        const ipod = await IpodDatabase.open(devicePath);
        try {
          currentTrackCount = ipod.trackCount;
        } finally {
          ipod.close();
        }
      } catch {
        // Database exists but couldn't be read - that's fine, we're resetting anyway
      }
    }

    const actionVerb = hasDb ? 'recreate' : 'create';
    const actionVerbPast = hasDb ? 'recreated' : 'created';
    const actionVerbIng = hasDb ? 'Recreating' : 'Creating';

    if (options.dryRun) {
      out.result<DeviceResetOutput>(
        { success: true, mountPoint: devicePath, tracksRemoved: currentTrackCount, dryRun: true },
        () => {
          out.print('Dry run - would perform the following:');
          out.newline();
          if (hasDb) {
            out.print(`  1. Remove existing database (${formatNumber(currentTrackCount)} tracks)`);
            out.print('  2. Create fresh iTunesDB');
          } else {
            out.print('  1. Create new iTunesDB (no existing database found)');
          }
          out.print(`  ${hasDb ? '3' : '2'}. Preserve filesystem and volume UUID`);
          out.newline();
          out.print('No changes made.');
        }
      );
      return;
    }

    // Strong confirmation (defaults to No) - only needed if there's content to lose
    if (!autoConfirm && out.isText) {
      out.newline();
      if (hasDb) {
        out.print('WARNING: This will recreate the iPod database from scratch.');
        out.print('All tracks, playlists, and play counts will be lost.');
        if (currentTrackCount > 0) {
          out.print(`Currently: ${formatNumber(currentTrackCount)} tracks`);
        }
        out.newline();
        out.print('Your device configuration in podkit will remain valid.');
        out.newline();

        const confirmed = await confirmNo('Continue?');
        if (!confirmed) {
          out.print('Cancelled. No changes made.');
          return;
        }
      } else {
        out.print('No existing database found. A fresh database will be created.');
        out.newline();
      }
    }

    out.print(`${actionVerbIng} database...`);

    try {
      const ipod = await IpodDatabase.initializeIpod(devicePath);
      const modelName = ipod.device.modelName;
      ipod.close();

      out.result<DeviceResetOutput>(
        { success: true, mountPoint: devicePath, modelName, tracksRemoved: currentTrackCount },
        () => {
          out.newline();
          out.print(`Database ${actionVerbPast}.`);
          out.print(`  Model:  ${modelName}`);
          out.print(`  Tracks: 0`);
          out.print(`  Path:   ${devicePath}`);
          if (currentTrackCount > 0) {
            out.newline();
            out.print(`Removed ${formatNumber(currentTrackCount)} tracks.`);
          }
          out.newline();
          out.print('You can now sync fresh content:');
          out.print('  podkit sync');
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.result<DeviceResetOutput>(
        { success: false, mountPoint: devicePath, error: message },
        () => out.error(`Failed to ${actionVerb} iPod database: ${message}`)
      );
      process.exitCode = 1;
    }
  });

// =============================================================================
// Eject subcommand
// =============================================================================

interface EjectOptions {
  force?: boolean;
}

const ejectSubcommand = new Command('eject')
  .alias('unmount')
  .description('safely unmount an iPod device')
  .option('-f, --force', 'force unmount even if device is busy')
  .action(async (options: EjectOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const force = options.force ?? false;

    const resolved = resolveDeviceArg();
    if ('error' in resolved) {
      out.result<DeviceEjectOutput>({ success: false, error: resolved.error }, () =>
        out.error(resolved.error)
      );
      process.exitCode = 1;
      return;
    }

    const { resolvedDevice, cliPath } = resolved;

    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;

    try {
      const core = await import('@podkit/core');
      getDeviceManager = core.getDeviceManager;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      out.result<DeviceEjectOutput>({ success: false, error: message }, () => {
        out.error('Failed to load podkit-core.');
        out.verbose1(`Details: ${message}`);
      });
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();

    if (!manager.isSupported) {
      out.result<DeviceEjectOutput>(
        { success: false, error: `Eject is not supported on ${manager.platform}` },
        () => {
          out.error(`Eject is not supported on ${manager.platform}.`);
          out.newline();
          out.error(manager.getManualInstructions('eject'));
        }
      );
      process.exitCode = 1;
      return;
    }

    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (deviceIdentity?.volumeUuid) {
      out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
    }

    const resolveResult = await resolveDevicePath({
      cliDevice: cliPath,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
    });

    if (!resolveResult.path) {
      out.result<DeviceEjectOutput>(
        { success: false, error: resolveResult.error ?? formatDeviceError(resolveResult) },
        () => out.error(resolveResult.error ?? formatDeviceError(resolveResult))
      );
      process.exitCode = 1;
      return;
    }

    const devicePath = resolveResult.path;

    if (!existsSync(devicePath)) {
      out.result<DeviceEjectOutput>(
        { success: false, device: devicePath, error: `Device path not found: ${devicePath}` },
        () => {
          out.error(`iPod not found at: ${devicePath}`);
          out.newline();
          out.error('Make sure the iPod is connected and mounted.');
        }
      );
      process.exitCode = 1;
      return;
    }

    out.print(`Ejecting iPod at ${devicePath}...`);

    const result = await manager.eject(devicePath, { force });

    if (result.success) {
      out.result<DeviceEjectOutput>(
        { success: true, device: devicePath, forced: result.forced },
        () => out.success('iPod ejected successfully. Safe to disconnect.')
      );
    } else {
      out.result<DeviceEjectOutput>(
        { success: false, device: devicePath, forced: result.forced, error: result.error },
        () => {
          out.error('Failed to eject iPod.');
          out.newline();
          if (result.error) {
            out.error(result.error);
          }
          if (!force) {
            out.newline();
            out.error('Try: podkit device eject --force');
          }
        }
      );
      process.exitCode = 1;
    }
  });

// =============================================================================
// Mount subcommand
// =============================================================================

interface MountOptions {
  disk?: string;
  dryRun?: boolean;
}

const mountSubcommand = new Command('mount')
  .description('mount an iPod device')
  .option('--disk <identifier>', 'disk identifier (e.g., /dev/disk4s2)')
  .option('--dry-run', 'show mount command without executing')
  .action(async (options: MountOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const explicitDisk = options.disk;
    const dryRun = options.dryRun ?? false;

    const resolved = resolveDeviceArg();
    if ('error' in resolved && !explicitDisk) {
      out.result<DeviceMountOutput>({ success: false, error: resolved.error }, () =>
        out.error(resolved.error)
      );
      process.exitCode = 1;
      return;
    }

    const resolvedDevice = 'resolvedDevice' in resolved ? resolved.resolvedDevice : undefined;

    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;

    try {
      const core = await import('@podkit/core');
      getDeviceManager = core.getDeviceManager;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      out.result<DeviceMountOutput>({ success: false, error: message }, () => {
        out.error('Failed to load podkit-core.');
        out.verbose1(`Details: ${message}`);
      });
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();

    if (!manager.isSupported) {
      out.result<DeviceMountOutput>(
        { success: false, error: `Mount is not supported on ${manager.platform}` },
        () => {
          out.error(`Mount is not supported on ${manager.platform}.`);
          out.newline();
          out.error(manager.getManualInstructions('mount'));
        }
      );
      process.exitCode = 1;
      return;
    }

    let deviceId: string | undefined;
    let volumeName: string | undefined;

    if (explicitDisk) {
      deviceId = explicitDisk;
    } else {
      const volumeUuid = resolvedDevice?.config.volumeUuid;

      if (volumeUuid) {
        const deviceIdentity = getDeviceIdentity(resolvedDevice);
        out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));

        const device = await manager.findByVolumeUuid(volumeUuid);

        if (!device) {
          out.result<DeviceMountOutput>(
            { success: false, error: `iPod not found with UUID: ${volumeUuid}` },
            () => {
              out.error(`iPod not found with UUID: ${volumeUuid}`);
              out.newline();
              out.error('Make sure the iPod is connected.');
              out.newline();
              out.error('You can specify a device explicitly:');
              out.error('  podkit device mount --disk /dev/disk4s2');
            }
          );
          process.exitCode = 1;
          return;
        }

        if (device.isMounted && device.mountPoint) {
          out.result<DeviceMountOutput>(
            { success: true, device: device.identifier, mountPoint: device.mountPoint },
            () => out.print(`iPod already mounted at: ${device.mountPoint}`)
          );
          return;
        }

        deviceId = device.identifier;
        volumeName = device.volumeName;
      } else {
        out.result<DeviceMountOutput>(
          { success: false, error: 'No device specified and no iPod registered in config' },
          () => {
            out.error('No device specified and no iPod registered in config.');
            out.newline();
            out.error('Either specify a device:');
            out.error('  podkit device mount --disk /dev/disk4s2');
            out.newline();
            out.error('Or register an iPod first:');
            out.error('  podkit device add -d <name>');
          }
        );
        process.exitCode = 1;
        return;
      }
    }

    if (!dryRun) {
      const displayName = volumeName || deviceId;
      out.print(`Mounting iPod: ${displayName}...`);
    }

    const result = await manager.mount(deviceId, {
      target: volumeName ? `/tmp/podkit-${volumeName}` : undefined,
      dryRun,
    });

    if (dryRun) {
      out.result<DeviceMountOutput>(
        {
          success: true,
          device: deviceId,
          mountPoint: result.mountPoint,
          dryRunCommand: result.dryRunCommand,
        },
        () => {
          out.print('Dry run - command that would be executed:');
          out.print(`  ${result.dryRunCommand}`);
          if (result.mountPoint) {
            out.print(`  Mount point: ${result.mountPoint}`);
          }
        }
      );
      return;
    }

    if (result.requiresSudo) {
      const assessment = result.assessment;
      out.result<DeviceMountOutput>(
        {
          success: false,
          device: deviceId,
          error: 'Mount requires elevated privileges',
          requiresSudo: true,
          dryRunCommand: result.dryRunCommand,
          assessment,
        },
        () => {
          const displayName = assessment?.volumeName ?? deviceId;
          const diskId = assessment?.diskIdentifier ?? deviceId;
          out.error(`Mount failed for ${displayName} (${diskId})`);
          out.newline();

          if (assessment?.iFlash.confirmed) {
            out.error('iFlash storage detected:');
            for (const evidence of assessment.iFlash.evidence) {
              out.error(`  • ${evidence.signal}: ${evidence.value}`);
              out.error(`    ${evidence.detail}`);
            }
            out.newline();
            out.error('macOS refuses to automatically mount large FAT32 volumes created by');
            out.error('iFlash adapters. Elevated privileges are required to bypass this.');
          } else {
            out.error('This device requires elevated privileges to mount.');
          }

          out.newline();
          out.error('Run:');
          out.error(`  ${bold('sudo')} podkit device mount`);

          printTips(out, { mountRequiresSudo: true });
        }
      );
      process.exitCode = 1;
      return;
    }

    if (result.success) {
      out.result<DeviceMountOutput>(
        { success: true, device: deviceId, mountPoint: result.mountPoint },
        () => {
          out.print(`iPod mounted at: ${result.mountPoint}`);
          out.newline();
          out.print('You can now use:');
          out.print(`  podkit device info`);
          out.print(`  podkit sync`);
        }
      );
    } else {
      out.result<DeviceMountOutput>(
        { success: false, device: deviceId, error: result.error },
        () => {
          out.error('Failed to mount iPod.');
          out.newline();
          if (result.error) {
            out.error(result.error);
          }
        }
      );
      process.exitCode = 1;
    }
  });

// =============================================================================
// Init subcommand
// =============================================================================

interface InitOptions {
  force?: boolean;
  yes?: boolean;
}

const initSubcommand = new Command('init')
  .description('initialize iPod database on a device')
  .option('-f, --force', 'overwrite existing database')
  .option('-y, --yes', 'skip confirmation prompt')
  .action(async (options: InitOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const autoConfirm = options.yes ?? false;

    const resolved = resolveDeviceArg();
    if ('error' in resolved) {
      out.result<DeviceInitOutput>({ success: false, error: resolved.error }, () =>
        out.error(resolved.error)
      );
      process.exitCode = 1;
      return;
    }

    const { resolvedDevice, cliPath } = resolved;

    let IpodDatabase: typeof import('@podkit/core').IpodDatabase;
    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;

    try {
      const core = await import('@podkit/core');
      IpodDatabase = core.IpodDatabase;
      getDeviceManager = core.getDeviceManager;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      out.result<DeviceInitOutput>({ success: false, error: message }, () => {
        out.error('Failed to load podkit-core.');
        out.verbose1(`Details: ${message}`);
      });
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();
    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (deviceIdentity?.volumeUuid) {
      out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
    }

    const resolveResult = await resolveDevicePath({
      cliDevice: cliPath,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
    });

    if (!resolveResult.path) {
      out.result<DeviceInitOutput>(
        { success: false, error: resolveResult.error ?? formatDeviceError(resolveResult) },
        () => out.error(resolveResult.error ?? formatDeviceError(resolveResult))
      );
      process.exitCode = 1;
      return;
    }

    const devicePath = resolveResult.path;

    if (!existsSync(devicePath)) {
      out.result<DeviceInitOutput>(
        { success: false, error: `Device path not found: ${devicePath}` },
        () => {
          out.error(`iPod not found at: ${devicePath}`);
          out.newline();
          out.error('Make sure the iPod is connected and mounted.');
        }
      );
      process.exitCode = 1;
      return;
    }

    // Check if database already exists
    const hasDb = await IpodDatabase.hasDatabase(devicePath);

    if (hasDb && !options.force) {
      out.result<DeviceInitOutput>(
        { success: false, error: 'Database already exists. Use --force to overwrite.' },
        () => {
          out.error('iPod already has a database. Use --force to reinitialize.');
          out.newline();
          out.error('Warning: This will delete all tracks and playlists!');
        }
      );
      process.exitCode = 1;
      return;
    }

    if (hasDb && options.force && !autoConfirm && out.isText) {
      out.newline();
      out.print('WARNING: This will delete all existing tracks and playlists!');
      out.newline();
      const confirmed = await confirmNo('Reinitialize the iPod database?');
      if (!confirmed) {
        out.print('Cancelled. No changes made.');
        return;
      }
    }

    out.print('Initializing iPod database...');

    try {
      const ipod = await IpodDatabase.initializeIpod(devicePath);
      const modelName = ipod.device.modelName;
      ipod.close();

      out.result<DeviceInitOutput>(
        { success: true, device: resolvedDevice?.name, mountPoint: devicePath, modelName },
        () => {
          out.newline();
          out.print(`iPod database initialized successfully.`);
          out.print(`  Model: ${modelName}`);
          out.print(`  Path:  ${devicePath}`);
          out.newline();
          out.print('You can now use:');
          out.print('  podkit sync    # Sync content to this device');
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.result<DeviceInitOutput>(
        { success: false, device: resolvedDevice?.name, mountPoint: devicePath, error: message },
        () => out.error(`Failed to initialize iPod database: ${message}`)
      );
      process.exitCode = 1;
    }
  });

// =============================================================================
// Set subcommand
// =============================================================================

interface SetOptions {
  quality?: string;
  audioQuality?: string;
  videoQuality?: string;
  encoding?: string;
  artwork?: boolean;
  clearQuality?: boolean;
  clearAudioQuality?: boolean;
  clearVideoQuality?: boolean;
  clearEncoding?: boolean;
  clearArtwork?: boolean;
}

const setSubcommand = new Command('set')
  .description('update device settings (quality, artwork)')
  .option(
    '--quality <preset>',
    'transcoding quality preset: max, high, medium, low'
  )
  .option(
    '--audio-quality <preset>',
    'audio quality (overrides --quality): max, high, medium, low'
  )
  .option('--video-quality <preset>', 'video quality (overrides --quality): max, high, medium, low')
  .option('--encoding <mode>', 'encoding mode: vbr, cbr')
  .option('--artwork', 'sync artwork to this device')
  .option('--no-artwork', 'do not sync artwork to this device')
  .option('--clear-quality', 'remove quality setting (use global default)')
  .option('--clear-audio-quality', 'remove audio quality setting (use global default)')
  .option('--clear-video-quality', 'remove video quality setting (use global default)')
  .option('--clear-encoding', 'remove encoding setting (use global default)')
  .option('--clear-artwork', 'remove artwork setting (use global default)')
  .action(async (options: SetOptions) => {
    const { config, globalOpts, configResult } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    const name = globalOpts.device;

    if (!name) {
      const error =
        'Missing required --device flag. Usage: podkit device set -d <name> --quality <preset>';
      out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    const devices = config.devices || {};
    if (!(name in devices)) {
      const error = `Device "${name}" not found in config.`;
      out.result<DeviceSetOutput>({ success: false, error }, () => {
        out.error(error);
        const available = Object.keys(devices);
        if (available.length > 0) {
          out.error(`Available devices: ${available.join(', ')}`);
        }
      });
      process.exitCode = 1;
      return;
    }

    // Validate quality options
    if (options.quality !== undefined && !QUALITY_PRESETS.includes(options.quality as any)) {
      const error = `Invalid quality preset "${options.quality}". Valid values: ${QUALITY_PRESETS.join(', ')}`;
      out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }
    if (
      options.audioQuality !== undefined &&
      !QUALITY_PRESETS.includes(options.audioQuality as any)
    ) {
      const error = `Invalid audio quality preset "${options.audioQuality}". Valid values: ${QUALITY_PRESETS.join(', ')}`;
      out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }
    if (
      options.videoQuality !== undefined &&
      !VIDEO_QUALITY_PRESETS.includes(options.videoQuality as any)
    ) {
      const error = `Invalid video quality preset "${options.videoQuality}". Valid values: ${VIDEO_QUALITY_PRESETS.join(', ')}`;
      out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }
    if (
      options.encoding !== undefined &&
      options.encoding !== 'vbr' &&
      options.encoding !== 'cbr'
    ) {
      const error = `Invalid encoding mode "${options.encoding}". Valid values: vbr, cbr`;
      out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    // Build updates object (null means remove the setting)
    const updates: Record<string, string | boolean | null> = {};

    if (options.clearQuality) {
      updates.quality = null;
    } else if (options.quality !== undefined) {
      updates.quality = options.quality;
    }

    if (options.clearAudioQuality) {
      updates.audioQuality = null;
    } else if (options.audioQuality !== undefined) {
      updates.audioQuality = options.audioQuality;
    }

    if (options.clearVideoQuality) {
      updates.videoQuality = null;
    } else if (options.videoQuality !== undefined) {
      updates.videoQuality = options.videoQuality;
    }

    if (options.clearEncoding) {
      updates.encoding = null;
    } else if (options.encoding !== undefined) {
      updates.encoding = options.encoding;
    }

    if (options.clearArtwork) {
      updates.artwork = null;
    } else if (options.artwork !== undefined) {
      updates.artwork = options.artwork;
    }

    if (Object.keys(updates).length === 0) {
      const error =
        'No settings to update. Specify at least one option (--quality, --audio-quality, --video-quality, --encoding, --artwork, or --clear-* variants).';
      out.result<DeviceSetOutput>({ success: false, error }, () => out.error(error));
      process.exitCode = 1;
      return;
    }

    const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
    const result = updateDevice(name, updates, { configPath });

    if (!result.success) {
      out.result<DeviceSetOutput>({ success: false, error: result.error }, () =>
        out.error(`Failed to update device: ${result.error}`)
      );
      process.exitCode = 1;
      return;
    }

    out.result<DeviceSetOutput>({ success: true, device: name, updated: updates }, () => {
      const changes: string[] = [];
      for (const [key, value] of Object.entries(updates)) {
        if (value === null) {
          changes.push(`  ${key}: cleared (will use global default)`);
        } else {
          changes.push(`  ${key}: ${value}`);
        }
      }
      out.print(`Updated device "${name}":`);
      for (const change of changes) {
        out.print(change);
      }
    });
  });

// =============================================================================
// Default subcommand
// =============================================================================

const defaultSubcommand = new Command('default')
  .description('set or clear the default device')
  .option('--clear', 'clear the default device')
  .action(async (options: { clear?: boolean }) => {
    const { config, globalOpts, configResult } = getContext();
    const name = globalOpts.device;
    const out = OutputContext.fromGlobalOpts(globalOpts);

    if (options.clear) {
      // Clear the default
      const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
      const result = setDefaultDevice('', { configPath });

      if (!result.success) {
        out.result<DeviceDefaultOutput>({ success: false, error: result.error }, () =>
          out.error(`Failed to clear default device: ${result.error}`)
        );
        process.exitCode = 1;
        return;
      }

      out.result<DeviceDefaultOutput>({ success: true, cleared: true }, () =>
        out.print('Cleared default device.')
      );
      return;
    }

    if (!name) {
      // Show current default
      const defaultDevice = config.defaults?.device;
      out.result<DeviceDefaultOutput>({ success: true, device: defaultDevice }, () => {
        if (defaultDevice) {
          out.print(`Default device: ${defaultDevice}`);
        } else {
          out.print('No default device set.');
        }
      });
      return;
    }

    // Set default
    const devices = config.devices || {};
    if (!(name in devices)) {
      const error = `Device "${name}" not found in config.`;
      out.result<DeviceDefaultOutput>({ success: false, error }, () => {
        out.error(error);
        const available = Object.keys(devices);
        if (available.length > 0) {
          out.error(`Available devices: ${available.join(', ')}`);
        }
      });
      process.exitCode = 1;
      return;
    }

    const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
    const result = setDefaultDevice(name, { configPath });

    if (!result.success) {
      out.result<DeviceDefaultOutput>({ success: false, error: result.error }, () =>
        out.error(`Failed to set default device: ${result.error}`)
      );
      process.exitCode = 1;
      return;
    }

    out.result<DeviceDefaultOutput>({ success: true, device: name }, () =>
      out.print(`Set "${name}" as the default device.`)
    );
  });

// =============================================================================
// Main device command
// =============================================================================

export const deviceCommand = new Command('device')
  .description('manage iPod devices')
  .addCommand(listSubcommand)
  .addCommand(addSubcommand)
  .addCommand(removeSubcommand)
  .addCommand(setSubcommand)
  .addCommand(defaultSubcommand)
  .addCommand(infoSubcommand)
  .addCommand(musicSubcommand)
  .addCommand(videoSubcommand)
  .addCommand(clearSubcommand)
  .addCommand(resetSubcommand)
  .addCommand(ejectSubcommand)
  .addCommand(mountSubcommand)
  .addCommand(initSubcommand)
  .action(async () => {
    // Default action: run list subcommand
    await listSubcommand.parseAsync([], { from: 'user' });
  });
