/**
 * E2E: lossy reduction converges in ONE sync — a second sync with no source
 * change does nothing (ADR-023).
 *
 * The codec matrix is a dry-run *decision* matrix against an empty device, so it
 * proves what podkit *plans* but never that a real add and the subsequent
 * re-sync agree. This sweep syncs a real device, then re-syncs, and asserts the
 * second run completes zero operations — the structural guarantee that the add
 * path and the re-sync device-bound share one decision and can never disagree
 * (the 437.08 two-pass-convergence class).
 *
 * The critical, otherwise-uncovered case is the **tolerance band**: a
 * device-native source just above the cap (within `[bitrate].tolerance`) is
 * COPIED on add, and the re-sync must re-evaluate that copy tag with the same
 * tolerance so it stays copied — not reduce it (which would be an add-vs-resync
 * disagreement). No other e2e exercises this.
 *
 * @module
 */

import { describe, it, expect } from 'bun:test';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { requireFFmpeg } from '@podkit/e2e-shared';
import { runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';

import type { SyncOutput } from 'podkit/types';

requireFFmpeg();

/**
 * Generate an audio file from pink noise (incompressible, so CBR targets are
 * honoured and the on-device bitrate stays meaningful) at a target bitrate.
 */
function generateAudio(
  outputPath: string,
  codec: 'mp3' | 'flac',
  bitrateKbps: number,
  title: string
): void {
  const enc = codec === 'mp3' ? `-c:a libmp3lame -b:a ${bitrateKbps}k` : `-c:a flac`;
  execSync(
    `ffmpeg -f lavfi -i "anoisesrc=color=pink:sample_rate=44100:duration=4" ` +
      `-metadata title="${title}" -metadata artist="Idem Artist" -metadata album="Idem Album" ` +
      `${enc} -y "${outputPath}"`,
    { stdio: 'ignore' }
  );
}

async function createConfig(configDir: string, source: string): Promise<string> {
  const configPath = join(configDir, 'config.toml');
  await writeFile(
    configPath,
    `version = 2

[music.default]
path = "${source}"

[defaults]
music = "default"
`
  );
  return configPath;
}

async function ipodMusicFiles(ipodPath: string): Promise<string[]> {
  const musicDir = join(ipodPath, 'iPod_Control', 'Music');
  if (!existsSync(musicDir)) return [];
  const files: string[] = [];
  for (const entry of await readdir(musicDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const f of await readdir(join(musicDir, entry.name))) {
      files.push(join(musicDir, entry.name, f));
    }
  }
  return files;
}

/** A single reduction scenario: what to generate + how to sync. */
interface Scenario {
  /** Fixture: codec + source bitrate + a unique title. */
  fixture: { codec: 'mp3' | 'flac'; bitrate: number; title: string };
  /** Quality preset + reduce mode for the FIRST sync. */
  quality: 'low' | 'high';
  reduce: 'auto' | 'always' | 'never';
  /** Optional DIFFERENT quality for the re-sync (e.g. raising the cap). */
  resyncQuality?: 'low' | 'high';
  /** Expected on-device file extension after the first sync. */
  expectExt: 'm4a' | 'mp3';
}

async function runScenario(s: Scenario): Promise<void> {
  await withTarget(async (target) => {
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-idem-cfg-'));
    const sourceDir = await mkdtemp(join(tmpdir(), 'podkit-idem-src-'));
    try {
      generateAudio(
        join(sourceDir, `track.${s.fixture.codec}`),
        s.fixture.codec,
        s.fixture.bitrate,
        s.fixture.title
      );
      const configPath = await createConfig(configDir, sourceDir);

      const firstArgs = [
        '--config',
        configPath,
        'sync',
        '--device',
        target.path,
        '--quality',
        s.quality,
        '--bitrate-reduce',
        s.reduce,
        '--json',
      ];
      const { result, json } = await runCliJson<SyncOutput>(firstArgs);
      expect(result.exitCode).toBe(0);
      expect(json?.result?.completed).toBe(1);

      // The add path produced the expected form (copy vs transcode).
      const files = await ipodMusicFiles(target.path);
      expect(files.filter((f) => f.endsWith(`.${s.expectExt}`))).toHaveLength(1);
      expect(await target.getTracks()).toHaveLength(1);

      // Re-sync (optionally at a raised cap) is a NO-OP: nothing completes. The
      // add and the re-sync device-bound share the seam, so a converted track
      // (recorded == cap) and a within-tolerance copy (re-evaluated at the same
      // tolerance) both re-sync to nothing; a raised cap only *reports* a
      // previously-reduced track (below-cap, report-only), never re-encodes it.
      const reArgs = [
        '--config',
        configPath,
        'sync',
        '--device',
        target.path,
        '--quality',
        s.resyncQuality ?? s.quality,
        '--bitrate-reduce',
        s.reduce,
        '--json',
      ];
      const { json: reJson } = await runCliJson<SyncOutput>(reArgs);
      expect(reJson?.result?.completed).toBe(0);
      // No add or file-replacement upgrade planned on the second pass.
      const churn = (reJson?.operations ?? []).filter(
        (op) => op.type.startsWith('add-') || op.type.startsWith('upgrade-')
      );
      expect(churn).toHaveLength(0);
    } finally {
      await rm(configDir, { recursive: true, force: true });
      await rm(sourceDir, { recursive: true, force: true });
    }
  });
}

describe('lossy reduction converges in one sync (no two-pass convergence)', () => {
  it('convert: an over-cap source is reduced on add, then re-syncs to a no-op', async () => {
    // MP3 256 kbps, cap 128 (low), convert: 256 > 128×1.25=160 → reduce to the
    // cap (transcode to AAC). Recorded == cap, so the re-sync does nothing.
    await runScenario({
      fixture: { codec: 'mp3', bitrate: 256, title: 'Convert Reduce' },
      quality: 'low',
      reduce: 'always',
      expectExt: 'm4a',
    });
  }, 240000);

  it('convert: a source in the tolerance band is COPIED on add, then re-syncs to a no-op', async () => {
    // MP3 144 kbps, cap 128 (low), convert: 144 is over the cap but within the
    // 25% band (144 ≤ 160), so it is COPIED, not reduced. The re-sync must
    // re-evaluate the copy tag at the SAME tolerance and leave it — otherwise the
    // add copies and the re-sync reduces (an add-vs-resync disagreement).
    await runScenario({
      fixture: { codec: 'mp3', bitrate: 144, title: 'Tolerance Band Copy' },
      quality: 'low',
      reduce: 'always',
      expectExt: 'mp3',
    });
  }, 240000);

  it('preserve: an over-cap device-native source is copied on add, then re-syncs to a no-op', async () => {
    // MP3 256 kbps, cap 128 (low), preserve (reduce=never): copied untouched;
    // the re-sync keeps it.
    await runScenario({
      fixture: { codec: 'mp3', bitrate: 256, title: 'Preserve Copy' },
      quality: 'low',
      reduce: 'never',
      expectExt: 'mp3',
    });
  }, 240000);

  it('lossless: a FLAC source is transcoded on add, then re-syncs to a no-op', async () => {
    await runScenario({
      fixture: { codec: 'flac', bitrate: 0, title: 'Lossless Transcode' },
      quality: 'high',
      reduce: 'auto',
      expectExt: 'm4a',
    });
  }, 240000);

  it('raising the cap does not re-encode a previously-reduced track (report-only, no churn)', async () => {
    // Reduce an over-cap source to the low cap on add, then re-sync at high (a
    // raised cap). Down-only never lifts it automatically — it is a report-only
    // below-cap signal, so the second sync completes nothing.
    await runScenario({
      fixture: { codec: 'mp3', bitrate: 256, title: 'Raised Cap Below' },
      quality: 'low',
      reduce: 'always',
      resyncQuality: 'high',
      expectExt: 'm4a',
    });
  }, 240000);
});
