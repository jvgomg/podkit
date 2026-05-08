/**
 * CLI errors
 *
 * Runners throw `CliError` for user-facing failures. The action wrapper
 * (`runAction`) catches them and translates into structured output + exit code.
 *
 * Tests assert on the thrown error directly, never on `process.exitCode`.
 */

import type { OutputContext } from './output/index.js';

export interface CliErrorPayload {
  message: string;
  /** Machine-readable error tag, e.g. 'PATH_REQUIRED'. */
  code?: string;
  /** Process exit code. Defaults to 1. */
  exitCode?: number;
  /** Extra fields merged into the JSON-mode output. */
  details?: Record<string, unknown>;
}

export class CliError extends Error {
  readonly code?: string;
  readonly exitCode: number;
  readonly details?: Record<string, unknown>;

  constructor(payload: CliErrorPayload) {
    super(payload.message);
    this.name = 'CliError';
    this.code = payload.code;
    this.exitCode = payload.exitCode ?? 1;
    this.details = payload.details;
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
      const payload: Record<string, unknown> = {
        success: false,
        error: err.message,
        ...err.details,
      };
      if (err.code !== undefined) {
        payload.code = err.code;
      }
      out.result(payload, () => out.error(err.message));
      process.exitCode = err.exitCode;
      return undefined;
    }
    throw err;
  }
}
