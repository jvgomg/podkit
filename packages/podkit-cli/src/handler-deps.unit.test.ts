/**
 * Unit tests for `loadCoreOrFail` — the deps-aware core-loader helper.
 */

import { describe, it, expect } from 'bun:test';
import { loadCoreOrFail } from './handler-deps.js';
import { CliError } from './errors.js';

describe('loadCoreOrFail', () => {
  it('returns the module produced by deps.loadCore', async () => {
    const stub = { __stub: true } as unknown as typeof import('@podkit/core');
    const result = await loadCoreOrFail({ loadCore: async () => stub }, 'X_CORE_LOAD_FAILED');
    expect(result).toBe(stub);
  });

  it('falls back to the real dynamic import when deps.loadCore is omitted', async () => {
    const real = await loadCoreOrFail({}, 'X_CORE_LOAD_FAILED');
    // We don't assert on the contents of `@podkit/core` here — only that the
    // helper completes without throwing when no stub is provided.
    expect(typeof real).toBe('object');
  });

  it('throws a CliError with the supplied code when loadCore rejects', async () => {
    let caught: unknown;
    try {
      await loadCoreOrFail(
        {
          loadCore: async () => {
            throw new Error('boom');
          },
        },
        'X_CORE_LOAD_FAILED'
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CliError);
    const cli = caught as CliError;
    expect(cli.code).toBe('X_CORE_LOAD_FAILED');
    expect(cli.message).toBe('boom');
  });

  it('falls back to a generic message when the rejection value is not an Error', async () => {
    let caught: unknown;
    try {
      await loadCoreOrFail(
        {
          loadCore: () => Promise.reject('not-an-error-instance'),
        },
        'X_CORE_LOAD_FAILED'
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CliError);
    expect((caught as CliError).message).toBe('Failed to load podkit-core');
  });
});
