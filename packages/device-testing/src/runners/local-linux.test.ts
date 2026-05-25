/**
 * Unit tests for the local-linux runner.
 *
 * Most of `local-linux` is a thin wrapper around `child_process.spawn` and is
 * already exercised by the higher-level native tests. The targeted coverage
 * here is the new `applyState()` safety guard: the runner must NOT shell out
 * to `apply-state.sh` unless `PODKIT_DEVTEST_LOCAL_MUTATE=1` is set. Mutating
 * a developer's host by accident would silently break their environment.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { healthy, noFfmpeg } from '../system-states/index.js';
import { localLinuxRunner, LOCAL_MUTATE_ENV } from './local-linux.js';

describe('local-linux runner: id + isAvailable', () => {
  it('identifies as "local-linux"', () => {
    expect(localLinuxRunner.id).toBe('local-linux');
  });

  it('isAvailable returns true only on linux hosts', async () => {
    const available = await localLinuxRunner.isAvailable();
    expect(available).toBe(process.platform === 'linux');
  });
});

describe('local-linux runner: applyState safety guard', () => {
  let originalMutate: string | undefined;
  let warnSpy: ReturnType<typeof spyOnWarn>;

  beforeEach(() => {
    originalMutate = process.env[LOCAL_MUTATE_ENV];
    delete process.env[LOCAL_MUTATE_ENV];
    warnSpy = spyOnWarn();
  });

  afterEach(() => {
    if (originalMutate === undefined) delete process.env[LOCAL_MUTATE_ENV];
    else process.env[LOCAL_MUTATE_ENV] = originalMutate;
    warnSpy.restore();
  });

  it('is a no-op without the env var (logs a warning, does not throw)', async () => {
    // Even when called for a destructive state (no-ffmpeg removes ffmpeg!),
    // without the opt-in we must NOT mutate the host.
    await localLinuxRunner.applyState(noFfmpeg);

    expect(warnSpy.calls.length).toBeGreaterThan(0);
    const allWarnings = warnSpy.calls.map((c) => c.join(' ')).join('\n');
    expect(allWarnings).toMatch(/PODKIT_DEVTEST_LOCAL_MUTATE=1/);
    expect(allWarnings).toMatch(/skipping applyState\('no-ffmpeg'\)/);
  });

  it('logs the state id in the warning so the user knows what was skipped', async () => {
    await localLinuxRunner.applyState(healthy);
    const allWarnings = warnSpy.calls.map((c) => c.join(' ')).join('\n');
    expect(allWarnings).toMatch(/healthy/);
  });

  // We deliberately do NOT test the opt-in branch end-to-end: it shells out
  // to a real script with sudo. The branch's existence is verified by reading
  // the source (and by the snapshot-based path in lima-test-vm-state, which
  // shares the same `apply-state.sh` contract).
});

// ---------------------------------------------------------------------------
// Tiny console.warn spy — avoids pulling in a mocking framework.
// ---------------------------------------------------------------------------

function spyOnWarn(): {
  calls: unknown[][];
  restore: () => void;
} {
  const calls: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    calls.push(args);
  };
  return {
    calls,
    restore: () => {
      console.warn = original;
    },
  };
}
