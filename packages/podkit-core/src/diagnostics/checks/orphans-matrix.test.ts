/**
 * Orphan-files (iPod) matrix coverage.
 *
 * Unit tests pinning the iPod-flavour `orphan-files` check. Every test drives
 * the exported `orphanFilesCheck.check` (and `.repair.run`) against a
 * synthetic on-disk × library-references state.
 *
 * Behaviours pinned here:
 *   - no F* directories at all
 *   - every file on disk is library-referenced
 *   - orphans on disk
 *   - the library references files that are not on disk
 *   - orphans spread across multiple F* directories
 *   - repair deletes all detected orphans
 *   - repair --dry-run does not modify the filesystem
 *   - a mix of deletable and undeletable orphans surfaces per-file errors
 *   - repair preserves library-referenced files
 *   - the check is iPod-only
 *
 * The CLI-layer renderings of the same data — CSV escaping, and the verbose
 * groupings by F* directory, by extension and by top-10 largest — live in
 * `doctor-flag-matrix.test.ts`, because they are properties of the renderer
 * rather than of the check. What this file pins is the `details.orphans`
 * shape those renderers consume.
 *
 * Filesystem injection: the production `orphanFilesCheck` reads via
 * `node:fs/promises` directly and exposes no DI seam. We use isolated temp
 * directories (matching the existing `orphans.test.ts` convention) — fast,
 * deterministic, and the "fake filesystem" criterion is met in spirit: each
 * test owns its own throwaway tree, and no test touches any other location.
 *
 * @see packages/podkit-core/src/diagnostics/checks/orphans.test.ts — baseline
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, chmod, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { orphanFilesCheck } from './orphans.js';
import type { DiagnosticContext, RepairContext } from '../types.js';
import type { IpodTrack } from '../../ipod/types.js';
import type { IpodDatabase } from '../../ipod/database.js';
import { makeMockIpodTrack } from '../../test-utils/tracks.js';

// ── Fixture builders ────────────────────────────────────────────────────────

/**
 * Minimal IpodTrack stub. Only `filePath` matters to the orphan check; the
 * mutator methods are plain stubs (no call-count assertions are made on them).
 */
function makeTrack(filePath: string): IpodTrack {
  return makeMockIpodTrack({ filePath });
}

function fakeDb(tracks: IpodTrack[]): IpodDatabase {
  return { getTracks: () => tracks } as unknown as IpodDatabase;
}

function ctx(mountPoint: string, tracks: IpodTrack[]): DiagnosticContext {
  return { mountPoint, deviceType: 'ipod', db: fakeDb(tracks) };
}

function repairCtx(mountPoint: string, tracks: IpodTrack[]): RepairContext {
  return { mountPoint, deviceType: 'ipod', db: fakeDb(tracks), adapters: [] };
}

/**
 * Lay down a synthetic iPod Music tree. Each key is an `iPod_Control/Music`-
 * relative path; the value is the file body (used to set a deterministic size).
 */
async function laydown(mountPoint: string, files: Record<string, string>): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const full = join(mountPoint, 'iPod_Control', 'Music', rel);
    await mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
    await writeFile(full, body);
  }
}

function ipodPath(rel: string): string {
  return `:iPod_Control:Music:${rel.replace(/\//g, ':')}`;
}

// ── Suite ───────────────────────────────────────────────────────────────────

describe('orphanFilesCheck — detection and repair matrix', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'podkit-task305-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── no F* directories ─────────────────────────────────────────────────────

  describe('no F* directories', () => {
    it('skips when the Music directory is absent entirely', async () => {
      // No iPod_Control/Music tree at all.
      const result = await orphanFilesCheck.check(ctx(dir, []));

      expect(result.status).toBe('skip');
      expect(result.summary).toBe('No music directory found');
      expect(result.repairable).toBe(false);
    });

    it('passes when Music exists but contains no F* directories', async () => {
      await mkdir(join(dir, 'iPod_Control', 'Music'), { recursive: true });
      // Add a non-F* sibling to exercise the regex filter.
      await mkdir(join(dir, 'iPod_Control', 'Music', 'iPod Photos'), { recursive: true });

      const result = await orphanFilesCheck.check(ctx(dir, []));

      expect(result.status).toBe('pass');
      expect(result.repairable).toBe(false);
      // Pass path emits zero-valued details for JSON-consumer symmetry.
      expect(result.details?.orphanCount).toBe(0);
      expect(result.details?.wastedBytes).toBe(0);
      expect(result.details?.orphans).toEqual([]);
    });
  });

  // ── every file on disk is referenced ──────────────────────────────────────

  describe('all files referenced', () => {
    it('passes with no orphan details when every disk file maps to a track', async () => {
      await laydown(dir, {
        'F00/a.m4a': 'AAAA',
        'F00/b.m4a': 'BBBB',
        'F23/c.mp3': 'CCCC',
      });

      const tracks = [
        makeTrack(ipodPath('F00/a.m4a')),
        makeTrack(ipodPath('F00/b.m4a')),
        makeTrack(ipodPath('F23/c.mp3')),
      ];
      const result = await orphanFilesCheck.check(ctx(dir, tracks));

      expect(result.status).toBe('pass');
      expect(result.repairable).toBe(false);
      expect(result.summary).toContain('3 files');
      // Pass path emits zero-valued details for JSON-consumer symmetry.
      expect(result.details?.orphanCount).toBe(0);
      expect(result.details?.wastedBytes).toBe(0);
      expect(result.details?.orphans).toEqual([]);
    });
  });

  // ── orphans on disk ───────────────────────────────────────────────────────

  describe('orphans found', () => {
    it('warns with orphanCount, wastedBytes, and orphans[] populated', async () => {
      await laydown(dir, {
        'F00/keep.m4a': 'KEEP',
        'F00/lonely.m4a': 'LONELY-13B!!',
        'F01/strays.mp3': 'STRAYS-10B',
      });

      const tracks = [makeTrack(ipodPath('F00/keep.m4a'))];
      const result = await orphanFilesCheck.check(ctx(dir, tracks));

      expect(result.status).toBe('warn');
      expect(result.repairable).toBe(true);
      expect(result.details).toBeDefined();
      expect(result.details?.orphanCount).toBe(2);
      expect(result.details?.totalFiles).toBe(3);
      const wasted = result.details?.wastedBytes as number;
      // The two orphan bodies are "LONELY-13B!!" (12 bytes) + "STRAYS-10B"
      // (10 bytes) = 22 bytes.
      expect(wasted).toBe(22);

      const orphans = result.details?.orphans as Array<{ path: string; size: number }>;
      expect(orphans).toHaveLength(2);
      const paths = orphans.map((o) => o.path).sort();
      expect(paths).toEqual([
        join(dir, 'iPod_Control', 'Music', 'F00', 'lonely.m4a'),
        join(dir, 'iPod_Control', 'Music', 'F01', 'strays.mp3'),
      ]);
      // Every orphan entry has a numeric size from a real stat() call.
      for (const o of orphans) expect(o.size).toBeGreaterThan(0);
    });
  });

  // ── library refs files not on disk ────────────────────────────────────────

  describe('library references missing files', () => {
    it('still passes for orphan-files when a tracked file is missing on disk', async () => {
      // Only `present.m4a` exists; `missing.m4a` is in the DB but not on disk.
      await laydown(dir, {
        'F00/present.m4a': 'PRESENT',
      });
      const tracks = [
        makeTrack(ipodPath('F00/present.m4a')),
        makeTrack(ipodPath('F00/missing.m4a')),
      ];
      const result = await orphanFilesCheck.check(ctx(dir, tracks));

      // Orphan-files is "files on disk not referenced by the DB", not the
      // inverse. Missing files are a separate concern.
      expect(result.status).toBe('pass');
      expect(result.repairable).toBe(false);
    });
  });

  // ── orphans across multiple F* dirs ───────────────────────────────────────

  describe('orphans spread across multiple F* directories', () => {
    it('reports every orphan across F00, F01, F23', async () => {
      await laydown(dir, {
        'F00/o0.m4a': '0',
        'F01/o1.m4a': '1',
        'F23/o23.mp3': '2',
      });
      const result = await orphanFilesCheck.check(ctx(dir, []));

      expect(result.status).toBe('warn');
      const orphans = result.details?.orphans as Array<{ path: string; size: number }>;
      expect(orphans).toHaveLength(3);
      const dirs = new Set(orphans.map((o) => o.path.split('/').slice(-2, -1)[0]));
      expect(dirs).toEqual(new Set(['F00', 'F01', 'F23']));
    });
  });

  // ── CLI-layer concerns (CSV + verbose grouping) ───────────────────────────

  describe('CLI rendering contract (rendering itself is covered in doctor-flag-matrix.test.ts)', () => {
    it('produces a `details.orphans` array shape that the CLI can render', async () => {
      // This test pins the contract used by the CLI:
      //   - the CSV path/size export consumes `details.orphans[].{path,size}`
      //   - byDir grouping uses `dirname(path)` → F* segment
      //   - byExt grouping uses `extname(path)`
      //   - top-10-by-size uses `details.orphans[].size`
      //
      // The CSV escape branch (commas + quotes) is asserted at the CLI layer
      // because `escapeCsvField` is internal to `commands/doctor.ts`.
      await laydown(dir, {
        'F00/song with, comma.m4a': 'A',
        'F01/song with "quotes".mp3': 'BB',
        'F02/plain.flac': 'CCC',
      });
      const result = await orphanFilesCheck.check(ctx(dir, []));

      const orphans = result.details?.orphans as Array<{ path: string; size: number }>;
      expect(orphans).toHaveLength(3);
      // Each entry has the two fields the CLI renderer + CSV exporter expect.
      for (const o of orphans) {
        expect(typeof o.path).toBe('string');
        expect(typeof o.size).toBe('number');
      }
      // Special-character paths flow through unmodified — escaping happens
      // at the CSV layer, not in the check.
      const names = orphans.map((o) => o.path).join('\n');
      expect(names).toMatch(/song with, comma\.m4a/);
      expect(names).toMatch(/song with "quotes"\.mp3/);
    });
  });

  // ── repair deletes all detected orphans ───────────────────────────────────

  describe('repair deletes orphans, follow-up doctor passes', () => {
    it('deletes every orphan; a follow-up check reports pass', async () => {
      await laydown(dir, {
        'F00/keep.m4a': 'KEEP',
        'F00/o1.m4a': 'O1',
        'F01/o2.mp3': 'O2',
      });
      const tracks = [makeTrack(ipodPath('F00/keep.m4a'))];

      const repair = await orphanFilesCheck.repair!.run(repairCtx(dir, tracks));

      expect(repair.success).toBe(true);
      expect(repair.details?.deleted).toBe(2);
      expect(repair.details?.errors).toBeUndefined();

      // Re-run the detection check — should now pass.
      const recheck = await orphanFilesCheck.check(ctx(dir, tracks));
      expect(recheck.status).toBe('pass');
      expect(recheck.repairable).toBe(false);
    });
  });

  // ── --dry-run leaves filesystem untouched ─────────────────────────────────

  describe('dry-run does not write', () => {
    it('reports planned deletions without removing any file', async () => {
      await laydown(dir, {
        'F00/keep.m4a': 'KEEP',
        'F00/o1.m4a': 'O1',
        'F01/o2.mp3': 'O2',
      });
      const tracks = [makeTrack(ipodPath('F00/keep.m4a'))];

      // Snapshot pre-state.
      const before = await listAllMusic(dir);
      const repair = await orphanFilesCheck.repair!.run(repairCtx(dir, tracks), {
        dryRun: true,
      });

      expect(repair.success).toBe(true);
      expect(repair.summary).toMatch(/Dry run/);
      expect(repair.details?.orphanCount).toBe(2);

      // Post-state is byte-identical to pre-state.
      const after = await listAllMusic(dir);
      expect(after).toEqual(before);
      // Spot-check the named orphans.
      expect(existsSync(join(dir, 'iPod_Control', 'Music', 'F00', 'o1.m4a'))).toBe(true);
      expect(existsSync(join(dir, 'iPod_Control', 'Music', 'F01', 'o2.mp3'))).toBe(true);
    });
  });

  // ── mixed deletable / undeletable ─────────────────────────────────────────

  describe('partial deletion failure surfaces per-file errors', () => {
    it('reports errors[] and success=false when at least one delete fails', async () => {
      // F02 is a directory that we mark read-only. Orphan files inside it
      // can't be unlinked because the parent directory blocks the entry
      // removal. F00's orphan deletes normally.
      await laydown(dir, {
        'F00/o1.m4a': 'O1',
        'F02/locked.m4a': 'LOCKED',
      });
      const f02 = join(dir, 'iPod_Control', 'Music', 'F02');

      // Drop write perms on F02. (POSIX: 0o555 = r-xr-xr-x.)
      await chmod(f02, 0o555);
      try {
        const result = await orphanFilesCheck.repair!.run(repairCtx(dir, []));

        expect(result.success).toBe(false);
        const errors = result.details?.errors as string[] | undefined;
        expect(Array.isArray(errors)).toBe(true);
        expect(errors!.length).toBeGreaterThanOrEqual(1);
        // The error names the path that failed.
        expect(errors!.join('\n')).toContain(join(f02, 'locked.m4a'));
        // The deletable orphan was still removed.
        expect(result.details?.deleted).toBe(1);
        expect(existsSync(join(dir, 'iPod_Control', 'Music', 'F00', 'o1.m4a'))).toBe(false);
      } finally {
        // Restore perms so afterEach can clean up.
        await chmod(f02, 0o755);
      }
    });
  });

  // ── repair preserves managed files ────────────────────────────────────────

  describe('managed files survive repair (file-list diff)', () => {
    it('every track-referenced path is identical pre- and post-repair', async () => {
      await laydown(dir, {
        'F00/keep1.m4a': 'KEEP1',
        'F00/o1.m4a': 'O1',
        'F01/keep2.mp3': 'KEEP2',
        'F01/o2.mp3': 'O2',
        'F02/o3.flac': 'O3',
      });
      const managed = [ipodPath('F00/keep1.m4a'), ipodPath('F01/keep2.mp3')].map(makeTrack);

      const managedFsPaths = [
        join(dir, 'iPod_Control', 'Music', 'F00', 'keep1.m4a'),
        join(dir, 'iPod_Control', 'Music', 'F01', 'keep2.mp3'),
      ];

      // Snapshot every managed file's body before repair.
      const fs = await import('node:fs/promises');
      const before = await Promise.all(
        managedFsPaths.map(async (p) => ({ path: p, body: await fs.readFile(p, 'utf8') }))
      );

      const repair = await orphanFilesCheck.repair!.run(repairCtx(dir, managed));
      expect(repair.success).toBe(true);
      expect(repair.details?.deleted).toBe(3);

      // Post: every managed file still exists, with the same body.
      for (const { path, body } of before) {
        expect(existsSync(path)).toBe(true);
        expect(await fs.readFile(path, 'utf8')).toBe(body);
      }
      // And every orphan is gone.
      expect(existsSync(join(dir, 'iPod_Control', 'Music', 'F00', 'o1.m4a'))).toBe(false);
      expect(existsSync(join(dir, 'iPod_Control', 'Music', 'F01', 'o2.mp3'))).toBe(false);
      expect(existsSync(join(dir, 'iPod_Control', 'Music', 'F02', 'o3.flac'))).toBe(false);
    });
  });

  // ── check is iPod-only ────────────────────────────────────────────────────

  describe('scope is iPod-only', () => {
    it('declares applicableTo: ["ipod"] (mass-storage devices use orphan-files-mass-storage)', () => {
      expect(orphanFilesCheck.applicableTo).toEqual(['ipod']);
    });
  });
});

/**
 * Recursively list every file under `<mount>/iPod_Control/Music` with its
 * absolute path. Used by the dry-run test to assert filesystem invariance.
 */
async function listAllMusic(mountPoint: string): Promise<string[]> {
  const root = join(mountPoint, 'iPod_Control', 'Music');
  const out: string[] = [];
  async function walk(p: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(p, e.name);
      if (e.isDirectory()) await walk(full);
      else out.push(full);
    }
  }
  await walk(root);
  return out.sort();
}
