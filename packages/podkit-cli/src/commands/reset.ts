/* eslint-disable no-console */
/**
 * Reset command - removes all tracks from the iPod
 *
 * This command connects to an iPod and removes all tracks, allowing users
 * to start fresh before syncing their full library.
 *
 * @example
 * ```bash
 * podkit reset                      # Prompts for confirmation
 * podkit reset --confirm            # Skip confirmation (for scripts)
 * podkit reset --dry-run            # Show what would be removed
 * ```
 */
import { existsSync } from 'node:fs';
import * as readline from 'node:readline';
import { Command } from 'commander';
import { getContext } from '../context.js';
import { formatNumber } from './status.js';

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
 * Reset output structure for JSON format.
 */
export interface ResetOutput {
  success: boolean;
  tracksRemoved?: number;
  dryRun?: boolean;
  error?: string;
}

export const resetCommand = new Command('reset')
  .description('remove all tracks from the iPod')
  .option('--confirm', 'skip confirmation prompt (for scripts)')
  .option('--dry-run', 'show what would be removed without removing')
  .action(async (options: { confirm?: boolean; dryRun?: boolean }) => {
    const { config, globalOpts, configResult } = getContext();

    // Determine device path from CLI option or config
    const devicePath = config.device;

    // Helper to output JSON or handle errors
    const outputJson = (data: ResetOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    // No device specified
    if (!devicePath) {
      if (globalOpts.json) {
        outputJson({
          success: false,
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

    // Try to open the iPod database
    let IpodDatabase: typeof import('@podkit/core').IpodDatabase;
    let IpodError: typeof import('@podkit/core').IpodError;

    try {
      const core = await import('@podkit/core');
      IpodDatabase = core.IpodDatabase;
      IpodError = core.IpodError;
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
      const trackCount = ipod.trackCount;

      // Handle empty iPod
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

      // Dry-run mode
      if (options.dryRun) {
        if (globalOpts.json) {
          outputJson({
            success: true,
            tracksRemoved: trackCount,
            dryRun: true,
          });
        } else {
          console.log(`iPod has ${formatNumber(trackCount)} track${trackCount === 1 ? '' : 's'}.`);
          console.log('');
          console.log('Dry run: would remove all tracks and audio files.');
        }
        return;
      }

      // Confirmation required (unless --confirm flag)
      if (!options.confirm) {
        if (!globalOpts.json) {
          console.log(`iPod has ${formatNumber(trackCount)} track${trackCount === 1 ? '' : 's'}.`);
          console.log('');
          console.log('This will remove ALL tracks from the iPod. Audio files will be deleted.');
          console.log('This action cannot be undone.');
          console.log('');
        }

        const confirmed = await confirm('Continue?');
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

      // Remove all tracks
      if (!globalOpts.json && !globalOpts.quiet) {
        console.log('Removing tracks...');
      }

      const removedCount = ipod.removeAllTracks({ deleteFiles: true });
      await ipod.save();

      if (globalOpts.json) {
        outputJson({
          success: true,
          tracksRemoved: removedCount,
        });
      } else {
        console.log(`Removed ${formatNumber(removedCount)} track${removedCount === 1 ? '' : 's'}.`);
      }
    } finally {
      ipod.close();
    }
  });
