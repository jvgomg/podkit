/**
 * E2E tests for self-healing sync (upgrade detection and application).
 *
 * Covers four upgrade paths:
 * - Metadata correction (genre, year, trackNumber, ...) — purely metadata
 *   comparison, runs on every adapter.
 * - Normalization update — soundcheck / ReplayGain re-write when source
 *   values change.
 * - Format upgrade (MP3 → FLAC re-routed to transcode) — see
 *   `documents/architecture/sync/upgrades.md` for why this gate is
 *   suppressed when the iPod track is already AAC.
 * - Quality upgrade (MP3 source bitrate rises past the iPod-stored copy) —
 *   requires both `source.bitrate` and the iPod track's persisted bitrate
 *   to populate the `detectUpgrades` gate; the second is written on copy
 *   today, with `--force-sync-tags` backfilling pre-existing tracks.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtemp, rm, copyFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { ensureFixturesExist, requireFFmpeg, requireMetaflac } from '@podkit/e2e-shared';
import { runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';
import { getTrackPath, Tracks, type AlbumDir } from '../helpers/fixtures';

import type { SyncOutput } from 'podkit/types';

requireMetaflac();
ensureFixturesExist('goldberg-selections');

/**
 * Tracks used for upgrade testing — all from Goldberg Selections with artwork.
 */
const TEST_TRACKS: Array<{ source: { album: AlbumDir; filename: string } }> = [
  { source: Tracks.HARMONY },
  { source: Tracks.VIBRATO },
  { source: Tracks.TREMOLO },
];

/**
 * Create a test collection by copying FLAC fixtures.
 *
 * @returns Path to the test collection directory
 */
async function createTestCollection(): Promise<string> {
  const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-upgrade-'));

  for (const track of TEST_TRACKS) {
    const sourcePath = getTrackPath(track.source.album, track.source.filename);
    const destPath = join(collectionDir, track.source.filename);
    await copyFile(sourcePath, destPath);
  }

  return collectionDir;
}

/**
 * Modify the GENRE tag on all FLAC files in the collection.
 */
function changeGenre(collectionDir: string, newGenre: string): void {
  for (const track of TEST_TRACKS) {
    const filePath = join(collectionDir, track.source.filename);
    execSync(`metaflac --remove-tag=GENRE --set-tag="GENRE=${newGenre}" "${filePath}"`, {
      stdio: 'ignore',
    });
  }
}

/**
 * Modify the DATE (year) tag on all FLAC files in the collection.
 */
function changeYear(collectionDir: string, newYear: number): void {
  for (const track of TEST_TRACKS) {
    const filePath = join(collectionDir, track.source.filename);
    execSync(`metaflac --remove-tag=DATE --set-tag="DATE=${newYear}" "${filePath}"`, {
      stdio: 'ignore',
    });
  }
}

/**
 * Create a config file for the test collection.
 *
 * `reduce` optionally pins the `[bitrate].reduce` axis (ADR-023): `always`
 * (convert — reduce over-cap device-native lossy), `never` (preserve — keep it
 * untouched), or unset (`auto`, which follows the transfer mode and defaults to
 * preserve under the default `fast` mode). Lossy reduction tests must opt into
 * `convert` explicitly because preserve is the default.
 */
async function createConfigFile(
  configDir: string,
  options: { source: string; reduce?: 'auto' | 'always' | 'never' }
): Promise<string> {
  const configPath = join(configDir, 'config.toml');

  const bitrateBlock = options.reduce ? `\n[bitrate]\nreduce = "${options.reduce}"\n` : '';
  const content = `version = 2

[music.default]
path = "${options.source}"

quality = "low"
${bitrateBlock}
[defaults]
music = "default"
`;

  await writeFile(configPath, content);
  return configPath;
}

// =============================================================================
// Tests
// =============================================================================

describe('self-healing sync: upgrade workflow', () => {
  it('detects and applies metadata corrections (genre change)', async () => {
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Step 1: Create collection with original genre ("Electronic") and sync
        collectionDir = await createTestCollection();

        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
        });

        const { result: result1, json: json1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result1.exitCode).toBe(0);
        expect(json1?.success).toBe(true);
        expect(json1?.result?.completed).toBe(3);

        const tracksAfterFirstSync = await target.getTracks();
        expect(tracksAfterFirstSync.length).toBe(3);

        // Step 2: Change genre to "Ambient" in the source files
        changeGenre(collectionDir, 'Ambient');

        // Step 3: Sync again — should detect metadata corrections
        const { result: result2, json: json2 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result2.exitCode).toBe(0);
        expect(json2?.success).toBe(true);

        // Step 4: Verify track count is unchanged (corrections, not adds)
        const tracksAfterCorrection = await target.getTracks();
        expect(tracksAfterCorrection.length).toBe(3);

        // Step 5: Verify updates were applied. changeGenre + changeYear hit
        // every fixture track, so all 3 should complete. Detailed plan
        // breakdown is asserted in the sibling dry-run test below;
        // non-dry-run sync output does not carry `plan`.
        expect(json2!.result!.completed).toBe(3);
      } finally {
        if (collectionDir) {
          await rm(collectionDir, { recursive: true, force: true });
        }
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('reports metadata corrections in dry-run without applying them', async () => {
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Step 1: Create collection and initial sync
        collectionDir = await createTestCollection();

        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
        });

        await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        const initialCount = (await target.getTracks()).length;
        expect(initialCount).toBe(3);

        // Step 2: Change metadata
        changeGenre(collectionDir, 'Ambient');
        changeYear(collectionDir, 2000);

        // Step 3: Dry-run sync — detect corrections without applying
        const { result, json } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);

        expect(result.exitCode).toBe(0);
        expect(json?.success).toBe(true);
        expect(json?.dryRun).toBe(true);

        // Should report metadata corrections for all 3 fixture tracks.
        expect(json!.plan).toBeDefined();
        expect(json!.plan!.tracksToUpdate).toBe(3);
        expect(json!.plan!.tracksToAdd).toBe(0);

        // Track count should be unchanged (dry-run didn't modify anything)
        const countAfterDryRun = (await target.getTracks()).length;
        expect(countAfterDryRun).toBe(initialCount);
      } finally {
        if (collectionDir) {
          await rm(collectionDir, { recursive: true, force: true });
        }
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('preserves track count through metadata correction cycle', async () => {
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Step 1: Create collection and sync
        collectionDir = await createTestCollection();

        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
        });

        await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        // Step 2: Change metadata and sync
        changeGenre(collectionDir, 'Ambient');
        await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        // Step 3: Change metadata again and sync
        changeGenre(collectionDir, 'Classical');
        changeYear(collectionDir, 1999);
        const { result: result3, json: json3 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result3.exitCode).toBe(0);
        expect(json3?.success).toBe(true);

        // Track count should still be 3 through all correction cycles
        const finalTracks = await target.getTracks();
        expect(finalTracks.length).toBe(3);

        // Step 4: Sync again with no changes — should be no-op
        const { json: json4 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        // Idempotency: a no-change re-sync should perform zero operations.
        // (Non-dry-run sync output has no `plan`; assert on `result` instead.)
        expect(json4!.result!.completed).toBe(0);
      } finally {
        if (collectionDir) {
          await rm(collectionDir, { recursive: true, force: true });
        }
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);
});

// =============================================================================
// Normalization update: verify soundcheck is written and re-sync is idempotent
//
// Source FLAC fixtures include ReplayGain tags. After the initial sync, the iPod
// should have non-zero soundcheck values. A re-sync with no changes should
// produce zero updates (proving the normalization was actually persisted).
// =============================================================================

describe('self-healing sync: normalization update', () => {
  it('initial sync writes soundcheck and re-sync is idempotent', async () => {
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Step 1: Create collection with ReplayGain tags and sync
        collectionDir = await createTestCollection();

        // Ensure all tracks have ReplayGain tags
        for (const track of TEST_TRACKS) {
          const filePath = join(collectionDir, track.source.filename);
          execSync(
            `metaflac --remove-tag=REPLAYGAIN_TRACK_GAIN --set-tag="REPLAYGAIN_TRACK_GAIN=-7.50 dB" "${filePath}"`,
            { stdio: 'ignore' }
          );
        }

        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
        });

        const { result: result1, json: json1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result1.exitCode).toBe(0);
        expect(json1?.success).toBe(true);
        expect(json1?.result?.completed).toBe(3);

        // Step 2: Re-sync with no changes — should be a no-op
        const { result: result2, json: json2 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result2.exitCode).toBe(0);
        expect(json2?.success).toBe(true);

        // Idempotency: a no-change re-sync should perform zero operations.
        expect(json2!.result!.completed).toBe(0);
      } finally {
        if (collectionDir) {
          await rm(collectionDir, { recursive: true, force: true });
        }
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('detects and applies normalization changes', async () => {
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Step 1: Create collection with ReplayGain -3.0 dB and sync
        collectionDir = await createTestCollection();

        for (const track of TEST_TRACKS) {
          const filePath = join(collectionDir, track.source.filename);
          execSync(
            `metaflac --remove-tag=REPLAYGAIN_TRACK_GAIN --set-tag="REPLAYGAIN_TRACK_GAIN=-3.00 dB" "${filePath}"`,
            { stdio: 'ignore' }
          );
        }

        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
        });

        await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        // Step 2: Change ReplayGain to -9.0 dB (>0.1 dB change triggers update)
        for (const track of TEST_TRACKS) {
          const filePath = join(collectionDir, track.source.filename);
          execSync(
            `metaflac --remove-tag=REPLAYGAIN_TRACK_GAIN --set-tag="REPLAYGAIN_TRACK_GAIN=-9.00 dB" "${filePath}"`,
            { stdio: 'ignore' }
          );
        }

        // Step 3: Re-sync — should detect normalization updates
        const { result: result2, json: json2 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result2.exitCode).toBe(0);
        expect(json2?.success).toBe(true);

        // Normalization change applied to all 3 tracks (no adds, no removes).
        expect(json2!.result!.completed).toBe(3);

        // Step 4: Re-sync again — should be idempotent now
        const { result: result3, json: json3 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);

        expect(result3.exitCode).toBe(0);
        // Idempotent: third sync (re-sync with no changes) does no work.
        expect(json3!.result!.completed).toBe(0);
      } finally {
        if (collectionDir) {
          await rm(collectionDir, { recursive: true, force: true });
        }
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);
});

// =============================================================================
// Format upgrade: MP3 → FLAC (transcoded to AAC)
//
// This is the exact scenario that caused playback failures on real iPods:
// 1. User has MP3s, syncs to iPod (copies as-is with .mp3 extension)
// 2. User replaces MP3s with FLACs in their collection
// 3. Sync detects format upgrade, transcodes FLAC to AAC
// 4. The replaced file MUST have .m4a extension (not .mp3) or iPod can't play it
// =============================================================================

/**
 * Generate a short MP3 test file with specific metadata.
 */
function generateMp3(
  outputPath: string,
  metadata: { title: string; artist: string; album: string }
): void {
  execSync(
    `ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=2" ` +
      `-metadata title="${metadata.title}" ` +
      `-metadata artist="${metadata.artist}" ` +
      `-metadata album="${metadata.album}" ` +
      `-b:a 128k -y "${outputPath}"`,
    { stdio: 'ignore' }
  );
}

/**
 * Generate a short FLAC test file with the same metadata as the MP3.
 */
function generateFlac(
  outputPath: string,
  metadata: { title: string; artist: string; album: string }
): void {
  execSync(
    `ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=2" ` +
      `-metadata title="${metadata.title}" ` +
      `-metadata artist="${metadata.artist}" ` +
      `-metadata album="${metadata.album}" ` +
      `-c:a flac -y "${outputPath}"`,
    { stdio: 'ignore' }
  );
}

/**
 * Recursively find all audio files on the iPod's music directory.
 *
 * Uses withFileTypes to filter for directories explicitly rather than
 * relying on a try/catch around readdir to swallow ENOTDIR — a swallowed
 * error would have hidden permission failures or filesystem corruption.
 */
async function findIpodMusicFiles(ipodPath: string): Promise<string[]> {
  const musicDir = join(ipodPath, 'iPod_Control', 'Music');
  if (!existsSync(musicDir)) return [];

  const files: string[] = [];
  const entries = await readdir(musicDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subdirPath = join(musicDir, entry.name);
    const subEntries = await readdir(subdirPath);
    for (const subEntry of subEntries) {
      files.push(join(subdirPath, subEntry));
    }
  }
  return files;
}

describe('self-healing sync: format upgrade (MP3 → FLAC)', () => {
  it('upgrades MP3 to AAC with correct .m4a extension', async () => {
    requireFFmpeg();
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-format-upgrade-'));

      try {
        const trackMeta = {
          title: 'Format Test',
          artist: 'Upgrade Artist',
          album: 'Upgrade Album',
        };

        // Step 1: Create collection with MP3 and sync
        generateMp3(join(collectionDir, 'track.mp3'), trackMeta);

        const configPath = await createConfigFile(configDir, { source: collectionDir });

        const { result: result1, json: json1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);
        expect(json1?.result?.completed).toBe(1);

        // Verify the track was copied as MP3 (compatible lossy → direct copy)
        const filesAfterFirstSync = await findIpodMusicFiles(target.path);
        const mp3Files = filesAfterFirstSync.filter((f) => f.endsWith('.mp3'));
        expect(mp3Files).toHaveLength(1);

        // Step 2: Replace source MP3 with a FLAC (same metadata)
        execSync(`rm "${join(collectionDir, 'track.mp3')}"`, { stdio: 'ignore' });
        generateFlac(join(collectionDir, 'track.flac'), trackMeta);

        // Step 3: Sync again — should detect format upgrade and transcode
        const { result: result2, json: json2 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(result2.exitCode).toBe(0);
        expect(json2?.success).toBe(true);

        // Should have upgraded (not added) — track count stays at 1
        const tracksAfterUpgrade = await target.getTracks();
        expect(tracksAfterUpgrade).toHaveLength(1);

        // Step 4: Verify the file on the iPod now has .m4a extension
        const filesAfterUpgrade = await findIpodMusicFiles(target.path);
        const m4aFiles = filesAfterUpgrade.filter((f) => f.endsWith('.m4a'));
        const remainingMp3Files = filesAfterUpgrade.filter((f) => f.endsWith('.mp3'));

        // This is the critical assertion: the upgraded file must be .m4a, not .mp3
        // If this fails, the iPod firmware would try to decode AAC with the MP3
        // decoder and playback would fail.
        expect(m4aFiles).toHaveLength(1);
        expect(remainingMp3Files).toHaveLength(0);
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);
});

// =============================================================================
// Lossy source-rise: a lossy source re-ripped at a HIGHER bitrate is never
// followed up. Re-encoding a lossy track up cannot recover discarded
// information and would grow the file, so podkit keeps the existing device copy
// (ADR-023 — down-only). The old source-improved "quality-change-up" gate is
// gone; a genuinely higher-quality re-rip is left to ordinary content-change
// detection, never an up-encode of the existing copy.
// =============================================================================

/**
 * Generate an MP3 at a specified bitrate (kbps). Used by the quality-upgrade
 * test to swap a low-bitrate source for a higher-bitrate one.
 */
function generateMp3AtBitrate(
  outputPath: string,
  metadata: { title: string; artist: string; album: string },
  bitrateKbps: number
): void {
  execSync(
    `ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=2" ` +
      `-metadata title="${metadata.title}" ` +
      `-metadata artist="${metadata.artist}" ` +
      `-metadata album="${metadata.album}" ` +
      `-b:a ${bitrateKbps}k -y "${outputPath}"`,
    { stdio: 'ignore' }
  );
}

describe('self-healing sync: lossy source-rise is not followed up (down-only)', () => {
  it('keeps the device copy when a lossy source is re-ripped at a higher bitrate', async () => {
    requireFFmpeg();
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-source-rise-'));

      try {
        const trackMeta = {
          title: 'Source Rise',
          artist: 'Upgrade Artist',
          album: 'Upgrade Album',
        };

        // Step 1: Sync a 96 kbps MP3 at quality=low (cap 128). Below the cap, so
        // it is copied as-is and recorded at 96 in the sync tag.
        generateMp3AtBitrate(join(collectionDir, 'track.mp3'), trackMeta, 96);

        const configPath = await createConfigFile(configDir, { source: collectionDir });

        const { result: result1, json: json1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);
        expect(json1?.result?.completed).toBe(1);

        const tracksAfterFirstSync = await target.getTracks();
        expect(tracksAfterFirstSync).toHaveLength(1);
        const initialBitrate = tracksAfterFirstSync[0]!.bitrate;
        expect(initialBitrate).toBeGreaterThan(0);
        expect(initialBitrate).toBeLessThan(150);

        // Step 2: Re-rip the SAME track at 256 kbps. Same metadata + path, so the
        // matcher still considers it the same track.
        generateMp3AtBitrate(join(collectionDir, 'track.mp3'), trackMeta, 256);

        // Step 3: Dry-run at the same quality. The source rose, but re-encoding a
        // lossy track up is forbidden (ADR-023, down-only): no quality-change-up,
        // and nothing is queued — the existing copy is already playable.
        const { json: dryJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);
        expect(dryJson?.plan?.updateBreakdown?.['quality-change-up'] ?? 0).toBe(0);
        expect(dryJson?.plan?.tracksToUpdate ?? 0).toBe(0);
        expect(dryJson?.plan?.tracksToAdd ?? 0).toBe(0);

        // Step 4: Real re-sync is a no-op, and the device track is unchanged — its
        // bitrate stays at the original copy, never grown toward the higher source.
        const { result: result2, json: json2 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(result2.exitCode).toBe(0);
        expect(json2?.result?.completed).toBe(0);

        const tracksAfter = await target.getTracks();
        expect(tracksAfter).toHaveLength(1);
        expect(tracksAfter[0]!.bitrate).toBeLessThan(150);
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);
});

// =============================================================================
// Lossy cap-down: lowering the device bitrate cap re-encodes an existing LOSSY
// track down to the new cap.
//
// Lossy sources were previously copied as-is and never capped — lowering the cap
// silently did nothing for them. The device-bound classifier now reads the lossy
// track's recorded sync-tag bitrate and, when it exceeds the cap, re-encodes the
// track down. The re-encoded sync tag records the new bitrate, so a follow-up
// sync at the same cap is a no-op (idempotent).
// =============================================================================

describe('self-healing sync: lossy cap-down (bitrate cap enforcement)', () => {
  it('lowering the cap re-encodes a lossy track down, then re-sync is idempotent', async () => {
    requireFFmpeg();
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-cap-down-'));

      try {
        const trackMeta = {
          title: 'Cap Test',
          artist: 'Cap Artist',
          album: 'Cap Album',
        };

        // Step 1: Sync a 192 kbps MP3 at quality=high (cap 256) under convert
        // (`reduce = always`). The source is below the cap band, so it is copied
        // as-is (.mp3) and recorded as quality=copy bitrate=192 in the sync tag.
        generateMp3AtBitrate(join(collectionDir, 'track.mp3'), trackMeta, 192);
        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
          reduce: 'always',
        });

        const { result: result1, json: json1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);
        expect(json1?.result?.completed).toBe(1);

        const mp3Files = (await findIpodMusicFiles(target.path)).filter((f) => f.endsWith('.mp3'));
        expect(mp3Files).toHaveLength(1);

        // Step 2: Dry-run at quality=low (cap 128) — the recorded 192 kbps now
        // exceeds the cap, so the classifier reports exactly one cap-DOWN.
        const { json: dryJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--dry-run',
          '--json',
        ]);
        expect(dryJson?.plan?.updateBreakdown?.['quality-change-down']).toBe(1);
        expect(dryJson?.plan?.tracksToAdd).toBe(0);

        // Step 3: Sync at quality=low — re-encodes the track down to AAC at the cap.
        const { result: result2, json: json2 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--json',
        ]);
        expect(result2.exitCode).toBe(0);
        expect(json2?.result?.completed).toBe(1);

        // Track count unchanged (re-encode, not add), and the on-device file is now
        // AAC (.m4a) — definitive proof the lossy track was re-encoded, not copied.
        expect((await target.getTracks()).length).toBe(1);
        const filesAfter = await findIpodMusicFiles(target.path);
        expect(filesAfter.filter((f) => f.endsWith('.m4a'))).toHaveLength(1);
        expect(filesAfter.filter((f) => f.endsWith('.mp3'))).toHaveLength(0);

        // Step 4: Re-sync at quality=low — idempotent (the recorded bitrate now
        // equals the cap, so nothing fires). Assert both the dry-run plan (no
        // tracks queued) and a real re-sync (nothing executed).
        const { json: idempotentDryJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--dry-run',
          '--json',
        ]);
        expect(idempotentDryJson?.plan?.tracksToUpdate).toBe(0);
        expect(idempotentDryJson?.plan?.tracksToAdd).toBe(0);

        const { json: json3 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--json',
        ]);
        expect(json3?.result?.completed).toBe(0);
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);
});

// =============================================================================
// Lossy cap on first add: a brand-new lossy source whose bitrate exceeds the
// device cap is re-encoded DOWN to the cap on the FIRST add, not copied as-is
// and capped on the next sync. A fresh over-cap library converges in one sync.
// =============================================================================

describe('self-healing sync: lossy cap on first add (single-sync convergence)', () => {
  it('re-encodes an over-cap lossy source down to the cap on first add, then re-sync is idempotent', async () => {
    requireFFmpeg();
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-cap-add-'));

      try {
        const trackMeta = {
          title: 'Cap Add Test',
          artist: 'Cap Artist',
          album: 'Cap Album',
        };

        // A 320 kbps MP3 — well above the quality=low cap (128). Synced under
        // convert (`reduce = always`); preserve (the default) would copy it.
        generateMp3AtBitrate(join(collectionDir, 'track.mp3'), trackMeta, 320);
        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
          reduce: 'always',
        });

        // Step 1: Dry-run at quality=low — the over-cap source is queued as a
        // TRANSCODE (down to the cap), not a verbatim copy.
        const { json: dryAddJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--dry-run',
          '--json',
        ]);
        expect(dryAddJson?.plan?.tracksToAdd).toBe(1);
        expect(dryAddJson?.plan?.tracksToTranscode).toBe(1);
        expect(dryAddJson?.plan?.tracksToCopy ?? 0).toBe(0);

        // Step 2: Real sync — one track added, re-encoded down to AAC at the cap.
        const { result: result1, json: json1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);
        expect(json1?.result?.completed).toBe(1);

        // The on-device file is AAC (.m4a) — the source MP3 was re-encoded on add,
        // never copied as-is.
        const filesAfter = await findIpodMusicFiles(target.path);
        expect(filesAfter.filter((f) => f.endsWith('.m4a'))).toHaveLength(1);
        expect(filesAfter.filter((f) => f.endsWith('.mp3'))).toHaveLength(0);

        // Step 3: Re-sync at the same quality — idempotent in a SINGLE pass. The
        // first-add transcode recorded the cap in the sync tag, so there is no
        // second-sync cap-down. Zero queued tracks proves convergence.
        const { json: convergeJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--dry-run',
          '--json',
        ]);
        expect(convergeJson?.plan?.tracksToAdd).toBe(0);
        expect(convergeJson?.plan?.tracksToUpdate).toBe(0);
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);
});

// =============================================================================
// Below a raised cap (report-only): raising the cap does NOT re-lift a track
// that was previously REDUCED below it. Lossy reduction is down-only (ADR-023
// §7): re-encoding the reduced copy back up cannot recover discarded
// information. The track is reported through the report-only channel
// (`quality-change-below-cap`), never re-encoded automatically; `--force-transcode`
// is the explicit lift (re-encoding from the original, higher-bitrate source).
// =============================================================================

describe('self-healing sync: below a raised cap (report-only, --force-transcode lifts)', () => {
  it('reports a previously-reduced track below a raised cap without lifting it, until --force-transcode', async () => {
    requireFFmpeg();
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-below-cap-'));

      try {
        const trackMeta = {
          title: 'Below Cap Test',
          artist: 'Cap Artist',
          album: 'Cap Album',
        };

        // A 320 kbps MP3 source — plenty of headroom above any preset cap.
        generateMp3AtBitrate(join(collectionDir, 'track.mp3'), trackMeta, 320);
        // Convert (`reduce = always`) so the over-cap source is reduced on add.
        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
          reduce: 'always',
        });

        // Step 1: Sync at quality=low under convert — the 320 kbps source is
        // reduced to AAC at the cap (128) on the first add, recorded quality=low.
        const { result: result1, json: json1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);
        expect(json1?.result?.completed).toBe(1);

        const reducedTracks = await target.getTracks();
        expect(reducedTracks.length).toBe(1);
        const reducedBitrate = reducedTracks[0]!.bitrate;
        // The on-device file is AAC (the reduction re-encode).
        expect(
          (await findIpodMusicFiles(target.path)).filter((f) => f.endsWith('.m4a'))
        ).toHaveLength(1);

        // Step 2: Dry-run at quality=high (cap 256). The recorded low/128 now sits
        // below the raised cap, but down-only reduction never re-lifts it: it is
        // reported (quality-change-below-cap) and NOT queued for an update.
        const { json: belowJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--dry-run',
          '--json',
        ]);
        expect(belowJson?.plan?.updateBreakdown?.['quality-change-below-cap'] ?? 0).toBe(1);
        expect(belowJson?.plan?.tracksToUpdate ?? 0).toBe(0);
        expect(belowJson?.plan?.tracksToAdd ?? 0).toBe(0);
        const below = (belowJson?.plan?.qualityChanges ?? []).filter(
          (q) => q.reason === 'below-cap'
        );
        expect(below).toHaveLength(1);
        expect(below[0]!.reEncodes).toBe(false);

        // Step 3: Real sync at quality=high is a no-op — the reduced copy is kept.
        const { json: realJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--json',
        ]);
        expect(realJson?.result?.completed).toBe(0);
        expect((await target.getTracks())[0]!.bitrate).toBe(reducedBitrate);

        // Step 4: --force-transcode is the explicit lift — it re-encodes the track
        // up from the original 320 kbps source toward the raised cap, so the
        // on-device bitrate climbs above the reduced copy.
        const { json: forceJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--force-transcode',
          '--json',
        ]);
        expect(forceJson?.result?.completed).toBe(1);
        const liftedTracks = await target.getTracks();
        expect(liftedTracks.length).toBe(1);
        expect(liftedTracks[0]!.bitrate).toBeGreaterThan(reducedBitrate);

        // Step 5: Re-sync after the lift is idempotent — the rewritten sync tag
        // records the new target, so nothing re-fires.
        const { json: convergeJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--dry-run',
          '--json',
        ]);
        expect(convergeJson?.plan?.tracksToUpdate ?? 0).toBe(0);
        expect(convergeJson?.plan?.tracksToAdd ?? 0).toBe(0);
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 240000);
});

// =============================================================================
// Source-down suppression: when the SOURCE is re-ripped LOWER than the device
// copy (cap unchanged), the better device copy is kept by default — re-encoding
// down to the worse source would destroy quality. The situation is reported
// (qualityChanges[] + suppressed count) but never acted on (no operation, no
// tracksToUpdate bump, idempotent across re-syncs).
// =============================================================================

describe('self-healing sync: source-down suppression (degraded source)', () => {
  it('keeps the better device copy and reports it when the source is re-ripped lower', async () => {
    requireFFmpeg();
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-source-down-'));

      try {
        const trackMeta = {
          title: 'Degraded Source',
          artist: 'Source Artist',
          album: 'Source Album',
        };

        // Step 1: Sync a 192 kbps MP3 at quality=high (cap 256). Below the cap,
        // so it is copied as-is (.mp3) and recorded at 192 in the sync tag.
        generateMp3AtBitrate(join(collectionDir, 'track.mp3'), trackMeta, 192);
        // Quality is supplied per-invocation via the `--quality` flag, which
        // overrides the config's default.
        const configPath = await createConfigFile(configDir, { source: collectionDir });

        const { result: result1, json: json1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);
        expect(json1?.result?.completed).toBe(1);
        const mp3Before = (await findIpodMusicFiles(target.path)).filter((f) => f.endsWith('.mp3'));
        expect(mp3Before).toHaveLength(1);

        // Step 2: Re-rip the source LOWER (96 kbps). Now source 96 < recorded 192,
        // both still under the 256 cap — this is the source-down case.
        generateMp3AtBitrate(join(collectionDir, 'track.mp3'), trackMeta, 96);

        // Step 3: Dry-run at the SAME quality=high. The change is reported but
        // suppressed: a source-down-suppressed entry in qualityChanges[], a
        // suppressed count of 1, and crucially NO tracksToUpdate (it stays put).
        const { json: dryJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--dry-run',
          '--json',
        ]);
        expect(dryJson?.plan?.updateBreakdown?.['quality-change-suppressed'] ?? 0).toBe(1);
        expect(dryJson?.plan?.tracksToUpdate ?? 0).toBe(0);
        expect(dryJson?.plan?.tracksToAdd ?? 0).toBe(0);
        const suppressed = (dryJson?.plan?.qualityChanges ?? []).filter(
          (q) => q.reason === 'source-down-suppressed'
        );
        expect(suppressed).toHaveLength(1);
        expect(suppressed[0]!.reEncodes).toBe(false);
        expect(suppressed[0]!.encodedBitrate).toBeGreaterThan(suppressed[0]!.sourceBitrate ?? 0);

        // Step 4: Real sync at quality=high — nothing executes (no-op), the device
        // file is UNCHANGED (still the original .mp3, never re-encoded to .m4a).
        const { json: realJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--json',
        ]);
        expect(realJson?.result?.completed).toBe(0);
        expect((await target.getTracks()).length).toBe(1);
        const filesAfter = await findIpodMusicFiles(target.path);
        expect(filesAfter.filter((f) => f.endsWith('.mp3'))).toHaveLength(1);
        expect(filesAfter.filter((f) => f.endsWith('.m4a'))).toHaveLength(0);
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);

  it('suppresses (not cap-down) when the recorded copy is above the cap but the source dropped below it', async () => {
    // The fixed edge: a device copy recorded ABOVE the cap whose source later
    // degraded BELOW the cap must NOT re-encode down to the worse source — that
    // would be a lossy-to-lossy upsample of degraded audio. It is suppressed.
    requireFFmpeg();
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-source-down-edge-'));

      try {
        const trackMeta = {
          title: 'Degraded Above Cap',
          artist: 'Source Artist',
          album: 'Source Album',
        };

        // Step 1: Sync a 320 kbps MP3 at quality=high under preserve (the
        // default). It is copied as-is and recorded at 320 — above the quality=low
        // cap (128) used below, which is exactly the "recorded above the cap"
        // precondition this edge needs.
        generateMp3AtBitrate(join(collectionDir, 'track.mp3'), trackMeta, 320);
        const configPath = await createConfigFile(configDir, { source: collectionDir });

        const { result: result1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);
        expect(
          (await findIpodMusicFiles(target.path)).filter((f) => f.endsWith('.mp3'))
        ).toHaveLength(1);

        // Step 2: Re-rip the source to 100 kbps — below the 128 cap. The recorded
        // 320 is above the cap, but the source can no longer supply it.
        generateMp3AtBitrate(join(collectionDir, 'track.mp3'), trackMeta, 100);

        // Step 3: Dry-run at quality=low. The source-down bound takes priority over
        // the (recorded-above-cap) reduction bound, so this is suppressed — never a
        // cap-down to the degraded source.
        const { json: dryJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--dry-run',
          '--json',
        ]);
        expect(dryJson?.plan?.updateBreakdown?.['quality-change-suppressed'] ?? 0).toBe(1);
        expect(dryJson?.plan?.updateBreakdown?.['quality-change-down'] ?? 0).toBe(0);
        expect(dryJson?.plan?.tracksToUpdate ?? 0).toBe(0);
        const suppressed = (dryJson?.plan?.qualityChanges ?? []).filter(
          (q) => q.reason === 'source-down-suppressed'
        );
        expect(suppressed).toHaveLength(1);

        // Step 4: Real sync — no-op, the better device copy is left untouched.
        const { json: realJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--json',
        ]);
        expect(realJson?.result?.completed).toBe(0);
        const filesAfter = await findIpodMusicFiles(target.path);
        expect(filesAfter.filter((f) => f.endsWith('.mp3'))).toHaveLength(1);
        expect(filesAfter.filter((f) => f.endsWith('.m4a'))).toHaveLength(0);
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);
});

// =============================================================================
// Reduction axis (convert/preserve) + preconditions. ADR-023 replaced the old
// `--bitrate-sync` five-mode policy: lossy reduction is now down-only, gated by
// `[bitrate].reduce` (`--bitrate-reduce`), and a lossy CBR/VBR flip never
// re-encodes. The lossless paths ignore the axis; their preconditions still fire
// and `--skip-upgrades` is the master veto.
// =============================================================================

describe('self-healing sync: reduction axis (convert/preserve) and preconditions', () => {
  it('never follows a degraded source down — suppressed under convert as well as the default', async () => {
    requireFFmpeg();
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-no-follow-down-'));

      try {
        const trackMeta = {
          title: 'No Follow Down',
          artist: 'Source Artist',
          album: 'Source Album',
        };

        // Step 1: sync a 192 kbps MP3 at quality=high (cap 256) — copied at 192.
        generateMp3AtBitrate(join(collectionDir, 'track.mp3'), trackMeta, 192);
        const configPath = await createConfigFile(configDir, { source: collectionDir });

        const { json: json1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--json',
        ]);
        expect(json1?.result?.completed).toBe(1);

        // Step 2: re-rip the source LOWER (96 kbps). There is no longer any axis
        // that follows a source down — convert reduces only OVER-cap sources, never
        // chases a degraded source below the recorded copy.
        generateMp3AtBitrate(join(collectionDir, 'track.mp3'), trackMeta, 96);

        // Step 3: even under convert (`--bitrate-reduce always`) the source-down is
        // suppressed (report-only), not followed down — no update is queued.
        const { json: dryJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--bitrate-reduce',
          'always',
          '--dry-run',
          '--json',
        ]);
        expect(dryJson?.plan?.updateBreakdown?.['quality-change-suppressed'] ?? 0).toBe(1);
        expect(dryJson?.plan?.updateBreakdown?.['quality-change-down'] ?? 0).toBe(0);
        expect(dryJson?.plan?.tracksToUpdate ?? 0).toBe(0);

        // Step 4: real sync under convert is a no-op; the better device copy stays.
        const { json: realJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--bitrate-reduce',
          'always',
          '--json',
        ]);
        expect(realJson?.result?.completed).toBe(0);
        expect((await target.getTracks()).length).toBe(1);
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);

  it('a lossy CBR/VBR flip never re-encodes the track', async () => {
    requireFFmpeg();
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-lossy-flip-'));

      try {
        const trackMeta = { title: 'Lossy Flip', artist: 'Mode Artist', album: 'Mode Album' };

        // Step 1: get the device into a state where podkit reduced the lossy track
        // (so its sync tag records encoding=vbr + a bitrate). A 320 kbps MP3 synced
        // at quality=low under convert is reduced to AAC at 128 (recorded vbr/128).
        generateMp3AtBitrate(join(collectionDir, 'track.mp3'), trackMeta, 320);
        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
          reduce: 'always',
        });

        const { result: addResult } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--json',
        ]);
        expect(addResult.exitCode).toBe(0);
        // The reduction produced an AAC (.m4a) device copy.
        expect(
          (await findIpodMusicFiles(target.path)).filter((f) => f.endsWith('.m4a'))
        ).toHaveLength(1);

        // Step 2: flip the encoding mode to CBR. The bitrate is unchanged (still
        // the 128 cap), and the source is lossy — re-encoding it would be a
        // lossy→lossy degradation that can GROW the file, so podkit never does it
        // (ADR-023 §6). No update fires, even with --encoding cbr.
        const { json: flipJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--encoding',
          'cbr',
          '--dry-run',
          '--json',
        ]);
        expect(flipJson?.plan?.tracksToUpdate ?? 0).toBe(0);
        expect(flipJson?.plan?.tracksToAdd ?? 0).toBe(0);

        // Step 3: real sync with the flipped encoding is a no-op — nothing executes.
        const { json: realJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--encoding',
          'cbr',
          '--json',
        ]);
        expect(realJson?.result?.completed ?? 0).toBe(0);
        expect((await target.getTracks()).length).toBe(1);
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 240000);

  it('a lossless->lossy boundary re-encodes down even under preserve (--bitrate-reduce never), and --skip-upgrades blocks it', async () => {
    requireFFmpeg();
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-lossless-boundary-'));

      try {
        const trackMeta = { title: 'Boundary', artist: 'Lossless Artist', album: 'Lossless Album' };

        // Step 1: sync a FLAC at quality=max — on the iPod (ALAC-capable) this
        // resolves to lossless, so the device copy is lossless (ALAC), recorded
        // with a quality=lossless sync tag.
        generateFlac(join(collectionDir, 'track.flac'), trackMeta);
        const configPath = await createConfigFile(configDir, { source: collectionDir });

        const { json: json1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'max',
          '--json',
        ]);
        expect(json1?.result?.completed).toBe(1);
        const losslessBitrate = (await target.getTracks())[0]!.bitrate;

        // Step 2: switch the target to a lossy preset under preserve
        // (`--bitrate-reduce never`). Crossing the lossless/lossy boundary is a
        // correctness re-encode the reduction axis does NOT govern, so it must
        // still fire DOWN to the cap even under preserve.
        const { json: neverJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--bitrate-reduce',
          'never',
          '--dry-run',
          '--json',
        ]);
        expect(neverJson?.plan?.tracksToUpdate).toBe(1);
        expect(neverJson?.plan?.updateBreakdown?.['quality-change-down'] ?? 0).toBe(1);
        expect(neverJson?.plan?.updateBreakdown?.['quality-change-suppressed'] ?? 0).toBe(0);

        // Step 3: --skip-upgrades is the master veto — it blocks even this precondition.
        const { json: skipJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--skip-upgrades',
          '--dry-run',
          '--json',
        ]);
        expect(skipJson?.plan?.tracksToUpdate ?? 0).toBe(0);

        // Step 4: real re-encode under preserve — the device copy drops to lossy
        // AAC (bitrate below the lossless copy). A re-sync is then a no-op.
        const { json: realJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--bitrate-reduce',
          'never',
          '--json',
        ]);
        expect(realJson?.result?.completed).toBe(1);
        const lossyBitrate = (await target.getTracks())[0]!.bitrate;
        expect(lossyBitrate).toBeLessThan(losslessBitrate);

        const { json: reJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--bitrate-reduce',
          'never',
          '--json',
        ]);
        expect(reJson?.result?.completed).toBe(0);
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 240000);

  it('preserve (--bitrate-reduce never) freezes a cap-down that convert would fire', async () => {
    requireFFmpeg();
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-freeze-'));

      try {
        const trackMeta = {
          title: 'Frozen Bitrate',
          artist: 'Source Artist',
          album: 'Source Album',
        };

        // Step 1: sync a 192 kbps MP3 at quality=high (cap 256) — below the band,
        // so it is copied as-is and recorded at 192 (above the quality=low cap).
        generateMp3AtBitrate(join(collectionDir, 'track.mp3'), trackMeta, 192);
        const configPath = await createConfigFile(configDir, { source: collectionDir });

        const { json: json1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'high',
          '--json',
        ]);
        expect(json1?.result?.completed).toBe(1);

        // Step 2: control — under convert (`--bitrate-reduce always`) the recorded
        // 192 exceeds the quality=low cap (128), so a cap-down WOULD fire.
        const { json: controlJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--bitrate-reduce',
          'always',
          '--dry-run',
          '--json',
        ]);
        expect(controlJson?.plan?.updateBreakdown?.['quality-change-down'] ?? 0).toBe(1);

        // Step 3: under preserve (`--bitrate-reduce never`) the device-native copy
        // is kept untouched — no cap-down, nothing queued (a clean freeze, not a
        // suppressed report).
        const { json: neverJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--bitrate-reduce',
          'never',
          '--dry-run',
          '--json',
        ]);
        expect(neverJson?.plan?.updateBreakdown?.['quality-change-down'] ?? 0).toBe(0);
        expect(neverJson?.plan?.tracksToUpdate ?? 0).toBe(0);
        expect(neverJson?.plan?.tracksToAdd ?? 0).toBe(0);

        // Step 4: real sync under preserve is a no-op; the copied MP3 is untouched.
        const { json: realJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--bitrate-reduce',
          'never',
          '--json',
        ]);
        expect(realJson?.result?.completed).toBe(0);
        const filesAfter = await findIpodMusicFiles(target.path);
        expect(filesAfter.filter((f) => f.endsWith('.mp3'))).toHaveLength(1);
        expect(filesAfter.filter((f) => f.endsWith('.m4a'))).toHaveLength(0);
      } finally {
        await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);
});
