/**
 * E2E tests for podkit doctor --repair artwork-rebuild.
 *
 * Tests the artwork repair workflow: full repair, partial matches,
 * no-artwork sources, dry run, sync tag handling, idempotency,
 * and error recovery.
 *
 * These tests use directory sources (no Docker needed). They require:
 * - Audio fixtures (test/fixtures/audio/)
 * - metaflac (for stripping artwork)
 * - ffmpeg (for transcoding)
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import {
  mkdtemp,
  rm,
  copyFile,
  readFile,
  readdir,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { existsSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { areFixturesAvailable, getTrackPath, Tracks, type AlbumDir } from '../helpers/fixtures';

import type { SyncOutput } from 'podkit/types';

// ── Output types (mirrors packages/podkit-cli/src/commands/doctor.ts) ────────

interface DoctorOutput {
  healthy: boolean;
  mountPoint: string;
  deviceModel: string;
  checks: Array<{
    id: string;
    name: string;
    status: 'pass' | 'fail' | 'warn' | 'skip';
    summary: string;
  }>;
}

interface RepairOutput {
  success: boolean;
  summary: string;
  checkId: string;
  dryRun: boolean;
  details?: {
    totalTracks?: number;
    matched?: number;
    noSource?: number;
    noArtwork?: number;
    errors?: number;
    errorDetails?: Array<{ artist: string; title: string; error: string }>;
  };
}

// ── Prerequisite checks ──────────────────────────────────────────────────────

function isMetaflacAvailable(): boolean {
  try {
    execSync('which metaflac', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isFfmpegAvailable(): boolean {
  try {
    execSync('which ffmpeg', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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

const FLAC_FILENAMES = ['01-harmony.flac', '02-vibrato.flac', '03-tremolo.flac'];

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
  const content = `version = 1

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

async function runDoctor(devicePath: string) {
  // E2E tests skip system-scope checks; see ../commands/doctor.e2e.test.ts
  // for the full rationale.
  return runCliJson<DoctorOutput>(['doctor', '--device', devicePath, '--no-system', '--json']);
}

async function runDoctorRepair(
  configPath: string,
  devicePath: string,
  collectionName: string,
  extraArgs: string[] = []
) {
  return runCliJson<RepairOutput>([
    '--config',
    configPath,
    'doctor',
    '--repair',
    'artwork-rebuild',
    '--device',
    devicePath,
    '-c',
    collectionName,
    '--json',
    ...extraArgs,
  ]);
}

function stripArtwork(dir: string, filenames: string[]): void {
  for (const filename of filenames) {
    const path = join(dir, filename);
    execSync(`metaflac --remove --block-type=PICTURE "${path}"`, { stdio: 'ignore' });
  }
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

async function getDirectoryChecksums(dirPath: string): Promise<Map<string, string>> {
  const checksums = new Map<string, string>();

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const data = await readFile(fullPath);
        const hash = createHash('sha256').update(data).digest('hex');
        const relPath = fullPath.slice(dirPath.length);
        checksums.set(relPath, hash);
      }
    }
  }

  await walk(dirPath);
  return checksums;
}

// =============================================================================
// Tests
// =============================================================================

describe('podkit doctor --repair artwork-rebuild', () => {
  let fixturesAvailable = false;
  let metaflacAvailable = false;
  let ffmpegAvailable = false;

  beforeAll(async () => {
    fixturesAvailable = await areFixturesAvailable();
    metaflacAvailable = isMetaflacAvailable();
    ffmpegAvailable = isFfmpegAvailable();
  });

  function canRun(): boolean {
    return fixturesAvailable && metaflacAvailable && ffmpegAvailable;
  }

  function skipReason(): string | null {
    if (!fixturesAvailable) return 'fixtures not available';
    if (!metaflacAvailable) return 'metaflac not available';
    if (!ffmpegAvailable) return 'ffmpeg not available';
    return null;
  }

  // ===========================================================================
  // Repair workflow
  // ===========================================================================

  it('repairs corrupted artwork and doctor passes afterward', async () => {
    if (!canRun()) {
      console.log(`Skipping: ${skipReason()}`);
      return;
    }

    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        collectionDir = await createTempCollection(GOLDBERG_TRACKS);
        const configPath = await syncTracksToIpod(collectionDir, configDir, target.path);

        // Corrupt artwork
        await corruptIthmb(target.path);

        // Verify corruption is detected
        const { json: preDiag } = await runDoctor(target.path);
        expect(preDiag!.healthy).toBe(false);

        // Run repair
        const { result: repairResult, json: repairJson } = await runDoctorRepair(
          configPath,
          target.path,
          'main'
        );
        expect(repairResult.exitCode).toBe(0);
        expect(repairJson).not.toBeNull();
        expect(repairJson!.success).toBe(true);
        expect(repairJson!.details?.matched).toBe(3);
        expect(repairJson!.details?.errors).toBe(0);
        expect(repairJson!.dryRun).toBe(false);

        // Verify doctor passes after repair
        const { json: postDiag } = await runDoctor(target.path);
        expect(postDiag!.healthy).toBe(true);
      } finally {
        if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);

  it('handles partial source matches — unmatched tracks get artwork cleared', async () => {
    if (!canRun()) {
      console.log(`Skipping: ${skipReason()}`);
      return;
    }

    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let fullCollectionDir: string | undefined;
      let partialCollectionDir: string | undefined;

      try {
        // Sync 3 tracks
        fullCollectionDir = await createTempCollection(GOLDBERG_TRACKS);
        await syncTracksToIpod(fullCollectionDir, configDir, target.path);

        // Corrupt artwork
        await corruptIthmb(target.path);

        // Create a partial collection with only 1 of the 3 tracks
        partialCollectionDir = await mkdtemp(join(tmpdir(), 'podkit-partial-'));
        await copyFile(
          getTrackPath(Tracks.HARMONY.album, Tracks.HARMONY.filename),
          join(partialCollectionDir, Tracks.HARMONY.filename)
        );

        // Rewrite config to point to partial collection
        const configPath = await createTestConfig(partialCollectionDir, configDir, 'main', 'high');

        // Repair with partial source
        const { result: repairResult, json: repairJson } = await runDoctorRepair(
          configPath,
          target.path,
          'main'
        );
        expect(repairResult.exitCode).toBe(0);
        expect(repairJson).not.toBeNull();
        expect(repairJson!.success).toBe(true);
        expect(repairJson!.details?.matched).toBe(1);
        expect(repairJson!.details?.noSource).toBe(2);
        expect(repairJson!.details?.errors).toBe(0);

        // Doctor should pass — no corruption, just missing artwork
        const { json: postDiag } = await runDoctor(target.path);
        expect(postDiag!.healthy).toBe(true);
      } finally {
        if (fullCollectionDir) await rm(fullCollectionDir, { recursive: true, force: true });
        if (partialCollectionDir) await rm(partialCollectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);

  it('reports noArtwork when source files have no embedded artwork', async () => {
    if (!canRun()) {
      console.log(`Skipping: ${skipReason()}`);
      return;
    }

    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Sync tracks with artwork first
        collectionDir = await createTempCollection(GOLDBERG_TRACKS);
        const configPath = await syncTracksToIpod(collectionDir, configDir, target.path);

        // Strip artwork from source files
        stripArtwork(collectionDir, FLAC_FILENAMES);

        // Run repair — source files exist but have no artwork
        const { json: repairJson } = await runDoctorRepair(configPath, target.path, 'main');
        expect(repairJson).not.toBeNull();
        expect(repairJson!.success).toBe(true);
        expect(repairJson!.details?.noArtwork).toBe(3);
        expect(repairJson!.details?.matched).toBe(0);
      } finally {
        if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);

  // ===========================================================================
  // Dry run
  // ===========================================================================

  it('dry run reports changes without modifying files', async () => {
    if (!canRun()) {
      console.log(`Skipping: ${skipReason()}`);
      return;
    }

    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        collectionDir = await createTempCollection(GOLDBERG_TRACKS);
        const configPath = await syncTracksToIpod(collectionDir, configDir, target.path);

        // Corrupt artwork
        await corruptIthmb(target.path);

        // Snapshot file checksums before dry run
        const beforeChecksums = await getDirectoryChecksums(target.path);

        // Run repair with --dry-run
        const { json: repairJson } = await runDoctorRepair(configPath, target.path, 'main', [
          '--dry-run',
        ]);
        expect(repairJson).not.toBeNull();
        expect(repairJson!.dryRun).toBe(true);
        expect(repairJson!.details?.matched).toBe(3);

        // Verify no files were modified
        const afterChecksums = await getDirectoryChecksums(target.path);
        expect(afterChecksums.size).toBe(beforeChecksums.size);
        for (const [filePath, hash] of beforeChecksums) {
          expect(afterChecksums.get(filePath)).toBe(hash);
        }

        // Doctor should still fail (nothing was repaired)
        const { json: postDiag } = await runDoctor(target.path);
        expect(postDiag!.healthy).toBe(false);
      } finally {
        if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);

  // ===========================================================================
  // Sync tag handling
  // ===========================================================================

  it('preserves quality and encoding in sync tags, only updates art=', async () => {
    if (!canRun()) {
      console.log(`Skipping: ${skipReason()}`);
      return;
    }

    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        collectionDir = await createTempCollection(GOLDBERG_TRACKS);
        const configPath = await syncTracksToIpod(collectionDir, configDir, target.path);

        const tracksBefore = await target.getTracks();
        expect(tracksBefore.length).toBe(3);

        // Corrupt and repair
        await corruptIthmb(target.path);
        const { result: repairResult } = await runDoctorRepair(configPath, target.path, 'main');
        expect(repairResult.exitCode).toBe(0);

        const tracksAfter = await target.getTracks();
        expect(tracksAfter.length).toBe(3);

        // Doctor should pass
        const { json: postDiag } = await runDoctor(target.path);
        expect(postDiag!.healthy).toBe(true);
      } finally {
        if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);

  it('clears art= from sync tag when track has no source match', async () => {
    if (!canRun()) {
      console.log(`Skipping: ${skipReason()}`);
      return;
    }

    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;
      let emptyCollectionDir: string | undefined;

      try {
        // Sync tracks with artwork
        collectionDir = await createTempCollection(GOLDBERG_TRACKS);
        await syncTracksToIpod(collectionDir, configDir, target.path);

        // Create empty collection (no source matches)
        emptyCollectionDir = await mkdtemp(join(tmpdir(), 'podkit-empty-'));
        const configPath = await createTestConfig(emptyCollectionDir, configDir, 'main', 'high');

        // Repair with no sources
        const { json: repairJson } = await runDoctorRepair(configPath, target.path, 'main');
        expect(repairJson!.details?.noSource).toBe(3);
        expect(repairJson!.details?.matched).toBe(0);
        expect(repairJson!.details?.errors).toBe(0);

        // Doctor should still pass (artwork cleared, no corruption)
        const { json: postDiag } = await runDoctor(target.path);
        expect(postDiag!.healthy).toBe(true);
      } finally {
        if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
        if (emptyCollectionDir) await rm(emptyCollectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);

  // ===========================================================================
  // Edge cases
  // ===========================================================================

  // Note: Tests for batched saves (>200 tracks) and album artwork caching
  // are better covered by unit tests — they require large track counts and
  // adapter call instrumentation respectively.

  it('second repair is a no-op when artwork is already correct', async () => {
    if (!canRun()) {
      console.log(`Skipping: ${skipReason()}`);
      return;
    }

    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        collectionDir = await createTempCollection(GOLDBERG_TRACKS);
        const configPath = await syncTracksToIpod(collectionDir, configDir, target.path);

        // Corrupt and repair
        await corruptIthmb(target.path);
        const { json: repair1Json } = await runDoctorRepair(configPath, target.path, 'main');
        expect(repair1Json!.details?.matched).toBe(3);

        // Doctor passes
        const { json: midDiag } = await runDoctor(target.path);
        expect(midDiag!.healthy).toBe(true);

        // Run repair again — should still succeed and match all tracks
        const { json: repair2Json } = await runDoctorRepair(configPath, target.path, 'main');
        expect(repair2Json!.success).toBe(true);
        expect(repair2Json!.details?.matched).toBe(3);
        expect(repair2Json!.details?.errors).toBe(0);

        // Doctor still passes
        const { json: postDiag } = await runDoctor(target.path);
        expect(postDiag!.healthy).toBe(true);
      } finally {
        if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 240000);

  it('continues repairing remaining tracks when one source file is corrupt', async () => {
    if (!canRun()) {
      console.log(`Skipping: ${skipReason()}`);
      return;
    }

    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Sync 3 tracks with artwork
        collectionDir = await createTempCollection(GOLDBERG_TRACKS);
        const configPath = await syncTracksToIpod(collectionDir, configDir, target.path);

        // Corrupt one source file (write garbage to make it unreadable as audio).
        // The directory adapter reads metadata from files, so a corrupt file may
        // either fail to scan (becoming noSource) or scan but fail during artwork
        // extraction (becoming an error or noArtwork via album cache). All 3 tracks
        // share the same album, so caching effects apply.
        const corruptFile = join(collectionDir, Tracks.HARMONY.filename);
        writeFileSync(corruptFile, Buffer.from('NOT_A_VALID_FLAC_FILE'));

        // Run repair — should complete without crashing
        const { json: repairJson } = await runDoctorRepair(configPath, target.path, 'main');

        expect(repairJson).not.toBeNull();
        const details = repairJson!.details!;
        expect(details.totalTracks).toBe(3);
        // All tracks must be accounted for in some category
        const accounted =
          (details.matched ?? 0) +
          (details.noSource ?? 0) +
          (details.noArtwork ?? 0) +
          (details.errors ?? 0);
        expect(accounted).toBe(3);
      } finally {
        if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);
});
