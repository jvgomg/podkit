/**
 * Progress display utilities for CLI output
 *
 * Provides consistent progress line formatting and track name truncation
 * for both audio and video transcoding operations. Automatically adapts
 * to terminal width to prevent line wrapping.
 *
 * ## Dual Progress Display
 *
 * For operations with many files (especially video transcoding), a two-line
 * display shows both overall progress and per-file progress simultaneously:
 *
 * ```
 * Overall:  [========>                     ]  27%  3/11 videos
 * Current:  [===============>              ]  52%  Transcoding (2.1x): Show - S01E03
 * ```
 */

import { renderProgressBar } from '../output/formatters.js';

/**
 * Options for formatting a progress line
 */
export interface ProgressLineOptions {
  /** Progress bar string (e.g., "[====>    ] 50%") */
  bar: string;
  /** Phase description (e.g., "Transcoding", "Copying") */
  phase: string;
  /** Track name to display (will be truncated to fit terminal) */
  trackName?: string;
  /** Encoding speed multiplier (e.g., 1.5 for 1.5x) */
  speed?: number;
  /** Override terminal width (defaults to process.stdout.columns or 80) */
  terminalWidth?: number;
}

/**
 * Truncate a string to a maximum length, adding ellipsis if needed.
 */
export function truncateTrackName(name: string | undefined, maxLength = 40): string {
  if (!name) return '';
  if (name.length <= maxLength) return name;
  return name.substring(0, maxLength - 3) + '...';
}

/**
 * Get the current terminal width, with a sensible default.
 * Checks stderr first (since progress output goes there), then stdout.
 */
export function getTerminalWidth(): number {
  return process.stderr.columns || process.stdout.columns || 80;
}

/**
 * Format a progress line for CLI output with carriage return
 *
 * Creates a progress line that overwrites the previous line using `\r\x1b[K`.
 * Automatically fits the output to the terminal width by truncating the track
 * name to fill available space. If the terminal is too narrow for even a short
 * track name, the name is omitted entirely.
 *
 * @param options - Progress line formatting options
 * @returns Formatted progress line ready for `process.stdout.write()`
 */
export function formatProgressLine({
  bar,
  phase,
  trackName,
  speed,
  terminalWidth,
}: ProgressLineOptions): string {
  const width = terminalWidth ?? getTerminalWidth();
  const speedStr = speed ? ` (${speed.toFixed(1)}x)` : '';

  // Base line without track name: "bar phase(speed)"
  const baseLength = bar.length + 1 + phase.length + speedStr.length;

  if (!trackName) {
    return `\r\x1b[K${bar} ${phase}${speedStr}`;
  }

  // Track name adds ": name" (2 chars for ": " prefix)
  const availableForTrack = width - baseLength - 2;

  // Need at least 4 chars to show anything meaningful (e.g., "S...")
  if (availableForTrack < 4) {
    return `\r\x1b[K${bar} ${phase}${speedStr}`;
  }

  const truncated = truncateTrackName(trackName, availableForTrack);
  return `\r\x1b[K${bar} ${phase}${speedStr}: ${truncated}`;
}

// =============================================================================
// Dual Progress Display
// =============================================================================

/** Prefix for the overall progress line */
const OVERALL_PREFIX = 'Overall:  ';
/** Prefix for the current item progress line */
const CURRENT_PREFIX = 'Current:  ';

/**
 * Format the overall progress line with bar and counter.
 *
 * Produces: `Overall:  [========>       ]  27%  3/11 videos`
 */
export function formatOverallLine(completed: number, total: number, unit: string): string {
  const bar = renderProgressBar(completed, total);
  const counter = `${completed}/${total} ${unit}`;
  return `${OVERALL_PREFIX}${bar}  ${counter}`;
}

/**
 * Format a current-item progress line (with sub-progress bar).
 *
 * Produces: `Current:  [===============>  ]  52%  Transcoding (2.1x): Track Name`
 */
export function formatCurrentLineWithBar(options: {
  percent: number;
  phase: string;
  trackName?: string;
  speed?: number;
}): string {
  const bar = renderProgressBar(Math.round(options.percent), 100);
  const speedStr = options.speed ? ` (${options.speed.toFixed(1)}x)` : '';
  const width = getTerminalWidth();
  const prefix = CURRENT_PREFIX;

  const baseLength = prefix.length + bar.length + 1 + options.phase.length + speedStr.length;

  if (!options.trackName) {
    return `${prefix}${bar} ${options.phase}${speedStr}`;
  }

  const availableForTrack = width - baseLength - 2;
  if (availableForTrack < 4) {
    return `${prefix}${bar} ${options.phase}${speedStr}`;
  }

  const truncated = truncateTrackName(options.trackName, availableForTrack);
  return `${prefix}${bar} ${options.phase}${speedStr}: ${truncated}`;
}

/**
 * Format a current-item progress line (text only, no sub-bar).
 *
 * Produces: `Current:  Copying: Track Name`
 */
export function formatCurrentLineText(options: { phase: string; trackName?: string }): string {
  const width = getTerminalWidth();
  const prefix = CURRENT_PREFIX;
  const baseLength = prefix.length + options.phase.length;

  if (!options.trackName) {
    return `${prefix}${options.phase}`;
  }

  const availableForTrack = width - baseLength - 2;
  if (availableForTrack < 4) {
    return `${prefix}${options.phase}`;
  }

  const truncated = truncateTrackName(options.trackName, availableForTrack);
  return `${prefix}${options.phase}: ${truncated}`;
}

/**
 * Two-line progress display for sync operations.
 *
 * Manages ANSI cursor movement to overwrite two lines in place:
 * - Line 1: Overall progress (file count + percentage)
 * - Line 2: Current item progress (phase, track name, optional sub-bar)
 *
 * Call `update()` on each progress tick and `finish()` when done to
 * clean up both lines before printing the completion message.
 */
export class DualProgressDisplay {
  private rendered = false;
  private writer: (content: string) => void;

  constructor(writer: (content: string) => void) {
    this.writer = writer;
  }

  /**
   * Update both progress lines.
   *
   * @param overallLine - Pre-formatted overall progress line (no ANSI prefix)
   * @param currentLine - Pre-formatted current item line (no ANSI prefix)
   */
  update(overallLine: string, currentLine: string): void {
    if (this.rendered) {
      // Move up one line, clear it, write overall, then newline + clear + current
      this.writer(`\x1b[A\r\x1b[K${overallLine}\n\r\x1b[K${currentLine}`);
    } else {
      // First render: write both lines
      this.writer(`${overallLine}\n${currentLine}`);
      this.rendered = true;
    }
  }

  /**
   * Clear both progress lines so subsequent output starts clean.
   */
  finish(): void {
    if (this.rendered) {
      // Move up one line, clear it, move down, clear the second line
      this.writer('\x1b[A\r\x1b[K\n\r\x1b[K\x1b[A');
      this.rendered = false;
    }
  }
}
