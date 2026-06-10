/**
 * E2E tests for podkit doctor command — diagnostics and argument validation.
 *
 * Tests the health check pipeline: running checks, JSON output schema,
 * corruption detection, and CLI argument validation for --repair.
 *
 * For artwork repair tests, see ../features/doctor-repair.e2e.test.ts.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtemp, rm, copyFile } from 'node:fs/promises';
import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ensureFixturesExist, requireFFmpeg, requireMetaflac } from '@podkit/e2e-shared';
import { runCli, runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { getTrackPath, Tracks, type AlbumDir } from '../helpers/fixtures';

import type { SyncOutput } from 'podkit/types';
import { readdir, stat, truncate, writeFile } from 'node:fs/promises';

requireFFmpeg();
requireMetaflac();
ensureFixturesExist('goldberg-selections');

// ── Output types (mirrors packages/podkit-cli/src/commands/doctor.ts) ────────

interface DoctorCheckOutput {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  summary: string;
  repairable: boolean;
  details?: Record<string, unknown>;
  docsUrl?: string;
}

interface DoctorOutput {
  healthy: boolean;
  mountPoint: string;
  deviceModel: string;
  checks: DoctorCheckOutput[];
}

// ── Test fixture helpers ─────────────────────────────────────────────────────

interface TrackDef {
  source: { album: AlbumDir; filename: string };
}

const GOLDBERG_TRACKS: TrackDef[] = [
  { source: Tracks.HARMONY },
  { source: Tracks.VIBRATO },
  { source: Tracks.TREMOLO },
];

async function createTempCollection(tracks: TrackDef[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'podkit-doctor-'));
  for (const track of tracks) {
    const srcPath = getTrackPath(track.source.album, track.source.filename);
    const destPath = join(dir, track.source.filename);
    await copyFile(srcPath, destPath);
  }
  return dir;
}

async function createTestConfig(
  sourceDir: string,
  configDir: string,
  collectionName = 'main',
  quality = 'high'
): Promise<string> {
  const configPath = join(configDir, 'config.toml');
  const content = `version = 2

[music.${collectionName}]
path = "${sourceDir}"

quality = "${quality}"

[defaults]
music = "${collectionName}"
`;
  await writeFile(configPath, content);
  return configPath;
}

async function syncTracksToIpod(
  collectionDir: string,
  configDir: string,
  devicePath: string,
  collectionName = 'main',
  quality = 'high'
): Promise<string> {
  const configPath = await createTestConfig(collectionDir, configDir, collectionName, quality);

  const { result } = await runCliJson<SyncOutput>([
    '--config',
    configPath,
    'sync',
    '--device',
    devicePath,
    '--json',
  ]);

  if (result.exitCode !== 0) {
    throw new Error(`Sync failed (exit ${result.exitCode}): ${result.stderr}`);
  }

  return configPath;
}

async function runDoctor(devicePath: string, extraArgs: string[] = []) {
  // E2E doctor tests intentionally skip system-scope checks (FFmpeg encoders,
  // libusb availability, udev rule). Those depend on the host environment and
  // are exercised by their own unit tests with injected probes; asserting on
  // them here couples the test result to whatever the dev box happens to have
  // installed. See agents/testing.md for the system-check testing strategy.
  return runCliJson<DoctorOutput>([
    'doctor',
    '--device',
    devicePath,
    '--no-system',
    '--json',
    ...extraArgs,
  ]);
}

/**
 * Capture a SHA-256 fingerprint of the ArtworkDB slot.
 *
 * Returns a string that encodes both the existence and content of the file so
 * that "didn't exist before, still doesn't exist after" and "existed with
 * content X, still has content X" are both detectable as "no change".
 *
 * We intentionally scope this to the single file rather than hashing the
 * whole Artwork directory because other files (e.g. .ithmb thumbnails) change
 * legitimately during a full sync. Doctor's non-repair path must not touch
 * ArtworkDB — that is the only invariant under test here.
 */
function artworkDbFingerprint(ipodPath: string): string {
  const artworkDbPath = join(ipodPath, 'iPod_Control', 'Artwork', 'ArtworkDB');
  if (!existsSync(artworkDbPath)) {
    return 'absent';
  }
  const buf = readFileSync(artworkDbPath);
  if (buf.length === 0) {
    return 'empty:0bytes';
  }
  return createHash('sha256').update(buf).digest('hex');
}

async function corruptIthmb(ipodPath: string): Promise<void> {
  const artworkDir = join(ipodPath, 'iPod_Control', 'Artwork');
  if (!existsSync(artworkDir)) return;

  const files = await readdir(artworkDir);
  const itmbFiles = files.filter((f) => f.endsWith('.ithmb'));

  for (const itmbFile of itmbFiles) {
    const filePath = join(artworkDir, itmbFile);
    const fileInfo = await stat(filePath);
    if (fileInfo.size > 0) {
      const newSize = Math.max(1, Math.floor(fileInfo.size / 4));
      await truncate(filePath, newSize);
    }
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('podkit doctor', () => {
  // ===========================================================================
  // Diagnostic tests
  // ===========================================================================

  describe('diagnostics', () => {
    it('reports healthy for iPod with valid artwork', async () => {
      await withTarget(async (target) => {
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
        let collectionDir: string | undefined;

        try {
          collectionDir = await createTempCollection(GOLDBERG_TRACKS);
          await syncTracksToIpod(collectionDir, configDir, target.path);

          const { json } = await runDoctor(target.path);

          expect(json).not.toBeNull();
          expect(json!.healthy).toBe(true);

          const artworkCheck = json!.checks.find((c) => c.id === 'artwork-rebuild');
          expect(artworkCheck).toBeDefined();
          expect(artworkCheck!.status).toBe('pass');
        } finally {
          if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
          await rm(configDir, { recursive: true, force: true });
        }
      });
    }, 120000);

    it('reports failure when ithmb files are truncated', async () => {
      await withTarget(async (target) => {
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
        let collectionDir: string | undefined;

        try {
          collectionDir = await createTempCollection(GOLDBERG_TRACKS);
          await syncTracksToIpod(collectionDir, configDir, target.path);
          await corruptIthmb(target.path);

          const { result, json } = await runDoctor(target.path);

          // Doctor ran cleanly but found issues — exit 2
          expect(result.exitCode).toBe(2);
          expect(json).not.toBeNull();
          expect(json!.healthy).toBe(false);

          const artworkCheck = json!.checks.find((c) => c.id === 'artwork-rebuild');
          expect(artworkCheck).toBeDefined();
          expect(artworkCheck!.status).toBe('fail');
          expect(artworkCheck!.details).toBeDefined();
          expect(artworkCheck!.details!.corruptEntries).toBeGreaterThan(0);
          expect(artworkCheck!.repairable).toBe(true);
        } finally {
          if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
          await rm(configDir, { recursive: true, force: true });
        }
      });
    }, 120000);

    it('reports healthy for iPod with no artwork', async () => {
      await withTarget(async (target) => {
        const { result, json } = await runDoctor(target.path);

        expect(result.exitCode).toBe(0);
        expect(json).not.toBeNull();
        expect(json!.healthy).toBe(true);

        // The dummy iPod template includes a valid-but-empty ArtworkDB
        // (944-byte mhfd header, 0 image entries). The artwork check parses
        // it successfully and returns 'pass' (artwork.ts:83-89).
        // Doctor's non-repair path never calls db.save() — the hash-stability
        // tests below confirm the file is unchanged after the run.
        const artworkCheck = json!.checks.find((c) => c.id === 'artwork-rebuild');
        expect(artworkCheck).toBeDefined();
        expect(artworkCheck!.status).toBe('pass');
      });
    }, 30000);

    it('skips when ArtworkDB exists but is 0 bytes', async () => {
      await withTarget(async (target) => {
        // The template already has the Artwork directory; overwrite ArtworkDB
        // with a 0-byte file to exercise the buffer.length === 0 guard.
        const artworkDbPath = join(target.path, 'iPod_Control', 'Artwork', 'ArtworkDB');
        writeFileSync(artworkDbPath, Buffer.alloc(0));

        const { json } = await runDoctor(target.path);

        expect(json).not.toBeNull();
        expect(json!.healthy).toBe(true);

        // 0-byte ArtworkDB → artwork.ts buffer.length === 0 guard returns 'skip'.
        // Doctor's non-repair path never calls db.save(), so the file stays
        // at 0 bytes throughout the run. See hash-stability test below.
        const artworkCheck = json!.checks.find((c) => c.id === 'artwork-rebuild');
        expect(artworkCheck).toBeDefined();
        expect(artworkCheck!.status).toBe('skip');
      });
    }, 30000);
  });

  // ===========================================================================
  // Doctor read-only contract — ArtworkDB hash stability
  //
  // Doctor's non-repair path must NOT mutate the device. These tests enforce
  // that contract empirically: SHA-256 the ArtworkDB slot before and after
  // `podkit doctor`, then assert the fingerprint is unchanged.
  //
  // The fingerprint encodes absence ("absent"), empty content ("empty:0bytes"),
  // and non-empty content (SHA-256 hex), so all three mutation modes are caught:
  //   - file created from nothing
  //   - empty file written with a header
  //   - existing content overwritten
  // ===========================================================================

  describe('doctor read-only contract (ArtworkDB hash stability)', () => {
    it('does not mutate an existing ArtworkDB during a diagnostic run', async () => {
      // The dummy iPod template ships with a valid-but-empty ArtworkDB.
      // Capture its fingerprint before and after doctor to confirm no write.
      await withTarget(async (target) => {
        const before = artworkDbFingerprint(target.path);

        await runDoctor(target.path);

        const after = artworkDbFingerprint(target.path);
        expect(after).toBe(before);
      });
    }, 30000);

    it('does not modify a 0-byte ArtworkDB during a diagnostic run', async () => {
      await withTarget(async (target) => {
        // Replace the template ArtworkDB with a 0-byte file to test the
        // buffer.length === 0 guard. Doctor must leave it untouched.
        const artworkDbPath = join(target.path, 'iPod_Control', 'Artwork', 'ArtworkDB');
        writeFileSync(artworkDbPath, Buffer.alloc(0));

        const before = artworkDbFingerprint(target.path);
        expect(before).toBe('empty:0bytes');

        await runDoctor(target.path);

        const after = artworkDbFingerprint(target.path);
        expect(after).toBe('empty:0bytes');
      });
    }, 30000);

    it('does not create an ArtworkDB when none exists', async () => {
      await withTarget(async (target) => {
        // Remove the template ArtworkDB so the existsSync gate fires. Doctor
        // must not write a new file to satisfy parsing.
        const artworkDbPath = join(target.path, 'iPod_Control', 'Artwork', 'ArtworkDB');
        unlinkSync(artworkDbPath);

        const before = artworkDbFingerprint(target.path);
        expect(before).toBe('absent');

        await runDoctor(target.path);

        const after = artworkDbFingerprint(target.path);
        expect(after).toBe('absent');
      });
    }, 30000);
  });

  // ===========================================================================
  // JSON output schema
  // ===========================================================================

  describe('JSON output', () => {
    it('produces valid JSON with correct schema for pass case', async () => {
      await withTarget(async (target) => {
        const { json, parseError } = await runDoctor(target.path);

        expect(parseError).toBeUndefined();
        expect(json).not.toBeNull();

        expect(typeof json!.healthy).toBe('boolean');
        expect(typeof json!.mountPoint).toBe('string');
        expect(typeof json!.deviceModel).toBe('string');
        expect(Array.isArray(json!.checks)).toBe(true);

        for (const check of json!.checks) {
          expect(typeof check.id).toBe('string');
          expect(typeof check.name).toBe('string');
          expect(['pass', 'fail', 'warn', 'skip']).toContain(check.status);
          expect(typeof check.summary).toBe('string');
        }
      });
    }, 30000);

    it('produces valid JSON with correct schema for fail case', async () => {
      await withTarget(async (target) => {
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
        let collectionDir: string | undefined;

        try {
          collectionDir = await createTempCollection(GOLDBERG_TRACKS);
          await syncTracksToIpod(collectionDir, configDir, target.path);
          await corruptIthmb(target.path);

          const { json, parseError } = await runDoctor(target.path);

          expect(parseError).toBeUndefined();
          expect(json).not.toBeNull();
          expect(json!.healthy).toBe(false);

          const failedCheck = json!.checks.find((c) => c.status === 'fail');
          expect(failedCheck).toBeDefined();
          expect(failedCheck!.details).toBeDefined();
          expect(typeof failedCheck!.details!.totalEntries).toBe('number');
          expect(typeof failedCheck!.details!.corruptEntries).toBe('number');
          expect(typeof failedCheck!.details!.healthyEntries).toBe('number');
          expect(typeof failedCheck!.details!.corruptPercent).toBe('number');
          expect(failedCheck!.repairable).toBe(true);
          expect(failedCheck!.docsUrl).toBeDefined();
        } finally {
          if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
          await rm(configDir, { recursive: true, force: true });
        }
      });
    }, 120000);
  });

  // ===========================================================================
  // Argument validation
  // ===========================================================================

  describe('argument validation', () => {
    it('requires -d for --repair', async () => {
      const result = await runCli(['doctor', '--repair', 'artwork-rebuild']);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Repair requires an explicit device');
    }, 30000);

    it('requires -c for --repair artwork-rebuild', async () => {
      await withTarget(async (target) => {
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));

        try {
          const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-src-'));
          const configPath = await createTestConfig(collectionDir, configDir, 'main', 'high');

          const result = await runCli([
            '--config',
            configPath,
            'doctor',
            '--repair',
            'artwork-rebuild',
            '--device',
            target.path,
          ]);

          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain('requires a source collection');

          await rm(collectionDir, { recursive: true, force: true });
        } finally {
          await rm(configDir, { recursive: true, force: true });
        }
      });
    }, 30000);

    it('diagnostics work with -d but without -c', async () => {
      await withTarget(async (target) => {
        const { result, json } = await runDoctor(target.path);

        expect(result.exitCode).toBe(0);
        expect(json).not.toBeNull();
        expect(json!.checks.length).toBeGreaterThan(0);
      });
    }, 30000);
  });
});
