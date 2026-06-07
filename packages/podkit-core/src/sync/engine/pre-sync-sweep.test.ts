/**
 * Tests for the pre-sync debris sweep.
 *
 * Three classes of debris flow into PlanPreliminaries:
 * - Mass-storage device debris (.podkit-tmp + adapter-failure)
 * - iPod device debris (.podkit-tmp anywhere under iPod_Control)
 * - Host transcode-tmp directories
 *
 * Phantom manifest entries (mass-storage only) ride alongside debris in
 * the same FS walk.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreSyncSweep, runPreliminariesPreFlight } from './pre-sync-sweep.js';
import { writeOwnership } from '../../lib/pid-file.js';
import type { ContentPaths } from '@podkit/devices-mass-storage';
import type { Warning, WarningSink } from './types.js';

function makeSink(): { sink: WarningSink; warnings: Warning[] } {
  const warnings: Warning[] = [];
  const sink: WarningSink = { emit: (w) => warnings.push(w) };
  return { sink, warnings };
}

const DEFAULT_CONTENT_PATHS: ContentPaths = {
  musicDir: 'Music',
  moviesDir: 'Video/Movies',
  tvShowsDir: 'Video/Shows',
};

async function withTempDirs<T>(fn: (mount: string, hostTmp: string) => Promise<T>): Promise<T> {
  const mount = await mkdtemp(join(tmpdir(), 'preswep-mount-'));
  const hostTmp = await mkdtemp(join(tmpdir(), 'preswep-host-'));
  try {
    return await fn(mount, hostTmp);
  } finally {
    await rm(mount, { recursive: true, force: true });
    await rm(hostTmp, { recursive: true, force: true });
  }
}

async function makeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    const dir = full.substring(0, full.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(full, content);
  }
}

/**
 * Build a `podkit-transcode-<uuid>/` dir with no `.owner` — represents
 * either pre-`.owner` legacy debris or a crash before the ownership
 * write. Both cases must reap.
 */
async function makeAbandonedTranscodeDir(
  hostTmp: string,
  uuid: string,
  files: Record<string, string> = {}
): Promise<void> {
  const dir = join(hostTmp, `podkit-transcode-${uuid}`);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  // No `.owner` written → walker treats as abandoned.
}

/**
 * Build a `podkit-transcode-<uuid>/` dir with a live `.owner` — represents
 * the current process's own active scratch dir. Walker must skip.
 */
async function makeLiveTranscodeDir(
  hostTmp: string,
  uuid: string,
  files: Record<string, string> = {}
): Promise<void> {
  const dir = join(hostTmp, `podkit-transcode-${uuid}`);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  // Use our own PID + start time so the walker's isAlive probe returns true.
  await writeOwnership(join(dir, '.owner'), {
    pid: process.pid,
    startTimeMs: Date.now() - Math.floor(process.uptime() * 1000),
  });
}

/**
 * Build a `podkit-transcode-<uuid>/` dir with a dead `.owner` — represents
 * a SIGKILLed prior process. Walker must reap.
 */
async function makeDeadOwnerTranscodeDir(
  hostTmp: string,
  uuid: string,
  files: Record<string, string> = {}
): Promise<void> {
  const dir = join(hostTmp, `podkit-transcode-${uuid}`);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  // 999_999 is virtually never a live pid on test hosts.
  await writeOwnership(join(dir, '.owner'), {
    pid: 999_999,
    startTimeMs: Date.now() - 60_000,
  });
}

describe('runPreSyncSweep', () => {
  it('returns empty preliminaries when nothing to clean', async () => {
    await withTempDirs(async (mount, hostTmp) => {
      const result = await runPreSyncSweep({
        mountPoint: mount,
        deviceType: 'mass-storage',
        contentPaths: DEFAULT_CONTENT_PATHS,
        tmpDirOverride: hostTmp,
      });
      expect(result.debrisCleanup).toBeUndefined();
      expect(result.phantomPrune).toBeUndefined();
    });
  });

  describe('mass-storage', () => {
    it('surfaces .podkit-tmp debris under content paths', async () => {
      await withTempDirs(async (mount, hostTmp) => {
        await makeFiles(mount, {
          'Music/Artist/Album/01 - Track.m4a': 'good',
          'Music/Artist/Album/02 - Broken.m4a.podkit-tmp': 'half-written',
        });
        const result = await runPreSyncSweep({
          mountPoint: mount,
          deviceType: 'mass-storage',
          contentPaths: DEFAULT_CONTENT_PATHS,
          tmpDirOverride: hostTmp,
        });
        expect(result.debrisCleanup?.paths).toHaveLength(1);
        expect(result.debrisCleanup?.paths[0]).toContain('02 - Broken.m4a.podkit-tmp');
        expect(result.debrisCleanup?.totalBytes).toBe('half-written'.length);
      });
    });

    it('surfaces phantom manifest entries when loadManagedFiles is provided', async () => {
      await withTempDirs(async (mount, hostTmp) => {
        await makeFiles(mount, {
          'Music/Artist/Album/01 - Track.m4a': 'good',
        });
        const result = await runPreSyncSweep({
          mountPoint: mount,
          deviceType: 'mass-storage',
          contentPaths: DEFAULT_CONTENT_PATHS,
          loadManagedFiles: async () =>
            new Set([
              'Music/Artist/Album/01 - Track.m4a',
              'Music/Artist/Album/02 - Missing.m4a',
              'Music/Artist/Album/03 - AlsoMissing.flac',
            ]),
          tmpDirOverride: hostTmp,
        });
        expect(result.phantomPrune?.paths).toEqual(
          expect.arrayContaining([
            'Music/Artist/Album/02 - Missing.m4a',
            'Music/Artist/Album/03 - AlsoMissing.flac',
          ])
        );
      });
    });

    it('tolerates a throwing loadManagedFiles (falls back to debris-only)', async () => {
      // Module-level docstring promises "tolerant of every scanner failure" —
      // pin that a rejected loader becomes a no-phantom-pruning result
      // instead of propagating.
      await withTempDirs(async (mount, hostTmp) => {
        await makeFiles(mount, {
          'Music/half.m4a.podkit-tmp': 'half',
        });
        const result = await runPreSyncSweep({
          mountPoint: mount,
          deviceType: 'mass-storage',
          contentPaths: DEFAULT_CONTENT_PATHS,
          loadManagedFiles: async () => {
            throw new Error('manifest read failed');
          },
          tmpDirOverride: hostTmp,
        });
        // Debris still surfaces…
        expect(result.debrisCleanup?.paths).toHaveLength(1);
        // …but no phantom-prune entries since the manifest never loaded.
        expect(result.phantomPrune).toBeUndefined();
      });
    });

    it('skips phantom pruning when no loader is provided', async () => {
      await withTempDirs(async (mount, hostTmp) => {
        await makeFiles(mount, {
          'Music/Artist/Album/02 - Broken.m4a.podkit-tmp': 'half',
        });
        const result = await runPreSyncSweep({
          mountPoint: mount,
          deviceType: 'mass-storage',
          contentPaths: DEFAULT_CONTENT_PATHS,
          // No loadManagedFiles — only debris surfaces.
          tmpDirOverride: hostTmp,
        });
        expect(result.debrisCleanup?.paths).toHaveLength(1);
        expect(result.phantomPrune).toBeUndefined();
      });
    });

    it('returns empty when content paths are not provided', async () => {
      await withTempDirs(async (mount, hostTmp) => {
        const result = await runPreSyncSweep({
          mountPoint: mount,
          deviceType: 'mass-storage',
          // no contentPaths
          tmpDirOverride: hostTmp,
        });
        expect(result.debrisCleanup).toBeUndefined();
      });
    });
  });

  describe('iPod', () => {
    it('surfaces .podkit-tmp debris across the full iPod_Control surface', async () => {
      await withTempDirs(async (mount, hostTmp) => {
        await makeFiles(mount, {
          'iPod_Control/Music/F00/good.m4a': 'good',
          'iPod_Control/Music/F12/half.m4a.podkit-tmp': 'half',
          'iPod_Control/iTunes/iTunesPrefs.podkit-tmp': 'half',
          'iPod_Control/Artwork/ArtworkDB.podkit-tmp': 'half',
        });
        const result = await runPreSyncSweep({
          mountPoint: mount,
          deviceType: 'ipod',
          tmpDirOverride: hostTmp,
        });
        expect(result.debrisCleanup?.paths).toHaveLength(3);
        expect(result.phantomPrune).toBeUndefined();
      });
    });

    it('does not invoke loadManagedFiles for iPod devices', async () => {
      let called = false;
      await withTempDirs(async (mount, hostTmp) => {
        await runPreSyncSweep({
          mountPoint: mount,
          deviceType: 'ipod',
          loadManagedFiles: async () => {
            called = true;
            return new Set();
          },
          tmpDirOverride: hostTmp,
        });
      });
      expect(called).toBe(false);
    });
  });

  describe('host transcode-tmp', () => {
    it('surfaces abandoned podkit-transcode-* dirs with no .owner', async () => {
      await withTempDirs(async (mount, hostTmp) => {
        await makeAbandonedTranscodeDir(hostTmp, 'aaaa', { 'partial.m4a': 'data' });
        const result = await runPreSyncSweep({
          mountPoint: mount,
          deviceType: 'mass-storage',
          contentPaths: DEFAULT_CONTENT_PATHS,
          tmpDirOverride: hostTmp,
        });
        expect(result.debrisCleanup?.paths).toHaveLength(1);
        expect(result.debrisCleanup?.paths[0]).toContain('podkit-transcode-aaaa');
      });
    });

    it('SKIPS dirs whose .owner is the current live process (sibling protection)', async () => {
      await withTempDirs(async (mount, hostTmp) => {
        // Live dir: `.owner` points at the current process.
        await makeLiveTranscodeDir(hostTmp, 'live-bbbb', { 'wip.m4a': 'still writing' });
        const result = await runPreSyncSweep({
          mountPoint: mount,
          deviceType: 'mass-storage',
          contentPaths: DEFAULT_CONTENT_PATHS,
          tmpDirOverride: hostTmp,
        });
        expect(result.debrisCleanup).toBeUndefined();
      });
    });

    it('surfaces dirs whose .owner is a dead PID (SIGKILLed prior process)', async () => {
      await withTempDirs(async (mount, hostTmp) => {
        await makeDeadOwnerTranscodeDir(hostTmp, 'dead-cccc', { 'partial.m4a': 'data' });
        const result = await runPreSyncSweep({
          mountPoint: mount,
          deviceType: 'mass-storage',
          contentPaths: DEFAULT_CONTENT_PATHS,
          tmpDirOverride: hostTmp,
        });
        expect(result.debrisCleanup?.paths).toHaveLength(1);
        expect(result.debrisCleanup?.paths[0]).toContain('podkit-transcode-dead-cccc');
      });
    });

    it('aggregates device debris + host transcode-tmp into one cleanup', async () => {
      await withTempDirs(async (mount, hostTmp) => {
        await makeFiles(mount, {
          'Music/half.m4a.podkit-tmp': 'x'.repeat(100),
        });
        await makeAbandonedTranscodeDir(hostTmp, 'cccc', {
          'partial.m4a': 'y'.repeat(50),
        });
        const result = await runPreSyncSweep({
          mountPoint: mount,
          deviceType: 'mass-storage',
          contentPaths: DEFAULT_CONTENT_PATHS,
          tmpDirOverride: hostTmp,
        });
        expect(result.debrisCleanup?.paths).toHaveLength(2);
        expect(result.debrisCleanup?.totalBytes).toBe(150);
      });
    });
  });
});

describe('runPreliminariesPreFlight', () => {
  it('is a no-op when preliminaries are undefined', async () => {
    const { sink, warnings } = makeSink();
    const result = await runPreliminariesPreFlight(undefined, { dryRun: false, warningSink: sink });
    expect(result).toEqual({
      debrisDeleted: 0,
      freedBytes: 0,
      failedPaths: [],
      phantomsPruned: 0,
    });
    expect(warnings).toEqual([]);
  });

  it('is a no-op in dry-run mode regardless of preliminaries', async () => {
    await withTempDirs(async (mount, _hostTmp) => {
      const target = join(mount, 'leaveme.podkit-tmp');
      await writeFile(target, 'do not delete');
      const { sink, warnings } = makeSink();
      let prunedCalls = 0;
      const result = await runPreliminariesPreFlight(
        {
          debrisCleanup: { paths: [target], totalBytes: 13 },
          phantomPrune: { paths: ['Music/gone.m4a'] },
        },
        {
          dryRun: true,
          warningSink: sink,
          adapter: {
            prunePhantomManifest: async () => {
              prunedCalls += 1;
              return { pruned: 0, errors: [] };
            },
          },
        }
      );
      expect(result.debrisDeleted).toBe(0);
      expect(result.phantomsPruned).toBe(0);
      // Adapter must NOT be invoked in dry-run.
      expect(prunedCalls).toBe(0);
      // File still on disk.
      const { existsSync } = await import('node:fs');
      expect(existsSync(target)).toBe(true);
      expect(warnings).toEqual([]);
    });
  });

  it('deletes every path in debrisCleanup.paths and reports freed bytes', async () => {
    await withTempDirs(async (mount, _hostTmp) => {
      const a = join(mount, 'a.podkit-tmp');
      const b = join(mount, 'b.podkit-tmp');
      await writeFile(a, 'aa');
      await writeFile(b, 'bbbb');
      const { sink, warnings } = makeSink();
      const result = await runPreliminariesPreFlight(
        { debrisCleanup: { paths: [a, b], totalBytes: 6 } },
        { dryRun: false, warningSink: sink }
      );
      expect(result.debrisDeleted).toBe(2);
      expect(result.freedBytes).toBeGreaterThan(0);
      expect(warnings).toEqual([]);
      const { existsSync } = await import('node:fs');
      expect(existsSync(a)).toBe(false);
      expect(existsSync(b)).toBe(false);
    });
  });

  it('handles directories via rm recursive+force (one shape for files + dirs)', async () => {
    await withTempDirs(async (mount, _hostTmp) => {
      const transcodeDir = join(mount, 'podkit-transcode-xxxx');
      await mkdir(transcodeDir, { recursive: true });
      await writeFile(join(transcodeDir, 'out.m4a'), 'partial');
      const { sink } = makeSink();
      const result = await runPreliminariesPreFlight(
        { debrisCleanup: { paths: [transcodeDir], totalBytes: 7 } },
        { dryRun: false, warningSink: sink }
      );
      expect(result.debrisDeleted).toBe(1);
      const { existsSync } = await import('node:fs');
      expect(existsSync(transcodeDir)).toBe(false);
    });
  });

  it('tolerates a path that fails to delete (emits debris-cleanup-failure Warning)', async () => {
    await withTempDirs(async (mount, _hostTmp) => {
      const good = join(mount, 'good.podkit-tmp');
      await writeFile(good, 'hello');
      // A non-existent path with deep nesting that rm() can't access —
      // actually with force:true rm() doesn't error on ENOENT. We need
      // a different failure mode. Use a path containing a NUL byte to
      // force a synchronous TypeError from the syscall layer.
      const bad = join(mount, 'cannot\0unlink.podkit-tmp');

      const { sink, warnings } = makeSink();
      const result = await runPreliminariesPreFlight(
        { debrisCleanup: { paths: [good, bad], totalBytes: 5 } },
        { dryRun: false, warningSink: sink }
      );
      expect(result.debrisDeleted).toBe(1);
      expect(result.failedPaths).toEqual([bad]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.type).toBe('debris-cleanup-failure');
      expect(warnings[0]!.phase).toBe('execute');
      expect(warnings[0]!.message).toContain('cannot');
    });
  });

  it('auto-prunes phantom rows via the adapter and stays silent on success', async () => {
    const { sink, warnings } = makeSink();
    const pruneCalls: string[][] = [];
    const result = await runPreliminariesPreFlight(
      {
        phantomPrune: { paths: ['Music/ghost.m4a', 'Music/missing.flac'] },
      },
      {
        dryRun: false,
        warningSink: sink,
        adapter: {
          prunePhantomManifest: async (paths) => {
            pruneCalls.push(paths);
            return { pruned: paths.length, errors: [] };
          },
        },
      }
    );
    expect(pruneCalls).toHaveLength(1);
    expect(pruneCalls[0]).toEqual(['Music/ghost.m4a', 'Music/missing.flac']);
    expect(result.phantomsPruned).toBe(2);
    // No advisory when the prune succeeded.
    expect(warnings).toEqual([]);
  });

  it('emits an advisory Warning when the adapter prune reports per-path errors', async () => {
    const { sink, warnings } = makeSink();
    await runPreliminariesPreFlight(
      {
        phantomPrune: { paths: ['Music/ghost.m4a'] },
      },
      {
        dryRun: false,
        warningSink: sink,
        adapter: {
          prunePhantomManifest: async (paths) => ({
            pruned: 0,
            errors: paths.map((p) => ({ path: p, error: new Error('EACCES rewrite denied') })),
          }),
        },
      }
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.type).toBe('debris-cleanup-failure');
    expect(warnings[0]!.message).toContain('auto-prune');
    expect(warnings[0]!.message).toContain('EACCES rewrite denied');
    expect(warnings[0]!.message).toContain('--repair orphan-files');
  });

  it('emits an advisory Warning when the adapter prune throws unexpectedly', async () => {
    const { sink, warnings } = makeSink();
    await runPreliminariesPreFlight(
      {
        phantomPrune: { paths: ['Music/ghost.m4a'] },
      },
      {
        dryRun: false,
        warningSink: sink,
        adapter: {
          prunePhantomManifest: async () => {
            throw new Error('boom');
          },
        },
      }
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.type).toBe('debris-cleanup-failure');
    expect(warnings[0]!.message).toContain('boom');
    expect(warnings[0]!.message).toContain('--repair orphan-files');
  });

  it('falls back to the doctor-advisory Warning when the adapter has no prune method', async () => {
    const { sink, warnings } = makeSink();
    await runPreliminariesPreFlight(
      {
        phantomPrune: { paths: ['Music/ghost.m4a', 'Music/missing.flac'] },
      },
      // No adapter at all — iPod paths and tests that exercise the legacy
      // surface go through here.
      { dryRun: false, warningSink: sink }
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.type).toBe('debris-cleanup-failure');
    expect(warnings[0]!.message).toContain('phantom');
    expect(warnings[0]!.message).toContain('--repair orphan-files');
  });

  it('respects abort signal mid-loop', async () => {
    await withTempDirs(async (mount, _hostTmp) => {
      const a = join(mount, 'a.podkit-tmp');
      const b = join(mount, 'b.podkit-tmp');
      await writeFile(a, 'aa');
      await writeFile(b, 'bb');
      const controller = new AbortController();
      // Abort immediately so the loop never starts deleting.
      controller.abort();
      const { sink } = makeSink();
      const result = await runPreliminariesPreFlight(
        { debrisCleanup: { paths: [a, b], totalBytes: 4 } },
        { dryRun: false, warningSink: sink, signal: controller.signal }
      );
      expect(result.debrisDeleted).toBe(0);
      const { existsSync } = await import('node:fs');
      expect(existsSync(a)).toBe(true);
      expect(existsSync(b)).toBe(true);
    });
  });
});
