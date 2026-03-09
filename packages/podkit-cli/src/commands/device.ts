/**
 * Device command - manage iPod devices
 *
 * Provides subcommands for device management and content operations.
 *
 * @example
 * ```bash
 * podkit device                  # list configured devices
 * podkit device add <name>       # detect and add iPod
 * podkit device remove <name>    # remove from config
 * podkit device info [name]      # config + live status
 * podkit device music [name]     # list music on device
 * podkit device video [name]     # list video on device
 * podkit device clear [name]     # clear all content
 * podkit device reset [name]     # reset database
 * podkit device eject [name]     # eject device
 * podkit device mount [name]     # mount device
 * podkit device init [name]      # initialize iPod database
 * ```
 */
import { Command } from 'commander';
import { existsSync, statfsSync } from 'node:fs';
import * as readline from 'node:readline';
import { getContext } from '../context.js';
import {
  addDevice,
  removeDevice,
  setDefaultDevice,
  DEFAULT_CONFIG_PATH,
} from '../config/index.js';
import {
  resolveDevicePath,
  formatDeviceError,
  resolveDeviceFromConfig,
  getDeviceIdentity,
  formatDeviceNotFoundError,
} from '../device-resolver.js';
import type { DeviceConfig } from '../config/index.js';
import {
  type DisplayTrack,
  type FieldName,
  AVAILABLE_FIELDS,
  DEFAULT_FIELDS,
  parseFields,
  formatTable,
  formatJson,
  formatCsv,
} from './display-utils.js';

// =============================================================================
// Shared utilities
// =============================================================================

/**
 * Format bytes as human-readable size with appropriate unit.
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
 * Format a number with thousands separators.
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Get generation display name from generation identifier.
 */
export function formatGeneration(generation: string): string {
  const generationMap: Record<string, string> = {
    unknown: 'Unknown Generation',
    first: '1st Generation',
    second: '2nd Generation',
    third: '3rd Generation',
    fourth: '4th Generation',
    photo: 'Photo',
    mobile: 'Mobile',
    mini_1: 'Mini (1st Generation)',
    mini_2: 'Mini (2nd Generation)',
    shuffle_1: 'Shuffle (1st Generation)',
    shuffle_2: 'Shuffle (2nd Generation)',
    shuffle_3: 'Shuffle (3rd Generation)',
    shuffle_4: 'Shuffle (4th Generation)',
    nano_1: 'Nano (1st Generation)',
    nano_2: 'Nano (2nd Generation)',
    nano_3: 'Nano (3rd Generation)',
    nano_4: 'Nano (4th Generation)',
    nano_5: 'Nano (5th Generation)',
    nano_6: 'Nano (6th Generation)',
    video_1: 'Video (5th Generation)',
    video_2: 'Video (5.5th Generation)',
    classic_1: 'Classic (6th Generation)',
    classic_2: 'Classic (6.5th Generation)',
    classic_3: 'Classic (7th Generation)',
    touch_1: 'Touch (1st Generation)',
    touch_2: 'Touch (2nd Generation)',
    touch_3: 'Touch (3rd Generation)',
    touch_4: 'Touch (4th Generation)',
    iphone_1: 'iPhone (1st Generation)',
    iphone_2: 'iPhone 3G',
    iphone_3: 'iPhone 3GS',
    iphone_4: 'iPhone 4',
    ipad_1: 'iPad (1st Generation)',
  };

  return generationMap[generation] ?? generation;
}

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
 * Prompt user for yes/no confirmation (defaults to yes)
 */
async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === '' || normalized === 'y' || normalized === 'yes');
    });
  });
}

/**
 * Prompt user for no/yes confirmation (defaults to no)
 */
async function confirmNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === 'y' || normalized === 'yes');
    });
  });
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
      resolvedDevice: import('../device-resolver.js').ResolvedDevice;
      config: ReturnType<typeof getContext>['config'];
      globalOpts: ReturnType<typeof getContext>['globalOpts'];
    };

/**
 * Resolve device from positional argument or default
 */
function resolveDeviceArg(deviceName?: string): DeviceArgResult {
  const { config, globalOpts } = getContext();

  const resolvedDevice = deviceName
    ? resolveDeviceFromConfig(config, deviceName)
    : resolveDeviceFromConfig(config); // Try default device

  // Check if named device was requested but not found
  if (deviceName && !resolvedDevice) {
    return { error: formatDeviceNotFoundError(deviceName, config) };
  }

  // Check if no default is set
  if (!deviceName && !resolvedDevice) {
    const hasDevices = config.devices && Object.keys(config.devices).length > 0;
    if (hasDevices) {
      return {
        error:
          'No default device set. Specify a device name or set a default with: podkit device default <name>',
      };
    }
    return {
      error: "No devices configured. Run 'podkit device add <name>' to add one.",
    };
  }

  // At this point, resolvedDevice must be defined because we've checked all error cases
  return { resolvedDevice: resolvedDevice!, config, globalOpts };
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
  };
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
    storage?: {
      used: number;
      total: number;
      free: number;
      percentUsed: number;
    };
    musicCount?: number;
    videoCount?: number;
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
  tracksRemoved?: number;
  dryRun?: boolean;
  error?: string;
  fileDeleteErrors?: string[];
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
}

// =============================================================================
// Re-export display utilities for backward compatibility
// =============================================================================

// Re-export types and constants from display-utils for external consumers
export type { DisplayTrack, FieldName } from './display-utils.js';
export { AVAILABLE_FIELDS, DEFAULT_FIELDS } from './display-utils.js';

// =============================================================================
// Device-specific format helpers
// =============================================================================

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

    const outputJson = (data: DeviceListOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    const devices = config.devices || {};
    const defaultDevice = config.defaults?.device;
    const deviceNames = Object.keys(devices);

    if (deviceNames.length === 0) {
      if (globalOpts.json) {
        outputJson({
          success: true,
          devices: [],
          defaultDevice: undefined,
        });
      } else {
        console.log("No devices configured. Run 'podkit device add <name>' to add one.");
      }
      return;
    }

    if (globalOpts.json) {
      const deviceList = deviceNames.map((name) => {
        const device = devices[name]!;
        return {
          name,
          isDefault: name === defaultDevice,
          volumeUuid: device.volumeUuid,
          volumeName: device.volumeName,
          quality: device.quality,
          videoQuality: device.videoQuality,
          artwork: device.artwork,
        };
      });

      outputJson({
        success: true,
        devices: deviceList,
        defaultDevice,
      });
      return;
    }

    console.log('Configured devices:');
    console.log('');

    const headers = ['NAME', 'VOLUME', 'QUALITY', 'VIDEO', 'ARTWORK'];
    const widths = [
      Math.max(6, ...deviceNames.map((n) => n.length + 2)),
      Math.max(8, ...deviceNames.map((n) => (devices[n]?.volumeName || '').length)),
      8,
      6,
      7,
    ];

    console.log('  ' + formatRow(headers, widths));

    for (const name of deviceNames) {
      const device = devices[name]!;
      const isDefault = name === defaultDevice;
      const prefix = isDefault ? '* ' : '  ';

      const row = formatRow(
        [
          name,
          device.volumeName || '-',
          device.quality || '-',
          device.videoQuality || '-',
          device.artwork === true ? 'yes' : device.artwork === false ? 'no' : '-',
        ],
        widths
      );

      console.log(prefix + row);
    }

    console.log('');
    console.log('* = default device');
  });

// =============================================================================
// Add subcommand
// =============================================================================

const addSubcommand = new Command('add')
  .description('detect connected iPod and add to config')
  .argument('<name>', 'name for this device configuration')
  .action(async (name: string) => {
    const { globalOpts, configResult } = getContext();

    const outputJson = (data: DeviceAddOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
      const error =
        'Invalid device name. Must start with a letter and contain only letters, numbers, hyphens, and underscores.';
      if (globalOpts.json) {
        outputJson({ success: false, error });
      } else {
        console.error(error);
      }
      process.exitCode = 1;
      return;
    }

    const existingDevices = configResult.config.devices || {};
    if (name in existingDevices) {
      const error = `Device "${name}" already exists in config. Use a different name or remove it first.`;
      if (globalOpts.json) {
        outputJson({ success: false, error });
      } else {
        console.error(error);
      }
      process.exitCode = 1;
      return;
    }

    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;

    try {
      const core = await import('@podkit/core');
      getDeviceManager = core.getDeviceManager;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      if (globalOpts.json) {
        outputJson({ success: false, error: message });
      } else {
        console.error('Failed to load podkit-core.');
        if (globalOpts.verbose) {
          console.error('Details:', message);
        }
      }
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();

    if (!manager.isSupported) {
      const error = `Device scanning is not supported on ${manager.platform}.`;
      if (globalOpts.json) {
        outputJson({ success: false, error });
      } else {
        console.error(error);
        console.error('');
        console.error(manager.getManualInstructions('mount'));
      }
      process.exitCode = 1;
      return;
    }

    if (!globalOpts.quiet && !globalOpts.json) {
      console.log('Scanning for attached iPods...');
    }

    const ipods = await manager.findIpodDevices();

    if (ipods.length === 0) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          error: 'No iPod devices found',
        });
      } else {
        console.error('No iPod devices found.');
        console.error('');
        console.error('Make sure your iPod is connected and mounted.');
        console.error(
          'If using an iFlash adapter, the iPod may need to be mounted manually first.'
        );
      }
      process.exitCode = 1;
      return;
    }

    const ipod = ipods[0]!;

    const deviceInfo = {
      name,
      identifier: ipod.identifier,
      volumeName: ipod.volumeName,
      volumeUuid: ipod.volumeUuid,
      size: ipod.size,
      isMounted: ipod.isMounted,
      mountPoint: ipod.mountPoint,
    };

    const deviceCount = Object.keys(existingDevices).length;
    const isFirstDevice = deviceCount === 0;

    if (globalOpts.json) {
      const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
      const deviceConfig: DeviceConfig = {
        volumeUuid: ipod.volumeUuid,
        volumeName: ipod.volumeName,
      };

      const result = addDevice(name, deviceConfig, { configPath });

      if (result.success && isFirstDevice) {
        setDefaultDevice(name, { configPath });
      }

      outputJson({
        success: result.success,
        device: deviceInfo,
        saved: result.success,
        configPath: result.configPath,
        isDefault: isFirstDevice,
        error: result.error,
      });

      if (!result.success) {
        process.exitCode = 1;
      }
      return;
    }

    console.log('');
    console.log('Found attached iPod:');
    console.log(`  Name:        ${ipod.volumeName || '(unnamed)'}`);
    console.log(`  Size:        ${formatBytes(ipod.size)}`);
    console.log(`  Volume UUID: ${ipod.volumeUuid}`);
    console.log(`  Mounted:     ${ipod.isMounted ? 'Yes' : 'No'}`);
    if (ipod.mountPoint) {
      console.log(`  Mount point: ${ipod.mountPoint}`);
    }
    console.log(`  Device:      /dev/${ipod.identifier}`);
    console.log('');

    const shouldSave = await confirm(`Add this iPod as "${name}"? [Y/n] `);

    if (!shouldSave) {
      console.log('Cancelled. No changes made.');
      return;
    }

    const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
    const deviceConfig: DeviceConfig = {
      volumeUuid: ipod.volumeUuid,
      volumeName: ipod.volumeName,
    };

    const result = addDevice(name, deviceConfig, { configPath });

    if (!result.success) {
      console.error(`Failed to save config: ${result.error}`);
      process.exitCode = 1;
      return;
    }

    if (isFirstDevice) {
      setDefaultDevice(name, { configPath });
    }

    console.log('');
    if (result.created) {
      console.log(`Created config file: ${result.configPath}`);
    } else {
      console.log(`Updated config file: ${result.configPath}`);
    }
    console.log('');
    console.log(`Device "${name}" added to config.`);
    if (isFirstDevice) {
      console.log(`Set as default device.`);
    }
    console.log('');
    console.log('You can now use:');
    console.log(`  podkit sync -d ${name}     # Sync to this device`);
    console.log('  podkit device info ' + name + '  # View device details');
  });

// =============================================================================
// Remove subcommand
// =============================================================================

const removeSubcommand = new Command('remove')
  .description('remove a device from config')
  .argument('<name>', 'name of the device to remove')
  .option('--confirm', 'skip confirmation prompt')
  .action(async (name: string, options: { confirm?: boolean }) => {
    const { config, globalOpts, configResult } = getContext();

    const outputJson = (data: DeviceRemoveOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    const devices = config.devices || {};
    const defaultDevice = config.defaults?.device;

    if (!(name in devices)) {
      const error = `Device "${name}" not found in config.`;
      if (globalOpts.json) {
        outputJson({ success: false, error });
      } else {
        console.error(error);
        const available = Object.keys(devices);
        if (available.length > 0) {
          console.error(`Available devices: ${available.join(', ')}`);
        }
      }
      process.exitCode = 1;
      return;
    }

    const wasDefault = name === defaultDevice;

    if (!options.confirm && !globalOpts.json) {
      console.log(`This will remove device "${name}" from the config.`);
      if (wasDefault) {
        console.log('This device is currently set as the default.');
      }
      console.log('');

      const confirmed = await confirmNo(`Remove device "${name}"? [y/N] `);
      if (!confirmed) {
        console.log('Cancelled. No changes made.');
        return;
      }
    }

    const configPath = configResult.configPath ?? DEFAULT_CONFIG_PATH;
    const result = removeDevice(name, { configPath });

    if (!result.success) {
      if (globalOpts.json) {
        outputJson({ success: false, error: result.error });
      } else {
        console.error(`Failed to remove device: ${result.error}`);
      }
      process.exitCode = 1;
      return;
    }

    if (wasDefault) {
      setDefaultDevice('', { configPath });
    }

    if (globalOpts.json) {
      outputJson({
        success: true,
        device: name,
        wasDefault,
      });
    } else {
      console.log(`Device "${name}" removed from config.`);
      if (wasDefault) {
        console.log('Cleared default device setting.');
      }
    }
  });

// =============================================================================
// Info subcommand (replaces show, merges status)
// =============================================================================

const infoSubcommand = new Command('info')
  .description('display device configuration and live status')
  .argument('[name]', 'device name (uses default if omitted)')
  .action(async (name?: string) => {
    const { globalOpts } = getContext();

    const outputJson = (data: DeviceInfoOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    const resolved = resolveDeviceArg(name);
    if ('error' in resolved) {
      if (globalOpts.json) {
        outputJson({ success: false, error: resolved.error });
      } else {
        console.error(resolved.error);
      }
      process.exitCode = 1;
      return;
    }

    const { resolvedDevice, config } = resolved;
    const device = resolvedDevice!.config;
    const deviceName = resolvedDevice!.name;
    const defaultDevice = config.defaults?.device;
    const isDefault = deviceName === defaultDevice;

    // Try to get live status if device is connected
    let liveStatus: DeviceInfoOutput['status'] | undefined;

    try {
      const core = await import('@podkit/core');
      const manager = core.getDeviceManager();
      const deviceIdentity = getDeviceIdentity(resolvedDevice);

      if (deviceIdentity) {
        const resolveResult = await resolveDevicePath({
          cliDevice: globalOpts.device,
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

              // Count music and video tracks
              const tracks = ipod.getTracks();
              const musicCount = tracks.filter((t) =>
                core.isMusicMediaType(t.mediaType)
              ).length;
              const videoCount = tracks.filter((t) =>
                core.isVideoMediaType(t.mediaType)
              ).length;

              liveStatus = {
                mounted: true,
                mountPoint: resolveResult.path,
                model: {
                  name: info.device.modelName,
                  number: info.device.modelNumber,
                  generation: info.device.generation,
                  capacity: info.device.capacity,
                },
                musicCount,
                videoCount,
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
            // iPod database not readable - just show as mounted
            liveStatus = {
              mounted: true,
              mountPoint: resolveResult.path,
            };
          }
        } else if (resolveResult.deviceInfo) {
          // Device found but not mounted
          liveStatus = {
            mounted: false,
          };
        }
      }
    } catch {
      // podkit-core not available, skip live status
    }

    if (globalOpts.json) {
      outputJson({
        success: true,
        device: {
          name: deviceName,
          volumeUuid: device.volumeUuid,
          volumeName: device.volumeName,
          quality: device.quality,
          videoQuality: device.videoQuality,
          artwork: device.artwork,
          transforms: device.transforms as unknown as Record<string, unknown> | undefined,
          isDefault,
        },
        status: liveStatus,
      });
      return;
    }

    // Human-readable output
    console.log(`Device: ${deviceName}${isDefault ? ' (default)' : ''}`);
    console.log(`  Volume UUID:   ${device.volumeUuid}`);
    console.log(`  Volume Name:   ${device.volumeName}`);

    if (liveStatus) {
      if (liveStatus.mounted && liveStatus.mountPoint) {
        console.log(`  Status:        Mounted at ${liveStatus.mountPoint}`);
      } else if (liveStatus.mounted === false) {
        console.log(`  Status:        Not mounted`);
      }

      if (liveStatus.model) {
        const capacityStr =
          liveStatus.model.capacity > 0 ? ` (${liveStatus.model.capacity}GB)` : '';
        const genStr = formatGeneration(liveStatus.model.generation);
        console.log(`  Model:         ${liveStatus.model.name}${capacityStr} - ${genStr}`);
      }

      if (liveStatus.storage) {
        const usedStr = formatBytes(liveStatus.storage.used);
        const totalStr = formatBytes(liveStatus.storage.total);
        console.log(
          `  Storage:       ${usedStr} used / ${totalStr} total (${liveStatus.storage.percentUsed}%)`
        );
      }

      if (liveStatus.musicCount !== undefined) {
        console.log(`  Music:         ${formatNumber(liveStatus.musicCount)} tracks`);
      }
      if (liveStatus.videoCount !== undefined && liveStatus.videoCount > 0) {
        console.log(`  Video:         ${formatNumber(liveStatus.videoCount)} videos`);
      }
    }

    console.log(`  Quality:       ${device.quality || '(not set)'}`);
    if (device.videoQuality) {
      console.log(`  Video Quality: ${device.videoQuality}`);
    }
    console.log(
      `  Artwork:       ${device.artwork === true ? 'yes' : device.artwork === false ? 'no' : '(not set)'}`
    );

    if (device.transforms) {
      console.log('  Transforms:');
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
        console.log(`    ${transformName}: ${enabled ? 'enabled' : 'disabled'}${detailStr}`);
      }
    }
  });

// =============================================================================
// Music subcommand (from list.ts)
// =============================================================================

interface MusicVideoOptions {
  format?: string;
  fields?: string;
}

const musicSubcommand = new Command('music')
  .description('list music tracks on device')
  .argument('[name]', 'device name (uses default if omitted)')
  .option('--format <fmt>', 'output format: table, json, csv', 'table')
  .option('--fields <list>', 'fields to show (comma-separated)')
  .action(async (name: string | undefined, options: MusicVideoOptions) => {
    const { globalOpts } = getContext();
    const format = globalOpts.json ? 'json' : options.format;
    const fields = parseFields(options.fields);

    const outputError = (error: string) => {
      if (format === 'json') {
        console.log(JSON.stringify({ error: true, message: error }, null, 2));
      } else {
        console.error(`Error: ${error}`);
      }
      process.exitCode = 1;
    };

    const resolved = resolveDeviceArg(name);
    if ('error' in resolved) {
      outputError(resolved.error);
      return;
    }

    const { resolvedDevice } = resolved;

    try {
      const core = await import('@podkit/core');
      const manager = core.getDeviceManager();
      const deviceIdentity = getDeviceIdentity(resolvedDevice);

      if (!globalOpts.quiet && deviceIdentity?.volumeUuid && format !== 'json') {
        console.error('Looking for iPod...');
      }

      const resolveResult = await resolveDevicePath({
        cliDevice: globalOpts.device,
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
          format: parseFormat(t.filetype),
          bitrate: t.bitrate > 0 ? t.bitrate : undefined,
        }));

        let output: string;
        switch (format) {
          case 'json':
            output = formatJson(displayTracks, fields);
            break;
          case 'csv':
            output = formatCsv(displayTracks, fields);
            break;
          case 'table':
          default:
            output = formatTable(displayTracks, fields);
            break;
        }

        console.log(output);
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
  .description('list video content on device')
  .argument('[name]', 'device name (uses default if omitted)')
  .option('--format <fmt>', 'output format: table, json, csv', 'table')
  .option('--fields <list>', 'fields to show (comma-separated)')
  .action(async (name: string | undefined, options: MusicVideoOptions) => {
    const { globalOpts } = getContext();
    const format = globalOpts.json ? 'json' : options.format;
    const fields = parseFields(options.fields);

    const outputError = (error: string) => {
      if (format === 'json') {
        console.log(JSON.stringify({ error: true, message: error }, null, 2));
      } else {
        console.error(`Error: ${error}`);
      }
      process.exitCode = 1;
    };

    const resolved = resolveDeviceArg(name);
    if ('error' in resolved) {
      outputError(resolved.error);
      return;
    }

    const { resolvedDevice } = resolved;

    try {
      const core = await import('@podkit/core');
      const manager = core.getDeviceManager();
      const deviceIdentity = getDeviceIdentity(resolvedDevice);

      if (!globalOpts.quiet && deviceIdentity?.volumeUuid && format !== 'json') {
        console.error('Looking for iPod...');
      }

      const resolveResult = await resolveDevicePath({
        cliDevice: globalOpts.device,
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
          format: parseFormat(t.filetype),
          bitrate: t.bitrate > 0 ? t.bitrate : undefined,
        }));

        let output: string;
        switch (format) {
          case 'json':
            output = formatJson(displayTracks, fields);
            break;
          case 'csv':
            output = formatCsv(displayTracks, fields);
            break;
          case 'table':
          default:
            output = formatTable(displayTracks, fields);
            break;
        }

        console.log(output);
      } finally {
        ipod.close();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputError(message);
    }
  });

// =============================================================================
// Clear subcommand (from clear.ts)
// =============================================================================

interface ClearOptions {
  confirm?: boolean;
  dryRun?: boolean;
  type?: 'music' | 'video' | 'all';
}

const clearSubcommand = new Command('clear')
  .description('remove content from the iPod (all, music only, or video only)')
  .argument('[name]', 'device name (uses default if omitted)')
  .option('--confirm', 'skip confirmation prompt (for scripts)')
  .option('--dry-run', 'show what would be removed without removing')
  .option(
    '--type <type>',
    'content type to clear: "music", "video", or "all" (default: all)',
    'all'
  )
  .action(async (name: string | undefined, options: ClearOptions) => {
    const { globalOpts } = getContext();

    const outputJson = (data: DeviceClearOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    const resolved = resolveDeviceArg(name);
    if ('error' in resolved) {
      if (globalOpts.json) {
        outputJson({ success: false, error: resolved.error });
      } else {
        console.error(resolved.error);
      }
      process.exitCode = 1;
      return;
    }

    const { resolvedDevice } = resolved;

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
      if (globalOpts.json) {
        outputJson({ success: false, error: message });
      } else {
        console.error('Failed to load podkit-core.');
        if (globalOpts.verbose) {
          console.error('Details:', message);
        }
      }
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();
    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (!globalOpts.quiet && !globalOpts.json && deviceIdentity?.volumeUuid) {
      console.log('Looking for iPod...');
    }

    const resolveResult = await resolveDevicePath({
      cliDevice: globalOpts.device,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
    });

    if (!resolveResult.path) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          error: resolveResult.error ?? formatDeviceError(resolveResult),
        });
      } else {
        console.error(resolveResult.error ?? formatDeviceError(resolveResult));
      }
      process.exitCode = 1;
      return;
    }

    const devicePath = resolveResult.path;

    if (!existsSync(devicePath)) {
      if (globalOpts.json) {
        outputJson({ success: false, error: `Device path not found: ${devicePath}` });
      } else {
        console.error(`iPod not found at: ${devicePath}`);
        console.error('');
        console.error('Make sure the iPod is connected and mounted.');
      }
      process.exitCode = 1;
      return;
    }

    let ipod;
    try {
      ipod = await IpodDatabase.open(devicePath);
    } catch (err) {
      const isIpodError = err instanceof IpodError;
      const message = err instanceof Error ? err.message : String(err);

      if (globalOpts.json) {
        outputJson({
          success: false,
          error: isIpodError
            ? `Not an iPod or database corrupted: ${message}`
            : message,
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
      }
      process.exitCode = 1;
      return;
    }

    // Validate type option
    const contentType = options.type ?? 'all';
    if (!['music', 'video', 'all'].includes(contentType)) {
      const errorMsg = `Invalid type "${contentType}". Must be "music", "video", or "all".`;
      if (globalOpts.json) {
        outputJson({ success: false, error: errorMsg });
      } else {
        console.error(errorMsg);
      }
      process.exitCode = 1;
      ipod.close();
      return;
    }

    try {
      // Import helper functions for filtering tracks by media type
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

      // Label for output messages
      const contentLabel =
        contentType === 'all' ? 'content' : contentType === 'music' ? 'music tracks' : 'videos';

      if (targetCount === 0) {
        if (globalOpts.json) {
          outputJson({
            success: true,
            contentType,
            tracksRemoved: 0,
            totalTracks: 0,
            dryRun: options.dryRun,
          });
        } else {
          console.log(`iPod has no ${contentLabel} to remove.`);
        }
        return;
      }

      if (options.dryRun) {
        if (globalOpts.json) {
          outputJson({
            success: true,
            contentType,
            tracksRemoved: targetCount,
            totalTracks: targetCount,
            totalSize: targetSize,
            dryRun: true,
          });
        } else {
          console.log(
            `Found ${formatNumber(targetCount)} ${contentLabel} (${formatBytes(targetSize)})`
          );
          console.log('');
          console.log(`Dry run: would remove ${contentLabel} and files.`);
        }
        return;
      }

      if (!options.confirm) {
        if (!globalOpts.json) {
          console.log(
            `Found ${formatNumber(targetCount)} ${contentLabel} (${formatBytes(targetSize)})`
          );
          console.log('');
          if (contentType === 'all') {
            console.log('This will remove ALL content from the iPod. Files will be deleted.');
          } else {
            console.log(`This will remove all ${contentLabel} from the iPod. Files will be deleted.`);
          }
          console.log('This action cannot be undone.');
          console.log('');
        }

        const confirmPrompt =
          contentType === 'all' ? 'Delete all content?' : `Delete all ${contentLabel}?`;
        const confirmed = await confirmNo(confirmPrompt);
        if (!confirmed) {
          if (globalOpts.json) {
            outputJson({ success: false, error: 'Operation cancelled by user' });
          } else {
            console.log('Operation cancelled.');
          }
          process.exitCode = 1;
          return;
        }
      }

      if (!globalOpts.json && !globalOpts.quiet) {
        console.log(`Removing ${contentLabel}...`);
      }

      // Perform the removal based on content type
      let result;
      if (contentType === 'all') {
        result = ipod.removeAllTracks({ deleteFiles: true });
      } else {
        result = ipod.removeTracksByContentType(contentType, { deleteFiles: true });
      }
      await ipod.save();

      if (result.fileDeleteErrors.length > 0 && !globalOpts.quiet) {
        for (const error of result.fileDeleteErrors) {
          console.warn(`Warning: ${error}`);
        }
      }

      if (globalOpts.json) {
        outputJson({
          success: true,
          contentType,
          tracksRemoved: result.removedCount,
          totalTracks: targetCount,
          totalSize: targetSize,
          fileDeleteErrors:
            result.fileDeleteErrors.length > 0 ? result.fileDeleteErrors : undefined,
        });
      } else {
        console.log(
          `Removed ${formatNumber(result.removedCount)} ${contentLabel}, freed ${formatBytes(targetSize)}.`
        );
      }
    } finally {
      ipod.close();
    }
  });

// =============================================================================
// Reset subcommand (from reset.ts)
// =============================================================================

const resetSubcommand = new Command('reset')
  .description('remove all tracks from the iPod database')
  .argument('[name]', 'device name (uses default if omitted)')
  .option('--confirm', 'skip confirmation prompt (for scripts)')
  .option('--dry-run', 'show what would be removed without removing')
  .action(async (name: string | undefined, options: ClearOptions) => {
    const { globalOpts } = getContext();

    const outputJson = (data: DeviceResetOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    const resolved = resolveDeviceArg(name);
    if ('error' in resolved) {
      if (globalOpts.json) {
        outputJson({ success: false, error: resolved.error });
      } else {
        console.error(resolved.error);
      }
      process.exitCode = 1;
      return;
    }

    const { resolvedDevice } = resolved;

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
      if (globalOpts.json) {
        outputJson({ success: false, error: message });
      } else {
        console.error('Failed to load podkit-core.');
        if (globalOpts.verbose) {
          console.error('Details:', message);
        }
      }
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();
    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (!globalOpts.quiet && !globalOpts.json && deviceIdentity?.volumeUuid) {
      console.log('Looking for iPod...');
    }

    const resolveResult = await resolveDevicePath({
      cliDevice: globalOpts.device,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
    });

    if (!resolveResult.path) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          error: resolveResult.error ?? formatDeviceError(resolveResult),
        });
      } else {
        console.error(resolveResult.error ?? formatDeviceError(resolveResult));
      }
      process.exitCode = 1;
      return;
    }

    const devicePath = resolveResult.path;

    if (!existsSync(devicePath)) {
      if (globalOpts.json) {
        outputJson({ success: false, error: `Device path not found: ${devicePath}` });
      } else {
        console.error(`iPod not found at: ${devicePath}`);
        console.error('');
        console.error('Make sure the iPod is connected and mounted.');
      }
      process.exitCode = 1;
      return;
    }

    let ipod;
    try {
      ipod = await IpodDatabase.open(devicePath);
    } catch (err) {
      const isIpodError = err instanceof IpodError;
      const message = err instanceof Error ? err.message : String(err);

      if (globalOpts.json) {
        outputJson({
          success: false,
          error: isIpodError
            ? `Not an iPod or database corrupted: ${message}`
            : message,
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
      }
      process.exitCode = 1;
      return;
    }

    try {
      const trackCount = ipod.trackCount;

      if (trackCount === 0) {
        if (globalOpts.json) {
          outputJson({
            success: true,
            tracksRemoved: 0,
            dryRun: options.dryRun,
          });
        } else {
          console.log('iPod has no tracks to remove.');
        }
        return;
      }

      if (options.dryRun) {
        if (globalOpts.json) {
          outputJson({
            success: true,
            tracksRemoved: trackCount,
            dryRun: true,
          });
        } else {
          console.log(
            `iPod has ${formatNumber(trackCount)} track${trackCount === 1 ? '' : 's'}.`
          );
          console.log('');
          console.log('Dry run: would remove all tracks and audio files.');
        }
        return;
      }

      if (!options.confirm) {
        if (!globalOpts.json) {
          console.log(
            `iPod has ${formatNumber(trackCount)} track${trackCount === 1 ? '' : 's'}.`
          );
          console.log('');
          console.log(
            'This will remove ALL tracks from the iPod. Audio files will be deleted.'
          );
          console.log('This action cannot be undone.');
          console.log('');
        }

        const confirmed = await confirmNo('Continue?');
        if (!confirmed) {
          if (globalOpts.json) {
            outputJson({ success: false, error: 'Operation cancelled by user' });
          } else {
            console.log('Operation cancelled.');
          }
          process.exitCode = 1;
          return;
        }
      }

      if (!globalOpts.json && !globalOpts.quiet) {
        console.log('Removing tracks...');
      }

      const result = ipod.removeAllTracks({ deleteFiles: true });
      await ipod.save();

      if (result.fileDeleteErrors.length > 0 && !globalOpts.quiet) {
        for (const error of result.fileDeleteErrors) {
          console.warn(`Warning: ${error}`);
        }
      }

      if (globalOpts.json) {
        outputJson({
          success: true,
          tracksRemoved: result.removedCount,
          fileDeleteErrors:
            result.fileDeleteErrors.length > 0 ? result.fileDeleteErrors : undefined,
        });
      } else {
        console.log(
          `Removed ${formatNumber(result.removedCount)} track${result.removedCount === 1 ? '' : 's'}.`
        );
      }
    } finally {
      ipod.close();
    }
  });

// =============================================================================
// Eject subcommand (from eject.ts)
// =============================================================================

interface EjectOptions {
  force?: boolean;
}

const ejectSubcommand = new Command('eject')
  .description('safely unmount an iPod device')
  .argument('[name]', 'device name (uses default if omitted)')
  .option('-f, --force', 'force unmount even if device is busy')
  .action(async (name: string | undefined, options: EjectOptions) => {
    const { globalOpts } = getContext();
    const force = options.force ?? false;

    const outputJson = (data: DeviceEjectOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    const resolved = resolveDeviceArg(name);
    if ('error' in resolved) {
      if (globalOpts.json) {
        outputJson({ success: false, error: resolved.error });
      } else {
        console.error(resolved.error);
      }
      process.exitCode = 1;
      return;
    }

    const { resolvedDevice } = resolved;

    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;

    try {
      const core = await import('@podkit/core');
      getDeviceManager = core.getDeviceManager;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      if (globalOpts.json) {
        outputJson({ success: false, error: message });
      } else {
        console.error('Failed to load podkit-core.');
        if (globalOpts.verbose) {
          console.error('Details:', message);
        }
      }
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();

    if (!manager.isSupported) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          error: `Eject is not supported on ${manager.platform}`,
        });
      } else {
        console.error(`Eject is not supported on ${manager.platform}.`);
        console.error('');
        console.error(manager.getManualInstructions('eject'));
      }
      process.exitCode = 1;
      return;
    }

    const deviceIdentity = getDeviceIdentity(resolvedDevice);

    if (!globalOpts.quiet && !globalOpts.json && deviceIdentity?.volumeUuid) {
      console.log(`Looking for iPod...`);
    }

    const resolveResult = await resolveDevicePath({
      cliDevice: globalOpts.device,
      deviceIdentity,
      manager,
      requireMounted: true,
      quiet: globalOpts.quiet,
    });

    if (!resolveResult.path) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          error: resolveResult.error ?? formatDeviceError(resolveResult),
        });
      } else {
        console.error(resolveResult.error ?? formatDeviceError(resolveResult));
      }
      process.exitCode = 1;
      return;
    }

    const devicePath = resolveResult.path;

    if (!existsSync(devicePath)) {
      if (globalOpts.json) {
        outputJson({
          success: false,
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

    if (!globalOpts.quiet && !globalOpts.json) {
      console.log(`Ejecting iPod at ${devicePath}...`);
    }

    const result = await manager.eject(devicePath, { force });

    if (result.success) {
      if (globalOpts.json) {
        outputJson({
          success: true,
          device: devicePath,
          forced: result.forced,
        });
      } else if (!globalOpts.quiet) {
        console.log('iPod ejected successfully. Safe to disconnect.');
      }
    } else {
      if (globalOpts.json) {
        outputJson({
          success: false,
          device: devicePath,
          forced: result.forced,
          error: result.error,
        });
      } else {
        console.error('Failed to eject iPod.');
        console.error('');
        if (result.error) {
          console.error(result.error);
        }
        if (!force) {
          console.error('');
          console.error('Try: podkit device eject --force');
        }
      }
      process.exitCode = 1;
    }
  });

// =============================================================================
// Mount subcommand (from mount.ts)
// =============================================================================

interface MountOptions {
  device?: string;
  dryRun?: boolean;
}

const mountSubcommand = new Command('mount')
  .description('mount an iPod device')
  .argument('[name]', 'device name (uses default if omitted)')
  .option('--device <identifier>', 'device identifier (e.g., /dev/disk4s2)')
  .option('--dry-run', 'show mount command without executing')
  .action(async (name: string | undefined, options: MountOptions) => {
    const { globalOpts } = getContext();
    const explicitDevice = options.device;
    const dryRun = options.dryRun ?? false;

    const outputJson = (data: DeviceMountOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    const resolved = resolveDeviceArg(name);
    if ('error' in resolved && !explicitDevice) {
      if (globalOpts.json) {
        outputJson({ success: false, error: resolved.error });
      } else {
        console.error(resolved.error);
      }
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
      if (globalOpts.json) {
        outputJson({ success: false, error: message });
      } else {
        console.error('Failed to load podkit-core.');
        if (globalOpts.verbose) {
          console.error('Details:', message);
        }
      }
      process.exitCode = 1;
      return;
    }

    const manager = getDeviceManager();

    if (!manager.isSupported) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          error: `Mount is not supported on ${manager.platform}`,
        });
      } else {
        console.error(`Mount is not supported on ${manager.platform}.`);
        console.error('');
        console.error(manager.getManualInstructions('mount'));
      }
      process.exitCode = 1;
      return;
    }

    let deviceId: string | undefined;
    let volumeName: string | undefined;

    if (explicitDevice) {
      deviceId = explicitDevice;
    } else {
      const volumeUuid = resolvedDevice?.config.volumeUuid;

      if (volumeUuid) {
        if (!globalOpts.quiet && !globalOpts.json) {
          console.log(`Looking for iPod with UUID: ${volumeUuid}...`);
        }

        const device = await manager.findByVolumeUuid(volumeUuid);

        if (!device) {
          if (globalOpts.json) {
            outputJson({
              success: false,
              error: `iPod not found with UUID: ${volumeUuid}`,
            });
          } else {
            console.error(`iPod not found with UUID: ${volumeUuid}`);
            console.error('');
            console.error('Make sure the iPod is connected.');
            console.error('');
            console.error('You can specify a device explicitly:');
            console.error('  podkit device mount --device /dev/disk4s2');
          }
          process.exitCode = 1;
          return;
        }

        if (device.isMounted && device.mountPoint) {
          if (globalOpts.json) {
            outputJson({
              success: true,
              device: device.identifier,
              mountPoint: device.mountPoint,
            });
          } else if (!globalOpts.quiet) {
            console.log(`iPod already mounted at: ${device.mountPoint}`);
          }
          return;
        }

        deviceId = device.identifier;
        volumeName = device.volumeName;
      } else {
        if (globalOpts.json) {
          outputJson({
            success: false,
            error: 'No device specified and no iPod registered in config',
          });
        } else {
          console.error('No device specified and no iPod registered in config.');
          console.error('');
          console.error('Either specify a device:');
          console.error('  podkit device mount --device /dev/disk4s2');
          console.error('');
          console.error('Or register an iPod first:');
          console.error('  podkit device add <name>');
        }
        process.exitCode = 1;
        return;
      }
    }

    if (!globalOpts.quiet && !globalOpts.json && !dryRun) {
      const displayName = volumeName || deviceId;
      console.log(`Mounting iPod: ${displayName}...`);
    }

    const result = await manager.mount(deviceId, {
      target: volumeName ? `/tmp/podkit-${volumeName}` : undefined,
      dryRun,
    });

    if (dryRun) {
      if (globalOpts.json) {
        outputJson({
          success: true,
          device: deviceId,
          mountPoint: result.mountPoint,
          dryRunCommand: result.dryRunCommand,
        });
      } else {
        console.log('Dry run - command that would be executed:');
        console.log(`  ${result.dryRunCommand}`);
        if (result.mountPoint) {
          console.log(`  Mount point: ${result.mountPoint}`);
        }
      }
      return;
    }

    if (result.requiresSudo) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          device: deviceId,
          error: 'Mount requires elevated privileges',
          requiresSudo: true,
          dryRunCommand: result.dryRunCommand,
        });
      } else {
        console.error('Mount requires elevated privileges.');
        console.error('');
        console.error('Run:');
        console.error(`  ${result.dryRunCommand}`);
      }
      process.exitCode = 1;
      return;
    }

    if (result.success) {
      if (globalOpts.json) {
        outputJson({
          success: true,
          device: deviceId,
          mountPoint: result.mountPoint,
        });
      } else if (!globalOpts.quiet) {
        console.log(`iPod mounted at: ${result.mountPoint}`);
        console.log('');
        console.log('You can now use:');
        console.log(`  podkit device info`);
        console.log(`  podkit sync`);
      }
    } else {
      if (globalOpts.json) {
        outputJson({
          success: false,
          device: deviceId,
          error: result.error,
        });
      } else {
        console.error('Failed to mount iPod.');
        console.error('');
        if (result.error) {
          console.error(result.error);
        }
      }
      process.exitCode = 1;
    }
  });

// =============================================================================
// Init subcommand (initialize iPod database)
// =============================================================================

export interface DeviceInitOutput {
  success: boolean;
  device?: string;
  mountPoint?: string;
  error?: string;
}

interface InitOptions {
  force?: boolean;
}

const initSubcommand = new Command('init')
  .description('initialize iPod database on a device')
  .argument('[name]', 'device name (uses default if omitted)')
  .option('-f, --force', 'overwrite existing database')
  .action(async (_name: string | undefined, _options: InitOptions) => {
    const { globalOpts } = getContext();

    const outputJson = (data: DeviceInitOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    // TODO: Implement iPod database initialization
    // This requires either:
    // 1. Using gpod-tool CLI to initialize the iPod
    // 2. Adding a create() method to IpodDatabase in podkit-core
    // For now, output a not-implemented message

    const error =
      'Device initialization is not yet implemented. ' +
      'Please use iTunes or a compatible tool to initialize the iPod database.';

    if (globalOpts.json) {
      outputJson({ success: false, error });
    } else {
      console.error(error);
    }
    process.exitCode = 1;
  });

// =============================================================================
// Main device command
// =============================================================================

export const deviceCommand = new Command('device')
  .description('manage iPod devices')
  .addCommand(listSubcommand)
  .addCommand(addSubcommand)
  .addCommand(removeSubcommand)
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
