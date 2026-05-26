/**
 * Artwork change-detection matrix — directory adapter.
 *
 * Companion to `art-matrix.test.ts`. Where that matrix probes the state
 * after a single fresh sync, this one probes podkit's ability to **detect
 * source artwork changing between syncs**:
 *
 *   1. Sync the embedded-art fixture (cover A) to a fresh iPod.
 *   2. Swap the source file with the alt-cover variant (cover B) — identical
 *      tags, different cover JPEG bytes.
 *   3. Dry-run a second sync. Observe which operations fire.
 *
 * The same prediction-vs-observation contract as the static matrix: the
 * predictor encodes podkit's current behaviour, the test fails on any
 * mismatch. The `reason` field on each cell documents *why* the outcome
 * is what it is.
 *
 * ## What this matrix demonstrates
 *
 * `--check-artwork` exists because the cheap path (no flag) cannot detect
 * artwork-only changes:
 *
 *   - Without `--check-artwork`: the directory adapter never computes
 *     `source.artworkHash`, so `detectUpgrades`'s artwork-updated branch
 *     (`packages/podkit-core/src/sync/engine/upgrades.ts:294-299`) is
 *     inert. Cover-swap is silently missed — the new cover never reaches
 *     the device until the file is touched again for some other reason.
 *   - With `--check-artwork`: source.artworkHash is populated, sync 1
 *     writes the old hash into the syncTag, sync 2 compares against the
 *     new hash and fires `artwork-updated`.
 *
 * For formats that don't carry embedded art in the fixture (WAV / AIFF /
 * OGG / Opus), the alt variant is also embed-less, so there is nothing to
 * change. Those cells stay at no-op regardless of the flag. AIFF is
 * additionally absent from the device entirely — see the standing AIFF
 * note on the static matrix.
 *
 * Subsonic / Navidrome coverage of artwork-change is deferred: mutating
 * source files behind Navidrome requires triggering a library rescan and
 * waiting for re-index, which is a separate harness concern.
 *
 * @module
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ensureFixturesExist,
  cleanupTempConfig,
  createTempConfig,
  runCliJson,
} from '@podkit/e2e-shared';
import {
  SCENARIO_ARTISTS,
  getMultiFormatEmbeddedFixturesDir,
  getMultiFormatEmbeddedAltFixturesDir,
} from '@podkit/test-fixtures';
import { withTarget } from '../targets';

import type { SyncOutput } from 'podkit/types';

ensureFixturesExist('multi-format-embedded');
ensureFixturesExist('multi-format-embedded-alt');

// ---------------------------------------------------------------------------
// Matrix axes
// ---------------------------------------------------------------------------

type Format = 'wav' | 'aiff' | 'flac' | 'alac' | 'mp3' | 'aac' | 'ogg' | 'opus';

const FORMATS: readonly Format[] = ['wav', 'aiff', 'flac', 'alac', 'mp3', 'aac', 'ogg', 'opus'];

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
 * Whether the fixture for this format embeds an attached_pic stream. Only
 * these formats can experience an artwork-change — for the rest the alt
 * variant is also embed-less and the cover bytes never reach the device or
 * the source-side adapter.
 */
const FIXTURE_EMBEDS_ART: Record<Format, boolean> = {
  wav: false,
  aiff: false,
  flac: true,
  alac: true,
  mp3: true,
  aac: true,
  ogg: false,
  opus: false,
};

const ARTIST = SCENARIO_ARTISTS.embedded;

// ---------------------------------------------------------------------------
// Prediction engine
// ---------------------------------------------------------------------------

interface Expected {
  /** Did the track land on the device during sync 1? */
  trackPresent: boolean;
  /**
   * Operations the second sync should produce for this track, as a sorted
   * comma-joined `<type>:<reason>` list. Empty string means "no ops".
   *
   * We track every op (not only artwork-updated) so the matrix catches
   * unrelated quirks like the MP3 `codec-changed` op that fires on every
   * post-mutation sync without `--check-artwork`.
   */
  ops: string;
  /** Documented rule that produced this expectation. */
  reason: string;
}

function predict(format: Format, checkArtwork: boolean): Expected {
  // AIFF tracks never reach the device — same pipeline drop seen in the
  // static matrix. No track, no diff, no detection.
  if (format === 'aiff') {
    return {
      trackPresent: false,
      ops: '',
      reason: 'AIFF tracks do not land on the device (bug — pipeline drops AIFF)',
    };
  }

  if (!FIXTURE_EMBEDS_ART[format]) {
    return {
      trackPresent: true,
      ops: '',
      reason: `${format} cannot carry embedded art in the fixture — source bytes never change → no diff to detect`,
    };
  }

  // From here on, the file has embedded art in both variants. The cover
  // bytes differ between sync 1 and sync 2.
  if (checkArtwork) {
    return {
      trackPresent: true,
      ops: 'upgrade-artwork:artwork-updated',
      reason: 'source.artworkHash differs from syncTag.artworkHash → artwork-updated fires',
    };
  }

  // MP3 quirk: without --check-artwork the post-mutation second sync produces
  // a `codec-changed` upgrade-direct-copy op for the MP3 track. None of the
  // other embed-capable formats (FLAC, ALAC, AAC) show this. Likely because
  // the syncTag.codec field interaction with MP3's lossy-copy path differs
  // from the other formats — captured here so a future fix surfaces; see the
  // backlog task on `postProcessCodecChanges`.
  if (format === 'mp3') {
    return {
      trackPresent: true,
      ops: 'upgrade-direct-copy:codec-changed',
      reason:
        'no --check-artwork → cover-swap silently missed, but MP3 also produces a spurious codec-changed op every sync (bug — codec-changed for unchanged codec)',
    };
  }

  return {
    trackPresent: true,
    ops: '',
    reason:
      'no --check-artwork → source.artworkHash undefined → artwork-updated branch is inert → cover-swap is silently missed (documented limitation; the reason --check-artwork exists)',
  };
}

// ---------------------------------------------------------------------------
// Pass runner
// ---------------------------------------------------------------------------

interface Observed {
  trackPresent: boolean;
  /** Same sorted comma-joined `<type>:<reason>` shape as Expected.ops. */
  ops: string;
  secondSyncOps: Array<{ type: string; reason?: string }>;
}

interface PassResult {
  checkArtwork: boolean;
  byFormat: Map<Format, Observed>;
}

function expectedOpString(format: Format): string {
  return `${ARTIST} - ${FORMAT_TITLE[format]}`;
}

async function copyDir(src: string, dst: string): Promise<void> {
  await cp(src, dst, { recursive: true });
}

async function runPass(checkArtwork: boolean): Promise<PassResult> {
  return withTarget<PassResult>(async (target) => {
    const sourceRoot = await mkdtemp(join(tmpdir(), 'art-matrix-change-'));
    // Mirror the embedded fixture into the mutable source root.
    await copyDir(getMultiFormatEmbeddedFixturesDir(), join(sourceRoot, 'album'));

    const configPath = await createTempConfig(sourceRoot);

    try {
      const baseArgs = ['--config', configPath, 'sync', '--device', target.path, '--json'];
      const initArgs = checkArtwork ? [...baseArgs, '--check-artwork'] : baseArgs;

      const { result: initResult, json: initJson } = await runCliJson<SyncOutput>(initArgs, {
        timeout: 240000,
      });
      if (initResult.exitCode !== 0 || !initJson?.success) {
        throw new Error(
          `initial sync failed (checkArtwork=${checkArtwork}): exit=${initResult.exitCode}\n` +
            `  json: ${JSON.stringify(initJson, null, 2)}\n` +
            `  stderr: ${initResult.stderr}`
        );
      }

      const deviceTracks = await target.getTracks();
      const presenceByFormat = new Map<Format, boolean>();
      for (const format of FORMATS) {
        const found = deviceTracks.some(
          (t) => t.artist === ARTIST && t.title === FORMAT_TITLE[format]
        );
        presenceByFormat.set(format, found);
      }

      // Mutate: replace the album directory with the alt-cover variant.
      await rm(join(sourceRoot, 'album'), { recursive: true, force: true });
      await copyDir(getMultiFormatEmbeddedAltFixturesDir(), join(sourceRoot, 'album'));

      const { result: dryResult, json: dryJson } = await runCliJson<SyncOutput>(
        [...initArgs, '--dry-run'],
        { timeout: 120000 }
      );
      if (dryResult.exitCode !== 0 || !dryJson) {
        throw new Error(
          `dry-run sync failed (checkArtwork=${checkArtwork}): exit=${dryResult.exitCode}`
        );
      }

      const byFormat = new Map<Format, Observed>();
      for (const format of FORMATS) {
        const opTarget = expectedOpString(format);
        const matchingOps = (dryJson.operations ?? []).filter(
          (op) => (op.track ?? '') === opTarget
        );
        const opStrings = matchingOps.map((op) => `${op.type}:${op.reason ?? ''}`).sort();
        byFormat.set(format, {
          trackPresent: presenceByFormat.get(format) ?? false,
          ops: opStrings.join(','),
          secondSyncOps: matchingOps.map((op) => ({ type: op.type, reason: op.reason })),
        });
      }

      return { checkArtwork, byFormat };
    } finally {
      await cleanupTempConfig(configPath);
      try {
        await rm(sourceRoot, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
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

describe('artwork change detection — directory adapter', () => {
  for (const checkArtwork of [false, true]) {
    describe(`--check-artwork ${checkArtwork ? 'on' : 'off'}`, () => {
      for (const format of FORMATS) {
        const expected = predict(format, checkArtwork);
        it(`${format}`, () => {
          const pass = checkArtwork ? PASS_ON : PASS_OFF;
          expect(pass).not.toBeNull();
          const observed = pass!.byFormat.get(format);
          expect(observed).toBeDefined();

          const diffs: string[] = [];
          if (observed!.trackPresent !== expected.trackPresent) {
            diffs.push(
              `  trackPresent: expected=${expected.trackPresent}, observed=${observed!.trackPresent}`
            );
          }
          if (observed!.ops !== expected.ops) {
            diffs.push(`  ops: expected="${expected.ops}", observed="${observed!.ops}"`);
            diffs.push(`    secondSyncOps: ${JSON.stringify(observed!.secondSyncOps)}`);
          }

          if (diffs.length > 0) {
            throw new Error(
              `Cell ${format} (--check-artwork ${checkArtwork ? 'on' : 'off'}) mismatched expectations:\n${diffs.join(
                '\n'
              )}\n  rule: ${expected.reason}`
            );
          }
        });
      }
    });
  }
});
