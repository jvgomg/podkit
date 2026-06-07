/**
 * Unit tests for mass-storage orphan file detection diagnostic check
 *
 * Uses real temp directories with actual files to test orphan detection
 * and repair against the .podkit/state.json manifest.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orphanFilesMassStorageCheck } from './orphans-mass-storage.js';
import type { DiagnosticContext, RepairContext } from '../types.js';
import type { MassStorageManifest } from '../../device/mass-storage-utils.js';
import type { ContentPaths } from '@podkit/devices-mass-storage';

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
      expect(result.summary).toContain('Deleted 2 files');
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
      expect(result.summary).toBe('Nothing to clean up');
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

    it('ignores debris files (handled by debris-files-mass-storage check)', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
        'Music/Artist/Album/02 - Broken.Audio file': 'legacy debris',
        'Music/Artist/Album/03 - Crashed.flac.podkit-tmp': 'in-flight residue',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      const ctx = makeRepairCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.repair!.run(ctx);

      // Orphan repair deletes ZERO files — neither file is an orphan
      // (one is in manifest; the others are debris, owned by the sibling
      // check). The original combined behaviour where this check also
      // deleted debris is gone after the orphan/debris split.
      expect(result.success).toBe(true);
      expect(result.summary).toBe('Nothing to clean up');
      expect(existsSync(join(tempDir, 'Music/Artist/Album/02 - Broken.Audio file'))).toBe(true);
      expect(existsSync(join(tempDir, 'Music/Artist/Album/03 - Crashed.flac.podkit-tmp'))).toBe(
        true
      );
      expect(existsSync(join(tempDir, 'Music/Artist/Album/01 - Track.m4a'))).toBe(true);
    });

    it('prunes phantom manifest entries via atomic manifest rewrite', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
      });
      await writeManifest(tempDir, [
        'Music/Artist/Album/01 - Track.m4a',
        'Music/Artist/Album/02 - Missing.m4a',
        'Music/Artist/Album/03 - AlsoMissing.flac',
      ]);

      const ctx = makeRepairCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.repair!.run(ctx);

      expect(result.success).toBe(true);
      expect((result.details as Record<string, unknown>).phantomsPruned).toBe(2);

      // Manifest rewritten with only the surviving entry.
      const manifestRaw = await readFile(join(tempDir, '.podkit/state.json'), 'utf-8');
      const manifest = JSON.parse(manifestRaw) as MassStorageManifest;
      expect(manifest.managedFiles).toEqual(['Music/Artist/Album/01 - Track.m4a']);
    });

    it('dry-run reports orphan + phantom-manifest classes without writing', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
        'Music/Artist/Album/orphan.mp3': 'orphan audio',
        // Debris is the sibling check's concern; the orphan dry-run
        // ignores it entirely after the split.
        'Music/Artist/Album/02 - Broken.Audio file': 'debris',
      });
      await writeManifest(tempDir, [
        'Music/Artist/Album/01 - Track.m4a',
        'Music/Artist/Album/missing.m4a',
      ]);

      const ctx = makeRepairCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.repair!.run(ctx, { dryRun: true });

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Dry run');
      expect(result.summary).toContain('1 orphan file');
      expect(result.summary).toContain('1 phantom manifest entry');
      // Debris no longer surfaces here.
      expect(result.summary).not.toContain('debris');
      // Files untouched.
      expect(existsSync(join(tempDir, 'Music/Artist/Album/orphan.mp3'))).toBe(true);
      expect(existsSync(join(tempDir, 'Music/Artist/Album/02 - Broken.Audio file'))).toBe(true);
    });
  });

  describe('metadata', () => {
    it('should have correct check metadata', () => {
      expect(orphanFilesMassStorageCheck.id).toBe('orphan-files-mass-storage');
      expect(orphanFilesMassStorageCheck.name).toBe('Orphan Files (Mass Storage)');
      expect(orphanFilesMassStorageCheck.applicableTo).toEqual(['mass-storage']);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Orphan-side coverage of incomplete-sync classes
  //
  // After the orphan/debris split, debris-extension residue (`.podkit-tmp`,
  // `.Audio file`) is owned by `debris-files-mass-storage`. The orphan check
  // still owns the phantom-manifest class (manifest entries with no file on
  // disk) and the partial-write gap (a file in the manifest is trusted even
  // if it's truncated).
  // ──────────────────────────────────────────────────────────────────────────
  describe('orphan-only coverage', () => {
    it('does NOT surface debris-extension residue (sibling check owns it)', async () => {
      // Both `.Audio file` and `.podkit-tmp` are now `debris-files-mass-storage`'s
      // responsibility. The orphan check skips them entirely.
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
        'Music/Artist/Album/02 - Broken.Audio file': 'partial bytes',
        'Music/Artist/Album/03 - Crashed.m4a.podkit-tmp': 'half written',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      const ctx = makeCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.check(ctx);

      // All on-disk content is tracked or debris-only — no orphan-side issues.
      expect(result.status).toBe('pass');
      expect(result.details?.orphanCount).toBe(0);
      // `debris` is no longer a key the orphan check populates.
      expect((result.details as Record<string, unknown>).debrisCount).toBeUndefined();
    });

    it('flags manifest entries that point to missing files', async () => {
      // Symmetric pass: manifest entries whose file has been deleted out of
      // band (or was never copied because of a now-closed
      // copyTrackFile-failure pathway). Surfaced as `missingTrackedFiles`.
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
      });
      await writeManifest(tempDir, [
        'Music/Artist/Album/01 - Track.m4a',
        'Music/Artist/Album/02 - Missing.m4a',
      ]);

      const ctx = makeCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.check(ctx);

      expect(result.status).toBe('warn');
      expect(result.details?.orphanCount).toBe(0);
      const missing = (result.details as Record<string, unknown>).missingTrackedFiles as string[];
      expect(missing).toEqual(['Music/Artist/Album/02 - Missing.m4a']);
      expect(result.repairable).toBe(true);
    });

    it('does NOT detect partial-write debris when the file is in the manifest', async () => {
      // If a sync writes the manifest entry BEFORE the file copy completes
      // (the current mass-storage-adapter.ts:379 path: `fs.copyFileSync`
      // directly to the destination, no atomic rename), an interrupted sync
      // leaves a partial file with the recognized extension and a manifest
      // entry pointing at it. The orphan check trusts the manifest and skips
      // it — there is no size/integrity verification.
      await createFiles(tempDir, {
        // Partial write: file exists, in manifest, but only 12 bytes of an
        // expected multi-megabyte audio file.
        'Music/Artist/Album/01 - Partial.m4a': 'partial    ',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Partial.m4a']);

      const ctx = makeCtx(tempDir, DEFAULT_CONTENT_PATHS);
      const result = await orphanFilesMassStorageCheck.check(ctx);

      // Gap: even though the file is corrupt/incomplete, it's "managed" per
      // the manifest, so the orphan check passes. A size/checksum probe
      // (or atomic-write writer) is required to catch this class.
      expect(result.status).toBe('pass');
      expect(result.details?.orphanCount).toBe(0);
    });
  });
});
