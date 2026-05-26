/**
 * Artwork-handling matrix — directory adapter.
 *
 * Probes the full grid of (source format × art location) for the directory
 * adapter. For each cell we verify two things after syncing to a dummy iPod:
 *
 *   1. Initial sync: `device.hasArtwork` matches the cell's expectation.
 *   2. Idempotency: a second sync with unchanged source produces no
 *      `artwork-added` / `artwork-updated` upgrades — the "Music already in
 *      sync!" path.
 *
 * Cells that we expect to be broken today are tagged with `expectedBroken`.
 * Broken cells still run; the assertion that ought to pass is inverted, so
 * if a fix later lands the test fails until the cell is removed from the
 * broken map. The point is to make breakages visible and convert them into
 * follow-up work, not to skip them.
 *
 * Adapter probe notes (see `packages/podkit-core/src/adapters/directory.ts`):
 *   - The directory adapter reads embedded artwork only (via music-metadata
 *     `common.picture`). It does NOT inspect sidecar `cover.jpg` files. That
 *     means scenarios C (sidecar only) are expected to all show
 *     `hasArtwork=false` on the device — same as scenario A.
 *
 * Companion: `art-matrix.docker.test.ts` covers the Subsonic adapter.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import {
  ensureFixturesExist,
  cleanupTempConfig,
  createTempConfig,
  runCli,
  runCliJson,
} from '@podkit/e2e-shared';
import { withTarget } from '../targets';
import { Albums, getAlbumDir, type AlbumDir } from '../helpers/fixtures';

import type { SyncOutput } from 'podkit/types';

ensureFixturesExist('multi-format');
ensureFixturesExist('multi-format-embedded');
ensureFixturesExist('multi-format-sidecar');
ensureFixturesExist('multi-format-both');

// ---------------------------------------------------------------------------
// Matrix definition
// ---------------------------------------------------------------------------

type Scenario = 'A-none' | 'B-embedded' | 'C-sidecar' | 'D-both';

type Format = 'wav' | 'aiff' | 'flac' | 'alac' | 'mp3' | 'aac' | 'ogg' | 'opus';

interface MatrixCell {
  scenario: Scenario;
  /** Album directory that hosts the source files for this scenario. */
  album: AlbumDir;
  format: Format;
  /** Filename inside the album dir. */
  filename: string;
  /** What the device track's `hasArtwork` should be after the initial sync. */
  expectedDeviceHasArtwork: boolean;
  /**
   * When set, this cell is a known-broken probe. The test inverts assertions
   * for the cell and fails if the cell suddenly passes (so the broken-map
   * stays honest as bugs get fixed).
   */
  expectedBroken?: string;
}

const FORMAT_FILENAMES: Record<Format, string> = {
  wav: '01-wav-track.wav',
  aiff: '02-aiff-track.aiff',
  flac: '03-flac-track.flac',
  alac: '04-alac-track.m4a',
  mp3: '05-mp3-track.mp3',
  aac: '06-aac-track.m4a',
  ogg: '07-ogg-track.ogg',
  opus: '08-opus-track.opus',
};

const SCENARIO_ALBUM: Record<Scenario, AlbumDir> = {
  'A-none': Albums.MULTI_FORMAT,
  'B-embedded': Albums.MULTI_FORMAT_EMBEDDED,
  'C-sidecar': Albums.MULTI_FORMAT_SIDECAR,
  'D-both': Albums.MULTI_FORMAT_BOTH,
};

const FORMATS: Format[] = ['wav', 'aiff', 'flac', 'alac', 'mp3', 'aac', 'ogg', 'opus'];

/**
 * Codecs whose fixture file embeds an attached_pic. WAV and AIFF muxers
 * reject video streams; OGG/Opus need METADATA_BLOCK_PICTURE which the
 * fixture generator does not write. See `audio-multi-format.ts`.
 */
const EMBEDS_ATTACHED_PIC: Record<Format, boolean> = {
  wav: false,
  aiff: false,
  flac: true,
  alac: true,
  mp3: true,
  aac: true,
  ogg: false,
  opus: false,
};

function buildCells(): MatrixCell[] {
  const cells: MatrixCell[] = [];

  for (const format of FORMATS) {
    // Scenario A — no artwork. Nothing should show device artwork.
    cells.push({
      scenario: 'A-none',
      album: SCENARIO_ALBUM['A-none'],
      format,
      filename: FORMAT_FILENAMES[format],
      expectedDeviceHasArtwork: false,
    });

    // Scenario B — embedded only. Round-trips only when the generator could
    // embed (mp3, flac, alac, aac). WAV/AIFF/OGG/Opus fixtures have no
    // embedded art at all, so device.hasArtwork is correctly false; that's
    // not a bug — it's the codec/container limit.
    cells.push({
      scenario: 'B-embedded',
      album: SCENARIO_ALBUM['B-embedded'],
      format,
      filename: FORMAT_FILENAMES[format],
      expectedDeviceHasArtwork: EMBEDS_ATTACHED_PIC[format],
    });

    // Scenario C — sidecar only. Directory adapter ignores cover.jpg, so
    // every cell should produce device.hasArtwork=false.
    cells.push({
      scenario: 'C-sidecar',
      album: SCENARIO_ALBUM['C-sidecar'],
      format,
      filename: FORMAT_FILENAMES[format],
      expectedDeviceHasArtwork: false,
    });

    // Scenario D — both. With the directory adapter the sidecar is invisible,
    // so behaviour is identical to scenario B.
    cells.push({
      scenario: 'D-both',
      album: SCENARIO_ALBUM['D-both'],
      format,
      filename: FORMAT_FILENAMES[format],
      expectedDeviceHasArtwork: EMBEDS_ATTACHED_PIC[format],
    });
  }

  return cells;
}

const CELLS = buildCells();

// ---------------------------------------------------------------------------
// Per-cell sync routine
// ---------------------------------------------------------------------------

interface SyncTwiceResult {
  initialHasArtwork: boolean | null;
  secondPlanAdds: number;
  secondPlanUpdates: number;
  secondStdout: string;
  initialJson: SyncOutput | null;
  secondJson: SyncOutput | null;
  /** Track count seen on the device after the first sync. */
  initialTrackCount: number;
}

async function runCellSync(cell: MatrixCell): Promise<SyncTwiceResult> {
  const musicPath = getAlbumDir(cell.album);

  return await withTarget(async (target) => {
    const configPath = await createTempConfig(musicPath);
    try {
      const { json: firstJson, result: firstResult } = await runCliJson<SyncOutput>(
        ['--config', configPath, 'sync', '--device', target.path, '--json'],
        { timeout: 120000 }
      );
      expect(firstResult.exitCode).toBe(0);
      expect(firstJson?.success).toBe(true);

      const tracks = await target.getTracks();
      const targetTrack = tracks.find((t) =>
        // Title is what podkit pulls from ffmpeg metadata; matches our fixture title.
        (t.title ?? '').toLowerCase().startsWith(cell.format)
      );

      const second = await runCli(
        ['--config', configPath, 'sync', '--device', target.path, '--json'],
        { timeout: 60000 }
      );
      const secondJson = JSON.parse(second.stdout) as SyncOutput;

      return {
        initialHasArtwork: targetTrack ? targetTrack.hasArtwork : null,
        secondPlanAdds: secondJson?.plan?.tracksToAdd ?? 0,
        secondPlanUpdates: secondJson?.plan?.tracksToUpdate ?? 0,
        secondStdout: second.stdout,
        initialJson: firstJson,
        secondJson,
        initialTrackCount: tracks.length,
      };
    } finally {
      await cleanupTempConfig(configPath);
    }
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('artwork matrix (directory adapter)', () => {
  beforeAll(() => {
    // No global state to set up — the matrix is fully driven by per-cell sync.
  });

  for (const cell of CELLS) {
    const label = `${cell.scenario} / ${cell.format}`;
    const desc = cell.expectedBroken ? `${label} [expectedBroken: ${cell.expectedBroken}]` : label;

    it(
      desc,
      async () => {
        const result = await runCellSync(cell);

        const trackPresent = result.initialHasArtwork !== null;
        const observed = result.initialHasArtwork === true;
        const matchesExpectation = trackPresent && observed === cell.expectedDeviceHasArtwork;
        const idempotent =
          result.secondPlanAdds === 0 &&
          // Allow a single sync-tag-write follow-up to be the no-op path; what
          // we are really looking for is no `artwork-added` / `artwork-updated`.
          (result.secondJson?.plan?.updateBreakdown?.['artwork-added'] ?? 0) === 0 &&
          (result.secondJson?.plan?.updateBreakdown?.['artwork-updated'] ?? 0) === 0;

        const ok = matchesExpectation && idempotent;

        if (cell.expectedBroken) {
          // Inverted assertion — if a previously-broken cell starts passing,
          // we want a noisy failure so the broken-map can be cleaned up.
          expect(ok).toBe(false);
        } else {
          if (!ok) {
            throw new Error(
              `Cell ${label} failed:\n` +
                `  expectedDeviceHasArtwork=${cell.expectedDeviceHasArtwork}, observed=${observed}\n` +
                `  secondPlanAdds=${result.secondPlanAdds}, secondPlanUpdates=${result.secondPlanUpdates}\n` +
                `  breakdown=${JSON.stringify(result.secondJson?.plan?.updateBreakdown)}\n` +
                `  initialTrackCount=${result.initialTrackCount}`
            );
          }
          expect(ok).toBe(true);
        }
      },
      180000
    );
  }
});
