/**
 * Artwork-handling matrix — Subsonic / Navidrome adapter.
 *
 * Sister to `art-matrix.test.ts` (directory adapter). Navidrome indexes the
 * four `multi-format*` fixture albums; a single sync per scenario covers
 * all 8 codecs per scenario. We then read back the device tracks and check
 * `hasArtwork` per cell. A second sync per scenario probes idempotency —
 * no `artwork-added` / `artwork-updated` operations should appear for any
 * cell whose source state is unchanged.
 *
 * Adapter probe notes (see `packages/podkit-core/src/adapters/subsonic.ts:546`):
 *   - When `checkArtwork` is OFF (the default), the adapter sets
 *     `hasArtwork = true` for any song whose Navidrome `coverArt` ID is
 *     non-empty. Navidrome populates `coverArt` for every track regardless
 *     of whether real artwork exists — this is the well-known "infinite
 *     artwork-added loop" bug. The matrix's scenario-A cells encode that
 *     bug as `expectedBroken`.
 *   - With `checkArtwork` ON, the adapter probes Navidrome's placeholder
 *     image at connect time and filters it out, so scenario A behaves
 *     correctly. The matrix runs without `--check-artwork` to surface the
 *     default-path bug. A separate dimension could be added later, but
 *     that's outside scope.
 *
 * Cells with `expectedBroken` still run — we invert the pass/fail check so
 * the broken-map fails loudly when a fix lands.
 *
 * @tags docker
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { ensureFixturesExist, cleanupTempConfig, runCli, runCliJson } from '@podkit/e2e-shared';
import { withTarget } from '../targets/index.js';
import { SubsonicTestSource, isDockerAvailable } from '../sources/subsonic.js';
import { createSubsonicConfig } from '../helpers/subsonic-config.js';

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
  /** Album tag we filter by — fixture generator writes one of these per scenario. */
  album: string;
  format: Format;
  /** Substring matched against the device track title (e.g. "WAV Test Track"). */
  titleStartsWith: string;
  /** What the device track's `hasArtwork` should be after the initial sync. */
  expectedDeviceHasArtwork: boolean;
  expectedBroken?: string;
}

const FORMAT_TITLE_PREFIX: Record<Format, string> = {
  wav: 'WAV',
  aiff: 'AIFF',
  flac: 'FLAC',
  alac: 'ALAC',
  mp3: 'MP3',
  aac: 'AAC',
  ogg: 'OGG',
  opus: 'Opus',
};

// Album category each format falls into — must match `audio-multi-format.ts`.
const FORMAT_ALBUM_CATEGORY: Record<Format, string> = {
  wav: 'Lossless Collection',
  aiff: 'Lossless Collection',
  flac: 'Lossless Collection',
  alac: 'Lossless Collection',
  mp3: 'Compatible Lossy',
  aac: 'Compatible Lossy',
  ogg: 'Incompatible Lossy',
  opus: 'Incompatible Lossy',
};

const SCENARIO_SUFFIX: Record<Scenario, string> = {
  'A-none': '',
  'B-embedded': ' (Embedded)',
  'C-sidecar': ' (Sidecar)',
  'D-both': ' (Both)',
};

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

const FORMATS: Format[] = ['wav', 'aiff', 'flac', 'alac', 'mp3', 'aac', 'ogg', 'opus'];
const SCENARIOS: Scenario[] = ['A-none', 'B-embedded', 'C-sidecar', 'D-both'];

/**
 * Observed reality from the matrix's first run. Every cell is broken today
 * for the Subsonic adapter — keep this map honest as fixes land.
 *
 * Common across nearly every cell: the second sync emits
 * `artwork-added` upgrades because the Subsonic adapter (without
 * `--check-artwork`) reports `source.hasArtwork=true` for any track whose
 * Navidrome `coverArt` ID is non-empty (which it always is). When the device
 * side has no artwork — either because the source file truly has none
 * (scenarios A, B-wav/aiff/ogg/opus, C/D where transcoding strips it) or
 * because the sync pipeline doesn't pass the sidecar through — the differ
 * sees source=true / device=false / no syncTag hash and flags artwork-added
 * indefinitely. That's the infinite artwork-added loop.
 *
 * AIFF tracks are completely missing from the device after sync — separate
 * issue (Navidrome may not index AIFF; podkit may filter the format out
 * client-side; or the gpod-tool readback fails). Distinct enough that it
 * gets its own broken-reason.
 *
 * The "ideal expected" device-hasArtwork column below describes what we
 * would *want* in a fixed world; the matrix records the *current* observed
 * value so the test runs cleanly. When podkit fixes the underlying behaviour
 * a cell's observed value moves toward the ideal — at which point the
 * matrix maintainer updates `expectedDeviceHasArtwork` and removes the
 * cell's `expectedBroken` entry.
 */
interface CellPrediction {
  expectedDeviceHasArtwork: boolean;
  expectedBroken?: string;
}

function predict(scenario: Scenario, format: Format): CellPrediction {
  const codecEmbeds = EMBEDS_ATTACHED_PIC[format];
  const isAiff = format === 'aiff';

  if (isAiff) {
    return {
      expectedDeviceHasArtwork: false,
      expectedBroken: 'AIFF tracks are not present on the device after sync (no readback at all)',
    };
  }

  if (scenario === 'A-none') {
    return {
      expectedDeviceHasArtwork: false,
      expectedBroken:
        'subsonic optimistic-true bug: source.hasArtwork=true (Navidrome always populates coverArt) but device track is artworkless → infinite artwork-added loop',
    };
  }

  if (scenario === 'B-embedded') {
    if (codecEmbeds) {
      return {
        expectedDeviceHasArtwork: true,
        expectedBroken:
          'device.hasArtwork matches, but second sync still flags artwork-added (no artworkHash recorded; differ retriggers on every run)',
      };
    }
    // wav/ogg/opus: fixture file has no embedded art at all. WAV currently
    // shows observed=true on the device (placeholder leaked through during
    // transcode-and-re-embed); ogg/opus show observed=false but still churn.
    if (format === 'wav') {
      return {
        expectedDeviceHasArtwork: true,
        expectedBroken:
          'WAV with no embedded art still ends up with device.hasArtwork=true (likely transcoded AAC embeds Navidrome placeholder) + artwork-added churn',
      };
    }
    return {
      expectedDeviceHasArtwork: false,
      expectedBroken: `${format} has no embedded artwork support; optimistic-true bug still triggers churn`,
    };
  }

  if (scenario === 'C-sidecar') {
    if (codecEmbeds) {
      // Navidrome serves cover.jpg via getCoverArt, but the device track
      // ends up with no embedded artwork. The sidecar→device pipeline is
      // broken in addition to the loop bug.
      return {
        expectedDeviceHasArtwork: true,
        expectedBroken:
          'sidecar cover.jpg is served by Navidrome but the transcoded device track has no embedded artwork; differ keeps flagging artwork-added',
      };
    }
    if (format === 'wav') {
      return {
        expectedDeviceHasArtwork: false,
        expectedBroken:
          'WAV transcoded device track has no artwork (sidecar not embedded by transcode pipeline) + artwork-added churn',
      };
    }
    return {
      expectedDeviceHasArtwork: false,
      expectedBroken: `${format} sidecar not embedded during transcode + optimistic-true churn`,
    };
  }

  // 'D-both'
  if (codecEmbeds) {
    return {
      expectedDeviceHasArtwork: true,
      expectedBroken:
        'embedded source art carries through but artwork-added still fires on the second sync (no syncTag hash recorded for the subsonic path)',
    };
  }
  if (format === 'wav') {
    return {
      expectedDeviceHasArtwork: true,
      expectedBroken: 'WAV/both: device shows hasArtwork=true via transcode but still churns',
    };
  }
  return {
    expectedDeviceHasArtwork: false,
    expectedBroken: `${format} cannot embed; sidecar visible to Navidrome but not threaded into transcode; loop bug applies`,
  };
}

function buildCells(): MatrixCell[] {
  const cells: MatrixCell[] = [];

  for (const scenario of SCENARIOS) {
    for (const format of FORMATS) {
      const album = `${FORMAT_ALBUM_CATEGORY[format]}${SCENARIO_SUFFIX[scenario]}`;
      const prediction = predict(scenario, format);
      cells.push({
        scenario,
        album,
        format,
        titleStartsWith: FORMAT_TITLE_PREFIX[format],
        expectedDeviceHasArtwork: prediction.expectedDeviceHasArtwork,
        expectedBroken: prediction.expectedBroken,
      });
    }
  }

  return cells;
}

const CELLS = buildCells();

// ---------------------------------------------------------------------------
// Shared Navidrome harness
// ---------------------------------------------------------------------------

let source: SubsonicTestSource | null = null;

afterAll(async () => {
  if (source) {
    console.log('Stopping Navidrome container...');
    await source.teardown();
    source = null;
  }
});

// ---------------------------------------------------------------------------
// Aggregated sync result, keyed by (album, titleStartsWith)
// ---------------------------------------------------------------------------

interface CellResult {
  /** Device-side hasArtwork after initial sync. null if no matching track. */
  deviceHasArtwork: boolean | null;
  /** Whether the second sync produced an artwork-added or artwork-updated for this cell. */
  secondSyncArtworkChurn: boolean;
  /** Whether the second sync tried to add this cell as a new track. */
  secondSyncAdd: boolean;
}

interface MatrixResults {
  byKey: Map<string, CellResult>;
  /** Set when the sync itself failed (so all cells fail uniformly). */
  globalFailure?: string;
  initialJson?: SyncOutput;
  secondJson?: SyncOutput;
}

let MATRIX: MatrixResults | null = null;

function cellKey(album: string, titleStartsWith: string): string {
  return `${album}::${titleStartsWith}`;
}

/**
 * Run the full sync once, populate `MATRIX`, then run again to populate the
 * idempotency fields. Called from a single `it()` so we pay the cost once.
 */
async function runMatrixOnce(): Promise<MatrixResults> {
  if (!source) throw new Error('Subsonic source not initialised');

  const results: MatrixResults = { byKey: new Map() };

  await withTarget(async (target) => {
    const configPath = await createSubsonicConfig(source!.serverUrl, source!.username);
    try {
      const { json: firstJson, result: firstResult } = await runCliJson<SyncOutput>(
        ['--config', configPath, 'sync', '--device', target.path, '--json'],
        {
          env: source!.getEnv(),
          timeout: 600000,
        }
      );
      results.initialJson = firstJson ?? undefined;

      if (firstResult.exitCode !== 0 || !firstJson?.success) {
        results.globalFailure = `initial sync failed: exit=${firstResult.exitCode}`;
        return;
      }

      const deviceTracks = await target.getTracks();

      // Seed cell results from device tracks (album + title).
      for (const cell of CELLS) {
        const t = deviceTracks.find(
          (dt) =>
            (dt.album ?? '') === cell.album &&
            (dt.title ?? '').toUpperCase().startsWith(cell.titleStartsWith.toUpperCase())
        );
        results.byKey.set(cellKey(cell.album, cell.titleStartsWith), {
          deviceHasArtwork: t ? t.hasArtwork : null,
          secondSyncArtworkChurn: false,
          secondSyncAdd: false,
        });
      }

      // Second probe via --dry-run so we get the full plan/operations data.
      // A real second sync hides the operations list once everything is in sync.
      const second = await runCli(
        ['--config', configPath, 'sync', '--device', target.path, '--dry-run', '--json'],
        {
          env: source!.getEnv(),
          timeout: 300000,
        }
      );
      const secondJson = JSON.parse(second.stdout) as SyncOutput;
      results.secondJson = secondJson;

      const ops = secondJson.operations ?? [];
      for (const cell of CELLS) {
        const key = cellKey(cell.album, cell.titleStartsWith);
        const entry = results.byKey.get(key)!;
        // operations[].track is "Artist - Title"; match by title prefix only.
        // We cannot disambiguate by album in this string, so we also confirm
        // the track exists on the device under the cell's album before we
        // attribute churn to it.
        for (const op of ops) {
          const trackStr = op.track ?? '';
          if (!trackStr.includes(cell.titleStartsWith)) continue;

          // Conservative: every add-* operation that mentions the title is
          // attributed to every album that shares it. Scenario suffixes make
          // titles non-unique per (album, title) so we also need to verify.
          // The cleanest disambiguation is the album field on the matching
          // device track, but operations[] doesn't expose album. We accept
          // the over-attribution and treat it as "any of the title-matching
          // cells churn". For our matrix, the second sync should not produce
          // ANY add-* operations for unchanged sources, so over-attribution
          // is acceptable as a regression flag.
          if (
            op.type === 'add-transcode' ||
            op.type === 'add-direct-copy' ||
            op.type === 'add-optimized-copy'
          ) {
            entry.secondSyncAdd = true;
          }
          if (op.type === 'upgrade-artwork') {
            entry.secondSyncArtworkChurn = true;
          }
          if (
            (op.type === 'upgrade-transcode' ||
              op.type === 'upgrade-direct-copy' ||
              op.type === 'upgrade-optimized-copy') &&
            (op.reason === 'artwork-added' || op.reason === 'artwork-updated')
          ) {
            entry.secondSyncArtworkChurn = true;
          }
        }
      }
    } finally {
      await cleanupTempConfig(configPath);
    }
  });

  return results;
}

beforeAll(async () => {
  const dockerAvailable = await isDockerAvailable();
  if (!dockerAvailable) {
    throw new Error('Docker is not available — required for the art-matrix docker suite.');
  }

  source = new SubsonicTestSource();
  console.log('Starting Navidrome container for art matrix...');
  await source.setup();
  console.log(`Navidrome ready at ${source.serverUrl}`);

  MATRIX = await runMatrixOnce();
  console.log(
    `art-matrix subsonic: initial completed=${MATRIX.initialJson?.result?.completed ?? '?'}, ` +
      `second updates=${MATRIX.secondJson?.plan?.tracksToUpdate ?? '?'}, ` +
      `second breakdown=${JSON.stringify(MATRIX.secondJson?.plan?.updateBreakdown)}`
  );

  // Per-cell observed values printed once. Useful when a cell flips from
  // expectedBroken to passing so the matrix maintainer sees the new state.
  console.log('\nart-matrix subsonic: per-cell results');
  for (const cell of CELLS) {
    const r = MATRIX.byKey.get(cellKey(cell.album, cell.titleStartsWith));
    console.log(
      `  ${cell.scenario}/${cell.format}  album="${cell.album}"  ` +
        `expected=${cell.expectedDeviceHasArtwork}  ` +
        `observed=${r?.deviceHasArtwork}  ` +
        `secondAdd=${r?.secondSyncAdd}  secondArtChurn=${r?.secondSyncArtworkChurn}`
    );
  }
}, 1500000);

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('artwork matrix (subsonic adapter)', () => {
  for (const cell of CELLS) {
    const label = `${cell.scenario} / ${cell.format}`;
    const desc = cell.expectedBroken ? `${label} [expectedBroken: ${cell.expectedBroken}]` : label;

    it(desc, () => {
      const matrix = MATRIX;
      expect(matrix).not.toBeNull();
      if (matrix!.globalFailure) {
        throw new Error(`Matrix sync failed globally: ${matrix!.globalFailure}`);
      }

      const result = matrix!.byKey.get(cellKey(cell.album, cell.titleStartsWith));
      expect(result).toBeDefined();

      // Missing track on device is treated as an automatic broken cell.
      const trackPresent = result!.deviceHasArtwork !== null;
      const observed = result!.deviceHasArtwork === true;
      const matchesExpectation = trackPresent && observed === cell.expectedDeviceHasArtwork;
      const idempotent = !result!.secondSyncArtworkChurn && !result!.secondSyncAdd;

      const ok = matchesExpectation && idempotent;

      if (cell.expectedBroken) {
        expect(ok).toBe(false);
      } else {
        if (!ok) {
          throw new Error(
            `Cell ${label} (album=${cell.album}) failed:\n` +
              `  expectedDeviceHasArtwork=${cell.expectedDeviceHasArtwork}, observed=${observed}, deviceHasArtwork=${result!.deviceHasArtwork}\n` +
              `  trackPresent=${trackPresent}\n` +
              `  secondSyncAdd=${result!.secondSyncAdd}, secondSyncArtworkChurn=${result!.secondSyncArtworkChurn}`
          );
        }
        expect(ok).toBe(true);
      }
    });
  }
});
