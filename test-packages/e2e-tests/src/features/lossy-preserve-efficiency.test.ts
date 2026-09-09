/**
 * E2E: forced cross-codec transcode of an incompatible-codec source under
 * `preserve` is efficiency-matched and cap-bounded.
 *
 * An Opus source cannot be played by the iPod, so a transcode is a necessity.
 * Under `preserve` (`--bitrate-reduce never`) the shared lossy-reduction seam
 * targets the source's *quality* in the device codec via the codec-efficiency
 * table — Opus is ~25% more efficient than AAC, so the AAC target lands ABOVE the
 * raw Opus bitrate (bounded by the quality preset's cap) rather than at the naive
 * `min(source, cap)` a `convert` would pick.
 *
 * The discriminating assertion is that the same Opus source synced under
 * `preserve` lands at a higher on-device bitrate than under `convert`
 * (`--bitrate-reduce always`). Both use the same AAC encoder and the same source
 * content, so only the seam's target differs — preserve (source ÷ 0.75) is higher
 * than convert (source). The exact efficiency arithmetic is pinned at the unit
 * level (`lossy-reduction.test.ts`, `handler.test.ts`); this test proves the path
 * is wired end-to-end through config → classifier → seam → transcoder → device.
 *
 * That assertion was once *not* true by construction. Before TASK-499,
 * `buildVbrArgs` discarded `targetKbps` on FFmpeg's native `aac` encoder, so
 * both runs emitted a byte-identical `-c:a aac -q:a 5` and the two bitrates
 * differed only by encoder noise — observed failing `> 231` with `231`, on both
 * attempts, so `bunfig.toml`'s `retry = 1` did not mask it. The test was gated
 * off on hosts with only native `aac` while that stood. TASK-499 made all three
 * AAC encoders take the seam's target (native `aac` via `-b:a`, `libfdk_aac`
 * and `aac_at` via their quality indices), so the two runs now issue different
 * requests everywhere and the gate is gone (TASK-500).
 *
 * @module
 */

import { describe, it, expect } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { aacCeilingKbps, requireFFmpeg } from '@podkit/e2e-shared';
import { runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';

import type { SyncOutput } from 'podkit/types';

requireFFmpeg();

/** Bitrate cap of the `high` quality preset, in kbps (`AAC_PRESETS.high`). */
const HIGH_CAP_KBPS = 256;

/**
 * Generate an Opus file from pink noise at a target bitrate. Noise is
 * incompressible, so the encoder cannot collapse the file to a trivial bitrate —
 * keeping the on-device measurement meaningful and stable.
 */
function generateOpus(outputPath: string, bitrateKbps: number): void {
  execSync(
    `ffmpeg -f lavfi -i "anoisesrc=color=pink:sample_rate=48000:duration=4" -ac 2 ` +
      `-metadata title="Preserve Efficiency" ` +
      `-metadata artist="Codec Artist" ` +
      `-metadata album="Codec Album" ` +
      `-c:a libopus -b:a ${bitrateKbps}k -y "${outputPath}"`,
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

quality = "high"

[defaults]
music = "default"
`
  );
  return configPath;
}

async function findIpodMusicFiles(ipodPath: string): Promise<string[]> {
  const musicDir = join(ipodPath, 'iPod_Control', 'Music');
  if (!existsSync(musicDir)) return [];
  const files: string[] = [];
  for (const entry of await readdir(musicDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sub = join(musicDir, entry.name);
    for (const f of await readdir(sub)) files.push(join(sub, f));
  }
  return files;
}

/**
 * Sync a single Opus source under a given reduce mode and return the on-device
 * AAC track bitrate.
 */
async function syncOpusAndReadBitrate(reduceMode: 'never' | 'always'): Promise<number> {
  return withTarget(async (target) => {
    const configDir = await mkdtemp(join(tmpdir(), 'podkit-config-'));
    const collectionDir = await mkdtemp(join(tmpdir(), 'podkit-preserve-eff-'));
    try {
      // Opus asked for 128 kbps, quality=high (cap 256). What matters is the
      // bitrate podkit *probes* off the file — libopus undershoots `-b:a`
      // heavily on pink noise, so the file comes out around 69 kbps. preserve
      // then targets round(probed / 0.75), convert targets min(probed, 256) =
      // probed. Both sit below the cap, so neither is clamped and the two
      // targets stand a third apart.
      generateOpus(join(collectionDir, 'track.opus'), 128);
      const configPath = await createConfig(configDir, collectionDir);

      const { result, json } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        target.path,
        '--quality',
        'high',
        '--bitrate-reduce',
        reduceMode,
        '--json',
      ]);
      expect(result.exitCode).toBe(0);
      expect(json?.result?.completed).toBe(1);

      // The Opus source is incompatible, so it must be transcoded to AAC (.m4a) —
      // never copied as .opus.
      const files = await findIpodMusicFiles(target.path);
      expect(files.filter((f) => f.endsWith('.m4a'))).toHaveLength(1);
      expect(files.filter((f) => f.endsWith('.opus'))).toHaveLength(0);

      const tracks = await target.getTracks();
      expect(tracks).toHaveLength(1);

      // Re-sync is a no-op: the add and the device-bound re-sync share the seam,
      // so the recorded encoding matches and nothing re-fires.
      const { json: reJson } = await runCliJson<SyncOutput>([
        '--config',
        configPath,
        'sync',
        '--device',
        target.path,
        '--quality',
        'high',
        '--bitrate-reduce',
        reduceMode,
        '--json',
      ]);
      expect(reJson?.result?.completed).toBe(0);

      return tracks[0]!.bitrate;
    } finally {
      await rm(collectionDir, { recursive: true, force: true });
      await rm(configDir, { recursive: true, force: true });
    }
  });
}

describe('forced transcode (incompatible codec): preserve is efficiency-matched and cap-bounded', () => {
  it('preserve targets a higher AAC bitrate than convert for the same Opus source', async () => {
    const preserveBitrate = await syncOpusAndReadBitrate('never');
    const convertBitrate = await syncOpusAndReadBitrate('always');

    // The efficiency-matched preserve target (source ÷ 0.75) is a third higher
    // than the convert target (min(source, cap) = source). Same encoder, same
    // content — the only difference is the seam's target, and since TASK-499
    // every AAC encoder podkit drives is handed that target. So the two runs
    // ask for two different bitrates by construction, rather than differing by
    // whatever the encoder felt like on the day.
    //
    // Measured on FFmpeg 9.0.1 native `aac`: preserve 93 kbps, convert 69 —
    // a ratio of 1.35 against the 1.33 the efficiency table asks for. (Both
    // sit below their nominal 171/128 because libopus undershoots `-b:a`
    // heavily on pink noise, so the source bitrate podkit probes off the file
    // is ~69 rather than 128. That scales both targets equally and does not
    // touch the relationship under test — see TASK-502 for re-deriving these
    // against real music.)
    expect(preserveBitrate).toBeGreaterThan(convertBitrate);

    // Cap-bounded: the efficiency-lifted preserve target stays at or below the
    // quality preset's cap — the hard ceiling of ADR-023 §2 is honoured
    // end-to-end. A guard rather than a proof: making the *clamp* fire needs a
    // source whose lifted target crosses 256, which on this fixture depends on
    // how libopus rate-controls noise. The clamp itself is pinned at the unit
    // level in `lossy-reduction.test.ts`; see TASK-502 for making it bind here.
    expect(preserveBitrate).toBeLessThanOrEqual(aacCeilingKbps(HIGH_CAP_KBPS));
  }, 240000);
});
