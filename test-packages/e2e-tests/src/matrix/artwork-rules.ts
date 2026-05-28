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

import { mkdtemp, cp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cleanupTempConfig, createTempConfig, runCliJson } from '@podkit/e2e-shared';
import {
  SCENARIO_ARTISTS,
  getMultiFormatEmbeddedFixturesDir,
  getMultiFormatEmbeddedAltFixturesDir,
} from '@podkit/test-fixtures';
import type { SyncOutput } from 'podkit/types';

import { type IpodTarget, type SyncTarget } from '../targets';
import { DEVICE_SPEC_BY_ID, deviceAddressing, type DeviceId } from './devices.js';
import {
  FORMATS,
  FORMAT_TITLE,
  SCENARIO_ARTIST,
  SCENARIOS,
  scenarioFormatCells,
  type Format,
  type ScenarioFormatCell,
} from './axes.js';
import {
  FIXTURE_EMBEDS_ART,
  artworkReaches,
  deviceAction,
  sourceEmbedsArt,
  PIPELINES,
  type Pipeline,
} from './reference-model.js';
import {
  findDeviceTrack,
  formatOpsString,
  isArtworkIdempotent,
  opsForTrack,
  skipBug,
  type CellExpectation,
  type OpSummary,
  type SkipDecision,
} from './harness.js';

/**
 * Devices the host artwork matrix sweeps. iPod (database artwork) and
 * `ms-generic` (embedded artwork, no native vorbis → OGG transcodes away) sync
 * cleanly. `ms-echo-mini` is included so its cells are *present and visible*,
 * but they are all `skipBug`-fenced: its vorbis-native + embedded-art combo
 * makes OGG route through `optimized-copy`, which fails and aborts the whole
 * sync (doc-039 §"Mass-storage sync gaps" #1). Keeping echo-mini in the axis —
 * rather than silently dropping it — means the deferred coverage shows up as
 * `[BUG]` skips you can count, not as an invisible gap.
 */
export const ARTWORK_DEVICE_IDS: readonly DeviceId[] = ['ipod-MA147', 'ms-echo-mini', 'ms-generic'];

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

/** A static artwork cell extended with the pinned codec pipeline. */
export interface PipelineCell extends ScenarioFormatCell {
  pipeline: Pipeline;
}

/** The full scenario × format × pipeline product. */
export function pipelineCells(): PipelineCell[] {
  const cells: PipelineCell[] = [];
  for (const scenario of SCENARIOS) {
    for (const format of FORMATS) {
      for (const pipeline of PIPELINES) {
        cells.push({ scenario, format, pipeline });
      }
    }
  }
  return cells;
}

export function pipelineCellKey(cell: PipelineCell): string {
  return `${cell.scenario}/${cell.format}/${cell.pipeline}`;
}
export function pipelineCellLabel(cell: PipelineCell): string {
  return `${cell.scenario} / ${cell.format} / ${cell.pipeline}`;
}

/** A pipeline cell extended with the device axis (doc-039 P4). */
export interface PipelineDeviceCell extends PipelineCell {
  device: DeviceId;
}

/** The full device × scenario × format × pipeline product. */
export function pipelineDeviceCells(): PipelineDeviceCell[] {
  const cells: PipelineDeviceCell[] = [];
  for (const device of ARTWORK_DEVICE_IDS) {
    for (const { scenario, format, pipeline } of pipelineCells()) {
      cells.push({ device, scenario, format, pipeline });
    }
  }
  return cells;
}

export function pipelineDeviceCellKey(cell: PipelineDeviceCell): string {
  return `${cell.device}/${cell.scenario}/${cell.format}/${cell.pipeline}`;
}
export function pipelineDeviceCellLabel(cell: PipelineDeviceCell): string {
  return `${cell.device} / ${cell.scenario} / ${cell.format} / ${cell.pipeline}`;
}

/**
 * Classify the mass-storage cells the artwork matrix can't currently assert.
 * Every return here is a `bug` skip — **deferred work**, not a structural
 * prune — so a green run with these present still shows exactly what needs
 * fixing (grep `[BUG]` / `skipBug(`). All are recorded in doc-039
 * §"Mass-storage sync gaps".
 *
 * iPod and `ms-generic` sweep the full product (both pipelines, all formats
 * except the two below). Note `prefer-copy` on mass-storage is **not** skipped:
 * its real bug (a `preset-upgrade` re-sync loop) is a quality/preset-convergence
 * defect that this *artwork* matrix does not assert, so the artwork cells pass.
 */
export function skipArtworkCell(cell: PipelineDeviceCell): SkipDecision | null {
  if (DEVICE_SPEC_BY_ID[cell.device].kind !== 'mass-storage') return null;

  // echo-mini: vorbis-native + embedded-art → OGG routes through optimized-copy,
  // which fails and aborts the whole sync, so no cell is observable.
  if (cell.device === 'ms-echo-mini') {
    return cell.format === 'ogg'
      ? skipBug(
          'OGG optimized-copy fails on this vorbis-native, embedded-art device — FFmpeg cannot re-mux into the OGG container',
          'doc-039 §Mass-storage sync gaps #1'
        )
      : skipBug(
          'blocked by the OGG optimized-copy failure, which aborts the whole sync — no per-track outcome is observable until #1 is fixed',
          'doc-039 §Mass-storage sync gaps #1'
        );
  }

  // generic (and any embedded-art device that transcodes these): an OGG/Opus
  // source transcoded to AAC is re-added on every subsequent sync.
  if (cell.format === 'ogg' || cell.format === 'opus') {
    return skipBug(
      `${cell.format} transcoded to AAC is re-added every sync on mass-storage (incompatible-lossy → AAC source/device matching gap)`,
      'doc-039 §Mass-storage sync gaps #2'
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

/**
 * Directory adapter, swept across the device axis. The pinned codec pipeline
 * controls copy-vs-transcode (P2); the device's capabilities decide both that
 * action and whether art reaches the device. Only embedded art is visible (no
 * sidecar reads), and both the copy and transcode paths preserve/re-embed it,
 * so `deviceHasArtwork` mirrors the source's embed state on any device whose
 * `artworkSources` is non-empty. Predictions key off `target.capabilities`,
 * never the device name. The non-converging mass-storage cells are pruned by
 * `skipArtworkCell`, so every asserted cell is idempotent.
 */
export function predictDirectory(
  cell: PipelineDeviceCell,
  _checkArtwork: boolean
): StaticArtExpected {
  const { scenario, format, pipeline, device } = cell;
  const spec = DEVICE_SPEC_BY_ID[device];
  const action = deviceAction(format, spec.capabilities, pipeline, spec.kind);
  const deviceHasArtwork = artworkReaches(sourceEmbedsArt(scenario, format), spec.capabilities);
  const store = spec.kind === 'ipod' ? 'database-artwork' : 'embedded-artwork';

  let reason: string;
  if (scenario === 'A-none') {
    reason = `no art anywhere → device gets none (${action} path)`;
  } else if (scenario === 'C-sidecar') {
    reason = `sidecar invisible to directory adapter → collapses onto A (${action} path)`;
  } else if (!FIXTURE_EMBEDS_ART[format]) {
    reason = `${format} carries no embedded art in fixture → collapses onto A (${action} path)`;
  } else {
    reason = `embedded art preserved through the ${action} path on a ${store} device`;
  }

  return { trackPresent: true, deviceHasArtwork, idempotent: true, reason };
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
  target: SyncTarget;
  configPath: string;
  checkArtwork: boolean;
  env?: Record<string, string>;
  initTimeoutMs?: number;
  dryTimeoutMs?: number;
}): Promise<Map<string, StaticArtObserved>> {
  const { target, configPath, checkArtwork, env } = opts;
  const { deviceArg } = deviceAddressing(target);
  const baseArgs = ['--config', configPath, 'sync', '--device', deviceArg, '--json'];
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
 * Write a directory-source config pinned to a codec pipeline, returning the
 * config path (in its own temp dir, so `cleanupTempConfig` removes it).
 *
 * - `prefer-copy`: `quality=max` + lossless `['source']` → device-native
 *   formats copy.
 * - `transcode-aac`: `quality=high` + lossy `['aac']` → lossless +
 *   incompatible formats transcode to AAC.
 */
export async function createPipelineConfig(
  musicRoot: string,
  pipeline: Pipeline,
  device?: { fragment: string; name: string }
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `podkit-art-pipeline-${pipeline}-`));
  const configPath = join(dir, 'config.toml');
  const quality = pipeline === 'prefer-copy' ? 'max' : 'high';
  const codecBlock =
    pipeline === 'prefer-copy'
      ? '[codec]\nlossy = ["aac"]\nlossless = ["source"]\n'
      : '[codec]\nlossy = ["aac"]\n';
  const deviceBlock = device ? `${device.fragment}` : '';
  const defaultsDevice = device ? `device = "${device.name}"\n` : '';
  const content = `version = 2

quality = "${quality}"

${codecBlock}${deviceBlock}
[music.main]
path = "${musicRoot}"

[defaults]
music = "main"
${defaultsDevice}`;
  await writeFile(configPath, content);
  return configPath;
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
