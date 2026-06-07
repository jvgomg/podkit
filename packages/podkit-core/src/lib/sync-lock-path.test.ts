/**
 * Tests for the per-device sync-lock path resolver + the cross-process
 * contention guarantee it underwrites.
 *
 * The resolver itself is tiny — the tests pin the iPod-vs-mass-storage
 * layout and the `.podkit/` mkdir behaviour. The cross-process tests
 * spawn competing `bun -e` scripts that each call
 * `resolveSyncLockPath` + `acquireLock` against the same fixture mount
 * point. These mirror the production race between `podkit sync` and
 * `podkit doctor --repair orphan-files` (or two concurrent doctors)
 * without bootstrapping the full CLI: every other layer of the contention
 * path delegates to these two primitives, so a lock-level pin is
 * equivalent for our purposes.
 */

import { describe, it, expect } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSyncLockPath } from './sync-lock-path.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function withTempMount<T>(fn: (mount: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'podkit-lock-path-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Result of a competing-process lock attempt: the child either acquired
 * the lock and held it for the configured hold duration, or it failed
 * with `LockHeldError` / `LockContestedError`.
 */
interface SpawnResult {
  exitCode: number;
  /** `'acquired'` when the child held the lock to completion, `'held'`
   * when it saw LockHeldError, `'contested'` when LockContestedError. */
  outcome: 'acquired' | 'held' | 'contested' | 'other';
  stderr: string;
}

/**
 * Spawn a child `bun -e` script that imports `@podkit/core`, calls
 * `resolveSyncLockPath` + `acquireLock` against `mountPath`, holds for
 * `holdMs` ms, then releases.
 *
 * On `LockHeldError` / `LockContestedError` the child prints a tag to
 * stderr + exits 4 (matching the CLI's `LOCK_HELD` exit code). On any
 * other error it prints a tag + exits 5 so the parent can tell the
 * difference between "lock held" and "something else broke" — which
 * matters because the race-condition assertions must not silently pass
 * when both children explode for unrelated reasons.
 */
function spawnLockChild(
  mountPath: string,
  isIpod: boolean,
  holdMs: number,
  acquireDelayMs = 0
): Promise<SpawnResult> {
  // Resolve the source location of the core package so the child can
  // import the same code under test (not a stale dist build).
  const corePath = new URL('../index.ts', import.meta.url).pathname;
  const script = `
    const start = Date.now();
    const { resolveSyncLockPath, acquireLock, LockHeldError, LockContestedError } = await import(${JSON.stringify(corePath)});
    const mount = ${JSON.stringify(mountPath)};
    const isIpod = ${JSON.stringify(isIpod)};
    const holdMs = ${holdMs};
    const acquireDelayMs = ${acquireDelayMs};
    if (acquireDelayMs > 0) await new Promise((r) => setTimeout(r, acquireDelayMs));
    try {
      const path = await resolveSyncLockPath(mount, isIpod);
      const handle = await acquireLock(path);
      process.stderr.write('TAG:acquired\\n');
      await new Promise((r) => setTimeout(r, holdMs));
      await handle.release();
      process.exit(0);
    } catch (err) {
      if (err instanceof LockHeldError) {
        process.stderr.write('TAG:held\\n');
        process.exit(4);
      }
      if (err instanceof LockContestedError) {
        process.stderr.write('TAG:contested\\n');
        process.exit(4);
      }
      process.stderr.write('TAG:other ' + (err && err.message ? err.message : String(err)) + '\\n');
      process.exit(5);
    }
  `;
  return new Promise((resolve) => {
    const child = spawn('bun', ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      let outcome: SpawnResult['outcome'] = 'other';
      if (stderr.includes('TAG:acquired')) outcome = 'acquired';
      else if (stderr.includes('TAG:held')) outcome = 'held';
      else if (stderr.includes('TAG:contested')) outcome = 'contested';
      resolve({ exitCode: code ?? -1, outcome, stderr });
    });
  });
}

// ── resolveSyncLockPath: layout ──────────────────────────────────────────────

describe('resolveSyncLockPath', () => {
  it('iPod layout: <mountPoint>/iPod_Control/.podkit-sync.lock; no mkdir', async () => {
    await withTempMount(async (mount) => {
      const path = await resolveSyncLockPath(mount, /* isIpodDevice */ true);
      expect(path).toBe(join(mount, 'iPod_Control', '.podkit-sync.lock'));
      // iPod layout does NOT pre-create iPod_Control — the resolver is
      // path-only; that dir is owned by libgpod / device init.
      expect(existsSync(join(mount, 'iPod_Control'))).toBe(false);
    });
  });

  it('mass-storage layout: <mountPoint>/.podkit/sync.lock; creates .podkit if absent', async () => {
    await withTempMount(async (mount) => {
      const path = await resolveSyncLockPath(mount, /* isIpodDevice */ false);
      expect(path).toBe(join(mount, '.podkit', 'sync.lock'));
      const podkitDir = join(mount, '.podkit');
      expect(existsSync(podkitDir)).toBe(true);
      const s = await stat(podkitDir);
      expect(s.isDirectory()).toBe(true);
    });
  });

  it('mass-storage layout: existing .podkit dir is not re-created or modified', async () => {
    await withTempMount(async (mount) => {
      // Call twice — second call must not fail and must not blow away the dir.
      await resolveSyncLockPath(mount, false);
      await resolveSyncLockPath(mount, false);
      const podkitDir = join(mount, '.podkit');
      expect(existsSync(podkitDir)).toBe(true);
    });
  });
});

// ── Cross-process contention pins ────────────────────────────────────────────
//
// Each test spawns 2 child processes that race for the same mount-point
// lock. The exit-code contract mirrors the CLI's: `0` = held + released
// cleanly; `4` = LockHeldError / LockContestedError (the CLI's `LOCK_HELD`
// exit code). One must win, the other must report `held`.

describe('cross-process per-device lock', () => {
  it('mass-storage: one process acquires; the other exits LOCK_HELD (exit 4)', async () => {
    await withTempMount(async (mount) => {
      const [a, b] = await Promise.all([
        spawnLockChild(mount, /* isIpod */ false, /* holdMs */ 500),
        // Start the second child slightly later to make the race
        // deterministic — the first child must have written its lock
        // file before the second probes. Without a small offset the
        // second child can win, which is still a valid outcome but
        // makes the test order-of-spawn-dependent. The contention
        // contract holds either way (exactly one wins) so we assert
        // on "one acquired, one held" rather than which one was
        // first.
        spawnLockChild(mount, false, 0, /* acquireDelayMs */ 100),
      ]);
      const results = [a, b];
      const acquired = results.filter((r) => r.outcome === 'acquired');
      const held = results.filter((r) => r.outcome === 'held' || r.outcome === 'contested');
      const failures = results.filter((r) => r.outcome === 'other');
      expect(failures.map((r) => r.stderr)).toEqual([]);
      expect(acquired).toHaveLength(1);
      expect(held).toHaveLength(1);
      expect(acquired[0]!.exitCode).toBe(0);
      expect(held[0]!.exitCode).toBe(4);
    });
  }, 30_000);

  it('iPod: one process acquires; the other exits LOCK_HELD (exit 4)', async () => {
    await withTempMount(async (mount) => {
      // iPod layout requires iPod_Control/ to exist for the lock write to
      // succeed (the resolver does not mkdir for iPod). Create it so the
      // test exercises the contention path, not the "lock dir missing"
      // failure mode.
      await import('node:fs/promises').then((m) =>
        m.mkdir(join(mount, 'iPod_Control'), { recursive: true })
      );
      const [a, b] = await Promise.all([
        spawnLockChild(mount, /* isIpod */ true, /* holdMs */ 500),
        spawnLockChild(mount, true, 0, /* acquireDelayMs */ 100),
      ]);
      const results = [a, b];
      const acquired = results.filter((r) => r.outcome === 'acquired');
      const held = results.filter((r) => r.outcome === 'held' || r.outcome === 'contested');
      const failures = results.filter((r) => r.outcome === 'other');
      expect(failures.map((r) => r.stderr)).toEqual([]);
      expect(acquired).toHaveLength(1);
      expect(held).toHaveLength(1);
      expect(acquired[0]!.exitCode).toBe(0);
      expect(held[0]!.exitCode).toBe(4);
    });
  }, 30_000);

  it('mass-storage: doctor-equivalent contends with sync-equivalent (both call resolveSyncLockPath)', async () => {
    // Both surfaces use the same `resolveSyncLockPath` + `acquireLock`,
    // so this is the same physical race as the previous case — the
    // distinction is purely which CLI command spawns each child in
    // production. Re-running it under a different name documents the
    // sync-vs-doctor scenario explicitly in the test list.
    await withTempMount(async (mount) => {
      const [syncish, doctorish] = await Promise.all([
        spawnLockChild(mount, false, 500), // long-held "sync"
        spawnLockChild(mount, false, 0, /* acquireDelayMs */ 100), // "doctor --repair orphan-files"
      ]);
      const results = [syncish, doctorish];
      const acquired = results.filter((r) => r.outcome === 'acquired');
      const held = results.filter((r) => r.outcome === 'held' || r.outcome === 'contested');
      const failures = results.filter((r) => r.outcome === 'other');
      expect(failures.map((r) => r.stderr)).toEqual([]);
      expect(acquired).toHaveLength(1);
      expect(held).toHaveLength(1);
      expect(held[0]!.exitCode).toBe(4);
    });
  }, 30_000);
});
