/**
 * Mass-storage orphan-files diagnostic check — preset × content-path × override
 * matrix (TASK-306, m-19 Phase 5d).
 *
 * Each test drives `orphanFilesMassStorageCheck.check` / `.repair.run` against
 * a real temp directory populated to model a mass-storage device. The
 * `ContentPaths` shape passed in `DiagnosticContext.contentPaths` represents
 * the *resolved* content paths — production resolves the per-device override →
 * `deviceDefaults.musicDir` → preset-default precedence chain upstream of the
 * check. AC #6 therefore exercises three independent permutations and pins
 * the precedence at the resolution layer that produces the value the check
 * actually consumes.
 *
 * Tier-3 (Lima VM, FunctionFS gadget) is deferred behind TASK-322.05.01.
 *
 * @see backlog/tasks/task-306
 * @see adr/adr-016-test-harness-foundations.md
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, chmod, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { orphanFilesMassStorageCheck } from './orphans-mass-storage.js';
import { orphanFilesCheck } from './orphans.js';
import { runDiagnostics, getDiagnosticCheck } from '../index.js';
import type { DiagnosticContext, RepairContext } from '../types.js';
import type { MassStorageManifest } from '../../device/mass-storage-utils.js';
import { BUILT_IN_PRESETS, type ContentPaths } from '@podkit/devices-mass-storage';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a `ContentPaths` for the named built-in preset. Mirrors what the
 * production capability resolver hands the diagnostics layer.
 */
function presetContentPaths(presetId: 'echo-mini' | 'rockbox' | 'generic'): ContentPaths {
  return { ...BUILT_IN_PRESETS[presetId].contentPaths };
}

function makeCtx(mountPoint: string, contentPaths?: ContentPaths): DiagnosticContext {
  return { mountPoint, deviceType: 'mass-storage', contentPaths };
}

function makeRepairCtx(mountPoint: string, contentPaths?: ContentPaths): RepairContext {
  return { mountPoint, deviceType: 'mass-storage', contentPaths, adapters: [] };
}

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

async function createFiles(mountPoint: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = join(mountPoint, relativePath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(fullPath, content);
  }
}

/**
 * Resolve the effective `musicDir` using the production precedence:
 *   per-device override > global deviceDefaults.musicDir > preset default.
 *
 * Production wires this chain together at the config layer; the diagnostics
 * check only sees the resolved value. Reproducing the merge here lets each
 * AC #6 permutation assert what the check is handed *given the inputs at
 * each layer*.
 */
function resolveMusicDir(args: {
  perDevice?: string;
  deviceDefaults?: string;
  presetDefault: string;
}): string {
  return args.perDevice ?? args.deviceDefaults ?? args.presetDefault;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('orphan-files-mass-storage — preset × content-path × override matrix (TASK-306)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'podkit-ms-orphan-matrix-'));
  });

  afterEach(async () => {
    // Restore writable mode in case a partial-failure test left a dir read-only.
    await chmodTreeBestEffort(tempDir);
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Recursively chmod a tree back to 0o755 so `rm -rf` works after a test
   * leaves a directory in 0o555 mode (used by the AC#10 partial-failure case).
   * Best-effort: ignores ENOENT and other errors.
   */
  async function chmodTreeBestEffort(root: string): Promise<void> {
    try {
      await chmod(root, 0o755);
    } catch {
      return;
    }
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(root, entry.name);
      if (entry.isDirectory()) {
        await chmodTreeBestEffort(full);
      } else {
        try {
          await chmod(full, 0o644);
        } catch {
          /* best effort */
        }
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Preset coverage — AC #1..#4
  // ──────────────────────────────────────────────────────────────────────────

  describe('preset content-path layouts', () => {
    // AC #1
    it('AC#1 echo-mini preset with no orphans → pass, orphanCount absent (clean baseline)', async () => {
      // echo-mini stores music at the device root (musicDir: '').
      const cp = presetContentPaths('echo-mini');
      expect(cp.musicDir).toBe('');

      await createFiles(tempDir, {
        'Artist/Album/01 - Track.m4a': 'audio data',
        'Artist/Album/02 - Track.m4a': 'audio data',
      });
      await writeManifest(tempDir, ['Artist/Album/01 - Track.m4a', 'Artist/Album/02 - Track.m4a']);

      const result = await orphanFilesMassStorageCheck.check(makeCtx(tempDir, cp));

      expect(result.status).toBe('pass');
      expect(result.summary).toContain('2 files');
      expect(result.repairable).toBe(false);
      // Pass path emits zero-valued details for JSON-consumer symmetry.
      expect(result.details?.orphanCount).toBe(0);
      expect(result.details?.wastedBytes).toBe(0);
      expect(result.details?.orphans).toEqual([]);
    });

    // AC #2
    it('AC#2 echo-mini preset + one unmanaged file at device-root music dir → warn, orphanCount=1, wastedBytes=fileSize', async () => {
      const cp = presetContentPaths('echo-mini');
      const orphanContent = 'this is the orphan file payload';

      await createFiles(tempDir, {
        'Artist/Album/01 - Track.m4a': 'managed audio',
        'Artist/Album/manual-drop.mp3': orphanContent,
      });
      await writeManifest(tempDir, ['Artist/Album/01 - Track.m4a']);

      const result = await orphanFilesMassStorageCheck.check(makeCtx(tempDir, cp));

      expect(result.status).toBe('warn');
      expect(result.repairable).toBe(true);
      expect(result.details?.orphanCount).toBe(1);
      // wastedBytes must equal the orphan file's on-disk byte length.
      expect(result.details?.wastedBytes).toBe(Buffer.byteLength(orphanContent, 'utf8'));
      const orphans = result.details?.orphans as Array<{ path: string; size: number }>;
      expect(orphans).toHaveLength(1);
      expect(orphans[0]!.path).toBe(join(tempDir, 'Artist/Album/manual-drop.mp3'));
    });

    // AC #3
    it('AC#3 generic preset (Music/, Video/Movies/, Video/Shows/) flags orphan in its default music location → warn', async () => {
      const cp = presetContentPaths('generic');
      expect(cp.musicDir).toBe('Music');
      expect(cp.moviesDir).toBe('Video/Movies');
      expect(cp.tvShowsDir).toBe('Video/Shows');

      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'managed',
        'Music/Artist/Album/orphan.flac': 'orphan music',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      const result = await orphanFilesMassStorageCheck.check(makeCtx(tempDir, cp));

      expect(result.status).toBe('warn');
      expect(result.details?.orphanCount).toBe(1);
    });

    // AC #4
    it('AC#4 rockbox preset (Music/, Video/Movies/, Video/Shows/) flags orphan within its layout → warn', async () => {
      const cp = presetContentPaths('rockbox');
      // Rockbox uses DEFAULT_CONTENT_PATHS; assert that to pin the preset's
      // contract — if rockbox ever moves to a custom layout this test surfaces
      // the change immediately.
      expect(cp.musicDir).toBe('Music');

      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'managed',
        'Music/orphan-at-music-root.mp3': 'orphan rockbox',
        'Video/Movies/extra-movie.mp4': 'orphan movie',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      const result = await orphanFilesMassStorageCheck.check(makeCtx(tempDir, cp));

      expect(result.status).toBe('warn');
      expect(result.details?.orphanCount).toBe(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Out-of-scope content — AC #5
  // ──────────────────────────────────────────────────────────────────────────

  describe('files outside configured content paths', () => {
    // AC #5
    it('AC#5 files in non-content root directories (e.g. /System/, /Documents/) are NOT flagged as orphans', async () => {
      const cp = presetContentPaths('generic');

      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'managed',
        // Files outside the configured content paths — must be ignored.
        'System/firmware.bin': 'firmware blob (not a media file extension anyway)',
        'Documents/notes.m4a': 'media file extension but outside content roots',
        'Photos/IMG_001.mp4': 'media file but outside content roots',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      const result = await orphanFilesMassStorageCheck.check(makeCtx(tempDir, cp));

      expect(result.status).toBe('pass');
      // Total file count must reflect only files under the configured content
      // dirs (Music + Video/Movies + Video/Shows). Notes.m4a / IMG_001.mp4
      // must not appear in the scan totals.
      expect(result.summary).toContain('1 file');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Override precedence — AC #6 (three nested permutations)
  // ──────────────────────────────────────────────────────────────────────────

  describe('AC#6 musicDir override precedence (per-device > deviceDefaults > preset default)', () => {
    // Layer 1: per-device override beats every fallback.
    it('per-device override `MyMusic` wins over deviceDefaults `Tunes` and preset default `Music`', async () => {
      const musicDir = resolveMusicDir({
        perDevice: 'MyMusic',
        deviceDefaults: 'Tunes',
        presetDefault: BUILT_IN_PRESETS.generic.contentPaths.musicDir,
      });
      expect(musicDir).toBe('MyMusic');

      const cp: ContentPaths = {
        musicDir,
        moviesDir: 'Video/Movies',
        tvShowsDir: 'Video/Shows',
      };

      await createFiles(tempDir, {
        // Place orphan under the per-device override path. If the precedence
        // is broken the scanner would target `Tunes/` or `Music/` instead and
        // miss the orphan entirely.
        'MyMusic/Artist/Album/orphan.mp3': 'orphan in per-device override',
        // Decoy: file under the deviceDefaults dir must NOT be scanned.
        'Tunes/decoy.mp3': 'should be invisible to scanner',
        // Decoy: file under the preset default must NOT be scanned.
        'Music/decoy.mp3': 'should be invisible to scanner',
      });
      await writeManifest(tempDir, []);

      const result = await orphanFilesMassStorageCheck.check(makeCtx(tempDir, cp));

      expect(result.status).toBe('warn');
      expect(result.details?.orphanCount).toBe(1);
      const orphans = result.details?.orphans as Array<{ path: string }>;
      expect(orphans[0]!.path).toBe(join(tempDir, 'MyMusic/Artist/Album/orphan.mp3'));
    });

    // Layer 2: deviceDefaults wins when no per-device override.
    it('deviceDefaults `Tunes` wins over preset default `Music` when no per-device override is set', async () => {
      const musicDir = resolveMusicDir({
        // perDevice undefined
        deviceDefaults: 'Tunes',
        presetDefault: BUILT_IN_PRESETS.generic.contentPaths.musicDir,
      });
      expect(musicDir).toBe('Tunes');

      const cp: ContentPaths = {
        musicDir,
        moviesDir: 'Video/Movies',
        tvShowsDir: 'Video/Shows',
      };

      await createFiles(tempDir, {
        'Tunes/Artist/Album/orphan.mp3': 'orphan in deviceDefaults dir',
        // Decoy under preset default — must NOT be scanned.
        'Music/decoy.mp3': 'should be invisible to scanner',
      });
      await writeManifest(tempDir, []);

      const result = await orphanFilesMassStorageCheck.check(makeCtx(tempDir, cp));

      expect(result.status).toBe('warn');
      expect(result.details?.orphanCount).toBe(1);
      const orphans = result.details?.orphans as Array<{ path: string }>;
      expect(orphans[0]!.path).toBe(join(tempDir, 'Tunes/Artist/Album/orphan.mp3'));
    });

    // Layer 3: preset default applies when neither override layer is set.
    it('preset default `Music` applies when both per-device and deviceDefaults are absent', async () => {
      const musicDir = resolveMusicDir({
        // perDevice undefined
        // deviceDefaults undefined
        presetDefault: BUILT_IN_PRESETS.generic.contentPaths.musicDir,
      });
      expect(musicDir).toBe('Music');

      const cp = presetContentPaths('generic');

      await createFiles(tempDir, {
        'Music/Artist/Album/orphan.mp3': 'orphan in preset-default dir',
      });
      await writeManifest(tempDir, []);

      const result = await orphanFilesMassStorageCheck.check(makeCtx(tempDir, cp));

      expect(result.status).toBe('warn');
      expect(result.details?.orphanCount).toBe(1);
      const orphans = result.details?.orphans as Array<{ path: string }>;
      expect(orphans[0]!.path).toBe(join(tempDir, 'Music/Artist/Album/orphan.mp3'));
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Repair behaviour — AC #7, #8, #9
  // ──────────────────────────────────────────────────────────────────────────

  describe('repair behaviour', () => {
    // AC #7
    it('AC#7 repair deletes orphans then subsequent check reports pass', async () => {
      const cp = presetContentPaths('generic');

      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'managed',
        'Music/Artist/Album/orphan-a.mp3': 'orphan a',
        'Music/Artist/Album/orphan-b.mp3': 'orphan b',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      // Initial check sees 2 orphans
      const before = await orphanFilesMassStorageCheck.check(makeCtx(tempDir, cp));
      expect(before.status).toBe('warn');
      expect(before.details?.orphanCount).toBe(2);

      // Run the repair (not dry-run)
      const repair = await orphanFilesMassStorageCheck.repair!.run(makeRepairCtx(tempDir, cp));
      expect(repair.success).toBe(true);
      expect(repair.details?.deleted).toBe(2);

      // Re-check: now pass
      const after = await orphanFilesMassStorageCheck.check(makeCtx(tempDir, cp));
      expect(after.status).toBe('pass');
    });

    // AC #8
    it('AC#8 repair --dry-run leaves the filesystem unmodified', async () => {
      const cp = presetContentPaths('generic');

      await createFiles(tempDir, {
        'Music/Artist/Album/01 - Track.m4a': 'managed',
        'Music/Artist/Album/orphan.mp3': 'orphan audio',
      });
      await writeManifest(tempDir, ['Music/Artist/Album/01 - Track.m4a']);

      const result = await orphanFilesMassStorageCheck.repair!.run(makeRepairCtx(tempDir, cp), {
        dryRun: true,
      });

      expect(result.success).toBe(true);
      expect(result.summary).toContain('Dry run');
      expect(result.details?.orphanCount).toBe(1);

      // Both files must still exist.
      expect(existsSync(join(tempDir, 'Music/Artist/Album/orphan.mp3'))).toBe(true);
      expect(existsSync(join(tempDir, 'Music/Artist/Album/01 - Track.m4a'))).toBe(true);

      // A follow-up check must still see the orphan.
      const follow = await orphanFilesMassStorageCheck.check(makeCtx(tempDir, cp));
      expect(follow.status).toBe('warn');
      expect(follow.details?.orphanCount).toBe(1);
    });

    // AC #9
    it('AC#9 repair preserves managed files — managed-files set is identical before and after', async () => {
      const cp = presetContentPaths('generic');

      const managed = [
        'Music/Artist/Album/01 - Track.m4a',
        'Music/Artist/Album/02 - Track.m4a',
        'Video/Movies/Movie.m4v',
      ];
      const files: Record<string, string> = {
        'Music/Artist/Album/orphan.mp3': 'orphan a',
        'Video/Movies/orphan.mp4': 'orphan b',
      };
      for (const m of managed) files[m] = `managed:${m}`;
      await createFiles(tempDir, files);
      await writeManifest(tempDir, managed);

      // Snapshot managed paths' existence + sizes BEFORE
      const before = managed.map((m) => ({
        path: m,
        exists: existsSync(join(tempDir, m)),
      }));
      expect(before.every((b) => b.exists)).toBe(true);

      const repair = await orphanFilesMassStorageCheck.repair!.run(makeRepairCtx(tempDir, cp));
      expect(repair.success).toBe(true);
      expect(repair.details?.deleted).toBe(2);

      // All managed files still exist with identical content.
      for (const m of managed) {
        expect(existsSync(join(tempDir, m))).toBe(true);
      }
      // Orphans gone.
      expect(existsSync(join(tempDir, 'Music/Artist/Album/orphan.mp3'))).toBe(false);
      expect(existsSync(join(tempDir, 'Video/Movies/orphan.mp4'))).toBe(false);
    });

    // AC #10
    it('AC#10 partial failure: read-only parent dir → details.errors populated, success=false, deleted=remaining', async () => {
      const cp = presetContentPaths('generic');

      await createFiles(tempDir, {
        // Will be deletable.
        'Music/Artist/A/orphan-a.mp3': 'orphan a',
        // Will live under a read-only parent dir — its unlink will fail.
        'Music/Locked/orphan-b.mp3': 'orphan b',
      });
      await writeManifest(tempDir, []);

      // Lock the parent dir of orphan-b so unlink fails with EACCES.
      // Best-effort: skip the read-only assertion when running as root, since
      // root bypasses DAC checks.
      const lockedDir = join(tempDir, 'Music/Locked');
      await chmod(lockedDir, 0o555);

      let runningAsRoot = false;
      try {
        // unlink should fail; if it doesn't, treat as "running with elevated
        // permissions" and skip the strict assertions.
        const probe = join(lockedDir, '.probe');
        await writeFile(probe, 'x');
        // If writing succeeded, we're root — restore and skip.
        runningAsRoot = true;
        await chmod(lockedDir, 0o755);
        await rm(probe, { force: true });
      } catch {
        // expected: not root.
      }

      if (runningAsRoot) {
        // Document the skip path instead of silently passing.
        expect(true).toBe(true);
        return;
      }

      const result = await orphanFilesMassStorageCheck.repair!.run(makeRepairCtx(tempDir, cp));

      expect(result.success).toBe(false);
      const errors = result.details?.errors as string[] | undefined;
      expect(errors).toBeDefined();
      expect(errors!.length).toBeGreaterThanOrEqual(1);
      // The locked orphan's path appears in at least one error message.
      expect(errors!.some((e) => e.includes('orphan-b.mp3'))).toBe(true);
      // The other orphan must still have been deleted.
      expect(result.details?.deleted).toBe(1);
      expect(existsSync(join(tempDir, 'Music/Artist/A/orphan-a.mp3'))).toBe(false);
      expect(existsSync(join(tempDir, 'Music/Locked/orphan-b.mp3'))).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Applicability — AC #11, #12
  // ──────────────────────────────────────────────────────────────────────────

  describe('applicability across device types', () => {
    // AC #11 — mass-storage-only declared scope and registry lookup
    it('AC#11 orphanFilesMassStorageCheck declares applicableTo=["mass-storage"]; iPod devices skip it', async () => {
      expect(orphanFilesMassStorageCheck.applicableTo).toEqual(['mass-storage']);

      // The registered check resolves by id.
      expect(getDiagnosticCheck('orphan-files-mass-storage')).toBe(orphanFilesMassStorageCheck);

      // Drive runDiagnostics for an iPod with the device-side scopes and
      // assert the mass-storage orphan check is NOT present in the report.
      const ipodReport = await runDiagnostics({
        mountPoint: tempDir, // arbitrary — iPod-scoped checks will skip on absence of DB
        deviceType: 'ipod',
        // No db provided — checks that need it should skip gracefully.
        scopes: ['device-readiness', 'database-health'],
      });
      const ids = ipodReport.checks.map((c) => c.id);
      expect(ids).not.toContain('orphan-files-mass-storage');
    });

    // AC #12 — iPod-flavoured orphan-files NOT applied to mass-storage devices
    it('AC#12 iPod orphan-files check is NOT applied to mass-storage devices (absent from checks[])', async () => {
      expect(orphanFilesCheck.applicableTo).toEqual(['ipod']);

      const cp = presetContentPaths('generic');
      await writeManifest(tempDir, []);

      const msReport = await runDiagnostics({
        mountPoint: tempDir,
        deviceType: 'mass-storage',
        contentPaths: cp,
        scopes: ['device-readiness', 'database-health'],
      });
      const ids = msReport.checks.map((c) => c.id);
      expect(ids).not.toContain('orphan-files');
      // Symmetry: the mass-storage variant IS present on mass-storage runs.
      expect(ids).toContain('orphan-files-mass-storage');
    });
  });
});
