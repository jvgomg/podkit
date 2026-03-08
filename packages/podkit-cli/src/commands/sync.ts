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
import type { QualityPreset, TransformsConfig } from '../config/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * AAC-only quality presets (for fallback)
 */
type AacQualityPreset = Exclude<QualityPreset, 'alac'>;

/**
 * Sync command options
 */
interface SyncOptions {
  source?: string;
  dryRun?: boolean;
  quality?: QualityPreset;
  fallback?: AacQualityPreset;
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
    type: 'transcode' | 'copy' | 'remove' | 'update-metadata';
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

/**
 * Format execution warnings (artwork failures, etc.)
 *
 * By default, shows a summary count. With verbose, shows details.
 */
function formatExecutionWarnings(
  warnings: Array<{ type: string; track: { artist: string; title: string; album?: string }; message: string }>,
  verbosity: number
): string[] {
  const lines: string[] = [];

  if (warnings.length === 0) {
    return lines;
  }

  // Group warnings by type
  const byType = new Map<string, typeof warnings>();
  for (const warning of warnings) {
    const existing = byType.get(warning.type) ?? [];
    existing.push(warning);
    byType.set(warning.type, existing);
  }

  lines.push('');
  lines.push(`Warnings: ${warnings.length}`);

  if (verbosity >= 1) {
    lines.push('');
    for (const [type, typeWarnings] of byType) {
      const typeLabel = type === 'artwork' ? 'Artwork' : type.charAt(0).toUpperCase() + type.slice(1);
      lines.push(`  ${typeLabel} issues (${typeWarnings.length}):`);
      for (const warning of typeWarnings) {
        const trackName = `${warning.track.artist} - ${warning.track.title}`;
        if (verbosity >= 2) {
          lines.push(`    - ${trackName}`);
          lines.push(`      ${warning.message}`);
        } else {
          lines.push(`    - ${trackName}`);
        }
      }
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

// =============================================================================
// Sync Command
// =============================================================================

export const syncCommand = new Command('sync')
  .description('sync music collection to iPod')
  .option('-s, --source <path>', 'source directory to sync from')
  .option('-n, --dry-run', 'show what would be synced without making changes')
  .option(
    '--quality <preset>',
    'transcoding quality: alac, max, max-cbr, high, high-cbr, medium, medium-cbr, low, low-cbr',
    'high'
  )
  .option(
    '--fallback <preset>',
    'fallback quality for lossy sources when quality=alac (default: max)'
  )
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
    const fallback = options.fallback ?? config.fallback;
    const dryRun = options.dryRun ?? false;
    const removeOrphans = options.delete ?? false;
    const artwork = options.artwork ?? config.artwork;

    // Build transcode config for planner
    const transcodeConfig = {
      quality,
      fallback,
    };

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

    // Collect scan warnings (files that failed to parse)
    const scanWarnings: Array<{ file: string; message: string }> = [];

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
      return;
    }

    if (!globalOpts.json && !globalOpts.quiet) {
      spinner.stop(`Found ${formatNumber(collectionTracks.length)} tracks in source`);

      // Display scan warnings if any
      if (scanWarnings.length > 0) {
        console.log(`  ${scanWarnings.length} file${scanWarnings.length === 1 ? '' : 's'} could not be parsed`);
        if (globalOpts.verbose) {
          for (const warning of scanWarnings) {
            console.log(`    - ${warning.file}: ${warning.message}`);
          }
        }
      }
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
      // Pass transforms config for dual-key matching (detect when transforms need apply/revert)
      const diff = core.computeDiff(collectionTracks, ipodTracks, { transforms: config.transforms });

      if (!globalOpts.json && !globalOpts.quiet) {
        spinner.stop('Diff computed');
      }

      // ----- Create sync plan -----
      const plan = core.createPlan(diff, {
        removeOrphans,
        transcodeConfig,
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
          const operations: SyncOutput['operations'] = plan.operations.map((op) => {
            const base = {
              type: op.type,
              track: core.getOperationDisplayName(op),
              status: 'pending' as const,
            };
            // Include change details for update-metadata operations
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

          // Convert plan warnings to JSON format
          const planWarningInfos: PlanWarningInfo[] = plan.warnings.map((warning) => ({
            type: warning.type,
            message: warning.message,
            trackCount: warning.tracks.length,
            tracks: globalOpts.verbose
              ? warning.tracks.map((t) => `${t.artist} - ${t.title}`)
              : undefined,
          }));

          // Convert scan warnings to JSON format
          const scanWarningInfos: ScanWarningInfo[] = scanWarnings.map((warning) => ({
            file: warning.file,
            message: warning.message,
          }));

          // Build transforms info
          const transformsInfo: TransformInfo[] = [];
          if (config.transforms.ftintitle.enabled) {
            transformsInfo.push({
              name: 'ftintitle',
              enabled: true,
              mode: config.transforms.ftintitle.drop ? 'drop' : 'move',
              format: config.transforms.ftintitle.drop ? undefined : config.transforms.ftintitle.format,
            });
          }

          // Build update breakdown by reason
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
          console.log('=== Sync Plan (Dry Run) ===');
          console.log('');
          console.log(`Source: ${sourcePath}`);
          console.log(`Device: ${devicePath}`);
          const qualityDisplay = fallback ? `${quality} (fallback: ${fallback})` : quality;
          console.log(`Quality: ${qualityDisplay}`);
          const transformsDisplay = formatTransformsConfig(config.transforms);
          if (transformsDisplay) {
            console.log(`Transforms: ${transformsDisplay}`);
          }
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
          if (diff.toUpdate.length > 0) {
            // Group updates by reason
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
          if (diff.conflicts.length > 0) {
            console.log(`  Metadata conflicts: ${formatNumber(diff.conflicts.length)}`);
            if (globalOpts.verbose) {
              for (const conflict of diff.conflicts) {
                const track = conflict.collection;
                console.log(`    - ${track.artist} - ${track.title}`);
                for (const field of conflict.conflicts) {
                  const sourceValue = track[field as keyof typeof track] ?? '(empty)';
                  const ipodValue = conflict.ipod[field as keyof typeof conflict.ipod] ?? '(empty)';
                  console.log(`        ${field}: "${sourceValue}" vs "${ipodValue}"`);
                }
              }
            }
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

                // In verbose mode, show before/after for update operations
                if (globalOpts.verbose && op.type === 'update-metadata') {
                  // Find the corresponding UpdateTrack to get change details
                  const updateInfo = diff.toUpdate.find(
                    (u) => u.ipod.title === op.track.title && u.ipod.artist === op.track.artist
                  );
                  if (updateInfo) {
                    for (const change of updateInfo.changes) {
                      console.log(`      ${change.field}: "${change.from}" → "${change.to}"`);
                    }
                  }
                }
              }
              console.log('');
            }
          } else if (plan.operations.length > 20) {
            console.log(`Operations: ${plan.operations.length} total (use --verbose to list all)`);
            console.log('');
          }

          // Show warnings (lossy-to-lossy conversions)
          if (plan.warnings.length > 0) {
            for (const warning of plan.warnings) {
              if (warning.type === 'lossy-to-lossy') {
                console.log(`\u26A0\uFE0F  ${warning.tracks.length} track${warning.tracks.length === 1 ? '' : 's'} require lossy-to-lossy conversion:`);
                console.log('   These files (OGG, Opus) are not iPod-compatible and will be');
                console.log('   transcoded to AAC. This is unavoidable but results in quality loss.');
                console.log('');
                // Show up to 5 track names in verbose mode
                if (globalOpts.verbose) {
                  const displayTracks = warning.tracks.slice(0, 5);
                  for (const track of displayTracks) {
                    console.log(`   - ${track.artist} - ${track.title}`);
                  }
                  if (warning.tracks.length > 5) {
                    console.log(`   ... and ${warning.tracks.length - 5} more`);
                  }
                  console.log('');
                }
              }
            }
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
              tracksToUpdate: 0,
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

      // ----- Final output -----
      const duration = (Date.now() - startTime) / 1000;

      // Collect execution warnings (e.g., artwork extraction failures)
      const executionWarnings = executor.getWarnings();

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

        // Convert execution warnings to JSON format
        const executionWarningInfos: ExecutionWarningInfo[] = executionWarnings.map((w) => ({
          type: w.type,
          track: `${w.track.artist} - ${w.track.title}`,
          message: w.message,
        }));

        // Convert scan warnings to JSON format
        const scanWarningInfos: ScanWarningInfo[] = scanWarnings.map((w) => ({
          file: w.file,
          message: w.message,
        }));

        outputJson({
          success: failed === 0,
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
          operations: operationResults,
          result: {
            completed,
            failed,
            skipped: 0,
            bytesTransferred: plan.estimatedSize,
            duration,
          },
          scanWarnings: scanWarningInfos.length > 0 ? scanWarningInfos : undefined,
          executionWarnings: executionWarningInfos.length > 0 ? executionWarningInfos : undefined,
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

        // Display warnings based on verbosity
        if (executionWarnings.length > 0) {
          const warningLines = formatExecutionWarnings(executionWarnings, globalOpts.verbose);
          for (const line of warningLines) {
            console.log(line);
          }
        }

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
