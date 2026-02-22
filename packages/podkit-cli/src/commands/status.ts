/* eslint-disable no-console */
/**
 * Status command - displays iPod device information
 *
 * This command connects to an iPod and displays:
 * - Device model and generation
 * - Mount point path
 * - Storage usage (used/total with percentage)
 * - Track count
 *
 * @example
 * ```bash
 * podkit status                      # Auto-detect device
 * podkit status --device /Volumes/IPOD   # Explicit device path
 * podkit status --json               # JSON output
 * ```
 */
import { existsSync, statfsSync } from 'node:fs';
import { Command } from 'commander';
import { getContext } from '../context.js';

/**
 * Format bytes as human-readable size with appropriate unit.
 *
 * @param bytes Number of bytes
 * @param decimals Number of decimal places (default 1)
 * @returns Formatted string like "45.2 GB"
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
 *
 * @param num Number to format
 * @returns Formatted string like "8,432"
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('en-US');
}

/**
 * Get generation display name from generation identifier.
 *
 * @param generation iPod generation identifier
 * @returns Human-readable generation name
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
 *
 * @param mountpoint Path to the mounted device
 * @returns Storage stats or null if unavailable
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
 * Status output structure for JSON format.
 */
export interface StatusOutput {
  connected: boolean;
  device?: {
    modelName: string;
    modelNumber: string | null;
    generation: string;
    capacity: number;
  };
  mount?: string;
  storage?: {
    used: number;
    total: number;
    free: number;
    percentUsed: number;
  };
  tracks?: number;
  playlists?: number;
  error?: string;
}

export const statusCommand = new Command('status')
  .description('show iPod device information and connection status')
  .action(async () => {
    const { config, globalOpts, configResult } = getContext();

    // Determine device path from CLI option or config
    const devicePath = config.device;

    // Helper to output JSON or handle errors
    const outputJson = (data: StatusOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    // No device specified
    if (!devicePath) {
      if (globalOpts.json) {
        outputJson({
          connected: false,
          error: 'No device specified',
        });
      } else {
        console.error('No iPod device specified.');
        console.error('');
        console.error('Specify a device using:');
        console.error('  --device /path/to/ipod');
        console.error('  or set "device" in config file');
        if (configResult.configPath) {
          console.error(`  Config: ${configResult.configPath}`);
        }
      }
      process.exitCode = 1;
      return;
    }

    // Device path doesn't exist
    if (!existsSync(devicePath)) {
      if (globalOpts.json) {
        outputJson({
          connected: false,
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

    // Try to open the iPod database
    // Dynamically import to handle native binding errors gracefully
    let Database: typeof import('@podkit/libgpod-node').Database;
    let LibgpodError: typeof import('@podkit/libgpod-node').LibgpodError;

    try {
      const libgpod = await import('@podkit/libgpod-node');
      Database = libgpod.Database;
      LibgpodError = libgpod.LibgpodError;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load libgpod bindings';
      if (globalOpts.json) {
        outputJson({
          connected: false,
          error: message,
        });
      } else {
        console.error('Failed to load libgpod bindings.');
        console.error('');
        console.error('Make sure libgpod-node is built:');
        console.error('  bun run build:native');
        if (globalOpts.verbose) {
          console.error('');
          console.error('Details:', message);
        }
      }
      process.exitCode = 1;
      return;
    }

    // Open the database
    let db;
    try {
      db = await Database.open(devicePath);
    } catch (err) {
      const isLibgpodError = err instanceof LibgpodError;
      const message = err instanceof Error ? err.message : String(err);

      if (globalOpts.json) {
        outputJson({
          connected: false,
          error: isLibgpodError
            ? `Not an iPod or database corrupted: ${message}`
            : message,
        });
      } else {
        console.error(`Cannot read iPod database at: ${devicePath}`);
        console.error('');
        if (isLibgpodError) {
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
      // Get database and device info
      const info = db.getInfo();
      const device = info.device;

      // Get storage info from filesystem
      const storage = getStorageInfo(devicePath);

      // Build output data
      const output: StatusOutput = {
        connected: true,
        device: {
          modelName: device.modelName,
          modelNumber: device.modelNumber,
          generation: device.generation,
          capacity: device.capacity,
        },
        mount: info.mountpoint,
        tracks: info.trackCount,
        playlists: info.playlistCount,
      };

      if (storage) {
        output.storage = {
          used: storage.used,
          total: storage.total,
          free: storage.free,
          percentUsed: Math.round((storage.used / storage.total) * 100),
        };
      }

      if (globalOpts.json) {
        outputJson(output);
      } else {
        // Human-readable output
        // Line 1: Model name with capacity and generation
        const capacityStr =
          device.capacity > 0 ? ` (${device.capacity}GB)` : '';
        const genStr = formatGeneration(device.generation);
        console.log(`${device.modelName}${capacityStr} - ${genStr}`);

        // Line 2: Mount point
        console.log(`Mount: ${info.mountpoint}`);

        // Line 3: Storage info (if available)
        if (storage) {
          const usedStr = formatBytes(storage.used);
          const totalStr = formatBytes(storage.total);
          const percent = Math.round((storage.used / storage.total) * 100);
          console.log(`Storage: ${usedStr} used / ${totalStr} total (${percent}%)`);
        }

        // Line 4: Track count
        console.log(`Tracks: ${formatNumber(info.trackCount)}`);
      }
    } finally {
      db.close();
    }
  });
