/**
 * Common formatting utilities for CLI output
 *
 * These formatters provide consistent display of common data across commands.
 * Re-exports useful functions from display-utils.ts for convenience.
 */

// Re-export commonly used formatters from display-utils
export { formatBytes, formatNumber } from '../commands/display-utils.js';

/**
 * Render text in bold using ANSI escape codes when stdout is a TTY.
 * Falls back to plain text when output is piped or redirected.
 */
export function bold(text: string): string {
  return process.stdout.isTTY ? `\x1b[1m${text}\x1b[0m` : text;
}

/**
 * Format duration in seconds as human-readable time
 *
 * @example
 * formatDurationSeconds(45) // => "45s"
 * formatDurationSeconds(125) // => "2m 5s"
 * formatDurationSeconds(3725) // => "1h 2m"
 */
export function formatDurationSeconds(seconds: number): string {
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
 * Format a device header for display
 *
 * @example
 * formatDeviceHeader({ name: 'terapod', path: '/Volumes/TERAPOD', model: 'iPod Video' })
 * // => "Device: terapod (/Volumes/TERAPOD)"
 * //    "Model: iPod Video"
 */
export interface DeviceHeaderInfo {
  name?: string;
  path: string;
  model?: string;
}

export function formatDeviceHeader(info: DeviceHeaderInfo, verbose = false): string[] {
  const lines: string[] = [];

  if (info.name) {
    if (verbose) {
      lines.push(`Device: ${info.name} (${info.path})`);
    } else {
      lines.push(`Device: ${info.name}`);
    }
  } else {
    lines.push(`Device: ${info.path}`);
  }

  if (info.model) {
    lines.push(`Model: ${info.model}`);
  }

  return lines;
}

/**
 * Format a collection header for display
 *
 * @param collectionName - Name of the collection
 * @param sourcePath - Path to the collection source
 * @param verbose - Whether to include path details
 */
export function formatCollectionLabel(
  collectionName: string,
  sourcePath: string,
  verbose: boolean
): string {
  if (verbose) {
    return ` '${collectionName}' (${sourcePath})`;
  }
  return ` '${collectionName}'`;
}

/**
 * Progress bar rendering
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
 * Format update reason for display
 */
export function formatUpdateReason(reason: string): string {
  switch (reason) {
    case 'transform-apply':
      return 'Apply ftintitle';
    case 'transform-remove':
      return 'Revert ftintitle';
    case 'metadata-changed':
      return 'Metadata changed';
    case 'format-upgrade':
      return 'Format upgrade';
    case 'quality-upgrade':
      return 'Quality upgrade';
    case 'preset-upgrade':
      return 'Preset upgrade';
    case 'preset-downgrade':
      return 'Preset downgrade';
    case 'artwork-added':
      return 'Artwork added';
    case 'soundcheck-update':
      return 'Sound Check update';
    case 'metadata-correction':
      return 'Metadata correction';
    default:
      return reason;
  }
}

/**
 * Collected error for reporting
 */
export interface CollectedError {
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
export function formatErrors(errors: CollectedError[], verbosity: number): string[] {
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
        for (const stackLine of stackLines.slice(0, 5)) {
          // Limit to 5 lines
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
 * A grouped artist transform for the preview
 */
export interface TransformPreviewEntry {
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
export function buildTransformPreview<
  T extends { artist: string; title: string; album: string },
  C,
>(
  tracks: T[],
  config: C,
  applyTransformsFn: (
    track: T,
    config: C
  ) => { original: { artist: string }; transformed: { artist: string }; applied: boolean }
): TransformPreviewEntry[] {
  // Map of "original -> transformed" to count
  const transformMap = new Map<string, TransformPreviewEntry>();

  for (const track of tracks) {
    const result = applyTransformsFn(track, config);

    if (result.applied && result.original.artist !== result.transformed.artist) {
      const key = `${result.original.artist} -> ${result.transformed.artist}`;
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
