/* eslint-disable no-console */
/**
 * Sync command - synchronize music collection to iPod
 *
 * This command:
 * 1. Scans the source directory for audio files
 * 2. Opens the iPod database
 * 3. Computes the diff between source and iPod
 * 4. Creates a sync plan (transcode/copy/remove operations)
 * 5. Executes the plan with progress display
 *
 * @example
 * ```bash
 * podkit sync --source ~/Music           # Sync from directory
 * podkit sync --dry-run                  # Preview changes
 * podkit sync --delete                   # Remove orphaned tracks
 * podkit sync --quality medium           # Use medium quality preset
 * ```
 */
import { existsSync, statfsSync } from 'node:fs';
import { Command } from 'commander';
import { getContext } from '../context.js';
import type { QualityPreset } from '../config/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Sync command options
 */
interface SyncOptions {
  source?: string;
  dryRun?: boolean;
  quality?: QualityPreset;
  filter?: string;
  artwork?: boolean;
  delete?: boolean;
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
 * JSON output structure for sync command
 */
interface SyncOutput {
  success: boolean;
  dryRun: boolean;
  source?: string;
  device?: string;
  plan?: {
    tracksToAdd: number;
    tracksToRemove: number;
    tracksToTranscode: number;
    tracksToCopy: number;
    estimatedSize: number;
    estimatedTime: number;
  };
  operations?: Array<{
    type: 'transcode' | 'copy' | 'remove' | 'update-metadata';
    track: string;
    status?: 'pending' | 'completed' | 'failed' | 'skipped';
    error?: string;
  }>;
  result?: {
    completed: number;
    failed: number;
    skipped: number;
    bytesTransferred: number;
    duration: number;
  };
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
      process.stdout.write(`\r${this.frames[this.current]} ${this.message}`);
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
    if (finalMessage) {
      process.stdout.write(`\r${finalMessage}\n`);
    } else {
      process.stdout.write('\r');
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
// Sync Command
// =============================================================================

export const syncCommand = new Command('sync')
  .description('sync music collection to iPod')
  .option('-s, --source <path>', 'source directory to sync from')
  .option('-n, --dry-run', 'show what would be synced without making changes')
  .option('--quality <preset>', 'transcoding quality: high, medium, low', 'high')
  .option('--filter <pattern>', 'only sync tracks matching pattern')
  .option('--no-artwork', 'skip artwork transfer')
  .option('--delete', 'remove tracks from iPod not in source')
  .action(async (options: SyncOptions) => {
    const { config, globalOpts, configResult } = getContext();
    const startTime = Date.now();

    // Merge options with config
    const sourcePath = options.source ?? config.source;
    const devicePath = config.device;
    const quality = (options.quality ?? config.quality) as QualityPreset;
    const dryRun = options.dryRun ?? false;
    const removeOrphans = options.delete ?? false;
    const artwork = options.artwork ?? config.artwork;

    // JSON output helper
    const outputJson = (data: SyncOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    // ----- Validate source -----
    if (!sourcePath) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          dryRun,
          error: 'No source specified',
        });
      } else {
        console.error('No source directory specified.');
        console.error('');
        console.error('Specify a source using:');
        console.error('  --source /path/to/music');
        console.error('  or set "source" in config file');
        if (configResult.configPath) {
          console.error(`  Config: ${configResult.configPath}`);
        }
      }
      process.exitCode = 1;
      return;
    }

    if (!existsSync(sourcePath)) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          dryRun,
          source: sourcePath,
          error: `Source directory not found: ${sourcePath}`,
        });
      } else {
        console.error(`Source directory not found: ${sourcePath}`);
      }
      process.exitCode = 1;
      return;
    }

    // ----- Validate device -----
    if (!devicePath) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          dryRun,
          source: sourcePath,
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

    if (!existsSync(devicePath)) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          dryRun,
          source: sourcePath,
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

    // ----- Load dependencies dynamically -----
    let core: typeof import('@podkit/core');

    try {
      core = await import('@podkit/core');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
      if (globalOpts.json) {
        outputJson({
          success: false,
          dryRun,
          source: sourcePath,
          device: devicePath,
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
          source: sourcePath,
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

    // ----- Scan source directory -----
    const spinner = new Spinner();
    if (!globalOpts.json && !globalOpts.quiet) {
      spinner.start('Scanning source directory...');
    }

    const adapter = core.createDirectoryAdapter({
      path: sourcePath,
      onProgress: (progress) => {
        if (!globalOpts.json && !globalOpts.quiet) {
          if (progress.phase === 'discovering') {
            spinner.update('Discovering audio files...');
          } else {
            spinner.update(
              `Parsing metadata: ${progress.processed}/${progress.total} files`
            );
          }
        }
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
      return;
    }

    if (!globalOpts.json && !globalOpts.quiet) {
      spinner.stop(`Found ${formatNumber(collectionTracks.length)} tracks in source`);
    }

    // ----- Open iPod database -----
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
          source: sourcePath,
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

    try {
      const ipodTracks = ipod.getTracks();
      if (!globalOpts.json && !globalOpts.quiet) {
        spinner.stop(`iPod has ${formatNumber(ipodTracks.length)} tracks`);
      }

      // ----- Compute diff -----
      if (!globalOpts.json && !globalOpts.quiet) {
        spinner.start('Computing sync diff...');
      }

      // IPodTrack from IpodDatabase already has the correct shape for diffing
      const diff = core.computeDiff(collectionTracks, ipodTracks);

      if (!globalOpts.json && !globalOpts.quiet) {
        spinner.stop('Diff computed');
      }

      // ----- Create sync plan -----
      const plan = core.createPlan(diff, {
        removeOrphans,
        transcodePreset: { name: quality },
      });

      const summary = core.getPlanSummary(plan);

      // Check available space
      const storage = getStorageInfo(devicePath);
      const hasEnoughSpace = storage
        ? core.willFitInSpace(plan, storage.free)
        : true;

      // ----- Dry-run output -----
      if (dryRun) {
        if (globalOpts.json) {
          const operations: SyncOutput['operations'] = plan.operations.map((op) => ({
            type: op.type,
            track: core.getOperationDisplayName(op),
            status: 'pending' as const,
          }));

          outputJson({
            success: true,
            dryRun: true,
            source: sourcePath,
            device: devicePath,
            plan: {
              tracksToAdd: diff.toAdd.length,
              tracksToRemove: removeOrphans ? diff.toRemove.length : 0,
              tracksToTranscode: summary.transcodeCount,
              tracksToCopy: summary.copyCount,
              estimatedSize: plan.estimatedSize,
              estimatedTime: plan.estimatedTime,
            },
            operations,
          });
        } else {
          console.log('');
          console.log('=== Sync Plan (Dry Run) ===');
          console.log('');
          console.log(`Source: ${sourcePath}`);
          console.log(`Device: ${devicePath}`);
          console.log(`Quality: ${quality}`);
          console.log('');

          // Summary
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
          if (diff.conflicts.length > 0) {
            console.log(`  Metadata conflicts: ${formatNumber(diff.conflicts.length)}`);
          }
          console.log('');

          // Space estimate
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

          // Show operations (verbose mode or small number)
          if (globalOpts.verbose || plan.operations.length <= 20) {
            if (plan.operations.length > 0) {
              console.log('Operations:');
              for (const op of plan.operations) {
                const symbol = op.type === 'remove' ? '-' : '+';
                const typeStr = op.type.padEnd(10);
                console.log(`  ${symbol} [${typeStr}] ${core.getOperationDisplayName(op)}`);
              }
              console.log('');
            }
          } else if (plan.operations.length > 20) {
            console.log(`Operations: ${plan.operations.length} total (use --verbose to list all)`);
            console.log('');
          }

          console.log('Run without --dry-run to execute this plan.');
        }

        await adapter.disconnect();
        return;
      }

      // ----- Check space before execution -----
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
          console.error('');
          console.error('Consider:');
          console.error('  - Using --delete to remove orphaned tracks');
          console.error('  - Using --quality low for smaller files');
          console.error('  - Using --filter to sync fewer tracks');
        }
        process.exitCode = 1;
        await adapter.disconnect();
        return;
      }

      // ----- Nothing to do -----
      if (plan.operations.length === 0) {
        if (globalOpts.json) {
          outputJson({
            success: true,
            dryRun: false,
            source: sourcePath,
            device: devicePath,
            plan: {
              tracksToAdd: 0,
              tracksToRemove: 0,
              tracksToTranscode: 0,
              tracksToCopy: 0,
              estimatedSize: 0,
              estimatedTime: 0,
            },
            result: {
              completed: 0,
              failed: 0,
              skipped: 0,
              bytesTransferred: 0,
              duration: 0,
            },
          });
        } else {
          console.log('');
          console.log('Already in sync! No changes needed.');
          console.log(`  Source tracks: ${formatNumber(collectionTracks.length)}`);
          console.log(`  iPod tracks: ${formatNumber(ipodTracks.length)}`);
        }
        await adapter.disconnect();
        return;
      }

      // ----- Execute sync plan -----
      if (!globalOpts.json && !globalOpts.quiet) {
        console.log('');
        console.log('=== Syncing ===');
        console.log('');
        console.log(`Tracks to process: ${formatNumber(plan.operations.length)}`);
        console.log(`Estimated size: ${formatBytes(plan.estimatedSize)}`);
        console.log(`Estimated time: ~${formatDuration(plan.estimatedTime)}`);
        console.log('');
      }

      const operationResults: SyncOutput['operations'] = [];
      const collectedErrors: CollectedError[] = [];
      let completed = 0;
      let failed = 0;

      // Create executor and iterate for progress updates
      const executor = new core.DefaultSyncExecutor({ ipod, transcoder });

      for await (const progress of executor.execute(plan, { dryRun: false, continueOnError: true, artwork })) {
        // Track operation results for JSON output
        if (progress.error) {
          operationResults.push({
            type: progress.operation.type,
            track: core.getOperationDisplayName(progress.operation),
            status: 'failed',
            error: progress.error.message,
          });

          // Collect categorized error for detailed reporting
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
          // Count completed operations
          completed++;
        }

        // Update progress display
        if (!globalOpts.json && !globalOpts.quiet) {
          if (progress.phase === 'complete') {
            process.stdout.write('\x1b[2K\r');
            console.log('Sync complete!');
          } else if (progress.phase === 'updating-db') {
            process.stdout.write('\rSaving iPod database...' + ' '.repeat(40));
          } else if (progress.phase !== 'preparing') {
            const bar = renderProgressBar(progress.current + 1, progress.total);
            const phaseStr = progress.phase.charAt(0).toUpperCase() + progress.phase.slice(1);
            const trackStr = progress.currentTrack
              ? ` ${progress.currentTrack.substring(0, 40)}`
              : '';
            process.stdout.write(`\r${bar} ${phaseStr}${trackStr}` + ' '.repeat(20));
          }
        }
      }

      // ----- Final output -----
      const duration = (Date.now() - startTime) / 1000;

      if (globalOpts.json) {
        // Convert collected errors to JSON format
        const errorInfos: ErrorInfo[] = collectedErrors.map((err) => ({
          track: err.trackName,
          category: err.category,
          message: err.message,
          retryAttempts: err.retryAttempts,
          wasRetried: err.wasRetried,
          // Only include stack in verbose JSON mode
          ...(globalOpts.verbose >= 3 ? { stack: err.stack } : {}),
        }));

        outputJson({
          success: failed === 0,
          dryRun: false,
          source: sourcePath,
          device: devicePath,
          plan: {
            tracksToAdd: diff.toAdd.length,
            tracksToRemove: removeOrphans ? diff.toRemove.length : 0,
            tracksToTranscode: summary.transcodeCount,
            tracksToCopy: summary.copyCount,
            estimatedSize: plan.estimatedSize,
            estimatedTime: plan.estimatedTime,
          },
          operations: operationResults,
          result: {
            completed,
            failed,
            skipped: 0,
            bytesTransferred: plan.estimatedSize,
            duration,
          },
          errors: errorInfos.length > 0 ? errorInfos : undefined,
        });
      } else if (!globalOpts.quiet) {
        console.log('');
        console.log('=== Summary ===');
        console.log('');

        // Show success message with track counts
        const total = plan.operations.length;
        if (failed > 0) {
          console.log(`Synced ${formatNumber(completed)}/${formatNumber(total)} tracks (${formatNumber(failed)} failed)`);
        } else {
          console.log(`Synced ${formatNumber(completed)} tracks successfully`);
        }

        console.log(`Duration: ${formatDuration(duration)}`);
        console.log(`Data transferred: ~${formatBytes(plan.estimatedSize)}`);

        // Display errors based on verbosity
        if (collectedErrors.length > 0) {
          const errorLines = formatErrors(collectedErrors, globalOpts.verbose);
          for (const line of errorLines) {
            console.log(line);
          }
        }
      }

      if (failed > 0) {
        process.exitCode = 1;
      }
    } finally {
      ipod.close();
      await adapter.disconnect();
    }
  });
