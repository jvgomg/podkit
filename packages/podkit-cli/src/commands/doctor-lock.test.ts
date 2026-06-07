/**
 * Tests for `withDeviceWriteLock` — the per-device sync-lock wrapper
 * shared by every doctor repair path that mutates on-device state
 * (mass-storage manifest writes, iPod iTunesDB writes via libgpod,
 * SysInfo / SysInfoExtended writes).
 *
 * Pins:
 * - The wrapper holds the lock for the duration of `fn` and releases on
 *   normal completion + on throw (`finally`).
 * - A `LockHeldError` from the inner `acquireLock` becomes a `CliError`
 *   with code `LOCK_HELD` and exit code 4 — matching `podkit sync` so
 *   the daemon (and any caller) can branch on a single contention exit
 *   code regardless of which writer lost the race.
 * - A `LockContestedError` follows the same translation path.
 * - The lock is released by `fn` throwing, so repair failures don't pin
 *   the lock for the next sync.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock, resolveSyncLockPath, type LockHandle } from '@podkit/core';
import { withDeviceWriteLock, DoctorErrorCodes, DOCTOR_LOCK_HELD_EXIT_CODE } from './doctor.js';
import { CliError } from '../errors.js';

async function withTempMount<T>(fn: (mount: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'podkit-doctor-lock-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Pull the real `@podkit/core` for the wrapper to use.
const core = await import('@podkit/core');

describe('withDeviceWriteLock — happy path', () => {
  it('mass-storage: acquires, runs fn, releases (lock file gone after)', async () => {
    await withTempMount(async (mount) => {
      let ran = false;
      await withDeviceWriteLock(mount, /* isIpodDevice */ false, core, async () => {
        ran = true;
        // While inside fn, the lock file exists.
        const lockPath = await resolveSyncLockPath(mount, false);
        expect(existsSync(lockPath)).toBe(true);
      });
      expect(ran).toBe(true);
      const lockPath = await resolveSyncLockPath(mount, false);
      expect(existsSync(lockPath)).toBe(false);
    });
  });

  it('iPod: acquires under iPod_Control/, runs fn, releases', async () => {
    await withTempMount(async (mount) => {
      // iPod resolver does not mkdir — caller (libgpod / device init)
      // owns iPod_Control. Pre-create so the lock open succeeds.
      await import('node:fs/promises').then((m) =>
        m.mkdir(join(mount, 'iPod_Control'), { recursive: true })
      );
      let ran = false;
      await withDeviceWriteLock(mount, /* isIpodDevice */ true, core, async () => {
        ran = true;
        const lockPath = await resolveSyncLockPath(mount, true);
        expect(existsSync(lockPath)).toBe(true);
      });
      expect(ran).toBe(true);
      const lockPath = await resolveSyncLockPath(mount, true);
      expect(existsSync(lockPath)).toBe(false);
    });
  });

  it('releases the lock when fn throws', async () => {
    await withTempMount(async (mount) => {
      let caught: unknown;
      try {
        await withDeviceWriteLock(mount, false, core, async () => {
          throw new Error('repair blew up');
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toBe('repair blew up');
      const lockPath = await resolveSyncLockPath(mount, false);
      expect(existsSync(lockPath)).toBe(false);
    });
  });

  it('returns the value fn produced', async () => {
    await withTempMount(async (mount) => {
      const result = await withDeviceWriteLock(mount, false, core, async () => 'ok');
      expect(result).toBe('ok');
    });
  });
});

describe('withDeviceWriteLock — contention (LOCK_HELD)', () => {
  it('mass-storage: LockHeldError → CliError(LOCK_HELD, exit 4) with holder pid', async () => {
    await withTempMount(async (mount) => {
      // Pre-acquire from this process to simulate a concurrent sync.
      // We need a different "holder identity" so isAlive sees a live
      // process and acquireLock throws LockHeldError. Easiest path:
      // pre-write the lock with our own pid + start time so a second
      // attempt from the same process sees a live holder.
      const lockPath = await resolveSyncLockPath(mount, false);
      const held = await acquireLock(lockPath);
      try {
        let caught: unknown;
        try {
          await withDeviceWriteLock(mount, false, core, async () => {
            // Should never reach here — the lock is held.
            throw new Error('repair should not have started');
          });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(CliError);
        const cli = caught as CliError;
        expect(cli.code).toBe(DoctorErrorCodes.LOCK_HELD);
        expect(cli.exitCode).toBe(DOCTOR_LOCK_HELD_EXIT_CODE);
        expect(cli.exitCode).toBe(4);
        expect(cli.message).toContain(mount);
        expect(cli.details?.holderPid).toBe(process.pid);
        expect(cli.details?.lockPath).toBe(lockPath);
      } finally {
        await held.release();
      }
    });
  });

  it('iPod: LockHeldError → CliError(LOCK_HELD, exit 4)', async () => {
    await withTempMount(async (mount) => {
      await import('node:fs/promises').then((m) =>
        m.mkdir(join(mount, 'iPod_Control'), { recursive: true })
      );
      const lockPath = await resolveSyncLockPath(mount, true);
      const held = await acquireLock(lockPath);
      try {
        let caught: unknown;
        try {
          await withDeviceWriteLock(mount, true, core, async () => {
            throw new Error('repair should not have started');
          });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(CliError);
        const cli = caught as CliError;
        expect(cli.code).toBe(DoctorErrorCodes.LOCK_HELD);
        expect(cli.exitCode).toBe(4);
        expect(cli.details?.lockPath).toBe(lockPath);
      } finally {
        await held.release();
      }
    });
  });

  it('parallel doctor + doctor: exactly one runs fn; the other gets LOCK_HELD', async () => {
    // In-process race against the same mount. With the wrapper's
    // acquire-then-fn pattern, exactly one wins; the other sees the
    // winner's lock and translates LockHeldError into the CLI's
    // LOCK_HELD shape. Mirrors what two concurrent
    // `podkit doctor --repair orphan-files` invocations against the
    // same device would see in production.
    await withTempMount(async (mount) => {
      let ran = 0;
      const work = async (): Promise<string> => {
        return withDeviceWriteLock(mount, false, core, async () => {
          ran += 1;
          // Hold long enough that any concurrent attempt actually
          // probes our live lock.
          await new Promise((r) => setTimeout(r, 50));
          return 'done';
        });
      };
      const results = await Promise.allSettled([work(), work()]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      const cli = (rejected[0] as PromiseRejectedResult).reason;
      expect(cli).toBeInstanceOf(CliError);
      expect((cli as CliError).code).toBe(DoctorErrorCodes.LOCK_HELD);
      expect((cli as CliError).exitCode).toBe(4);
      // Only one body actually ran.
      expect(ran).toBe(1);
      // Winner released cleanly — no lock file lingering.
      const lockPath = await resolveSyncLockPath(mount, false);
      expect(existsSync(lockPath)).toBe(false);
    });
  });

  it('parallel sync + doctor: exactly one runs; the other gets LOCK_HELD', async () => {
    // "sync" = pre-acquired lock from the same process. "doctor" =
    // withDeviceWriteLock call that arrives while sync is holding.
    // Same primitive both sides, so the contention guarantee is the
    // same as doctor + doctor; this test exists to document the
    // sync-vs-doctor scenario explicitly.
    await withTempMount(async (mount) => {
      const lockPath = await resolveSyncLockPath(mount, false);
      let syncHandle: LockHandle | null = null;
      try {
        // Sync wins the race first by pre-acquiring.
        syncHandle = await acquireLock(lockPath);
        let caught: unknown;
        let doctorRan = false;
        try {
          await withDeviceWriteLock(mount, false, core, async () => {
            doctorRan = true;
          });
        } catch (err) {
          caught = err;
        }
        expect(doctorRan).toBe(false);
        expect(caught).toBeInstanceOf(CliError);
        expect((caught as CliError).code).toBe(DoctorErrorCodes.LOCK_HELD);
        expect((caught as CliError).exitCode).toBe(4);
      } finally {
        await syncHandle?.release();
      }
    });
  });
});
