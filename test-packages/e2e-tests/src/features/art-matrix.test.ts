/**
 * Artwork-handling matrix — directory adapter.
 *
 * Walks the full (scenario × format × --check-artwork) grid for podkit's
 * directory source adapter. For each cell we observe two things:
 *
 *   1. After a fresh sync, does `device.hasArtwork` match what the rules
 *      predict?
 *   2. After a second sync with unchanged source, does podkit avoid any
 *      artwork-related ops for that track (artwork-added/-updated/-removed
 *      or the standalone upgrade-artwork op)?
 *
 * The matrix is a **frozen snapshot of current behaviour**. The `predict()`
 * function encodes the rules we believe podkit follows today; when a code
 * change flips a cell's outcome, the test fails and the maintainer either
 * (a) accepts the change and updates the rule, or (b) reverts the regression.
 * No `expectedBroken` flag, no inverted assertions — the prediction itself
 * is the assertion.
 *
 * ## Rules (directory adapter)
 *
 * `packages/podkit-core/src/adapters/directory.ts` reads embedded artwork
 * only via `music-metadata`'s `common.picture`. The adapter has never
 * looked at sidecar `cover.jpg` files. That means scenarios C (sidecar
 * only) and D (sidecar+embedded) collapse onto A and B respectively from
 * the directory adapter's perspective.
 *
 * `packages/podkit-core/src/sync/engine/upgrades.ts` fires:
 *   - `artwork-added`    when source.hasArtwork=true && device.hasArtwork=false
 *   - `artwork-removed`  when source.hasArtwork=false && device.hasArtwork=true
 *   - `artwork-updated`  when source.artworkHash differs from syncTag.artworkHash
 *
 * Without `--check-artwork`, source.artworkHash is undefined so
 * artwork-updated never fires; loop avoidance relies on source/device agreeing
 * on hasArtwork.
 *
 * @module
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { join } from 'node:path';

import {
  ensureFixturesExist,
  cleanupTempConfig,
  createTempConfig,
  runCliJson,
} from '@podkit/e2e-shared';
import { SCENARIO_ARTISTS, getStaticFixturesRoot } from '@podkit/test-fixtures';
import { withTarget } from '../targets';

import type { SyncOutput } from 'podkit/types';

ensureFixturesExist('multi-format');
ensureFixturesExist('multi-format-embedded');
ensureFixturesExist('multi-format-sidecar');
ensureFixturesExist('multi-format-both');

// ---------------------------------------------------------------------------
// Matrix axes
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

/**
 * Whether the fixture for this format embeds cover art when the variant
 * calls for it (B and D). Every format now opts into a working embed
 * strategy in `audio-multi-format.ts` (attached_pic for FLAC/ALAC/MP3/AAC/
 * AIFF, METADATA_BLOCK_PICTURE for OGG/Opus, post-process `id3 ` RIFF chunk
 * for WAV).
 */
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
  /** Did this track make it onto the device after sync? */
  trackPresent: boolean;
  /** `device.hasArtwork` after the initial sync. `null` only when !trackPresent. */
  deviceHasArtwork: boolean | null;
  /** Second sync did not produce any artwork-related op for this track. */
  idempotent: boolean;
  /** Rule that produced this expectation — handy when a cell fails. */
  reason: string;
}

function predict(scenario: Scenario, format: Format, _checkArtwork: boolean): Expected {
  // Directory adapter only sees embedded art. Sidecar scenarios collapse
  // onto their non-sidecar counterparts.
  const fixtureHasEmbeddedSlot = scenario === 'B-embedded' || scenario === 'D-both';
  const sourceHasEmbeddedArt = fixtureHasEmbeddedSlot && FIXTURE_EMBEDS_ART[format];

  // Today's pipeline: copy preserves embedded art; transcode also embeds the
  // source's art into the AAC output when source had it. Either way the
  // device track inherits the source's artwork state.
  const deviceHasArtwork = sourceHasEmbeddedArt;

  // Both sides agree → no add/removed asymmetry → idempotent.
  const idempotent = sourceHasEmbeddedArt === deviceHasArtwork;

  let reason: string;
  if (scenario === 'A-none') {
    reason = 'no art anywhere → device gets none → idempotent';
  } else if (scenario === 'C-sidecar') {
    reason = 'sidecar invisible to directory adapter → collapses onto A';
  } else if (!FIXTURE_EMBEDS_ART[format]) {
    reason = `${format} container does not carry embedded art in fixture → collapses onto A`;
  } else {
    reason = 'embedded art preserved through copy/transcode pipeline';
  }

  return {
    trackPresent: true,
    deviceHasArtwork,
    idempotent,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Pass runner — one fresh sync per (--check-artwork) value
// ---------------------------------------------------------------------------

interface Observed {
  trackPresent: boolean;
  deviceHasArtwork: boolean | null;
  idempotent: boolean;
  /** Operations on this track in the second sync's dry-run output. */
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

/**
 * The directory adapter scans the static fixtures root recursively. That root
 * contains goldberg, synthetic-tests, and the four multi-format scenarios as
 * siblings. The matrix only asserts on the 32 multi-format-scenario cells, so
 * the extra non-matrix tracks come along for the ride harmlessly.
 */
function getSourceRoot(): string {
  return join(getStaticFixturesRoot(), 'audio');
}

async function runPass(checkArtwork: boolean): Promise<PassResult> {
  return withTarget<PassResult>(async (target) => {
    const root = getSourceRoot();
    const configPath = await createTempConfig(root);

    try {
      const baseArgs = ['--config', configPath, 'sync', '--device', target.path, '--json'];
      const initArgs = checkArtwork ? [...baseArgs, '--check-artwork'] : baseArgs;

      const { result: initResult, json: initJson } = await runCliJson<SyncOutput>(initArgs, {
        timeout: 240000,
      });
      if (initResult.exitCode !== 0 || !initJson?.success) {
        throw new Error(
          `initial sync failed (checkArtwork=${checkArtwork}): exit=${initResult.exitCode}\n` +
            `  args: ${JSON.stringify(initArgs)}\n` +
            `  json: ${JSON.stringify(initJson, null, 2)}\n` +
            `  stdout: ${initResult.stdout}\n` +
            `  stderr: ${initResult.stderr}`
        );
      }

      const deviceTracks = await target.getTracks();

      const { result: dryResult, json: dryJson } = await runCliJson<SyncOutput>(
        [...initArgs, '--dry-run'],
        { timeout: 120000 }
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
  PASS_OFF = await runPass(false);
  PASS_ON = await runPass(true);
}, 900000);

describe('artwork matrix — directory adapter', () => {
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
