/**
 * OutputContext - Unified output handling for CLI commands
 *
 * This class replaces scattered `if (globalOpts.json)` conditionals with a clean
 * interface that automatically handles the correct output format based on mode.
 *
 * @example
 * ```typescript
 * const out = OutputContext.fromGlobalOpts(globalOpts);
 *
 * // These only output in text mode:
 * out.print('Starting sync...');
 * out.success('Sync complete!');
 *
 * // This only outputs in JSON mode:
 * out.json({ success: true, tracks: 100 });
 *
 * // Spinners no-op in JSON/quiet mode:
 * const spinner = out.spinner('Loading...');
 * spinner.update('Still loading...');
 * spinner.stop('Done!');
 * ```
 */

import type {
  ExitCodeSink,
  OutputContextConfig,
  OutputSink,
  SpinnerControl,
  TableOptions,
} from './types.js';
import { nullSpinner, processExitCodeSink } from './types.js';
import type { TipContext } from './tips.js';
import { collectTips, formatTips } from './tips.js';

/**
 * Simple spinner for CLI progress
 */
class Spinner implements SpinnerControl {
  private frames = ['|', '/', '-', '\\'];
  private current = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private message = '';

  start(message: string): void {
    this.message = message;
    this.interval = setInterval(() => {
      // \x1b[K clears from cursor to end of line to prevent remnant characters
      process.stderr.write(`\r\x1b[K${this.frames[this.current]} ${this.message}`);
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
      process.stderr.write(`\r\x1b[K${finalMessage}\n`);
    } else {
      process.stderr.write('\r\x1b[K');
    }
  }
}

/**
 * OutputContext handles all output for a command, automatically routing
 * to the correct format (JSON or text) based on configuration.
 */
export class OutputContext {
  private readonly mode: 'json' | 'text';
  private readonly quiet: boolean;
  private readonly verbose: number;
  private readonly useColor: boolean;
  private readonly showTips: boolean;
  private readonly tty: boolean;
  private readonly out: OutputSink;
  private readonly err: OutputSink;
  private readonly exitCode: ExitCodeSink;
  /**
   * Width (chars) of the most recent `progress(line)` write. `clearProgress`
   * uses this to size its blank-space overwrite — sized to the actual line
   * rather than a wide guess so we don't waste bandwidth or eat too many
   * cells under unusual terminal widths.
   */
  private lastProgressWidth = 0;

  constructor(config: OutputContextConfig) {
    this.mode = config.mode;
    this.quiet = config.quiet;
    this.verbose = config.verbose;
    this.useColor = config.color;
    this.showTips = config.tips;
    this.tty = config.tty;
    this.out = config.stdout ?? process.stdout;
    this.err = config.stderr ?? process.stderr;
    this.exitCode = config.exitCode ?? processExitCodeSink;
  }

  /**
   * Set the process exit code via the configured sink.
   *
   * Default sink writes `process.exitCode`. Tests should construct an
   * OutputContext with a `BufferExitCodeSink` to capture the value
   * without mutating process-global state — that's what enables
   * `it.concurrent` within a single file.
   */
  setExitCode(code: number): void {
    this.exitCode.set(code);
  }

  /** Read the most recently set exit code, or `undefined`. */
  getExitCode(): number | undefined {
    return this.exitCode.get();
  }

  /**
   * Create an OutputContext from global CLI options and config
   */
  static fromGlobalOpts(
    opts: {
      json: boolean;
      quiet: boolean;
      verbose: number;
      color: boolean;
      tips?: boolean;
      tty?: boolean;
    },
    config?: { tips?: boolean },
    streams?: { stdout?: OutputSink; stderr?: OutputSink }
  ): OutputContext {
    // Tips are enabled only if both CLI (--no-tips) and config (tips = false) allow them
    const tips = (opts.tips ?? true) && (config?.tips ?? true);
    // Interactive output is suppressed when --no-tty is set or stdout is not a TTY
    const tty = (opts.tty ?? true) && (process.stdout.isTTY ?? false);
    return new OutputContext({
      mode: opts.json ? 'json' : 'text',
      quiet: opts.quiet,
      verbose: opts.verbose,
      color: opts.color,
      tips,
      tty,
      stdout: streams?.stdout,
      stderr: streams?.stderr,
    });
  }

  /**
   * Whether we're in JSON mode
   */
  get isJson(): boolean {
    return this.mode === 'json';
  }

  /**
   * Whether we're in text mode
   */
  get isText(): boolean {
    return this.mode === 'text';
  }

  /**
   * Whether output should be suppressed (quiet mode, but not JSON)
   */
  get isQuiet(): boolean {
    return this.quiet && !this.isJson;
  }

  /**
   * Whether verbose output is enabled
   */
  get isVerbose(): boolean {
    return this.verbose > 0;
  }

  /**
   * Whether interactive TTY output (spinners, progress bars) is enabled.
   * False when --no-tty is passed or stdout is not a TTY.
   */
  get isTty(): boolean {
    return this.tty;
  }

  /**
   * Get the verbosity level (0-3)
   */
  get verbosity(): number {
    return this.verbose;
  }

  /**
   * Print a message to stdout (text mode only, respects quiet)
   */
  print(message: string): void {
    if (this.isText && !this.quiet) {
      this.out.write(message + '\n');
    }
  }

  /**
   * Print an empty line (text mode only, respects quiet)
   */
  newline(): void {
    if (this.isText && !this.quiet) {
      this.out.write('\n');
    }
  }

  /**
   * Print a message only in verbose mode
   */
  verbose1(message: string): void {
    if (this.isText && !this.quiet && this.verbose >= 1) {
      this.out.write(message + '\n');
    }
  }

  /**
   * Print a message only at verbosity level 2+
   */
  verbose2(message: string): void {
    if (this.isText && !this.quiet && this.verbose >= 2) {
      this.out.write(message + '\n');
    }
  }

  /**
   * Print an error message (both modes - uses stderr)
   */
  error(message: string): void {
    if (this.isText) {
      this.err.write(message + '\n');
    }
    // In JSON mode, errors should be included in the JSON output instead
  }

  /**
   * Print a warning message (text mode only, uses stderr)
   */
  warn(message: string): void {
    if (this.isText && !this.quiet) {
      this.err.write(`Warning: ${message}\n`);
    }
  }

  /**
   * Print a success message (text mode only)
   */
  success(message: string): void {
    if (this.isText && !this.quiet) {
      this.out.write(message + '\n');
    }
  }

  /**
   * Emit a transient progress line.
   *
   * Behaviour by mode:
   *  - JSON or quiet → no-op. Structured output never carries progress;
   *    callers expecting status should consume the final JSON envelope.
   *  - Text + TTY → `\r${line}` to the stderr sink, overwriting the
   *    previous progress line. The caller is responsible for the line's
   *    leading whitespace / indent — the helper does not prefix.
   *  - Text + non-TTY → `${line}\n` to stderr. Cleared lines become
   *    history; CI logs and `tee`d pipes still see the progress trail
   *    instead of a jumble of `\r` codes.
   *
   * Tracks the line width so a subsequent `clearProgress()` knows how
   * many cells to blank out.
   */
  progress(line: string): void {
    if (!this.isText || this.quiet) return;
    if (this.tty) {
      this.err.write('\r' + line);
      this.lastProgressWidth = Math.max(this.lastProgressWidth, line.length);
    } else {
      this.err.write(line + '\n');
    }
  }

  /**
   * Clear the current progress line (if any).
   *
   * TTY text mode only — non-TTY progress writes are committed to the
   * scroll buffer with trailing newlines and nothing to clear. Idempotent:
   * safe to call when no progress line is active or after a previous
   * clear.
   */
  clearProgress(): void {
    if (!this.isText || this.quiet || !this.tty) return;
    if (this.lastProgressWidth === 0) return;
    this.err.write('\r' + ' '.repeat(this.lastProgressWidth) + '\r');
    this.lastProgressWidth = 0;
  }

  /**
   * Whether tips are enabled
   */
  get tipsEnabled(): boolean {
    return this.showTips;
  }

  /**
   * Print a tip message (text mode only, respects quiet and --no-tips)
   */
  tip(message: string, url?: string): void {
    if (this.isText && !this.quiet && this.showTips) {
      this.out.write(`Tip: ${message}\n`);
      if (url) {
        this.out.write(`  See: ${url}\n`);
      }
    }
  }

  /**
   * Collect and print tips for a given context.
   * Prints nothing if no tips match or tips are disabled.
   * Adds a leading newline before tips.
   */
  printTips(context: TipContext): void {
    if (!this.showTips || this.quiet || this.isJson) return;
    const tips = collectTips(context);
    const lines = formatTips(tips);
    if (lines.length > 0) {
      this.newline();
      for (const line of lines) {
        this.print(line);
      }
    }
  }

  /**
   * Output JSON data (JSON mode only)
   *
   * This is the primary way to output structured data in JSON mode.
   * In text mode, this is a no-op - use print() for text output.
   */
  json<T>(data: T): void {
    if (this.isJson) {
      this.out.write(JSON.stringify(data, null, 2) + '\n');
    }
  }

  /**
   * Output final result - works for both modes
   *
   * In JSON mode, outputs the data as JSON.
   * In text mode, calls the provided text formatter function.
   */
  result<T>(data: T, textFormatter?: (data: T) => void): void {
    if (this.isJson) {
      this.out.write(JSON.stringify(data, null, 2) + '\n');
    } else if (textFormatter && !this.quiet) {
      textFormatter(data);
    }
  }

  /**
   * Create a spinner for showing progress.
   * Returns a no-op spinner in JSON mode, quiet mode, or non-TTY mode.
   */
  spinner(message: string): SpinnerControl {
    if (this.isJson || this.quiet || !this.tty) {
      return nullSpinner;
    }

    const spinner = new Spinner();
    spinner.start(message);
    return spinner;
  }

  /**
   * Output a table (text mode) or array of objects (JSON mode)
   */
  table<T extends Record<string, unknown>>(
    rows: T[],
    options?: TableOptions & { jsonKey?: keyof T }
  ): void {
    if (this.isJson) {
      this.out.write(JSON.stringify(rows, null, 2) + '\n');
      return;
    }

    if (this.quiet || rows.length === 0) {
      return;
    }

    // Simple table output - more sophisticated formatting can be added
    const headers = options?.headers ?? Object.keys(rows[0] ?? {});
    const widths: number[] =
      options?.widths ??
      headers.map((h) => {
        let max = h.length;
        for (const row of rows) {
          const val = String(row[h] ?? '');
          max = Math.max(max, val.length);
        }
        return Math.min(max, 40); // Cap at 40 chars
      });

    // Header
    const headerLine = headers.map((h, i) => h.padEnd(widths[i] ?? 10)).join('  ');
    this.out.write(headerLine + '\n');
    this.out.write('\u2500'.repeat(headerLine.length) + '\n');

    // Rows
    for (const row of rows) {
      const line = headers
        .map((h, i) => {
          const val = String(row[h] ?? '');
          const width = widths[i] ?? 10;
          return val.length > width ? val.slice(0, width - 3) + '...' : val.padEnd(width);
        })
        .join('  ');
      this.out.write(line + '\n');
    }
  }

  /**
   * Write raw output to stderr (bypasses mode checks)
   * Useful for progress bars that need direct control
   */
  raw(content: string): void {
    if (!this.isJson && !this.quiet && this.tty) {
      this.err.write(content);
    }
  }

  /**
   * Write pre-formatted output directly to stdout (no mode checks).
   * Use for commands that handle their own formatting (e.g., --format table|json|csv).
   */
  stdout(content: string): void {
    this.out.write(content + '\n');
  }

  /**
   * Clear the current line (for progress updates)
   */
  clearLine(): void {
    if (!this.isJson && !this.quiet && this.tty) {
      this.err.write('\x1b[2K\r');
    }
  }
}
