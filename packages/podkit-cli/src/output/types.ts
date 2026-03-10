/**
 * Output system types for CLI commands
 *
 * These types provide a unified interface for handling both JSON and text output
 * across all CLI commands, eliminating scattered `if (globalOpts.json)` conditionals.
 */

/**
 * Output mode - determines how data is rendered
 */
export type OutputMode = 'json' | 'text';

/**
 * Options that control output behavior
 */
export interface OutputOptions {
  /** Output mode: 'json' for structured data, 'text' for human-readable */
  mode: OutputMode;
  /** Suppress non-essential output */
  quiet: boolean;
  /** Verbosity level (0-3) */
  verbose: number;
}

/**
 * Configuration for creating an OutputContext
 */
export interface OutputContextConfig extends OutputOptions {
  /** Whether colors are enabled */
  color: boolean;
}

/**
 * Interface for spinner control
 */
export interface SpinnerControl {
  /** Update the spinner message */
  update(message: string): void;
  /** Stop the spinner, optionally showing a final message */
  stop(finalMessage?: string): void;
}

/**
 * No-op spinner for JSON mode or quiet mode
 */
export const nullSpinner: SpinnerControl = {
  update: () => {},
  stop: () => {},
};

/**
 * Table formatting options
 */
export interface TableOptions {
  /** Column headers */
  headers?: string[];
  /** Column widths (optional, will auto-calculate if not provided) */
  widths?: number[];
}
