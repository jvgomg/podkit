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
 * The discriminating assertion is encoder-agnostic: the same Opus source synced
 * under `preserve` lands at a higher on-device bitrate than under `convert`
 * (`--bitrate-reduce always`). Both use the same AAC encoder and the same source
 * content, so only the seam's target differs — preserve (source ÷ 0.75) is higher
 * than convert (source). The exact efficiency arithmetic is pinned at the unit
 * level (`lossy-reduction.test.ts`, `handler.test.ts`); this test proves the path
 * is wired end-to-end through config → classifier → seam → transcoder → device.
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
import { requireFFmpeg } from '@podkit/e2e-shared';
import { runCliJson } from '../helpers/cli-runner';
import { withTarget } from '../targets';

import type { SyncOutput } from 'podkit/types';

requireFFmpeg();

/**
 * Generate an Opus file from pink noise at a target bitrate. Noise is
 * incompressible, so the encoder cannot collapse the file to a trivial bitrate —
 * keeping the on-device measurement meaningful and stable.
 */
function generateOpus(outputPath: string, bitrateKbps: number): void {
  execSync(
    `ffmpeg -f lavfi -i "anoisesrc=color=pink:sample_rate=48000:duration=4" ` +
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
      // 128 kbps Opus, quality=high (cap 256). preserve target = round(128 / 0.75)
      // = 171 (below the cap — not clamped); convert target = min(128, 256) = 128.
      // The two land in different AAC encoder quality buckets, so the on-device
      // bitrate differs observably.
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

    // The efficiency-matched preserve target (source ÷ 0.75 = 171) is higher than
    // the convert target (min(source, cap) = 128). Same encoder, same content —
    // the only difference is the seam's target — so the on-device AAC bitrate is
    // strictly higher under preserve. This is the end-to-end fingerprint of the
    // codec-efficiency path that a naive min(source, cap) would not produce.
    expect(preserveBitrate).toBeGreaterThan(convertBitrate);

    // Cap-bounded: even the efficiency-lifted preserve target stays at or below
    // the quality preset's cap (256) — the hard ceiling is honoured end-to-end.
    expect(preserveBitrate).toBeLessThanOrEqual(256);
  }, 240000);
});
