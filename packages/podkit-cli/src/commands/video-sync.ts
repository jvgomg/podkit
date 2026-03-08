/**
 * Video sync command - synchronize video collection to iPod
 *
 * This command:
 * 1. Validates the device supports video
 * 2. Scans the video source directory
 * 3. Computes the diff between source and iPod
 * 4. Creates a video sync plan (transcode/passthrough/remove operations)
 * 5. Displays dry-run output or executes with progress
 *
 * @example
 * ```bash
 * podkit video-sync --source ~/Videos       # Sync from directory
 * podkit video-sync --dry-run               # Preview changes
 * podkit video-sync --delete                # Remove orphaned videos
 * podkit video-sync --quality medium        # Use medium quality preset
 * ```
 */
import { existsSync, statfsSync } from 'node:fs';
import { Command } from 'commander';
import { getContext } from '../context.js';
import type { VideoQualityPreset } from '../config/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Video sync command options
 */
interface VideoSyncOptions {
  source?: string;
  dryRun?: boolean;
  quality?: VideoQualityPreset;
  artwork?: boolean;
  delete?: boolean;
}

/**
 * JSON output structure for video sync command
 */
interface VideoSyncOutput {
  success: boolean;
  dryRun: boolean;
  source?: string;
  device?: string;
  plan?: {
    videosToAdd: number;
    videosToRemove: number;
    videosToTranscode: number;
    videosToCopy: number;
    movieCount: number;
    tvShowCount: number;
    estimatedSize: number;
    estimatedTime: number;
  };
  result?: {
    completed: number;
    failed: number;
    skipped: number;
    bytesTransferred: number;
    duration: number;
  };
  warnings?: Array<{
    type: string;
    message: string;
    videoCount: number;
  }>;
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
      // \x1b[K clears from cursor to end of line
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
    // \x1b[K clears from cursor to end of line
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
 * Check if a string is a valid video quality preset
 */
function isValidVideoQualityPreset(value: string): value is VideoQualityPreset {
  return ['max', 'high', 'medium', 'low'].includes(value);
}

// =============================================================================
// Video Sync Command
// =============================================================================

export const videoSyncCommand = new Command('video-sync')
  .description('sync video collection to iPod')
  .option('-s, --source <path>', 'video source directory')
  .option('-n, --dry-run', 'show what would be synced without making changes')
  .option(
    '--quality <preset>',
    'video quality: max, high, medium, low',
    'high'
  )
  .option('--no-artwork', 'skip poster artwork transfer')
  .option('--delete', 'remove videos from iPod not in source')
  .action(async (options: VideoSyncOptions) => {
    const { config, globalOpts, configResult } = getContext();
    const startTime = Date.now();

    // Merge options with config
    const sourcePath = options.source ?? config.videoSource;
    const devicePath = config.device;
    const quality = options.quality ?? config.videoQuality ?? 'high';
    const dryRun = options.dryRun ?? false;
    const removeOrphans = options.delete ?? false;
    const artwork = options.artwork ?? config.artwork;

    // Validate quality preset
    if (!isValidVideoQualityPreset(quality)) {
      if (globalOpts.json) {
        console.log(JSON.stringify({
          success: false,
          dryRun,
          error: `Invalid quality preset: ${quality}. Valid values: max, high, medium, low`,
        }));
      } else {
        console.error(`Invalid quality preset: ${quality}`);
        console.error('Valid values: max, high, medium, low');
      }
      process.exitCode = 1;
      return;
    }

    // JSON output helper
    const outputJson = (data: VideoSyncOutput) => {
      console.log(JSON.stringify(data, null, 2));
    };

    // ----- Validate source -----
    if (!sourcePath) {
      if (globalOpts.json) {
        outputJson({
          success: false,
          dryRun,
          error: 'No video source specified',
        });
      } else {
        console.error('No video source directory specified.');
        console.error('');
        console.error('Specify a source using:');
        console.error('  --source /path/to/videos');
        console.error('  or set "videoSource" in config file');
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
          error: `Video source directory not found: ${sourcePath}`,
        });
      } else {
        console.error(`Video source directory not found: ${sourcePath}`);
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
      // ----- Check video support -----
      const ipodInfo = ipod.getInfo();
      const supportsVideo = ipodInfo.device?.supportsVideo ?? false;

      if (!supportsVideo) {
        spinner.stop();
        if (globalOpts.json) {
          outputJson({
            success: false,
            dryRun,
            source: sourcePath,
            device: devicePath,
            error: 'This iPod does not support video playback',
          });
        } else {
          console.error('This iPod does not support video playback.');
          console.error('');
          console.error('Video sync requires:');
          console.error('  - iPod Classic (all generations)');
          console.error('  - iPod Nano (3rd-5th generation)');
          console.error('  - iPod Video (5th generation)');
        }
        process.exitCode = 1;
        return;
      }

      if (!globalOpts.json && !globalOpts.quiet) {
        spinner.stop('iPod supports video');
      }

      // ----- Scan video source directory -----
      if (!globalOpts.json && !globalOpts.quiet) {
        spinner.start('Scanning video source directory...');
      }

      // Collect scan warnings
      const scanWarnings: Array<{ file: string; message: string }> = [];

      const adapter = core.createVideoDirectoryAdapter({
        path: sourcePath,
        onProgress: (progress) => {
          if (!globalOpts.json && !globalOpts.quiet) {
            if (progress.phase === 'discovering') {
              spinner.update('Discovering video files...');
            } else {
              spinner.update(
                `Analyzing videos: ${progress.processed}/${progress.total} files`
              );
            }
          }
        },
        onWarning: (warning) => {
          scanWarnings.push(warning);
        },
      });

      let collectionVideos: Awaited<ReturnType<typeof adapter.getVideos>>;
      try {
        await adapter.connect();
        collectionVideos = await adapter.getVideos();
      } catch (err) {
        spinner.stop();
        const message = err instanceof Error ? err.message : 'Failed to scan source';
        if (globalOpts.json) {
          outputJson({
            success: false,
            dryRun,
            source: sourcePath,
            device: devicePath,
            error: `Failed to scan video source: ${message}`,
          });
        } else {
          console.error(`Failed to scan video source directory: ${message}`);
        }
        process.exitCode = 1;
        return;
      }

      // Count by content type
      const movieCount = collectionVideos.filter(v => v.contentType === 'movie').length;
      const tvShowCount = collectionVideos.filter(v => v.contentType === 'tvshow').length;

      if (!globalOpts.json && !globalOpts.quiet) {
        spinner.stop(`Found ${formatNumber(collectionVideos.length)} videos (${movieCount} movies, ${tvShowCount} TV episodes)`);

        // Display scan warnings if any
        if (scanWarnings.length > 0) {
          console.log(`  ${scanWarnings.length} file${scanWarnings.length === 1 ? '' : 's'} could not be analyzed`);
          if (globalOpts.verbose) {
            for (const warning of scanWarnings) {
              console.log(`    - ${warning.file}: ${warning.message}`);
            }
          }
        }
      }

      // ----- Get iPod video tracks -----
      // For now, we assume no videos on iPod (full implementation needs TASK-069.14)
      // When libgpod video support is complete, we would:
      // const ipodTracks = ipod.getTracks().filter(t =>
      //   t.mediaType === core.MediaType.Movie || t.mediaType === core.MediaType.TVShow
      // );
      type IPodVideo = Awaited<ReturnType<typeof core.diffVideos>>['existing'][0]['ipod'];
      const ipodVideos: IPodVideo[] = []; // Placeholder

      // ----- Compute diff -----
      if (!globalOpts.json && !globalOpts.quiet) {
        spinner.start('Computing video sync diff...');
      }

      const diff = core.diffVideos(collectionVideos, ipodVideos);

      if (!globalOpts.json && !globalOpts.quiet) {
        spinner.stop('Diff computed');
      }

      // ----- Create sync plan -----
      const deviceProfile = core.getDefaultDeviceProfile();
      const plan = core.planVideoSync(diff, {
        deviceProfile,
        qualityPreset: quality,
        removeOrphans,
        useHardwareAcceleration: true,
      });

      const summary = core.getVideoPlanSummary(plan);

      // Check available space
      const storage = getStorageInfo(devicePath);
      const hasEnoughSpace = storage
        ? core.willVideoPlanFit(plan, storage.free)
        : true;

      // ----- Dry-run output -----
      if (dryRun) {
        if (globalOpts.json) {
          const warningInfos = plan.warnings.map(warning => ({
            type: warning.type,
            message: warning.message,
            videoCount: warning.tracks.length,
          }));

          outputJson({
            success: true,
            dryRun: true,
            source: sourcePath,
            device: devicePath,
            plan: {
              videosToAdd: diff.toAdd.length,
              videosToRemove: removeOrphans ? diff.toRemove.length : 0,
              videosToTranscode: summary.transcodeCount,
              videosToCopy: summary.copyCount,
              movieCount,
              tvShowCount,
              estimatedSize: plan.estimatedSize,
              estimatedTime: plan.estimatedTime,
            },
            warnings: warningInfos.length > 0 ? warningInfos : undefined,
          });
        } else {
          console.log('');
          console.log('=== Video Sync Plan (Dry Run) ===');
          console.log('');
          console.log(`Source: ${sourcePath}`);
          console.log(`Device: ${devicePath}`);
          console.log(`Quality: ${quality}`);
          console.log('');

          // Summary
          console.log('Collection:');
          console.log(`  Total videos: ${formatNumber(collectionVideos.length)}`);
          console.log(`    - Movies: ${formatNumber(movieCount)}`);
          console.log(`    - TV Shows: ${formatNumber(tvShowCount)}`);
          console.log('');

          console.log('Changes:');
          console.log(`  Videos to add: ${formatNumber(diff.toAdd.length)}`);
          if (summary.transcodeCount > 0) {
            console.log(`    - Transcode: ${formatNumber(summary.transcodeCount)}`);
          }
          if (summary.copyCount > 0) {
            console.log(`    - Passthrough: ${formatNumber(summary.copyCount)}`);
          }
          if (removeOrphans && diff.toRemove.length > 0) {
            console.log(`  Videos to remove: ${formatNumber(diff.toRemove.length)}`);
          }
          console.log(`  Already synced: ${formatNumber(diff.existing.length)}`);
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
                let symbol: string;
                let typeStr: string;
                switch (op.type) {
                  case 'video-transcode':
                    symbol = '+';
                    typeStr = 'transcode';
                    break;
                  case 'video-copy':
                    symbol = '+';
                    typeStr = 'passthrough';
                    break;
                  case 'remove':
                    symbol = '-';
                    typeStr = 'remove';
                    break;
                  default:
                    symbol = '?';
                    typeStr = op.type;
                }
                const displayName = core.getVideoOperationDisplayName(op);
                console.log(`  ${symbol} [${typeStr.padEnd(12)}] ${displayName}`);
              }
              console.log('');
            }
          } else if (plan.operations.length > 20) {
            console.log(`Operations: ${plan.operations.length} total (use --verbose to list all)`);
            console.log('');
          }

          // Show warnings
          if (plan.warnings.length > 0) {
            for (const warning of plan.warnings) {
              console.log(`Warning: ${warning.message}`);
            }
            console.log('');
          }

          // Note about execution limitation
          console.log('Note: Video sync execution requires iPod database video support.');
          console.log('      Currently only dry-run mode is available.');
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
              videosToAdd: diff.toAdd.length,
              videosToRemove: removeOrphans ? diff.toRemove.length : 0,
              videosToTranscode: summary.transcodeCount,
              videosToCopy: summary.copyCount,
              movieCount,
              tvShowCount,
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
          console.error('  - Using --delete to remove orphaned videos');
          console.error('  - Using --quality low for smaller files');
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
              videosToAdd: 0,
              videosToRemove: 0,
              videosToTranscode: 0,
              videosToCopy: 0,
              movieCount,
              tvShowCount,
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
          console.log(`  Collection videos: ${formatNumber(collectionVideos.length)}`);
        }
        await adapter.disconnect();
        return;
      }

      // ----- Execute sync plan -----
      // Full execution requires iPod database video support (TASK-069.14)
      // For now, we only support dry-run mode
      if (!globalOpts.json && !globalOpts.quiet) {
        console.log('');
        console.log('=== Video Sync ===');
        console.log('');
        console.log('Note: Video sync execution is not yet implemented.');
        console.log('      iPod database video support required (TASK-069.14).');
        console.log('      Use --dry-run to preview changes.');
        console.log('');
      }

      const executor = core.createVideoExecutor();

      // Execute in dry-run mode only for now
      const duration = (Date.now() - startTime) / 1000;
      let completed = 0;
      let skipped = 0;

      try {
        for await (const progress of executor.execute(plan, { dryRun: true })) {
          if (progress.skipped) {
            skipped++;
          } else if (progress.phase !== 'preparing' && progress.phase !== 'complete') {
            completed++;
          }

          // Update progress display
          if (!globalOpts.json && !globalOpts.quiet) {
            if (progress.phase === 'complete') {
              console.log('Plan preview complete.');
            } else {
              const bar = renderProgressBar(progress.current + 1, progress.total);
              const phaseStr = progress.phase.replace('video-', '');
              process.stdout.write(`\r\x1b[K${bar} ${phaseStr}: ${progress.currentTrack}`);
            }
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Execution failed';
        if (globalOpts.json) {
          outputJson({
            success: false,
            dryRun: false,
            source: sourcePath,
            device: devicePath,
            error: message,
          });
        } else {
          console.error('');
          console.error(`Error: ${message}`);
        }
        process.exitCode = 1;
        await adapter.disconnect();
        return;
      }

      if (globalOpts.json) {
        outputJson({
          success: true,
          dryRun: false,
          source: sourcePath,
          device: devicePath,
          plan: {
            videosToAdd: diff.toAdd.length,
            videosToRemove: removeOrphans ? diff.toRemove.length : 0,
            videosToTranscode: summary.transcodeCount,
            videosToCopy: summary.copyCount,
            movieCount,
            tvShowCount,
            estimatedSize: plan.estimatedSize,
            estimatedTime: plan.estimatedTime,
          },
          result: {
            completed,
            failed: 0,
            skipped,
            bytesTransferred: 0,
            duration,
          },
        });
      }

      await adapter.disconnect();
    } finally {
      ipod.close();
    }
  });
