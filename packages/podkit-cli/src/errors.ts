/**
 * CLI errors
 *
 * Runners throw `CliError` for user-facing failures. The action wrapper
 * (`runAction`) catches them and translates into structured output + exit code.
 *
 * Tests assert on the thrown error directly, never on `process.exitCode`.
 */

import type { OutputContext } from './output/index.js';

/**
 * Canonical JSON shape emitted by `runAction` when a `CliError` is thrown.
 * Every CLI command's failure JSON conforms to this shape (per ADR-015).
 *
 * Per-command `*Output` types are discriminated unions of their success
 * variant `| CliErrorOutput`, so JSON consumers branch on `success`.
 *
 * `details` is nested rather than spread to keep the canonical fields
 * (`success`, `error`, `code`) collision-free regardless of payload contents.
 */
export interface CliErrorOutput {
  success: false;
  error: string;
  code: string;
  /** Command-specific extras. Empty record when no details were passed. */
  details: Record<string, unknown>;
}

export interface CliErrorPayload {
  message: string;
  /**
   * Machine-readable error tag, e.g. 'PATH_REQUIRED'. Required so JSON
   * consumers can branch on a stable identifier without parsing English.
   */
  code: string;
  /** Process exit code. Defaults to 1. */
  exitCode?: number;
  /**
   * Command-specific extras. Emitted as a nested `details` object in the
   * JSON-mode output — never spread at the top level — so payload contents
   * cannot collide with the canonical fields (`success`, `error`, `code`).
   */
  details?: Record<string, unknown>;
  /**
   * Custom text-mode renderer. Called instead of the default
   * `out.error(message)` when the CLI is not in JSON mode. Use for
   * multi-line guidance, tips, or formatting.
   */
  printText?: (out: OutputContext) => void;
}

export class CliError extends Error {
  readonly code: string;
  readonly exitCode: number;
  readonly details?: Record<string, unknown>;
  readonly printText?: (out: OutputContext) => void;

  constructor(payload: CliErrorPayload) {
    super(payload.message);
    this.name = 'CliError';
    this.code = payload.code;
    this.exitCode = payload.exitCode ?? 1;
    this.details = payload.details;
    this.printText = payload.printText;
  }
}

/**
 * Wraps a runner so that thrown `CliError`s become structured output + exit code.
 *
 * Non-`CliError` exceptions propagate — they're bugs, and the calling
 * Commander layer / test runner should surface the stack trace.
 */
export async function runAction<T>(
  out: OutputContext,
  fn: () => Promise<T>
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CliError) {
      const payload: CliErrorOutput = {
        success: false,
        error: err.message,
        code: err.code,
        details: err.details ?? {},
      };
      out.result(payload, () => {
        if (err.printText) {
          err.printText(out);
        } else {
          out.error(err.message);
        }
      });
      out.setExitCode(err.exitCode);
      return undefined;
    }
    throw err;
  }
}
