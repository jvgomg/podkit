/**
 * Unbundled-runtime behaviour of the dev hooks surface.
 *
 * The two production-cleanliness guarantees (bundled artefact strips both
 * the hook body AND every reference to `__PODKIT_DEV_HOOKS__` /
 * `PODKIT_DEV_PAUSE_KEY`) live in
 * `packages/podkit-cli/src/dev-hooks-strip.test.ts`. This file pins the
 * unbundled side: when the compile-time symbol is undefined (the shape of
 * a `bun test` source-import), both `devPause` and `devPauseSync` must
 * short-circuit to a true no-op via the inline `typeof` guard. If the
 * guard were ever inverted, this test would hang.
 */

import { describe, expect, it } from 'bun:test';

import { devPause, devPauseSync } from './hooks.js';

describe('dev hooks (unbundled runtime)', () => {
  // The unbundled runtime never defines `__PODKIT_DEV_HOOKS__`, so the
  // `typeof` short-circuit in hooks.ts collapses both arrows to no-ops
  // regardless of env. If the guard regresses (e.g. someone hoists it to
  // a `const` outside the ternary), the active branch would fire here
  // and these tests would never resolve — the suite would time out.

  it('devPauseSync is a no-op when the build flag is undefined', () => {
    // No env var set, no build flag → must return synchronously without
    // touching the futex.
    devPauseSync('any-key');
    expect(true).toBe(true); // reached → no-op confirmed
  });

  it('devPauseSync is still a no-op even when the env var matches', () => {
    // Defensive: the active branch only fires under the build flag. The
    // env var alone must NOT activate the futex, otherwise `bun test`
    // runs that happen to set PODKIT_DEV_PAUSE_KEY would deadlock.
    const prev = process.env.PODKIT_DEV_PAUSE_KEY;
    process.env.PODKIT_DEV_PAUSE_KEY = 'any-key';
    try {
      devPauseSync('any-key');
      expect(true).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.PODKIT_DEV_PAUSE_KEY;
      else process.env.PODKIT_DEV_PAUSE_KEY = prev;
    }
  });

  it('devPause resolves immediately when the build flag is undefined', async () => {
    // Race the no-op promise against a short timer. The no-op must win;
    // a timer win means the hook is blocking, which is the regression
    // we want to surface.
    let timedOut = false;
    const timer = new Promise<void>((resolve) =>
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, 200)
    );
    await Promise.race([devPause('any-key'), timer]);
    expect(timedOut).toBe(false);
  });

  it('devPause is still a no-op when the env var matches', async () => {
    const prev = process.env.PODKIT_DEV_PAUSE_KEY;
    process.env.PODKIT_DEV_PAUSE_KEY = 'any-key';
    try {
      let timedOut = false;
      const timer = new Promise<void>((resolve) =>
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, 200)
      );
      await Promise.race([devPause('any-key'), timer]);
      expect(timedOut).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.PODKIT_DEV_PAUSE_KEY;
      else process.env.PODKIT_DEV_PAUSE_KEY = prev;
    }
  });
});
