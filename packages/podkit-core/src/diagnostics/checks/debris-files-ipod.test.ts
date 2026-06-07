/**
 * Unit tests for the iPod debris-files diagnostic check.
 *
 * Pins the walk surface — `.podkit-tmp` residue must surface no matter
 * which `iPod_Control/` directory it landed in. The original task spec
 * scoped this to `iPod_Control/Music/F**`; after TASK-376 retrofitted
 * atomic writes everywhere, that scope was too narrow.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { debrisFilesIpodCheck } from './debris-files-ipod.js';
import type { DiagnosticContext, RepairContext } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(mountPoint: string): DiagnosticContext {
  return { mountPoint, deviceType: 'ipod' };
}

function makeRepairCtx(mountPoint: string): RepairContext {
  return { mountPoint, deviceType: 'ipod', adapters: [] };
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

describe('debrisFilesIpodCheck', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ipod-debris-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('metadata', () => {
    it('has the expected id, name, scope, applicability', () => {
      expect(debrisFilesIpodCheck.id).toBe('debris-files-ipod');
      expect(debrisFilesIpodCheck.name).toBe('Debris Files (iPod)');
      expect(debrisFilesIpodCheck.applicableTo).toEqual(['ipod']);
      expect(debrisFilesIpodCheck.scope).toBe('database-health');
      expect(debrisFilesIpodCheck.repair).toBeDefined();
      expect(debrisFilesIpodCheck.repair?.requirements).toEqual(['writable-device']);
    });
  });

  describe('check', () => {
    it('passes when no debris is present', async () => {
      await createFiles(tempDir, {
        'iPod_Control/Music/F00/AAAA.m4a': 'audio',
      });

      const result = await debrisFilesIpodCheck.check(makeCtx(tempDir));
      expect(result.status).toBe('pass');
      expect(result.details?.debrisCount).toBe(0);
    });

    it('warns when `.podkit-tmp` is found under iPod_Control/Music/F**', async () => {
      await createFiles(tempDir, {
        'iPod_Control/Music/F12/AAAA.m4a': 'good',
        'iPod_Control/Music/F12/BBBB.m4a.podkit-tmp': 'half-written',
      });

      const result = await debrisFilesIpodCheck.check(makeCtx(tempDir));
      expect(result.status).toBe('warn');
      expect((result.details as Record<string, unknown>).debrisCount).toBe(1);
      const debris = (result.details as Record<string, unknown>).debris as Array<{
        path: string;
      }>;
      expect(debris[0]!.path).toContain('BBBB.m4a.podkit-tmp');
    });

    it('walks beyond F-buckets: catches debris in iTunes + Artwork directories', async () => {
      // Atomic-write helper is used across the full content surface — not
      // just F-buckets. Pin that the walker covers every directory the
      // retrofit can reach.
      await createFiles(tempDir, {
        'iPod_Control/iTunes/iTunesPrefs.podkit-tmp': 'partial prefs',
        'iPod_Control/Artwork/ArtworkDB.podkit-tmp': 'partial artwork',
        'iPod_Control/Device/SysInfoExtended.podkit-tmp': 'partial sysinfo',
      });

      const result = await debrisFilesIpodCheck.check(makeCtx(tempDir));
      expect(result.status).toBe('warn');
      expect((result.details as Record<string, unknown>).debrisCount).toBe(3);
    });

    it('skips dotfiles and dot-directories at every level', async () => {
      // macOS resource forks (._*, .DS_Store) and GLib temp residue
      // (.iTunesDB.tmpXXX) all live behind a dot prefix — skip the lot.
      await createFiles(tempDir, {
        'iPod_Control/Music/F00/._real-track.m4a': 'macOS metadata',
        'iPod_Control/Music/F00/.DS_Store': 'macOS dir metadata',
        'iPod_Control/iTunes/.iTunesDB.tmpXYZ': 'GLib atomic-write tmp',
      });

      const result = await debrisFilesIpodCheck.check(makeCtx(tempDir));
      expect(result.status).toBe('pass');
      expect(result.details?.debrisCount).toBe(0);
    });

    it('aggregates bytes across multiple debris files', async () => {
      await createFiles(tempDir, {
        'iPod_Control/Music/F00/a.podkit-tmp': 'x'.repeat(100),
        'iPod_Control/Music/F01/b.podkit-tmp': 'y'.repeat(50),
      });

      const result = await debrisFilesIpodCheck.check(makeCtx(tempDir));
      expect(result.status).toBe('warn');
      expect((result.details as Record<string, unknown>).wastedBytes).toBe(150);
    });
  });

  describe('repair', () => {
    it('dry-run reports without deleting', async () => {
      await createFiles(tempDir, {
        'iPod_Control/Music/F00/a.podkit-tmp': 'partial',
      });

      const result = await debrisFilesIpodCheck.repair!.run(makeRepairCtx(tempDir), {
        dryRun: true,
      });
      expect(result.success).toBe(true);
      expect(result.summary).toContain('Dry run');
      expect(existsSync(join(tempDir, 'iPod_Control/Music/F00/a.podkit-tmp'))).toBe(true);
    });

    it('deletes debris across multiple surfaces', async () => {
      await createFiles(tempDir, {
        'iPod_Control/Music/F00/good.m4a': 'good',
        'iPod_Control/Music/F00/bad.m4a.podkit-tmp': 'half',
        'iPod_Control/iTunes/iTunesPrefs.podkit-tmp': 'half',
      });

      const result = await debrisFilesIpodCheck.repair!.run(makeRepairCtx(tempDir));
      expect(result.success).toBe(true);
      expect(result.details?.deleted).toBe(2);
      expect(existsSync(join(tempDir, 'iPod_Control/Music/F00/bad.m4a.podkit-tmp'))).toBe(false);
      expect(existsSync(join(tempDir, 'iPod_Control/iTunes/iTunesPrefs.podkit-tmp'))).toBe(false);
      // Non-debris preserved.
      expect(existsSync(join(tempDir, 'iPod_Control/Music/F00/good.m4a'))).toBe(true);
    });

    it('tolerates a debris file that vanishes between scan and delete', async () => {
      // Concurrent cleanup (sibling podkit process) may unlink the file in
      // the window between scan and unlink. ENOENT is not an error.
      await createFiles(tempDir, {
        'iPod_Control/Music/F00/will-vanish.podkit-tmp': 'partial',
      });

      // Pre-delete to simulate the concurrent removal.
      await rm(join(tempDir, 'iPod_Control/Music/F00/will-vanish.podkit-tmp'));

      const result = await debrisFilesIpodCheck.repair!.run(makeRepairCtx(tempDir));
      // No debris found in the second walk — clean state.
      expect(result.success).toBe(true);
      expect(result.summary).toContain('No debris');
    });

    it('reports "no debris" when nothing to do', async () => {
      const result = await debrisFilesIpodCheck.repair!.run(makeRepairCtx(tempDir));
      expect(result.success).toBe(true);
      expect(result.summary).toContain('No debris');
    });
  });
});
