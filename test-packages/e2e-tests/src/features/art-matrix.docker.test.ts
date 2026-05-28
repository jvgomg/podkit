/**
 * Artwork-handling matrix — Subsonic / Navidrome adapter.
 *
 * Companion to `art-matrix.test.ts`. Same shape, same axes
 * (scenario × format × --check-artwork), same prediction-vs-observation
 * model — but the source is a Navidrome container instead of the local
 * filesystem.
 *
 * ## Rules (subsonic adapter)
 *
 * Source-side (`packages/podkit-core/src/adapters/subsonic.ts:540-552`):
 *   - When Navidrome populates `song.coverArt` (which it does for every
 *     track — album-level art is generated for every album), source.hasArtwork
 *     is set true regardless of whether real art exists.
 *   - `--check-artwork`: the adapter fetches via `getCoverArt`, validates the
 *     response (size, content-type, placeholder hash filter), and computes
 *     `source.artworkHash`. Navidrome's placeholder image is filtered out at
 *     connect time, so a track with no real art reads false in this mode.
 *   - Without `--check-artwork`: the adapter trusts `song.coverArt` and sets
 *     hasArtwork=true. No hash is computed.
 *
 * Device-side: the executor downloads the audio stream from Navidrome's
 * `/stream` endpoint. Navidrome does NOT splice sidecar bytes into the
 * stream — sidecar art is served separately via `/getCoverArt`. So the
 * downloaded file's embedded art reflects the *source file*'s embedded art:
 *   - scenario A: source file has none → downloaded file has none → device false
 *   - scenario B: source file embeds art (formats permitting) → preserved
 *   - scenario C: source file has none → downloaded file has none → device false
 *     (sidecar bytes never reach the device)
 *   - scenario D: same as B (source file embeds; sidecar is server-side noise)
 *
 * Idempotency: `detectUpgrades` fires `artwork-added` whenever
 * source.hasArtwork=true && device.hasArtwork=false. The escape hatch is the
 * syncTag.artworkHash, which is only written when source provides an
 * artworkHash — i.e. when `--check-artwork` is on. So the asymmetric cells
 * (source claims art but device file has none) churn forever without
 * `--check-artwork`, and converge after the first sync writes the hash with
 * `--check-artwork`.
 *
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import { cleanupTempConfig, ensureFixturesExist, runCliJson } from '@podkit/e2e-shared';
import { SCENARIO_ARTISTS } from '@podkit/test-fixtures';
import { SubsonicTestSource, isDockerAvailable } from '../sources/subsonic';
import { createSubsonicConfig } from '../helpers/subsonic-config';
import { withTarget } from '../targets';

import type { SyncOutput } from 'podkit/types';

ensureFixturesExist('multi-format');
ensureFixturesExist('multi-format-embedded');
ensureFixturesExist('multi-format-sidecar');
ensureFixturesExist('multi-format-both');

// ---------------------------------------------------------------------------
// Matrix axes (identical to the host matrix)
// ---------------------------------------------------------------------------

type Scenario = 'A-none' | 'B-embedded' | 'C-sidecar' | 'D-both';
type Format = 'wav' | 'aiff' | 'flac' | 'alac' | 'mp3' | 'aac' | 'ogg' | 'opus';

const SCENARIOS: readonly Scenario[] = ['A-none', 'B-embedded', 'C-sidecar', 'D-both'];
const FORMATS: readonly Format[] = ['wav', 'aiff', 'flac', 'alac', 'mp3', 'aac', 'ogg', 'opus'];

const SCENARIO_ARTIST: Record<Scenario, string> = {
  'A-none': SCENARIO_ARTISTS.none,
  'B-embedded': SCENARIO_ARTISTS.embedded,
  'C-sidecar': SCENARIO_ARTISTS.sidecar,
  'D-both': SCENARIO_ARTISTS.both,
};

const FORMAT_TITLE: Record<Format, string> = {
  wav: 'WAV Test Track',
  aiff: 'AIFF Test Track',
  flac: 'FLAC Test Track',
  alac: 'ALAC Test Track',
  mp3: 'MP3 Test Track',
  aac: 'AAC Test Track',
  ogg: 'OGG Test Track',
  opus: 'Opus Test Track',
};

const FIXTURE_EMBEDS_ART: Record<Format, boolean> = {
  wav: true,
  aiff: true,
  flac: true,
  alac: true,
  mp3: true,
  aac: true,
  ogg: true,
  opus: true,
};

// ---------------------------------------------------------------------------
// Prediction engine
// ---------------------------------------------------------------------------

interface Expected {
  trackPresent: boolean;
  deviceHasArtwork: boolean | null;
  idempotent: boolean;
  reason: string;
}

function predict(scenario: Scenario, format: Format, checkArtwork: boolean): Expected {
  // Source-side: subsonic adapter behaviour.
  let sourceHasArtwork: boolean;
  let sourceHasArtworkHash: boolean;
  if (checkArtwork) {
    // Real fetch + placeholder filter. Scenario A has no real art so
    // Navidrome serves the placeholder, which is filtered → false.
    sourceHasArtwork = scenario !== 'A-none';
    sourceHasArtworkHash = sourceHasArtwork;
  } else {
    // Optimistic-true on song.coverArt presence (which is universal).
    sourceHasArtwork = true;
    sourceHasArtworkHash = false;
  }

  // Device-side: the downloaded audio stream carries embedded art only when
  // the source FILE had it. Sidecar bytes never reach the file body.
  // Every multi-format track now has its own working embed strategy (WAV
  // via post-process `id3 ` chunk; OGG/Opus via METADATA_BLOCK_PICTURE), so
  // each format's device-side artwork is determined purely by whether the
  // fixture variant included embed for it — no cross-track inheritance.
  const deviceHasArtwork =
    (scenario === 'B-embedded' || scenario === 'D-both') && FIXTURE_EMBEDS_ART[format];

  // Idempotency rules from detectUpgrades + syncTag write:
  //   * Symmetric (both true or both false) → no churn.
  //   * Asymmetric (source true, device false):
  //       - With --check-artwork: source.artworkHash is written into the
  //         syncTag on first sync; second sync's artwork-added check compares
  //         hash and skips.
  //       - Without --check-artwork: no hash to compare → artwork-added every
  //         second sync.
  //   * source false / device true is unreachable from these fixtures.
  let idempotent: boolean;
  let asymmetryReason: string | null = null;
  if (sourceHasArtwork === deviceHasArtwork) {
    idempotent = true;
  } else if (sourceHasArtwork && !deviceHasArtwork) {
    idempotent = sourceHasArtworkHash; // i.e. checkArtwork
    asymmetryReason = sourceHasArtworkHash
      ? 'source/device mismatch but syncTag hash breaks the loop'
      : 'source/device mismatch with no hash → artwork-added every sync (optimistic-true bug)';
  } else {
    idempotent = false;
    asymmetryReason = 'source has no art but device does (unexpected for these fixtures)';
  }

  let reason: string;
  if (scenario === 'A-none') {
    reason = checkArtwork
      ? 'Navidrome placeholder filtered → source=false → symmetric'
      : 'Navidrome reports coverArt → source=true (phantom) → asymmetric → optimistic-true loop';
  } else if (scenario === 'C-sidecar' || !FIXTURE_EMBEDS_ART[format]) {
    reason = checkArtwork
      ? `device file has no embed → asymmetric → syncTag hash converges (no churn)`
      : `device file has no embed → asymmetric, no hash → artwork-added every sync`;
  } else {
    reason = 'embedded art in source file → device has art → symmetric, idempotent';
  }

  // Defensive: catch a class of rule mistakes by making sure asymmetric
  // unbroken-by-hash cells advertise themselves clearly.
  if (asymmetryReason && !reason.includes('hash') && !reason.includes('symmetric')) {
    reason = `${reason} — ${asymmetryReason}`;
  }

  return { trackPresent: true, deviceHasArtwork, idempotent, reason };
}

// ---------------------------------------------------------------------------
// Pass runner
// ---------------------------------------------------------------------------

interface Observed {
  trackPresent: boolean;
  deviceHasArtwork: boolean | null;
  idempotent: boolean;
  secondSyncOps: Array<{ type: string; reason?: string }>;
}

interface PassResult {
  checkArtwork: boolean;
  byKey: Map<string, Observed>;
}

function cellKey(scenario: Scenario, format: Format): string {
  return `${scenario}/${format}`;
}

function expectedOpString(scenario: Scenario, format: Format): string {
  return `${SCENARIO_ARTIST[scenario]} - ${FORMAT_TITLE[format]}`;
}

const ARTWORK_OP_REASONS = new Set(['artwork-added', 'artwork-updated', 'artwork-removed']);
const ADD_OP_TYPES = new Set(['add-transcode', 'add-direct-copy', 'add-optimized-copy']);
const UPGRADE_OP_TYPES = new Set([
  'upgrade-transcode',
  'upgrade-direct-copy',
  'upgrade-optimized-copy',
]);

let source: SubsonicTestSource | null = null;

async function runPass(checkArtwork: boolean): Promise<PassResult> {
  return withTarget<PassResult>(async (target) => {
    const configPath = await createSubsonicConfig(source!.serverUrl, source!.username);

    try {
      const baseArgs = ['--config', configPath, 'sync', '--device', target.path, '--json'];
      const initArgs = checkArtwork ? [...baseArgs, '--check-artwork'] : baseArgs;
      const env = source!.getEnv();

      const { result: initResult, json: initJson } = await runCliJson<SyncOutput>(initArgs, {
        env,
        timeout: 300000,
      });
      if (initResult.exitCode !== 0 || !initJson?.success) {
        throw new Error(
          `initial sync failed (checkArtwork=${checkArtwork}): exit=${initResult.exitCode}\n` +
            `  json: ${JSON.stringify(initJson, null, 2)}\n` +
            `  stderr: ${initResult.stderr}`
        );
      }

      const deviceTracks = await target.getTracks();

      const { result: dryResult, json: dryJson } = await runCliJson<SyncOutput>(
        [...initArgs, '--dry-run'],
        { env, timeout: 180000 }
      );
      if (dryResult.exitCode !== 0 || !dryJson) {
        throw new Error(
          `dry-run sync failed (checkArtwork=${checkArtwork}): exit=${dryResult.exitCode}`
        );
      }

      const byKey = new Map<string, Observed>();
      for (const scenario of SCENARIOS) {
        for (const format of FORMATS) {
          const opTarget = expectedOpString(scenario, format);
          const trackArtist = SCENARIO_ARTIST[scenario];
          const trackTitle = FORMAT_TITLE[format];

          const device = deviceTracks.find(
            (t) => t.artist === trackArtist && t.title === trackTitle
          );

          const matchingOps = (dryJson.operations ?? []).filter(
            (op) => (op.track ?? '') === opTarget
          );
          const idempotent = !matchingOps.some(
            (op) =>
              op.type === 'upgrade-artwork' ||
              ADD_OP_TYPES.has(op.type) ||
              (UPGRADE_OP_TYPES.has(op.type) &&
                op.reason !== undefined &&
                ARTWORK_OP_REASONS.has(op.reason))
          );

          byKey.set(cellKey(scenario, format), {
            trackPresent: device !== undefined,
            deviceHasArtwork: device ? device.hasArtwork : null,
            idempotent,
            secondSyncOps: matchingOps.map((op) => ({ type: op.type, reason: op.reason })),
          });
        }
      }

      return { checkArtwork, byKey };
    } finally {
      await cleanupTempConfig(configPath);
    }
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

let PASS_OFF: PassResult | null = null;
let PASS_ON: PassResult | null = null;

beforeAll(async () => {
  if (!(await isDockerAvailable())) {
    throw new Error('Docker is not available — required for the art-matrix subsonic suite.');
  }

  source = new SubsonicTestSource();
  console.log('Starting Navidrome container for art matrix...');
  await source.setup();
  console.log(`Navidrome ready at ${source.serverUrl}`);

  PASS_OFF = await runPass(false);
  PASS_ON = await runPass(true);
}, 1500000);

afterAll(async () => {
  if (source) {
    console.log('Stopping Navidrome container...');
    await source.teardown();
    source = null;
  }
});

describe('artwork matrix — subsonic adapter', () => {
  for (const checkArtwork of [false, true]) {
    describe(`--check-artwork ${checkArtwork ? 'on' : 'off'}`, () => {
      for (const scenario of SCENARIOS) {
        for (const format of FORMATS) {
          const expected = predict(scenario, format, checkArtwork);
          it(`${scenario} / ${format}`, () => {
            const pass = checkArtwork ? PASS_ON : PASS_OFF;
            expect(pass).not.toBeNull();
            const observed = pass!.byKey.get(cellKey(scenario, format));
            expect(observed).toBeDefined();

            const diffs: string[] = [];
            if (observed!.trackPresent !== expected.trackPresent) {
              diffs.push(
                `  trackPresent: expected=${expected.trackPresent}, observed=${observed!.trackPresent}`
              );
            }
            if (observed!.deviceHasArtwork !== expected.deviceHasArtwork) {
              diffs.push(
                `  deviceHasArtwork: expected=${expected.deviceHasArtwork}, observed=${observed!.deviceHasArtwork}`
              );
            }
            if (observed!.idempotent !== expected.idempotent) {
              diffs.push(
                `  idempotent: expected=${expected.idempotent}, observed=${observed!.idempotent}`
              );
              diffs.push(`    secondSyncOps: ${JSON.stringify(observed!.secondSyncOps)}`);
            }

            if (diffs.length > 0) {
              throw new Error(
                `Cell ${scenario}/${format} (--check-artwork ${checkArtwork ? 'on' : 'off'}) mismatched expectations:\n${diffs.join(
                  '\n'
                )}\n  rule: ${expected.reason}`
              );
            }
          });
        }
      }
    });
  }
});
