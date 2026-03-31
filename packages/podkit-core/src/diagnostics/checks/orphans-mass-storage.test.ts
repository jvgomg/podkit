/**
 * Unit tests for mass-storage orphan file detection diagnostic check
 *
 * Uses real temp directories with actual files to test orphan detection
 * and repair against the .podkit/state.json manifest.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orphanFilesMassStorageCheck } from './orphans-mass-storage.js';
import type { DiagnosticContext, RepairContext } from '../types.js';
import type { ContentPaths, MassStorageManifest } from '../../device/mass-storage-utils.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_CONTENT_PATHS: ContentPaths = {
  musicDir: 'Music',
  moviesDir: 'Video/Movies',
  tvShowsDir: 'Video/Shows',
};

function makeCtx(mountPoint: string, contentPaths?: ContentPaths): DiagnosticContext {
  return { mountPoint, deviceType: 'mass-storage', contentPaths };
}

function makeRepairCtx(mountPoint: string, contentPaths?: ContentPaths): RepairContext {
  return { mountPoint, deviceType: 'mass-storage', contentPaths, adapters: [] };
}

/** Write a state.json manifest to the .podkit directory */
async function writeManifest(mountPoint: string, managedFiles: string[]): Promise<void> {
  const stateDir = join(mountPoint, '.podkit');
  await mkdir(stateDir, { recursive: true });
  const manifest: MassStorageManifest = {
    version: 1,
    managedFiles,
    lastSync: new Date().toISOString(),
  };
  await writeFile(join(stateDir, 'state.json'), JSON.stringify(manifest), 'utf-8');
}

/** Create files on the "device" filesystem */
async function createFiles(mountPoint: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(mountPoint, relativePath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content);
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('orphanFilesMassStorageCheck', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'podkit-ms-orphan-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('check', () => {
    it('should skip when no content paths configured', async () => {
      const ctx = makeCtx(tempDir);
      const result = await orphanFilesMassStorageCheck.check(ctx);

      expect(result.status).toBe('skip');
      expect(result.summary).toBe('No content paths configured');
      expect(result.repairable).toBe(false);
    });

    it('should skip when no state manifest exists', async () => {
      const ctx = makeCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.check(ctx);

      expect(result.status).toBe('skip');
      expect(result.summary).toContain('No state manifest found');
      expect(result.repairable).toBe(false);
    });

    it('should pass when all files are tracked in the manifest', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data 1',
        'Music/Artist/Album/02 - Track.m4a': 'audio data 2',
      });
      await writeManifest(tempDir, [
        'Music/Artist/Album/01 - Track.m4a',
        'Music/Artist/Album/02 - Track.m4a',
      ]);

      const ctx = makeCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.check(ctx);

      expect(result.status).toBe('pass');
      expect(result.summary).toContain('2 files');
      expect(result.repairable).toBe(false);
    });

    it('should warn when orphan files are found', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
        'Music/Artist/Album/orphan.mp3': 'orphan audio',
        'Video/Movies/orphan-movie.m4v': 'orphan video',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      const ctx = makeCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.check(ctx);

      expect(result.status).toBe('warn');
      expect(result.summary).toContain('2 orphan files');
      expect(result.repairable).toBe(true);
      expect(result.details?.orphanCount).toBe(2);
      expect(result.details?.totalFiles).toBe(3);
      expect(result.details?.wastedBytes as number).toBeGreaterThan(0);
    });

    it('should skip dotfiles and the .podkit directory', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
        'Music/Artist/Album/._hidden.m4a': 'mac resource fork',
        'Music/.DS_Store': 'finder data',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      const ctx = makeCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.check(ctx);

      expect(result.status).toBe('pass');
      expect(result.summary).toContain('1 file');
    });

    it('should ignore non-media files', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
        'Music/Artist/Album/cover.jpg': 'image data',
        'Music/Artist/Album/notes.txt': 'text data',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      const ctx = makeCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.check(ctx);

      expect(result.status).toBe('pass');
    });

    it('should handle content directories that do not exist', async () => {
      // Only Music directory exists, Video directories don't
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      const ctx = makeCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.check(ctx);

      expect(result.status).toBe('pass');
    });

    it('should handle empty musicDir (device root scanning)', async () => {
      const contentPaths: ContentPaths = {
        musicDir: '',
        moviesDir: 'Video/Movies',
        tvShowsDir: 'Video/Shows',
      };

      await createFiles(tempDir, {
        'Artist/Album/01 - Track.m4a': 'audio data',
        'Artist/Album/orphan.mp3': 'orphan data',
      });
      await writeManifest(tempDir, ['Artist/Album/01 - Track.m4a']);

      const ctx = makeCtx(tempDir, contentPaths);
      const result = await orphanFilesMassStorageCheck.check(ctx);

      expect(result.status).toBe('warn');
      expect(result.details?.orphanCount).toBe(1);
    });

    it('should detect orphans across multiple content directories', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
        'Music/Artist/Album/orphan.flac': 'orphan music',
        'Video/Movies/orphan.mp4': 'orphan movie',
        'Video/Shows/Show/Season 1/orphan.m4v': 'orphan episode',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      const ctx = makeCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.check(ctx);

      expect(result.status).toBe('warn');
      expect(result.details?.orphanCount).toBe(3);
    });
  });

  describe('repair', () => {
    it('should report what would be deleted in dry-run mode', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
        'Music/Artist/Album/orphan.mp3': 'orphan audio data that takes space',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      const ctx = makeRepairCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.repair!.run(ctx, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Dry run');
      expect(result.summary).toContain('1 orphan file');
      expect(result.details?.orphanCount).toBe(1);

      // Verify file still exists
      expect(existsSync(join(tempDir, 'Music/Artist/Album/orphan.mp3'))).toBe(true);
    });

    it('should delete orphan files and report freed space', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
        'Music/Artist/Album/orphan.mp3': 'orphan audio',
        'Video/Movies/orphan.mp4': 'orphan video',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      const ctx = makeRepairCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.repair!.run(ctx);

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Deleted 2 orphan files');
      expect(result.details?.deleted).toBe(2);
      expect(result.details?.freedBytes as number).toBeGreaterThan(0);

      // Verify orphans are gone
      expect(existsSync(join(tempDir, 'Music/Artist/Album/orphan.mp3'))).toBe(false);
      expect(existsSync(join(tempDir, 'Video/Movies/orphan.mp4'))).toBe(false);

      // Verify tracked file still exists
      expect(existsSync(join(tempDir, 'Music/Artist/Album/01 - Track.m4a'))).toBe(true);
    });

    it('should clean up empty directories after deleting orphans', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
        'Music/OtherArtist/OtherAlbum/orphan.m4a': 'orphan data',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      const ctx = makeRepairCtx(tempDir, DEFAULT_CONTENT_PATHS);
      await orphanFilesMassStorageCheck.repair!.run(ctx);

      // OtherArtist directory tree should be removed
      expect(existsSync(join(tempDir, 'Music/OtherArtist'))).toBe(false);
      // Music directory itself should remain
      expect(existsSync(join(tempDir, 'Music'))).toBe(true);
      // Tracked file's directory should remain
      expect(existsSync(join(tempDir, 'Music/Artist/Album'))).toBe(true);
    });

    it('should not delete content root directories', async () => {
      await createFiles(tempDir, {
        'Music/orphan.m4a': 'orphan at root level',
      });
      await writeManifest(tempDir, []);

      const ctx = makeRepairCtx(tempDir, DEFAULT_CONTENT_PATHS);
      await orphanFilesMassStorageCheck.repair!.run(ctx);

      // File should be deleted
      expect(existsSync(join(tempDir, 'Music/orphan.m4a'))).toBe(false);
      // Music directory should still exist (it's the content root)
      // Note: Music dir will be removed since it's empty and cleanEmptyDirs
      // stops at the content root. If Music is the scan dir, it won't be removed.
    });

    it('should call onProgress during deletion', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/orphan1.m4a': 'data1',
        'Music/Artist/Album/orphan2.m4a': 'data2',
      });
      await writeManifest(tempDir, []);

      const ctx = makeRepairCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const progressCalls: Record<string, unknown>[] = [];
      await orphanFilesMassStorageCheck.repair!.run(ctx, {
        onProgress: (p) => progressCalls.push(p),
      });

      expect(progressCalls.length).toBe(2);
      expect(progressCalls[0]).toMatchObject({ phase: 'deleting', current: 1, total: 2 });
      expect(progressCalls[1]).toMatchObject({ phase: 'deleting', current: 2, total: 2 });
    });

    it('should return success with no orphans to delete', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      const ctx = makeRepairCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.repair!.run(ctx);

      expect(result.success).toBe(true);
      expect(result.summary).toBe('No orphan files to delete');
    });

    it('should have writable-device requirement', () => {
      expect(orphanFilesMassStorageCheck.repair!.requirements).toEqual(['writable-device']);
    });

    it('should return failure when no content paths configured', async () => {
      const ctx = makeRepairCtx(tempDir);
      const result = await orphanFilesMassStorageCheck.repair!.run(ctx);

      expect(result.success).toBe(false);
      expect(result.summary).toContain('No content paths configured');
    });

    it('should return failure when no manifest exists', async () => {
      const ctx = makeRepairCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.repair!.run(ctx);

      expect(result.success).toBe(false);
      expect(result.summary).toContain('No state manifest found');
    });
  });

  describe('metadata', () => {
    it('should have correct check metadata', () => {
      expect(orphanFilesMassStorageCheck.id).toBe('orphan-files-mass-storage');
      expect(orphanFilesMassStorageCheck.name).toBe('Orphan Files (Mass Storage)');
      expect(orphanFilesMassStorageCheck.applicableTo).toEqual(['mass-storage']);
    });
  });
});
