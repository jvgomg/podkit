/**
 * Clear command - removes all content of a specific type from the iPod
 *
 * This command removes either all music or all video content from an iPod,
 * allowing users to clear one category without affecting the other.
 *
 * @example
 * ```bash
 * podkit clear music                 # Prompts for confirmation
 * podkit clear video                 # Prompts for confirmation
 * podkit clear music -d terapod      # Use named device from config
 * podkit clear music --confirm       # Skip confirmation (for scripts)
 * podkit clear video --dry-run       # Show what would be removed
 * ```
 */
import { existsSync } from 'node:fs';
import * as readline from 'node:readline';
import { Command } from 'commander';
import { getContext } from '../context.js';
import { formatNumber, formatBytes } from './status.js';
import {
  resolveDevicePath,
  formatDeviceError,
  resolveDeviceFromConfig,
  getDeviceIdentity,
  formatDeviceNotFoundError,
} from '../device-resolver.js';

/**
 * Prompt the user for confirmation.
 *
 * @param message The message to display
 * @returns Promise that resolves to true if user confirms
 */
function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Clear output structure for JSON format.
 */
export interface ClearOutput {
  success: boolean;
  contentType?: 'music' | 'video';
  tracksRemoved?: number;
  totalTracks?: number;
  totalSize?: number;
  dryRun?: boolean;
  error?: string;
  /** Errors from file deletions that failed (non-fatal warnings) */
  fileDeleteErrors?: string[];
}

interface ClearOptions {
  confirm?: boolean;
  dryRun?: boolean;
  deviceName?: string;
}

export const clearCommand = new Command('clear')
  .description('remove all content of a specific type from the iPod')
  .argument('<type>', 'content type to clear: "music" or "video"')
  .option('-d, --device-name <name>', 'device name from config')
  .option('--confirm', 'skip confirmation prompt (for scripts)')
  .option('--dry-run', 'show what would be removed without removing')
  .action(async (type: string, options: ClearOptions) => {
    const { config, globalOpts } = getContext();

    // Validate content type
    if (type !== 'music' && type !== 'video') {
      if (globalOpts.json) {
        console.log(
          JSON.stringify({
            success: false,
            error: `Invalid content type: "${type}". Use "music" or "video".`,
          })
        );
      } else {
        console.error(`Invalid content type: "${type}"`);
        console.error('');
        console.error('Usage: podkit clear <music|video>');
      }
      process.exitCode = 1;
      return;
    }

    const contentType = type as 'music' | 'video';

    // Helper to output JSON or handle errors
    const outputJson = (data: ClearOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    // Try to load dependencies
    let IpodDatabase: typeof import('@podkit/core').IpodDatabase;
    let IpodError: typeof import('@podkit/core').IpodError;
    let isVideoMediaType: typeof import('@podkit/core').isVideoMediaType;
    let isMusicMediaType: typeof import('@podkit/core').isMusicMediaType;
    let getDeviceManager: typeof import('@podkit/core').getDeviceManager;

    try {
      const core = await import('@podkit/core');
      IpodDatabase = core.IpodDatabase;
      IpodError = core.IpodError;
      isVideoMediaType = core.isVideoMediaType;
      isMusicMediaType = core.isMusicMediaType;
      getDeviceManager = core.getDeviceManager;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to load podkit-core';
      if (globalOpts.json) {
        outputJson({
          success: false,
          error: message,
        });
      } else {
        console.error('Failed to load podkit-core.');
        console.error('');
        console.error('Make sure podkit-core is built:');
        console.error('  bun run build');
        if (globalOpts.verbose) {
          console.error('');
          console.error('Details:', message);
        }
      }
      process.exitCode = 1;
      return;
    }

    // Resolve named device (if -d flag used)
    const resolvedDevice = options.deviceName
      ? resolveDeviceFromConfig(config, options.deviceName)
      : resolveDeviceFromConfig(config); // Try default device

    // Check if named device was requested but not found
    if (options.deviceName && !resolvedDevice) {
      const errorMsg = formatDeviceNotFoundError(options.deviceName, config);
      if (globalOpts.json) {
        outputJson({
          success: false,
          error: errorMsg,
        });
      } else {
        console.error(errorMsg);
      }
      process.exitCode = 1;
      return;
    }

    // Resolve device path (CLI > named device UUID)
    const manager = getDeviceManager();
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

    // Open the database
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
      // Get all tracks and filter by content type
      const allTracks = ipod.getTracks();
      const matchFn = contentType === 'video' ? isVideoMediaType : isMusicMediaType;
      const matchingTracks = allTracks.filter((track) => matchFn(track.mediaType));
      const trackCount = matchingTracks.length;
      const totalSize = matchingTracks.reduce((sum, track) => sum + track.size, 0);

      const contentLabel = contentType === 'video' ? 'video' : 'music';
      const trackWord = trackCount === 1 ? 'track' : 'tracks';

      // Handle empty result
      if (trackCount === 0) {
        if (globalOpts.json) {
          outputJson({
            success: true,
            contentType,
            tracksRemoved: 0,
            totalTracks: 0,
            dryRun: options.dryRun,
          });
        } else {
          console.log(`iPod has no ${contentLabel} tracks to remove.`);
        }
        return;
      }

      // Dry-run mode
      if (options.dryRun) {
        if (globalOpts.json) {
          outputJson({
            success: true,
            contentType,
            tracksRemoved: trackCount,
            totalTracks: trackCount,
            totalSize,
            dryRun: true,
          });
        } else {
          console.log(`Found ${formatNumber(trackCount)} ${contentLabel} ${trackWord} (${formatBytes(totalSize)})`);
          console.log('');
          console.log(`Dry run: would remove all ${contentLabel} and their files.`);
        }
        return;
      }

      // Confirmation required (unless --confirm flag)
      if (!options.confirm) {
        if (!globalOpts.json) {
          console.log(`Found ${formatNumber(trackCount)} ${contentLabel} ${trackWord} (${formatBytes(totalSize)})`);
          console.log('');
          console.log(`This will remove all ${contentLabel} from the iPod. Files will be deleted.`);
          console.log('This action cannot be undone.');
          console.log('');
        }

        const confirmed = await confirm(`Delete all ${contentLabel}?`);
        if (!confirmed) {
          if (globalOpts.json) {
            outputJson({
              success: false,
              error: 'Operation cancelled by user',
            });
          } else {
            console.log('Operation cancelled.');
          }
          process.exitCode = 1;
          return;
        }
      }

      // Remove tracks by content type
      if (!globalOpts.json && !globalOpts.quiet) {
        console.log(`Removing ${contentLabel}...`);
      }

      const result = ipod.removeTracksByContentType(contentType, { deleteFiles: true });
      await ipod.save();

      // Report any file deletion errors
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
          totalTracks: result.totalCount,
          totalSize,
          fileDeleteErrors: result.fileDeleteErrors.length > 0 ? result.fileDeleteErrors : undefined,
        });
      } else {
        console.log(`Removed ${formatNumber(result.removedCount)} ${contentLabel} ${trackWord}, freed ${formatBytes(totalSize)}.`);
      }
    } finally {
      ipod.close();
    }
  });
