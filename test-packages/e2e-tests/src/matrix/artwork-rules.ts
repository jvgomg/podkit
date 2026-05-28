/**
 * Artwork concern: predictions + observation sequences for the three artwork
 * matrices (directory static, subsonic static, directory change-detection).
 *
 * Predictions compose the capability functions in `reference-model.ts`; the
 * observation helpers own the sync sequences that were duplicated across the
 * three test files. The thin `art-matrix*.test.ts` files wire these into the
 * generic harness.
 *
 * The two static predictors (`predictDirectory`, `predictSubsonic`) stay
 * distinct because the adapters genuinely differ on the *source* side: the
 * directory adapter reports real embedded-art presence, while the Subsonic
 * adapter optimistically trusts Navidrome's `coverArt` ID. Unifying them
 * behind a single adapter-parameterised predictor is deferred to the
 * device/adapter-axis phase (doc-039 P4).
 *
 * @module
 */

import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cleanupTempConfig, createTempConfig, runCliJson } from '@podkit/e2e-shared';
import {
  SCENARIO_ARTISTS,
  getMultiFormatEmbeddedFixturesDir,
  getMultiFormatEmbeddedAltFixturesDir,
} from '@podkit/test-fixtures';
import type { SyncOutput } from 'podkit/types';

import type { IpodTarget } from '../targets';
import {
  FORMATS,
  FORMAT_TITLE,
  SCENARIO_ARTIST,
  scenarioFormatCells,
  type Format,
  type ScenarioFormatCell,
} from './axes.js';
import { FIXTURE_EMBEDS_ART, sourceEmbedsArt } from './reference-model.js';
import {
  findDeviceTrack,
  formatOpsString,
  isArtworkIdempotent,
  opsForTrack,
  type CellExpectation,
  type OpSummary,
} from './harness.js';

// ---------------------------------------------------------------------------
// Cell expectation / observation shapes
// ---------------------------------------------------------------------------

/** Expected outcome for a static (single fresh sync) artwork cell. */
export interface StaticArtExpected extends CellExpectation {
  trackPresent: boolean;
  /** `device.hasArtwork` after the initial sync; `null` when !trackPresent. */
  deviceHasArtwork: boolean | null;
  /** Second sync produced no artwork-churn op for this track. */
  idempotent: boolean;
}

export interface StaticArtObserved extends Record<string, unknown> {
  trackPresent: boolean;
  deviceHasArtwork: boolean | null;
  idempotent: boolean;
  secondSyncOps: OpSummary[];
}

/** Expected outcome for an artwork-change cell. */
export interface ChangeExpected extends CellExpectation {
  trackPresent: boolean;
  /** Sorted `type:reason` join of the second-sync ops. `''` means no ops. */
  ops: string;
}

export interface ChangeObserved extends Record<string, unknown> {
  trackPresent: boolean;
  ops: string;
  secondSyncOps: OpSummary[];
}

// ---------------------------------------------------------------------------
// Cell key / label
// ---------------------------------------------------------------------------

export function staticCellKey(cell: ScenarioFormatCell): string {
  return `${cell.scenario}/${cell.format}`;
}
export function staticCellLabel(cell: ScenarioFormatCell): string {
  return `${cell.scenario} / ${cell.format}`;
}

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

/**
 * Directory adapter: only embedded art is visible (no sidecar reads). Copy
 * preserves embedded art and transcode re-embeds it, so the device mirrors
 * the source file's embed state, which keeps every cell symmetric and
 * idempotent.
 */
export function predictDirectory(
  cell: ScenarioFormatCell,
  _checkArtwork: boolean
): StaticArtExpected {
  const { scenario, format } = cell;
  const deviceHasArtwork = sourceEmbedsArt(scenario, format);
  // Source and device agree (directory adapter reports the file's real state),
  // so there is never an add/removed asymmetry → always idempotent.
  const idempotent = true;

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

  return { trackPresent: true, deviceHasArtwork, idempotent, reason };
}

/**
 * Subsonic adapter: Navidrome reports a `coverArt` ID for every track, so the
 * source side optimistically claims art unless `--check-artwork` fetches and
 * filters Navidrome's placeholder. The device side mirrors the downloaded
 * file's embed state (sidecar bytes never reach the stream). Asymmetric cells
 * (source claims art, device file has none) churn forever without a hash and
 * converge once `--check-artwork` writes the syncTag hash.
 */
export function predictSubsonic(
  cell: ScenarioFormatCell,
  checkArtwork: boolean
): StaticArtExpected {
  const { scenario, format } = cell;

  const sourceHasArtwork = checkArtwork ? scenario !== 'A-none' : true;
  const sourceHasArtworkHash = checkArtwork ? sourceHasArtwork : false;
  const deviceHasArtwork = sourceEmbedsArt(scenario, format);

  let idempotent: boolean;
  let asymmetryReason: string | null = null;
  if (sourceHasArtwork === deviceHasArtwork) {
    idempotent = true;
  } else if (sourceHasArtwork && !deviceHasArtwork) {
    idempotent = sourceHasArtworkHash;
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

  if (asymmetryReason && !reason.includes('hash') && !reason.includes('symmetric')) {
    reason = `${reason} — ${asymmetryReason}`;
  }

  return { trackPresent: true, deviceHasArtwork, idempotent, reason };
}

/**
 * Change detection: sync cover A, swap the source for cover B (identical tags,
 * different cover bytes), dry-run a second sync. With `--check-artwork` the
 * hash mismatch fires `artwork-updated`; without it the swap is silently
 * missed (the directory adapter never computes `source.artworkHash`).
 */
export function predictChange(format: Format, checkArtwork: boolean): ChangeExpected {
  if (!FIXTURE_EMBEDS_ART[format]) {
    return {
      trackPresent: true,
      ops: '',
      reason: `${format} cannot carry embedded art in the fixture — source bytes never change → no diff to detect`,
    };
  }
  if (checkArtwork) {
    return {
      trackPresent: true,
      ops: 'upgrade-artwork:artwork-updated',
      reason: 'source.artworkHash differs from syncTag.artworkHash → artwork-updated fires',
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
// Observation sequences
// ---------------------------------------------------------------------------

interface CliRunOpts {
  env?: Record<string, string>;
  timeout: number;
}

function runOpts(timeout: number, env?: Record<string, string>): CliRunOpts {
  return env ? { env, timeout } : { timeout };
}

/**
 * Static artwork pass: one fresh sync + getTracks + a second dry-run, with no
 * source mutation. Shared by the directory and Subsonic matrices — they differ
 * only in the config (and env) they hand in.
 */
export async function observeStaticArtwork(opts: {
  target: IpodTarget;
  configPath: string;
  checkArtwork: boolean;
  env?: Record<string, string>;
  initTimeoutMs?: number;
  dryTimeoutMs?: number;
}): Promise<Map<string, StaticArtObserved>> {
  const { target, configPath, checkArtwork, env } = opts;
  const baseArgs = ['--config', configPath, 'sync', '--device', target.path, '--json'];
  const initArgs = checkArtwork ? [...baseArgs, '--check-artwork'] : baseArgs;

  const { result: initResult, json: initJson } = await runCliJson<SyncOutput>(
    initArgs,
    runOpts(opts.initTimeoutMs ?? 240000, env)
  );
  if (initResult.exitCode !== 0 || !initJson?.success) {
    throw new Error(
      `initial sync failed (checkArtwork=${checkArtwork}): exit=${initResult.exitCode}\n` +
        `  args: ${JSON.stringify(initArgs)}\n` +
        `  json: ${JSON.stringify(initJson, null, 2)}\n` +
        `  stderr: ${initResult.stderr}`
    );
  }

  const deviceTracks = await target.getTracks();

  const { result: dryResult, json: dryJson } = await runCliJson<SyncOutput>(
    [...initArgs, '--dry-run'],
    runOpts(opts.dryTimeoutMs ?? 120000, env)
  );
  if (dryResult.exitCode !== 0 || !dryJson) {
    throw new Error(
      `dry-run sync failed (checkArtwork=${checkArtwork}): exit=${dryResult.exitCode}`
    );
  }

  const byKey = new Map<string, StaticArtObserved>();
  for (const cell of scenarioFormatCells()) {
    const artist = SCENARIO_ARTIST[cell.scenario];
    const title = FORMAT_TITLE[cell.format];
    const device = findDeviceTrack(deviceTracks, artist, title);
    const ops = opsForTrack(dryJson, artist, title);
    byKey.set(staticCellKey(cell), {
      trackPresent: device !== undefined,
      deviceHasArtwork: device ? device.hasArtwork : null,
      idempotent: isArtworkIdempotent(ops),
      secondSyncOps: ops,
    });
  }
  return byKey;
}

/**
 * Change-detection pass: copy the embedded fixture into a mutable root, sync,
 * record presence, swap in the alt-cover variant, dry-run, record the
 * second-sync ops per format. Directory adapter only.
 */
export async function observeChangePass(opts: {
  target: IpodTarget;
  checkArtwork: boolean;
}): Promise<Map<string, ChangeObserved>> {
  const { target, checkArtwork } = opts;
  const artist = SCENARIO_ARTISTS.embedded;
  const sourceRoot = await mkdtemp(join(tmpdir(), 'art-matrix-change-'));
  await cp(getMultiFormatEmbeddedFixturesDir(), join(sourceRoot, 'album'), { recursive: true });
  const configPath = await createTempConfig(sourceRoot);

  try {
    const baseArgs = ['--config', configPath, 'sync', '--device', target.path, '--json'];
    const initArgs = checkArtwork ? [...baseArgs, '--check-artwork'] : baseArgs;

    const { result: initResult, json: initJson } = await runCliJson<SyncOutput>(
      initArgs,
      runOpts(240000)
    );
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
      presenceByFormat.set(
        format,
        deviceTracks.some((t) => t.artist === artist && t.title === FORMAT_TITLE[format])
      );
    }

    // Mutate: replace the album with the alt-cover variant.
    await rm(join(sourceRoot, 'album'), { recursive: true, force: true });
    await cp(getMultiFormatEmbeddedAltFixturesDir(), join(sourceRoot, 'album'), {
      recursive: true,
    });

    const { result: dryResult, json: dryJson } = await runCliJson<SyncOutput>(
      [...initArgs, '--dry-run'],
      runOpts(120000)
    );
    if (dryResult.exitCode !== 0 || !dryJson) {
      throw new Error(
        `dry-run sync failed (checkArtwork=${checkArtwork}): exit=${dryResult.exitCode}`
      );
    }

    const byKey = new Map<string, ChangeObserved>();
    for (const format of FORMATS) {
      const ops = opsForTrack(dryJson, artist, FORMAT_TITLE[format]);
      byKey.set(format, {
        trackPresent: presenceByFormat.get(format) ?? false,
        ops: formatOpsString(ops),
        secondSyncOps: ops,
      });
    }
    return byKey;
  } finally {
    await cleanupTempConfig(configPath);
    try {
      await rm(sourceRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
