/**
 * Unit tests for orphan file detection diagnostic check
 *
 * Uses real temp directories with actual files to test orphan detection
 * and repair, with only the IpodDatabase mocked.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orphanFilesCheck } from './orphans.js';
import type { DiagnosticContext, RepairContext } from '../types.js';
import type { IpodTrack } from '../../ipod/types.js';
import type { IpodDatabase } from '../../ipod/database.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTrack(filePath: string): IpodTrack {
  return {
    title: 'Test Track',
    artist: 'Test Artist',
    album: 'Test Album',
    syncTag: null,
    duration: 180000,
    bitrate: 256,
    sampleRate: 44100,
    size: 5000000,
    mediaType: 1,
    filePath,
    timeAdded: 0,
    timeModified: 0,
    timePlayed: 0,
    timeReleased: 0,
    playCount: 0,
    skipCount: 0,
    rating: 0,
    hasArtwork: false,
    hasFile: true,
    compilation: false,
    update: mock(() => ({}) as IpodTrack),
    remove: mock(() => {}),
    copyFile: mock(() => ({}) as IpodTrack),
    setArtwork: mock(() => ({}) as IpodTrack),
    setArtworkFromData: mock(() => ({}) as IpodTrack),
    removeArtwork: mock(() => ({}) as IpodTrack),
  } as IpodTrack;
}

function makeMockDb(tracks: IpodTrack[]): IpodDatabase {
  return {
    getTracks: () => tracks,
  } as unknown as IpodDatabase;
}

function makeCtx(mountPoint: string, tracks: IpodTrack[]): DiagnosticContext {
  return { mountPoint, deviceType: 'ipod', db: makeMockDb(tracks) };
}

function makeRepairCtx(mountPoint: string, tracks: IpodTrack[]): RepairContext {
  return { mountPoint, deviceType: 'ipod', db: makeMockDb(tracks), adapters: [] };
}

/** Create an iPod-like Music directory structure with files */
async function createMusicDir(mountPoint: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(mountPoint, 'iPod_Control', 'Music', relativePath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content);
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('orphanFilesCheck', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'podkit-orphan-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('check', () => {
    it('should skip when no music directory exists', async () => {
      const ctx = makeCtx(tempDir, []);
      const result = await orphanFilesCheck.check(ctx);

      expect(result.status).toBe('skip');
      expect(result.summary).toBe('No music directory found');
      expect(result.repairable).toBe(false);
    });

    it('should pass when music directory is empty', async () => {
      await mkdir(join(tempDir, 'iPod_Control', 'Music'), { recursive: true });
      const ctx = makeCtx(tempDir, []);
      const result = await orphanFilesCheck.check(ctx);

      expect(result.status).toBe('pass');
      expect(result.repairable).toBe(false);
    });

    it('should pass when all files are referenced by tracks', async () => {
      await createMusicDir(tempDir, {
        'F00/track1.m4a': 'audio data 1',
        'F00/track2.m4a': 'audio data 2',
      });

      const tracks = [
        makeTrack(':iPod_Control:Music:F00:track1.m4a'),
        makeTrack(':iPod_Control:Music:F00:track2.m4a'),
      ];
      const ctx = makeCtx(tempDir, tracks);
      const result = await orphanFilesCheck.check(ctx);

      expect(result.status).toBe('pass');
      expect(result.summary).toContain('2 files');
      expect(result.repairable).toBe(false);
    });

    it('should warn when orphan files are found', async () => {
      await createMusicDir(tempDir, {
        'F00/track1.m4a': 'audio data 1',
        'F00/orphan.m4a': 'orphan data',
        'F01/another_orphan.mp3': 'more orphan data',
      });

      const tracks = [makeTrack(':iPod_Control:Music:F00:track1.m4a')];
      const ctx = makeCtx(tempDir, tracks);
      const result = await orphanFilesCheck.check(ctx);

      expect(result.status).toBe('warn');
      expect(result.summary).toContain('2 orphan files');
      expect(result.repairable).toBe(true);
      expect(result.details?.orphanCount).toBe(2);
      expect(result.details?.totalFiles).toBe(3);
      expect(result.details?.wastedBytes as number).toBeGreaterThan(0);
    });

    it('should ignore non-F* directories', async () => {
      await createMusicDir(tempDir, {
        'F00/track1.m4a': 'audio data',
      });
      // Create a non-F* directory with a file
      const otherDir = join(tempDir, 'iPod_Control', 'Music', 'Other');
      await mkdir(otherDir, { recursive: true });
      await writeFile(join(otherDir, 'stray.txt'), 'stray');

      const tracks = [makeTrack(':iPod_Control:Music:F00:track1.m4a')];
      const ctx = makeCtx(tempDir, tracks);
      const result = await orphanFilesCheck.check(ctx);

      expect(result.status).toBe('pass');
    });
  });

  describe('repair', () => {
    it('should report what would be deleted in dry-run mode', async () => {
      await createMusicDir(tempDir, {
        'F00/track1.m4a': 'audio data',
        'F00/orphan.m4a': 'orphan data that takes space',
      });

      const tracks = [makeTrack(':iPod_Control:Music:F00:track1.m4a')];
      const ctx = makeRepairCtx(tempDir, tracks);
      const result = await orphanFilesCheck.repair!.run(ctx, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Dry run');
      expect(result.summary).toContain('1 orphan file');
      expect(result.details?.orphanCount).toBe(1);

      // Verify file still exists
      const orphanPath = join(tempDir, 'iPod_Control', 'Music', 'F00', 'orphan.m4a');
      expect(existsSync(orphanPath)).toBe(true);
    });

    it('should delete orphan files and report freed space', async () => {
      await createMusicDir(tempDir, {
        'F00/track1.m4a': 'audio data',
        'F00/orphan.m4a': 'orphan data',
        'F01/orphan2.mp3': 'more orphan data',
      });

      const tracks = [makeTrack(':iPod_Control:Music:F00:track1.m4a')];
      const ctx = makeRepairCtx(tempDir, tracks);
      const result = await orphanFilesCheck.repair!.run(ctx);

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Deleted 2 orphan files');
      expect(result.details?.deleted).toBe(2);
      expect(result.details?.freedBytes as number).toBeGreaterThan(0);

      // Verify orphans are gone
      expect(existsSync(join(tempDir, 'iPod_Control', 'Music', 'F00', 'orphan.m4a'))).toBe(false);
      expect(existsSync(join(tempDir, 'iPod_Control', 'Music', 'F01', 'orphan2.mp3'))).toBe(false);

      // Verify tracked file still exists
      expect(existsSync(join(tempDir, 'iPod_Control', 'Music', 'F00', 'track1.m4a'))).toBe(true);
    });

    it('should remove empty F* directories after deleting orphans', async () => {
      await createMusicDir(tempDir, {
        'F00/track1.m4a': 'audio data',
        'F01/orphan.m4a': 'orphan data',
      });

      const tracks = [makeTrack(':iPod_Control:Music:F00:track1.m4a')];
      const ctx = makeRepairCtx(tempDir, tracks);
      await orphanFilesCheck.repair!.run(ctx);

      // F01 should be removed (was only orphans), F00 should remain
      expect(existsSync(join(tempDir, 'iPod_Control', 'Music', 'F01'))).toBe(false);
      expect(existsSync(join(tempDir, 'iPod_Control', 'Music', 'F00'))).toBe(true);
    });

    it('should call onProgress during deletion', async () => {
      await createMusicDir(tempDir, {
        'F00/orphan1.m4a': 'data1',
        'F00/orphan2.m4a': 'data2',
      });

      const ctx = makeRepairCtx(tempDir, []);
      const progressCalls: Record<string, unknown>[] = [];
      await orphanFilesCheck.repair!.run(ctx, {
        onProgress: (p) => progressCalls.push(p),
      });

      expect(progressCalls.length).toBe(2);
      expect(progressCalls[0]).toMatchObject({ phase: 'deleting', current: 1, total: 2 });
      expect(progressCalls[1]).toMatchObject({ phase: 'deleting', current: 2, total: 2 });
    });

    it('should return success with no orphans to delete', async () => {
      await createMusicDir(tempDir, {
        'F00/track1.m4a': 'audio data',
      });

      const tracks = [makeTrack(':iPod_Control:Music:F00:track1.m4a')];
      const ctx = makeRepairCtx(tempDir, tracks);
      const result = await orphanFilesCheck.repair!.run(ctx);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('No orphan files to delete');
    });

    it('should have writable-device requirement', () => {
      expect(orphanFilesCheck.repair!.requirements).toEqual(['writable-device']);
    });
  });
});
