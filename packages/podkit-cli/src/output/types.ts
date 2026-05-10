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
 * Minimal sink contract for output streams. `process.stdout` and
 * `process.stderr` satisfy this; tests can pass any object with `write`.
 */
export interface OutputSink {
  write(chunk: string): boolean | void;
}

/**
 * Sink for the process exit code. The default sink writes
 * `process.exitCode`; tests inject a buffer to avoid mutating process-global
 * state, which would otherwise prevent `it.concurrent` within a file.
 */
export interface ExitCodeSink {
  set(code: number): void;
  /** Most recently written code, or `undefined` if none. */
  get(): number | undefined;
}

/** Default sink — writes `process.exitCode`. */
export const processExitCodeSink: ExitCodeSink = {
  set(code) {
    process.exitCode = code;
  },
  get() {
    return process.exitCode === undefined
      ? undefined
      : typeof process.exitCode === 'number'
        ? process.exitCode
        : Number(process.exitCode);
  },
};

/** Buffer sink — captures into a field. Tests use this. */
export class BufferExitCodeSink implements ExitCodeSink {
  private code: number | undefined;
  set(code: number): void {
    this.code = code;
  }
  get(): number | undefined {
    return this.code;
  }
}

/**
 * Configuration for creating an OutputContext
 */
export interface OutputContextConfig extends OutputOptions {
  /** Whether colors are enabled */
  color: boolean;
  /** Whether contextual tips are enabled */
  tips: boolean;
  /**
   * Whether interactive output (spinners, progress) is enabled.
   * False when --no-tty is passed or stdout is not a TTY.
   */
  tty: boolean;
  /** stdout sink. Defaults to process.stdout. Tests inject a buffer. */
  stdout?: OutputSink;
  /** stderr sink. Defaults to process.stderr. */
  stderr?: OutputSink;
  /** Exit code sink. Defaults to writing `process.exitCode`. */
  exitCode?: ExitCodeSink;
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
