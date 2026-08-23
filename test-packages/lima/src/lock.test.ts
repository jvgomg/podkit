/**
 * Unit tests for the advisory-lock wrapper's single-process behaviour:
 * withVmLock runs and releases, isVmLocked reflects the held state, and a
 * zero-retry acquire fails fast while the lock is held. The cross-PROCESS
 * mutual-exclusion property is covered by `lock.integration.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  acquireVmLock,
  isVmLocked,
  withVmLock,
  lockRetryBudgetMs,
  DEFAULT_RETRIES,
  DEFAULT_STALE_MS,
} from './lock.js';

let lockDir: string;
const INSTANCE = 'podkit-test-lock';

beforeEach(() => {
  lockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lima-lock-unit-'));
});
afterEach(() => {
  fs.rmSync(lockDir, { recursive: true, force: true });
});

describe('withVmLock', () => {
  it('runs the critical section and releases the lock afterward', async () => {
    const result = await withVmLock(INSTANCE, async () => 'done', { lockDir, staleMs: 5000 });
    expect(result).toBe('done');
    expect(await isVmLocked(INSTANCE, { lockDir, staleMs: 5000 })).toBe(false);
  });

  it('releases the lock even when the critical section throws', async () => {
    await expect(
      withVmLock(
        INSTANCE,
        async () => {
          throw new Error('boom');
        },
        { lockDir, staleMs: 5000 }
      )
    ).rejects.toThrow('boom');
    expect(await isVmLocked(INSTANCE, { lockDir, staleMs: 5000 })).toBe(false);
  });
});

describe('acquireVmLock / isVmLocked', () => {
  it('reports locked while held and unlocked after release', async () => {
    expect(await isVmLocked(INSTANCE, { lockDir, staleMs: 5000 })).toBe(false);
    const release = await acquireVmLock(INSTANCE, { lockDir, staleMs: 5000 });
    expect(await isVmLocked(INSTANCE, { lockDir, staleMs: 5000 })).toBe(true);
    await release();
    expect(await isVmLocked(INSTANCE, { lockDir, staleMs: 5000 })).toBe(false);
  });

  it('fails fast (ELOCKED) on a zero-retry acquire while the lock is held', async () => {
    const release = await acquireVmLock(INSTANCE, { lockDir, staleMs: 5000 });
    try {
      let code = '';
      try {
        await acquireVmLock(INSTANCE, { lockDir, staleMs: 5000, retries: 0 });
      } catch (err) {
        code = (err as { code?: string }).code ?? '';
      }
      expect(code).toBe('ELOCKED');
    } finally {
      await release();
    }
  });
});

describe('contended-acquire wait budget', () => {
  // A contender that gives up while the holder is still legitimately working
  // turns "another task is creating this VM" into a build failure — the exact
  // race the lock exists to prevent. A cold `limactl start` pulls an image and
  // runs cloud-init, which routinely takes five to ten minutes, so the budget
  // has to clear that with room to spare.
  it('waits out a cold VM create rather than giving up mid-create', () => {
    expect(lockRetryBudgetMs()).toBeGreaterThan(15 * 60 * 1000);
  });

  // Guards the specific misconfiguration this budget already regressed on
  // once: proper-lockfile's `factor: 1` holds every delay at `minTimeout`, so
  // `maxTimeout` becomes dead config and the real budget silently collapses to
  // retries x minTimeout. Growth between successive retry counts proves the
  // backoff actually escalates.
  it('escalates its backoff instead of pinning every retry at the floor', () => {
    const linearFloor = DEFAULT_RETRIES * 200;
    expect(lockRetryBudgetMs()).toBeGreaterThan(linearFloor * 5);
  });

  // The long wait is only safe because a dead holder stops refreshing the
  // lockfile mtime and is reclaimed as stale — otherwise a crashed process
  // would wedge every later start for the whole budget.
  it('reclaims a dead holder far sooner than it would wait for a live one', () => {
    expect(DEFAULT_STALE_MS).toBeLessThan(lockRetryBudgetMs() / 10);
  });
});
