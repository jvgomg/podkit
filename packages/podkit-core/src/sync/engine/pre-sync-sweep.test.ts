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
import { runPreSyncSweep } from './pre-sync-sweep.js';
import type { ContentPaths } from '@podkit/devices-mass-storage';

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
