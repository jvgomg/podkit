/**
 * Unit tests for the mass-storage debris-files diagnostic check.
 *
 * Debris is podkit's own in-flight write residue (`.podkit-tmp`,
 * `.Audio file`). Repair is safe-by-design — no confirmation prompt — and
 * the check is manifest-agnostic: debris is identified by file extension,
 * not by manifest membership.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { debrisFilesMassStorageCheck } from './debris-files-mass-storage.js';
import type { DiagnosticContext, RepairContext } from '../types.js';
import type { ContentPaths } from '@podkit/devices-mass-storage';

// ── Helpers ──────────────────────────────────────────────────────────────────

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

async function createFiles(mountPoint: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(mountPoint, relativePath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content);
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('debrisFilesMassStorageCheck', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'debris-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('metadata', () => {
    it('has the expected id, name, scope, applicability', () => {
      expect(debrisFilesMassStorageCheck.id).toBe('debris-files-mass-storage');
      expect(debrisFilesMassStorageCheck.name).toBe('Debris Files (Mass Storage)');
      expect(debrisFilesMassStorageCheck.applicableTo).toEqual(['mass-storage']);
      expect(debrisFilesMassStorageCheck.scope).toBe('database-health');
      expect(debrisFilesMassStorageCheck.repair).toBeDefined();
      expect(debrisFilesMassStorageCheck.repair?.requirements).toEqual(['writable-device']);
    });
  });

  describe('check', () => {
    it('skips when no content paths configured', async () => {
      const result = await debrisFilesMassStorageCheck.check(makeCtx(tempDir));
      expect(result.status).toBe('skip');
      expect(result.summary).toContain('No content paths configured');
    });

    it('passes when no debris is present', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
      });

      const result = await debrisFilesMassStorageCheck.check(
        makeCtx(tempDir, DEFAULT_CONTENT_PATHS)
      );
      expect(result.status).toBe('pass');
      expect(result.details?.debrisCount).toBe(0);
    });

    it('warns when `.Audio file` legacy debris is found', async () => {
      // Aborted OGG/WAV/AIFF syncs once produced files with the literal
      // extension `.Audio file` (a `getFileTypeLabel` fallback, since fixed).
      // The walker matches them against `KNOWN_DEBRIS_EXTENSIONS`.
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
        'Music/Artist/Album/02 - Broken.Audio file': 'partial bytes',
      });

      const result = await debrisFilesMassStorageCheck.check(
        makeCtx(tempDir, DEFAULT_CONTENT_PATHS)
      );
      expect(result.status).toBe('warn');
      expect(result.repairable).toBe(true);
      expect((result.details as Record<string, unknown>).debrisCount).toBe(1);
      const debris = (result.details as Record<string, unknown>).debris as Array<{
        path: string;
      }>;
      expect(debris[0]!.path).toContain('02 - Broken.Audio file');
    });

    it('warns when `.podkit-tmp` in-flight write residue is found', async () => {
      // The atomic-write helper uses `.podkit-tmp` as the in-flight suffix.
      // Presence after a sync implies the writer crashed between copy and
      // rename — repair is always safe.
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
        'Music/Artist/Album/02 - Crashed.m4a.podkit-tmp': 'half written',
      });

      const result = await debrisFilesMassStorageCheck.check(
        makeCtx(tempDir, DEFAULT_CONTENT_PATHS)
      );
      expect(result.status).toBe('warn');
      expect((result.details as Record<string, unknown>).debrisCount).toBe(1);
    });

    it('is manifest-agnostic — debris detection does NOT require a manifest', async () => {
      // Unlike the orphan check, debris is identified by extension alone.
      // No `.podkit/state.json` is needed for the check to report findings.
      await createFiles(tempDir, {
        'Music/Artist/Album/02 - Crashed.m4a.podkit-tmp': 'half written',
      });

      const result = await debrisFilesMassStorageCheck.check(
        makeCtx(tempDir, DEFAULT_CONTENT_PATHS)
      );
      expect(result.status).toBe('warn');
      expect((result.details as Record<string, unknown>).debrisCount).toBe(1);
    });

    it('reports total bytes wasted across all debris files', async () => {
      await createFiles(tempDir, {
        'Music/A.flac.podkit-tmp': 'a'.repeat(100),
        'Music/B.flac.podkit-tmp': 'b'.repeat(50),
      });

      const result = await debrisFilesMassStorageCheck.check(
        makeCtx(tempDir, DEFAULT_CONTENT_PATHS)
      );
      expect(result.status).toBe('warn');
      expect((result.details as Record<string, unknown>).debrisCount).toBe(2);
      expect((result.details as Record<string, unknown>).wastedBytes).toBe(150);
    });
  });

  describe('repair', () => {
    it('dry-run lists debris without deleting it', async () => {
      await createFiles(tempDir, {
        'Music/A.flac.podkit-tmp': 'a'.repeat(100),
      });

      const result = await debrisFilesMassStorageCheck.repair!.run(
        makeRepairCtx(tempDir, DEFAULT_CONTENT_PATHS),
        { dryRun: true }
      );
      expect(result.success).toBe(true);
      expect(result.summary).toContain('Dry run');
      expect(result.summary).toContain('1 debris file');
      expect(existsSync(join(tempDir, 'Music/A.flac.podkit-tmp'))).toBe(true);
    });

    it('deletes debris files and reports freed space', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
        'Music/Artist/Album/02 - Broken.Audio file': 'partial bytes',
        'Music/Artist/Album/03 - Crashed.flac.podkit-tmp': 'in-flight residue',
      });

      const result = await debrisFilesMassStorageCheck.repair!.run(
        makeRepairCtx(tempDir, DEFAULT_CONTENT_PATHS)
      );

      expect(result.success).toBe(true);
      expect(result.details?.deleted).toBe(2);
      expect(existsSync(join(tempDir, 'Music/Artist/Album/02 - Broken.Audio file'))).toBe(false);
      expect(existsSync(join(tempDir, 'Music/Artist/Album/03 - Crashed.flac.podkit-tmp'))).toBe(
        false
      );
      // Non-debris file untouched.
      expect(existsSync(join(tempDir, 'Music/Artist/Album/01 - Track.m4a'))).toBe(true);
    });

    it('reports "nothing to clean up" when no debris exists', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'audio data',
      });

      const result = await debrisFilesMassStorageCheck.repair!.run(
        makeRepairCtx(tempDir, DEFAULT_CONTENT_PATHS)
      );

      expect(result.success).toBe(true);
      expect(result.summary).toContain('No debris to clean up');
    });

    it('cleans empty directories after deletion', async () => {
      await createFiles(tempDir, {
        'Music/Artist/Album/leftover.podkit-tmp': 'residue',
      });

      const result = await debrisFilesMassStorageCheck.repair!.run(
        makeRepairCtx(tempDir, DEFAULT_CONTENT_PATHS)
      );

      expect(result.success).toBe(true);
      // Album + Artist were now-empty after deletion, walked up.
      expect(existsSync(join(tempDir, 'Music/Artist/Album'))).toBe(false);
      expect(existsSync(join(tempDir, 'Music/Artist'))).toBe(false);
      // Content root (Music) is preserved as the cleanup boundary.
      expect(existsSync(join(tempDir, 'Music'))).toBe(true);
    });

    it('calls onProgress during deletion', async () => {
      await createFiles(tempDir, {
        'Music/A.podkit-tmp': 'one',
        'Music/B.podkit-tmp': 'two',
      });

      const progressEvents: unknown[] = [];
      await debrisFilesMassStorageCheck.repair!.run(makeRepairCtx(tempDir, DEFAULT_CONTENT_PATHS), {
        onProgress: (p) => progressEvents.push(p),
      });

      expect(progressEvents).toHaveLength(2);
      expect((progressEvents[0] as Record<string, unknown>).phase).toBe('deleting');
    });
  });
});
