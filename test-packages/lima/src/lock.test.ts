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

import { acquireVmLock, isVmLocked, withVmLock } from './lock.js';

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
