/**
 * E2E tests for quality preset change detection and sync tags.
 *
 * Tests the full cycle: sync → verify sync tags written → change preset →
 * verify detection → re-sync → verify idempotent.
 *
 * Sync tags enable exact preset change detection by storing transcode settings
 * in the iPod track's comment field. Bitrate-based detection serves as a
 * fallback for tracks without sync tags.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtemp, rm, copyFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { ensureFixturesExist, requireFFmpeg } from '@podkit/e2e-shared';
import { gpodTool } from '@podkit/gpod-testing';
import { runCliJson } from '../helpers/cli-runner';
import { withTarget, withMassStorageTarget } from '../targets';
import { getTrackPath, Tracks, type AlbumDir } from '../helpers/fixtures';
import { getMultiFormatEmbeddedFixturesDir } from '@podkit/test-fixtures';

ensureFixturesExist('goldberg-selections');

import type { SyncOutput } from 'podkit/types';

// =============================================================================
// Test Fixture Helpers
// =============================================================================

const TEST_TRACKS: Array<{ source: { album: AlbumDir; filename: string } }> = [
  { source: Tracks.HARMONY },
  { source: Tracks.VIBRATO },
  { source: Tracks.TREMOLO },
];

async function createTestCollection(): Promise<string> {
  const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-preset-'));

  for (const track of TEST_TRACKS) {
    const sourcePath = getTrackPath(track.source.album, track.source.filename);
    const destPath = join(collectionDir, track.source.filename);
    await copyFile(sourcePath, destPath);
  }

  return collectionDir;
}

async function createConfigFile(
  configDir: string,
  options: { source: string; quality: string }
): Promise<string> {
  const configPath = join(configDir, 'config.toml');

  const content = `version = 2

[music.default]
path = "${options.source}"

quality = "${options.quality}"

[defaults]
music = "default"
`;

  await writeFile(configPath, content);
  return configPath;
}

// =============================================================================
// Tests
// =============================================================================

describe('preset change detection', () => {
  it('second sync at different quality succeeds without errors', async () => {
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Sync at low quality
        collectionDir = await createTestCollection();
        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
          quality: 'low',
        });

        const { result: result1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);
        expect((await target.getTracks()).length).toBe(3);

        // Change to high quality and sync again — should succeed
        await writeFile(
          configPath,
          `version = 2\n\n[music.default]\npath = "${collectionDir}"\nquality = "high"\n[defaults]\nmusic = "default"\n`
        );

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
        // Track count preserved regardless of what happened (add/upgrade/no-op)
        expect((await target.getTracks()).length).toBe(3);
      } finally {
        if (collectionDir) {
          await rm(collectionDir, { recursive: true, force: true });
        }
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('skip-upgrades suppresses all file-replacement upgrades at different quality', async () => {
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        // Sync at low quality
        collectionDir = await createTestCollection();
        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
          quality: 'low',
        });

        const { result: result1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);

        // Change to high quality with --skip-upgrades — no file-replacement upgrades
        await writeFile(
          configPath,
          `version = 2\n\n[music.default]\npath = "${collectionDir}"\nquality = "high"\n[defaults]\nmusic = "default"\n`
        );

        const { result: dryResult, json: dryJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--dry-run',
          '--skip-upgrades',
          '--json',
        ]);

        expect(dryResult.exitCode).toBe(0);

        // With skip-upgrades, no file-replacement upgrades should be planned
        expect(dryJson!.plan).toBeDefined();
        const breakdown = dryJson!.plan!.updateBreakdown ?? {};
        expect(breakdown['quality-change-up'] ?? 0).toBe(0);
        expect(breakdown['quality-change-down'] ?? 0).toBe(0);
        expect(breakdown['quality-change-suppressed'] ?? 0).toBe(0);
        expect(breakdown['artwork-added'] ?? 0).toBe(0);
      } finally {
        if (collectionDir) {
          await rm(collectionDir, { recursive: true, force: true });
        }
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('second sync with same preset is idempotent (no work via sync tags)', async () => {
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        collectionDir = await createTestCollection();
        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
          quality: 'high',
        });

        // First sync
        const { result: result1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);

        // Second sync — should be fully in sync (no work)
        const { result: result2, json: json2 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);
        expect(result2.exitCode).toBe(0);
        expect(json2?.plan?.tracksToAdd).toBe(0);
        expect(json2?.plan?.tracksToUpdate).toBe(0);
      } finally {
        if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  it('sync tag detects preset change and re-transcodes', async () => {
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        collectionDir = await createTestCollection();
        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
          quality: 'high',
        });

        // Sync at high quality
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

        // Dry-run at low quality — sync tags should detect mismatch
        const { result: result2, json: json2 } = await runCliJson<SyncOutput>([
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
        expect(result2.exitCode).toBe(0);
        // All 3 tracks should need updating (preset downgrade)
        expect(json2?.plan?.tracksToUpdate).toBe(3);

        // Actually sync at low — tracks should be re-transcoded
        const { result: result3, json: json3 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--quality',
          'low',
          '--json',
        ]);
        expect(result3.exitCode).toBe(0);
        expect(json3?.result?.completed).toBe(3);

        // Third sync at low — should be idempotent (sync tags match)
        const { json: json4 } = await runCliJson<SyncOutput>([
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
        expect(json4?.plan?.tracksToAdd).toBe(0);
        expect(json4?.plan?.tracksToUpdate).toBe(0);
      } finally {
        if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 180000);

  it('--force-sync-tags --check-artwork establishes art= baselines on existing tracks', async () => {
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        collectionDir = await createTestCollection();
        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
          quality: 'medium',
        });

        // Initial sync without --check-artwork: tracks are written with sync
        // tags that have no `art=` hash (the adapter doesn't compute one).
        const { result: result1 } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--json',
        ]);
        expect(result1.exitCode).toBe(0);
        expect((await target.getTracks()).length).toBe(3);

        // Same config + same flags → idempotent re-sync (sync tags match).
        const { json: baselineJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);
        expect(baselineJson!.plan!.tracksToUpdate).toBe(0);

        // --force-sync-tags --check-artwork enters postProcessSyncTags
        // (handler.ts:662) and, for each lossless track whose syncTag is
        // missing the artwork hash, emits a sync-tag-write op to write the
        // baseline. The goldberg fixtures embed artwork, so all 3 lossless
        // tracks gain an art= hash and re-fire.
        const { result: forceResult, json: forceJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--force-sync-tags',
          '--check-artwork',
          '--dry-run',
          '--json',
        ]);
        expect(forceResult.exitCode).toBe(0);
        expect(forceJson!.plan).toBeDefined();
        expect(forceJson!.plan!.tracksToUpdate).toBe(3);
        expect(forceJson!.plan!.tracksToAdd).toBe(0);
        const breakdown = forceJson!.plan!.updateBreakdown ?? {};
        expect(breakdown['sync-tag-write'] ?? 0).toBe(3);
      } finally {
        if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);

  // Mass-storage arm: quality=max + lossless=['source'] on a device whose
  // supported codecs don't cover every lossless source. WAV/AIFF/ALAC sources
  // can't satisfy the lossless stack on `generic` (caps: aac/mp3/flac), so
  // the planner falls back per-track to lossy=high+aac. The persisted syncTag
  // therefore says `quality=high`, but the config-wide `resolvedQuality` is
  // 'lossless' — the second sync used to re-fire `preset-upgrade` forever.
  it('mass-storage quality=max lossless=[source] converges across re-sync', async () => {
    await withMassStorageTarget(
      async (target) => {
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-preset-ms-'));
        try {
          const stanza = target.deviceConfig();
          const configPath = join(configDir, 'config.toml');
          await writeFile(
            configPath,
            `version = 2

quality = "max"

[codec]
lossy = ["aac"]
lossless = ["source"]

[music.default]
path = "${getMultiFormatEmbeddedFixturesDir()}"

${stanza?.toml ?? ''}

[defaults]
music = "default"
device = "${stanza?.name ?? ''}"
`
          );

          const { result: result1, json: json1 } = await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            stanza?.name ?? target.path,
            '--json',
          ]);
          expect(result1.exitCode).toBe(0);
          expect(json1?.success).toBe(true);

          const { result: dryResult, json: dryJson } = await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            stanza?.name ?? target.path,
            '--dry-run',
            '--json',
          ]);
          expect(dryResult.exitCode).toBe(0);

          const breakdown = dryJson?.plan?.updateBreakdown ?? {};
          expect(breakdown['quality-change-up'] ?? 0).toBe(0);
          expect(breakdown['quality-change-down'] ?? 0).toBe(0);
          expect(dryJson?.plan?.tracksToTranscode ?? 0).toBe(0);
          expect(dryJson?.plan?.tracksToCopy ?? 0).toBe(0);
        } finally {
          await rm(configDir, { recursive: true, force: true });
        }
      },
      { preset: 'generic' }
    );
  }, 120000);

  // Mass-storage lossy cap-down: lowering the bitrate cap re-encodes an existing
  // LOSSY (MP3) track down to the new cap. Mass-storage stores the sync tag in a
  // sidecar/comment rather than an iTunesDB, so this also pins that the
  // sync-tag-as-truth cap enforcement works without a device database — and that
  // a follow-up sync at the same cap is idempotent.
  it('mass-storage lossy cap-down re-encodes down and converges across re-sync', async () => {
    requireFFmpeg();
    await withMassStorageTarget(
      async (target) => {
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-capdown-ms-'));
        const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-capdown-src-'));
        try {
          // A 192 kbps MP3 — compatible-lossy on the generic preset (aac/mp3/flac),
          // so it is copied as-is at the high cap.
          execSync(
            `ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=2" ` +
              `-metadata title="Cap Test" -metadata artist="Cap Artist" -metadata album="Cap Album" ` +
              `-b:a 192k -y "${join(collectionDir, 'track.mp3')}"`,
            { stdio: 'ignore' }
          );

          const stanza = target.deviceConfig();
          const configPath = join(configDir, 'config.toml');
          await writeFile(
            configPath,
            `version = 2

quality = "high"

[music.default]
path = "${collectionDir}"

${stanza?.toml ?? ''}

[defaults]
music = "default"
device = "${stanza?.name ?? ''}"
`
          );

          // Step 1: Initial sync at high — MP3 copied as-is.
          const { result: result1, json: json1 } = await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            stanza?.name ?? target.path,
            '--json',
          ]);
          expect(result1.exitCode).toBe(0);
          expect(json1?.success).toBe(true);
          expect((await target.getTracks()).length).toBe(1);

          // Step 2: Dry-run at quality=low — recorded 192 kbps exceeds the 128 cap,
          // so exactly one cap-DOWN is reported.
          const { json: dryJson } = await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            stanza?.name ?? target.path,
            '--quality',
            'low',
            '--dry-run',
            '--json',
          ]);
          expect(dryJson?.plan?.updateBreakdown?.['quality-change-down'] ?? 0).toBe(1);
          expect(dryJson?.plan?.tracksToAdd ?? 0).toBe(0);

          // Step 3: Sync at low — re-encode down to the cap.
          const { result: result3, json: json3 } = await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            stanza?.name ?? target.path,
            '--quality',
            'low',
            '--json',
          ]);
          expect(result3.exitCode).toBe(0);
          expect(json3?.result?.completed).toBe(1);

          // The on-device track is now re-encoded — its measured bitrate dropped
          // from ~192 toward the 128 cap (track count unchanged).
          const tracks = await target.getTracks();
          expect(tracks.length).toBe(1);
          expect(tracks[0]!.bitrate).toBeGreaterThan(0);
          expect(tracks[0]!.bitrate).toBeLessThan(170);

          // Step 4: Re-sync at low — idempotent (recorded bitrate now equals the cap).
          const { json: json4 } = await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            stanza?.name ?? target.path,
            '--quality',
            'low',
            '--dry-run',
            '--json',
          ]);
          expect(json4?.plan?.tracksToUpdate ?? 0).toBe(0);
          expect(json4?.plan?.tracksToAdd ?? 0).toBe(0);
        } finally {
          await rm(configDir, { recursive: true, force: true });
          await rm(collectionDir, { recursive: true, force: true });
        }
      },
      { preset: 'generic' }
    );
  }, 180000);

  // Mass-storage lossy cap-up, source-bounded: raising the cap re-encodes an
  // under-cap lossy track back up, but only as far as the source can supply
  // (min(source, cap) = source when the source is below the cap). This pins the
  // up direction on a device with no iTunesDB (sync tag in the sidecar/comment),
  // exercises the source-bounded edge, and confirms idempotency at that edge.
  it('mass-storage lossy cap-up re-encodes up bounded by the source and converges across re-sync', async () => {
    requireFFmpeg();
    await withMassStorageTarget(
      async (target) => {
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-capup-ms-'));
        const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-capup-src-'));
        try {
          // A 200 kbps MP3 — below the high cap (256), so a cap-up is bounded by
          // the source (200), not the cap.
          execSync(
            `ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=2" ` +
              `-metadata title="Cap Up" -metadata artist="Cap Artist" -metadata album="Cap Album" ` +
              `-b:a 200k -y "${join(collectionDir, 'track.mp3')}"`,
            { stdio: 'ignore' }
          );

          const stanza = target.deviceConfig();
          const configPath = join(configDir, 'config.toml');
          await writeFile(
            configPath,
            `version = 2

quality = "low"

[music.default]
path = "${collectionDir}"

${stanza?.toml ?? ''}

[defaults]
music = "default"
device = "${stanza?.name ?? ''}"
`
          );

          // Step 1: Sync at quality=low twice. First copies the MP3 as-is (200),
          // second caps it DOWN to a small AAC copy (~128) — leaving an AAC track
          // recorded below the high cap.
          for (let i = 0; i < 2; i++) {
            const { result } = await runCliJson<SyncOutput>([
              '--config',
              configPath,
              'sync',
              '--device',
              stanza?.name ?? target.path,
              '--json',
            ]);
            expect(result.exitCode).toBe(0);
          }
          const cappedTracks = await target.getTracks();
          expect(cappedTracks.length).toBe(1);
          expect(cappedTracks[0]!.bitrate).toBeGreaterThan(0);

          // Step 2: Dry-run at quality=high (cap 256). The recorded 128 (the prior
          // cap) sits below min(source 200, cap 256) = 200, so exactly one cap-UP
          // is reported — the effective ceiling is the source (200), not the cap.
          const { json: dryJson } = await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            stanza?.name ?? target.path,
            '--quality',
            'high',
            '--dry-run',
            '--json',
          ]);
          expect(dryJson?.plan?.updateBreakdown?.['quality-change-up'] ?? 0).toBe(1);
          expect(dryJson?.plan?.tracksToAdd ?? 0).toBe(0);

          // Step 3: Sync at quality=high — re-encode up from the source toward
          // the source ceiling (200), not the full 256 cap.
          const { result: result3, json: json3 } = await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            stanza?.name ?? target.path,
            '--quality',
            'high',
            '--json',
          ]);
          expect(result3.exitCode).toBe(0);
          expect(json3?.result?.completed).toBe(1);

          const upTracks = await target.getTracks();
          expect(upTracks.length).toBe(1);
          expect(upTracks[0]!.bitrate).toBeGreaterThan(0);

          // Step 4: Re-sync at quality=high — idempotent at the source-bounded
          // edge. The recorded effective target is the source bitrate (200, below
          // the 256 cap); zero queued tracks proves the re-encode recorded that
          // source-bounded target rather than re-firing on the next sync.
          const { json: json4 } = await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            stanza?.name ?? target.path,
            '--quality',
            'high',
            '--dry-run',
            '--json',
          ]);
          expect(json4?.plan?.tracksToUpdate ?? 0).toBe(0);
          expect(json4?.plan?.tracksToAdd ?? 0).toBe(0);
        } finally {
          await rm(configDir, { recursive: true, force: true });
          await rm(collectionDir, { recursive: true, force: true });
        }
      },
      { preset: 'generic' }
    );
  }, 240000);

  // Mass-storage source-down suppression: when the SOURCE is re-ripped LOWER
  // than the device copy (cap unchanged), the better device copy is kept by
  // default and the situation is reported but not acted on. Pins the
  // report-but-don't-execute path on a device with no iTunesDB (sync tag in the
  // sidecar/comment).
  it('mass-storage keeps the better device copy and reports source-down suppression', async () => {
    requireFFmpeg();
    await withMassStorageTarget(
      async (target) => {
        const configDir = await mkdtemp(join(tmpdir(), 'podkit-srcdown-ms-'));
        const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-srcdown-src-'));
        try {
          // A 192 kbps MP3 — below the high cap (256), copied as-is and recorded
          // at 192 in the sidecar sync tag.
          execSync(
            `ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=2" ` +
              `-metadata title="Src Down" -metadata artist="Cap Artist" -metadata album="Cap Album" ` +
              `-b:a 192k -y "${join(collectionDir, 'track.mp3')}"`,
            { stdio: 'ignore' }
          );

          const stanza = target.deviceConfig();
          const configPath = join(configDir, 'config.toml');
          await writeFile(
            configPath,
            `version = 2

quality = "high"

[music.default]
path = "${collectionDir}"

${stanza?.toml ?? ''}

[defaults]
music = "default"
device = "${stanza?.name ?? ''}"
`
          );

          // Step 1: Initial sync at high — MP3 copied as-is, recorded 192.
          const { result: result1 } = await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            stanza?.name ?? target.path,
            '--json',
          ]);
          expect(result1.exitCode).toBe(0);
          expect((await target.getTracks()).length).toBe(1);

          // Step 2: Re-rip the source LOWER (96 kbps), below the recorded 192 and
          // still under the cap — the source-down case.
          execSync(
            `ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=2" ` +
              `-metadata title="Src Down" -metadata artist="Cap Artist" -metadata album="Cap Album" ` +
              `-b:a 96k -y "${join(collectionDir, 'track.mp3')}"`,
            { stdio: 'ignore' }
          );

          // Step 3: Dry-run at the SAME quality=high — reported but suppressed: a
          // suppressed count of 1, a source-down-suppressed entry, and NO
          // tracksToUpdate (the track stays put).
          const { json: dryJson } = await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            stanza?.name ?? target.path,
            '--quality',
            'high',
            '--dry-run',
            '--json',
          ]);
          expect(dryJson?.plan?.updateBreakdown?.['quality-change-suppressed'] ?? 0).toBe(1);
          expect(dryJson?.plan?.tracksToUpdate ?? 0).toBe(0);
          const suppressed = (dryJson?.plan?.qualityChanges ?? []).filter(
            (q) => q.reason === 'source-down-suppressed'
          );
          expect(suppressed).toHaveLength(1);
          expect(suppressed[0]!.reEncodes).toBe(false);

          // Step 4: Real sync — no-op, device copy unchanged.
          const { json: realJson } = await runCliJson<SyncOutput>([
            '--config',
            configPath,
            'sync',
            '--device',
            stanza?.name ?? target.path,
            '--quality',
            'high',
            '--json',
          ]);
          expect(realJson?.result?.completed).toBe(0);
          expect((await target.getTracks()).length).toBe(1);
        } finally {
          await rm(configDir, { recursive: true, force: true });
          await rm(collectionDir, { recursive: true, force: true });
        }
      },
      { preset: 'generic' }
    );
  }, 180000);
});

// =============================================================================
// Untagged-track adoption (--force-sync-tags-transcode)
//
// The sync tag is the sole quality truth. A track podkit never wrote (no sync
// tag — here seeded directly into the iPod database via gpod-tool, mimicking a
// third-party / pre-feature track) is opted out of the quality classifier: a
// normal sync leaves it alone (no re-encode storm). Only the explicit
// `--force-sync-tags-transcode` flag adopts it, routing it to a re-encode.
//
// These arms use `--dry-run` so they assert the routing decision against a real
// device database without performing the (file-backed) re-encode. Execution +
// idempotency of the adopted tag are covered by the core unit/handler tests.
// =============================================================================

describe('untagged-track adoption (--force-sync-tags-transcode)', () => {
  const TRACK_META = { title: 'Adopt Me', artist: 'Untagged Artist', album: 'Adoption Album' };

  async function seedUntaggedSource(): Promise<string> {
    const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-adopt-'));
    const flacPath = join(collectionDir, 'adopt.flac');
    execSync(
      `ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=2" ` +
        `-metadata title="${TRACK_META.title}" ` +
        `-metadata artist="${TRACK_META.artist}" ` +
        `-metadata album="${TRACK_META.album}" ` +
        `-metadata track="1" -y "${flacPath}"`,
      { stdio: 'ignore' }
    );
    return collectionDir;
  }

  it('normal sync opts out an untagged track; --force-sync-tags-transcode adopts it', async () => {
    requireFFmpeg();
    await withTarget(async (target) => {
      const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
      let collectionDir: string | undefined;

      try {
        collectionDir = await seedUntaggedSource();
        const configPath = await createConfigFile(configDir, {
          source: collectionDir,
          quality: 'high',
        });

        // Seed an untagged track straight into the iPod DB (no podkit sync tag).
        await gpodTool.addTrack(target.path, {
          title: TRACK_META.title,
          artist: TRACK_META.artist,
          album: TRACK_META.album,
          trackNumber: 1,
          bitrate: 900,
          durationMs: 2000,
          sampleRate: 44100,
        });
        expect((await target.getTracks()).length).toBe(1);

        // Normal sync: the untagged track matches the source but is opted out of
        // the quality classifier — no quality-change is planned (no re-encode
        // storm). It is matched, not re-added.
        const { json: normalJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--dry-run',
          '--json',
        ]);
        expect(normalJson?.plan?.tracksToAdd).toBe(0);
        const normalBreakdown = normalJson?.plan?.updateBreakdown ?? {};
        expect(normalBreakdown['quality-change-up'] ?? 0).toBe(0);
        expect(normalBreakdown['quality-change-down'] ?? 0).toBe(0);

        // Adoption flag: the untagged track is routed to a re-encode
        // (quality-change), establishing ground truth. The seeded copy reads as
        // 900 kbps in the device DB; adopting it to the 256 kbps `high` cap is a
        // downward move, so it is reported as a quality-change down.
        const { json: adoptJson } = await runCliJson<SyncOutput>([
          '--config',
          configPath,
          'sync',
          '--device',
          target.path,
          '--force-sync-tags-transcode',
          '--dry-run',
          '--json',
        ]);
        expect(adoptJson?.plan?.tracksToAdd).toBe(0);
        const adoptBreakdown = adoptJson?.plan?.updateBreakdown ?? {};
        expect(adoptBreakdown['quality-change-down'] ?? 0).toBe(1);
        expect(adoptBreakdown['quality-change-up'] ?? 0).toBe(0);
      } finally {
        if (collectionDir) await rm(collectionDir, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
      }
    });
  }, 120000);
});
