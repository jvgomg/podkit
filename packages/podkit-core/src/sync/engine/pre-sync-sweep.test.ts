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
import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPreSyncSweep, runPreliminariesPreFlight } from './pre-sync-sweep.js';
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

async function makeOldTranscodeDir(
  hostTmp: string,
  uuid: string,
  ageMs: number,
  files: Record<string, string> = {}
): Promise<void> {
  const dir = join(hostTmp, `podkit-transcode-${uuid}`);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  const stampSec = (Date.now() - ageMs) / 1000;
  await utimes(dir, stampSec, stampSec);
}

describe('runPreSyncSweep', () => {
  it('returns empty preliminaries when nothing to clean', async () => {
    await withTempDirs(async (mount, hostTmp) => {
      const result = await runPreSyncSweep({
        mountPoint: mount,
        deviceType: 'mass-storage',
        contentPaths: DEFAULT_CONTENT_PATHS,
        tmpDirOverride: hostTmp,
        sessionStartMsOverride: Date.now(),
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
          sessionStartMsOverride: Date.now(),
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
          sessionStartMsOverride: Date.now(),
        });
        expect(result.phantomPrune?.paths).toEqual(
          expect.arrayContaining([
            'Music/Artist/Album/02 - Missing.m4a',
            'Music/Artist/Album/03 - AlsoMissing.flac',
          ])
        );
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
          sessionStartMsOverride: Date.now(),
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
          sessionStartMsOverride: Date.now(),
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
          sessionStartMsOverride: Date.now(),
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
          sessionStartMsOverride: Date.now(),
        });
      });
      expect(called).toBe(false);
    });
  });

  describe('host transcode-tmp', () => {
    it('surfaces abandoned podkit-transcode-* directories older than the session', async () => {
      await withTempDirs(async (mount, hostTmp) => {
        await makeOldTranscodeDir(hostTmp, 'aaaa', 60_000, { 'partial.m4a': 'data' });
        const result = await runPreSyncSweep({
          mountPoint: mount,
          deviceType: 'mass-storage',
          contentPaths: DEFAULT_CONTENT_PATHS,
          tmpDirOverride: hostTmp,
          sessionStartMsOverride: Date.now(),
        });
        expect(result.debrisCleanup?.paths).toHaveLength(1);
        expect(result.debrisCleanup?.paths[0]).toContain('podkit-transcode-aaaa');
      });
    });

    it('SKIPS dirs younger than sessionStartMs (concurrent sibling protection)', async () => {
      await withTempDirs(async (mount, hostTmp) => {
        // Live dir: mtime = now; session started 30s ago.
        await makeOldTranscodeDir(hostTmp, 'live-bbbb', 0, { 'wip.m4a': 'still writing' });
        const sessionStart = Date.now() - 30_000;
        const result = await runPreSyncSweep({
          mountPoint: mount,
          deviceType: 'mass-storage',
          contentPaths: DEFAULT_CONTENT_PATHS,
          tmpDirOverride: hostTmp,
          sessionStartMsOverride: sessionStart,
        });
        expect(result.debrisCleanup).toBeUndefined();
      });
    });

    it('aggregates device debris + host transcode-tmp into one cleanup', async () => {
      await withTempDirs(async (mount, hostTmp) => {
        await makeFiles(mount, {
          'Music/half.m4a.podkit-tmp': 'x'.repeat(100),
        });
        await makeOldTranscodeDir(hostTmp, 'cccc', 60_000, {
          'partial.m4a': 'y'.repeat(50),
        });
        const result = await runPreSyncSweep({
          mountPoint: mount,
          deviceType: 'mass-storage',
          contentPaths: DEFAULT_CONTENT_PATHS,
          tmpDirOverride: hostTmp,
          sessionStartMsOverride: Date.now(),
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
    expect(result).toEqual({ debrisDeleted: 0, freedBytes: 0, failedPaths: [] });
    expect(warnings).toEqual([]);
  });

  it('is a no-op in dry-run mode regardless of preliminaries', async () => {
    await withTempDirs(async (mount, _hostTmp) => {
      const target = join(mount, 'leaveme.podkit-tmp');
      await writeFile(target, 'do not delete');
      const { sink, warnings } = makeSink();
      const result = await runPreliminariesPreFlight(
        { debrisCleanup: { paths: [target], totalBytes: 13 } },
        { dryRun: true, warningSink: sink }
      );
      expect(result.debrisDeleted).toBe(0);
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

  it('emits an advisory Warning when phantom-prune paths are present', async () => {
    const { sink, warnings } = makeSink();
    await runPreliminariesPreFlight(
      {
        phantomPrune: { paths: ['Music/ghost.m4a', 'Music/missing.flac'] },
      },
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
