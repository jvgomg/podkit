/**
 * Shared helpers for command-handler dependency injection.
 *
 * Per-handler `*Deps` interfaces extend `CoreLoaderDeps` to opt into the
 * `loadCore` seam — tests pass a stub that returns a fake `@podkit/core`
 * module, production calls the real dynamic import.
 *
 * The throw-style helper `loadCoreOrFail` centralises the boilerplate that
 * was previously duplicated at every CLI entry point. It is intentionally
 * NOT used by callers that return `{ error }` instead of throwing
 * (e.g. doctor.ts:resolveDevice) — those keep their inline try/catch.
 */

import { CliError } from './errors.js';

/**
 * Mixed in by every handler `*Deps` interface. Production omits this field
 * and the default (real `import('@podkit/core')`) is used.
 */
export interface CoreLoaderDeps {
  loadCore?: () => Promise<typeof import('@podkit/core')>;
}

/**
 * Resolve the `@podkit/core` module via `deps.loadCore` or the real dynamic
 * import, throwing a `CliError` with the supplied `code` on failure.
 *
 * The `printText` block matches the previous inline pattern: a one-line
 * user-facing error plus a verbose-only detail line.
 */
export async function loadCoreOrFail(
  deps: CoreLoaderDeps,
  code: string
): Promise<typeof import('@podkit/core')> {
  const loadCore = deps.loadCore ?? (() => import('@podkit/core'));
  try {
    return await loadCore();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load podkit-core';
    throw new CliError({
      message,
      code,
      printText: (o) => {
        o.error('Failed to load podkit-core.');
        o.verbose1(`Details: ${message}`);
      },
    });
  }
}
