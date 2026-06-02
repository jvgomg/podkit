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
  compilationArtist,
  compilationCoverColor,
  compilationTrackEmbeds,
  getMultiFormatEmbeddedFixturesDir,
  getMultiFormatEmbeddedAltFixturesDir,
  getMultiFormatEmbeddedStrippedFixturesDir,
  HIRES_ARTIST,
  HIRES_COVER_SIZE,
} from '@podkit/test-fixtures';
import { isOggExtension } from '@podkit/core';
import type { SyncOutput } from 'podkit/types';

import { type IpodTarget, type SyncTarget } from '../targets';
import { DEVICE_SPEC_BY_ID, deviceAddressing, type DeviceId } from './devices.js';
import {
  FORMATS,
  FORMAT_TITLE,
  SCENARIO_ARTIST,
  SCENARIOS,
  scenarioFormatCells,
  trackId,
  type Format,
  type ScenarioFormatCell,
} from './axes.js';
import {
  FIXTURE_EMBEDS_ART,
  SOURCE_EXTENSION,
  artworkReaches,
  deviceAction,
  expectedFileArtworkSize,
  fileArtworkSurvives,
  sourceEmbedsArt,
  PIPELINES,
  TRANSFER_MODES,
  type Pipeline,
  type TransferMode,
} from './reference-model.js';
import {
  probeFileArtwork,
  probeIpodDbArtwork,
  probeIpodDbArtworkColor,
  type RgbColor,
} from './device-artwork.js';
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
 * Devices the host artwork matrix sweeps. iPod (database artwork) and two
 * embedded-art mass-storage presets. Every cell asserts real behaviour — no
 * skipBug fences left in this matrix.
 */
export const ARTWORK_DEVICE_IDS: readonly DeviceId[] = ['ipod-MA147', 'ms-echo-mini', 'ms-generic'];

// ---------------------------------------------------------------------------
// Cell expectation / observation shapes
// ---------------------------------------------------------------------------

/**
 * Provenance attribution mirror of `DecisionSource` from
 * `packages/podkit-cli/src/commands/sync-decisions.ts`. See codec-rules.ts
 * for the rationale (test package doesn't import from the CLI's source tree).
 */
type DecisionSource =
  | 'default'
  | 'global'
  | 'global-quality'
  | 'device'
  | 'device-quality'
  | 'unsupported'
  | 'unknown'
  | 'cli';

/** Expected outcome for a static (single fresh sync) artwork cell. */
export interface StaticArtExpected extends CellExpectation {
  trackPresent: boolean;
  /** `device.hasArtwork` after the initial sync; `null` when !trackPresent. */
  deviceHasArtwork: boolean | null;
  /** Second sync produced no artwork-churn op for this track. */
  idempotent: boolean;
  /**
   * Provenance of `--check-artwork`'s resolved value
   * (`json.decisions.checkArtwork.source`). The matrix runPass passes
   * `--check-artwork` as a CLI flag when enabled and omits it otherwise, so:
   *   - checkArtwork true  → expect `'cli'`
   *   - checkArtwork false → expect `'default'` (config doesn't set it)
   * Catches a CLI-flag plumbing regression that silently used config/default.
   */
  checkArtworkSource: DecisionSource;
  /**
   * Whether the sync emitted the `artwork-detection-disabled` plan warning
   * (TASK-366). Subsonic adapter fires it iff `!checkArtwork`; directory
   * adapter never fires it. A correlation cell with `checkArtworkSource`
   * pins the warning ↔ resolved-value relationship — a regression in either
   * feature alone (warning silently dropped, or warning fires after
   * checkArtwork is on) flips this.
   */
  artworkDetectionDisabledWarning: boolean;
}

export interface StaticArtObserved extends Record<string, unknown> {
  trackPresent: boolean;
  deviceHasArtwork: boolean | null;
  idempotent: boolean;
  checkArtworkSource: DecisionSource | null;
  artworkDetectionDisabledWarning: boolean;
  secondSyncOps: OpSummary[];
}

/** Expected outcome for an artwork-change cell. */
export interface ChangeExpected extends CellExpectation {
  trackPresent: boolean;
  /** Sorted `type:reason` join of the second-sync (post-mutation) dry-run ops. `''` means none. */
  ops: string;
  /**
   * After the detected change is *applied* by a real sync, a further dry-run is
   * free of artwork churn — i.e. the change converges instead of re-firing every
   * sync. Always expected true; a false here is a churn-loop bug.
   */
  convergesAfterApply: boolean;
}

export interface ChangeObserved extends Record<string, unknown> {
  trackPresent: boolean;
  ops: string;
  convergesAfterApply: boolean;
  secondSyncOps: OpSummary[];
  thirdSyncOps: OpSummary[];
}

/**
 * The artwork mutation applied between the two syncs:
 *
 * - `updated`: swap cover A for cover B (same dimensions, different bytes) —
 *   the source still has art, only the pixels change.
 * - `removed`: swap the embedded variant for the stripped variant (identical
 *   tags, no embedded art) — the source loses its cover entirely.
 */
export type ChangeTransition = 'updated' | 'removed';
export const CHANGE_TRANSITIONS: readonly ChangeTransition[] = ['updated', 'removed'];

/** The alt fixture each transition swaps in (the embedded variant is the base). */
const CHANGE_ALT_FIXTURE: Record<ChangeTransition, () => string> = {
  updated: getMultiFormatEmbeddedAltFixturesDir,
  removed: getMultiFormatEmbeddedStrippedFixturesDir,
};

/** A change-detection cell: a format under a given mutation. */
export interface ChangeCell {
  format: Format;
  transition: ChangeTransition;
}

export function changeCells(): ChangeCell[] {
  const cells: ChangeCell[] = [];
  for (const transition of CHANGE_TRANSITIONS) {
    for (const format of FORMATS) {
      cells.push({ format, transition });
    }
  }
  return cells;
}
export function changeCellKey(cell: ChangeCell): string {
  return `${cell.transition}/${cell.format}`;
}
export function changeCellLabel(cell: ChangeCell): string {
  return `${cell.transition} / ${cell.format}`;
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
 * The artwork matrix swept every mass-storage cell once the OGG/Opus → AAC
 * re-add loop was closed (the chained `-map_metadata` mapping in the
 * transcoder lifts Vorbis stream tags into the M4A output's global tags, so
 * incompatible-lossy sources now match their AAC outputs on re-scan).
 *
 * `prefer-copy` on mass-storage stays unskipped: its `preset-upgrade` loop is
 * a quality/preset-convergence defect this *artwork* matrix doesn't assert,
 * so artwork cells pass through it.
 *
 * **TASK-142 / TASK-370 mass-storage non-OGG fence.** The directory adapter
 * now detects peer cover.jpg and the executor adapter-fallback supplies bytes,
 * but `MassStorageTrack.setArtworkFromData` is a no-op for non-OGG outputs
 * (mass-storage-adapter.ts:436). The bytes are dropped; the device file stays
 * art-less. With `--check-artwork` off the directory adapter cannot pre-hash
 * the sidecar either, so `detectUpgrades` fires `artwork-added` on every
 * sync (no `source.artworkHash` to converge against `syncTag.artworkHash`).
 * Result: a permanent churn loop for `C-sidecar` / no-embed-format sources on
 * mass-storage non-OGG. Fenced as `skipBug` against TASK-370 (executor
 * sidecar device-write) — the matrix continues to assert iPod + OGG/Opus
 * carve-out cells where adapter fallback DOES converge.
 */
export function skipArtworkCell(cell: PipelineDeviceCell): SkipDecision | null {
  const spec = DEVICE_SPEC_BY_ID[cell.device];
  if (spec.kind !== 'mass-storage') return null;
  // Carve-out keyed on the OUTPUT extension: the OGG taglib embed path
  // (pipeline.ts transferArtwork → updateTrack({embeddedPictureData})) fires
  // only when `track.filePath` matches `isOggExtension` — i.e. the executor
  // took the COPY action on an OGG/Opus source. Transcoded outputs (.m4a)
  // never reach the taglib branch. Re-using podkit's own predicate keeps the
  // fence aligned if it grows.
  const action = deviceAction(cell.format, spec.capabilities, cell.pipeline, spec.kind);
  // 'x' prefix avoids extname's dotfile edge case (`.ogg` would be read as a
  // filename with no extension, not as `ext === '.ogg'`).
  const oggCopyOutput = action === 'copy' && isOggExtension(`x${SOURCE_EXTENSION[cell.format]}`);
  if (oggCopyOutput) return null;
  // Adapter fallback only matters when the source body lacks embed — that's
  // the C-sidecar scenario and no-embed-format cases. With every fixture
  // format embed-capable today (FIXTURE_EMBEDS_ART all-true), the gap reduces
  // to scenario === 'C-sidecar'.
  if (cell.scenario !== 'C-sidecar') return null;
  return skipBug(
    'mass-storage non-OGG-copy output: setArtworkFromData no-op drops adapter-fallback bytes → device file art-less → artwork-added churn',
    'TASK-370'
  );
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
  checkArtwork: boolean
): StaticArtExpected {
  const { scenario, format, pipeline, device } = cell;
  const spec = DEVICE_SPEC_BY_ID[device];
  const action = deviceAction(format, spec.capabilities, pipeline, spec.kind);
  const store = spec.kind === 'ipod' ? 'database-artwork' : 'embedded-artwork';

  // After TASK-142 the directory adapter detects peer cover.jpg/folder.jpg
  // and feeds those bytes through `adapter.getArtwork` to the executor. How
  // far the bytes reach the device depends on which write path the executor
  // picks for the output file:
  //
  // - **iPod** (database-artwork): `track.setArtworkFromData` writes the
  //   bytes into the iTunesDB on every cell where `cached.data` exists.
  //   Adapter fallback closes the C-sidecar / no-embed-format gap → every
  //   non-A album lands art on the device.
  // - **Mass-storage**, OGG/Opus output (`action === 'copy'` on a device
  //   that natively supports vorbis/opus): pipeline.ts:1491 takes a special
  //   `updateTrack({ embeddedPictureData })` branch that goes through the
  //   taglib-sharp METADATA_BLOCK_PICTURE writer, which DOES land bytes.
  //   So OGG/Opus copies pick up adapter-fallback bytes.
  // - **Mass-storage**, every other output: `MassStorageTrack.setArtworkFromData`
  //   is a no-op (mass-storage-adapter.ts:436). The on-device file's
  //   embedded picture comes only from FFmpeg passing the source picture
  //   through transcode/copy, so the device has art only when the source
  //   FILE BODY carried it (`sourceEmbedsArt`). Adapter-fallback bytes are
  //   dropped. TASK-370 (sidecar device-write) closes this gap.
  const sourceFileEmbeds = sourceEmbedsArt(scenario, format);
  const albumHasArt = scenario !== 'A-none';
  // 'x' prefix avoids extname's dotfile edge case (`.ogg` would be read as a
  // filename with no extension, not as `ext === '.ogg'`).
  const oggCopyPath = action === 'copy' && isOggExtension(`x${SOURCE_EXTENSION[format]}`);
  let deviceHasArt: boolean;
  if (spec.kind === 'ipod') {
    deviceHasArt = artworkReaches(albumHasArt, spec.capabilities);
  } else if (oggCopyPath) {
    deviceHasArt = artworkReaches(albumHasArt, spec.capabilities);
  } else {
    deviceHasArt = artworkReaches(sourceFileEmbeds, spec.capabilities);
  }

  let reason: string;
  if (scenario === 'A-none') {
    reason = `no art anywhere → device gets none (${action} path)`;
  } else if (scenario === 'C-sidecar') {
    if (spec.kind === 'ipod') {
      reason = `sidecar detected by adapter → fallback writes cover.jpg bytes into the iTunesDB (${action} path)`;
    } else if (oggCopyPath) {
      reason = `sidecar bytes from adapter → ${format} copy path embeds via taglib METADATA_BLOCK_PICTURE (${action})`;
    } else {
      reason = `sidecar detected but mass-storage setArtworkFromData is a no-op for ${format} ${action} → device file stays art-less; TASK-370 closes the gap`;
    }
  } else if (!FIXTURE_EMBEDS_ART[format]) {
    if (spec.kind === 'ipod') {
      reason = `${format} carries no embedded art in fixture → adapter fallback supplies the album cover (${action} path)`;
    } else if (oggCopyPath) {
      reason = `${format} ${action} → adapter fallback feeds the taglib embed path (${action})`;
    } else {
      reason = `${format} carries no embedded art in fixture → mass-storage adapter fallback is a no-op (${action} path) → device stays art-less`;
    }
  } else {
    reason = `embedded art preserved through the ${action} path on a ${store} device`;
  }

  return {
    trackPresent: true,
    deviceHasArtwork: deviceHasArt,
    idempotent: true,
    // ASSUMPTION: the host matrix's `createPipelineConfig` never writes
    // `checkArtwork = ...` into the TOML. CLI flag → 'cli'; otherwise the
    // resolver falls through to 'default'.
    checkArtworkSource: checkArtwork ? 'cli' : 'default',
    // Directory adapter never emits the warning — it's Subsonic-only.
    artworkDetectionDisabledWarning: false,
    reason,
  };
}

/**
 * Subsonic adapter: Navidrome reports a `coverArt` ID for every track, so the
 * adapter can't distinguish a real cover from Navidrome's placeholder without
 * fetching. Without `--check-artwork` the adapter leaves `source.hasArtwork`
 * undefined; detectUpgrades treats undefined as "unknown" and short-circuits
 * both the artwork-added and artwork-removed rules, so every cell is
 * idempotent regardless of source/device asymmetry. With `--check-artwork`
 * the adapter fetches each cover, filters Navidrome's placeholder, and writes
 * a syncTag hash that converges any genuine source/device mismatch.
 *
 * **Adapter-fallback path (TASK-142):** the executor now consults
 * `SubsonicAdapter.getArtwork(track)` whenever embedded extraction from the
 * downloaded audio body returns null. That call hits `getCoverArt`, filters
 * the placeholder (probed unconditionally at connect time), and returns API
 * bytes when the album has a real cover. So C-sidecar / D-both / any no-embed
 * format that Navidrome serves with a real `cover.jpg` now lands art on the
 * device even though the file body carries none. A-none stays art-less
 * because the placeholder hash matches and getArtwork returns null.
 *
 * **iPod-only assumption.** `ScenarioFormatCell` has no device axis — the
 * docker matrix runs through `withTarget` which creates an `IpodTarget`. The
 * prediction below claims `deviceHasArtwork = albumHasArt` (every non-A
 * scenario lands art) because `setArtworkFromData` reliably writes the
 * iTunesDB on iPod. If a future docker matrix sweeps mass-storage Subsonic
 * targets, this predictor needs the same kind+OGG-carve-out branching that
 * `predictDirectory` carries — mass-storage non-OGG-copy outputs drop adapter
 * bytes (see `MassStorageTrack.setArtworkFromData`, TASK-371). Until then,
 * the device-kind branching is omitted as YAGNI but flagged here so the
 * limitation is not silent.
 */
export function predictSubsonic(
  cell: ScenarioFormatCell,
  checkArtwork: boolean
): StaticArtExpected {
  const { scenario, format } = cell;

  // Source-side "art exists for this album"; Navidrome serves the sidecar
  // cover.jpg via getCoverArt for C/D, the embedded picture for B, and the
  // placeholder (filtered) for A.
  const albumHasArt = scenario !== 'A-none';
  // Device-side "the on-device file has art" — after TASK-142 the adapter
  // fallback closes the gap between "file body embed" and "album has art",
  // so every non-A album lands art on the device regardless of where it lived
  // in the source (embed vs sidecar vs API).
  const deviceHasArtwork = albumHasArt;

  // Without checkArtwork: source.hasArtwork=undefined → engine skips
  // artwork-added/removed entirely → idempotent on every cell.
  if (!checkArtwork) {
    let reason: string;
    if (scenario === 'A-none') {
      reason =
        'Navidrome placeholder filtered at connect → getArtwork returns null → no art transferred → idempotent';
    } else if (scenario === 'C-sidecar' || !FIXTURE_EMBEDS_ART[format]) {
      reason =
        'embed missing from file body → adapter fallback fetches API cover.jpg → device gets art; source.hasArtwork=undefined keeps engine quiet';
    } else {
      reason =
        'embedded art in source file → device has art via extract; source.hasArtwork=undefined keeps engine quiet';
    }
    return {
      trackPresent: true,
      deviceHasArtwork,
      idempotent: true,
      // ASSUMPTION: the artwork-matrix configs (createSubsonicConfig +
      // createPipelineConfig) never write `checkArtwork = ...` into the
      // TOML. With no config-level value and no CLI flag, the resolver
      // returns 'default'. If a future config helper sets it, this pin
      // must flip to 'global' / 'device' as appropriate.
      checkArtworkSource: 'default',
      // Subsonic adapter fires `artwork-detection-disabled` precisely when
      // checkArtwork is off — that's the warning's whole reason for existing.
      artworkDetectionDisabledWarning: true,
      reason,
    };
  }

  // With checkArtwork: adapter fetches, filters placeholders, writes a hash.
  // Every non-A album is symmetric on the device (cover lands either via
  // embed extract or via adapter fallback); A converges because the
  // placeholder hash filters out the only candidate Navidrome serves.
  const idempotent = true;

  let reason: string;
  if (scenario === 'A-none') {
    reason = 'Navidrome placeholder filtered → source=false → symmetric';
  } else if (scenario === 'C-sidecar' || !FIXTURE_EMBEDS_ART[format]) {
    reason =
      'embed missing → adapter fallback transfers API cover; source.artworkHash matches syncTag.artworkHash → idempotent';
  } else {
    reason = 'embedded art in source file → device has art → symmetric, idempotent';
  }

  return {
    trackPresent: true,
    deviceHasArtwork,
    idempotent,
    checkArtworkSource: 'cli',
    // Subsonic + checkArtwork on → warning suppressed (the cheap-path
    // limitation it warns about no longer applies).
    artworkDetectionDisabledWarning: false,
    reason,
  };
}

/**
 * Change detection: sync the embedded variant, swap the source between syncs,
 * dry-run a second sync, observe which operations fire.
 *
 * Two mutations are modelled (the `transition` axis):
 *
 * - `updated`: cover A → cover B (same dimensions, different bytes).
 * - `removed`: embedded variant → stripped variant (source loses its art).
 *
 * The two mutations are asymmetric, and the asymmetry is the point. Artwork
 * *removal* changes a metadata field — `hasArtwork` goes true → false — and
 * podkit's self-healing diff compares `hasArtwork` on both sides (ADR-009), so
 * source-false vs device-true fires `artwork-removed` on the cheap path, with
 * or without `--check-artwork`. An artwork *update* leaves `hasArtwork` true on
 * both sides; only the bytes differ, which the cheap path can't see — so
 * `artwork-updated` fires only under `--check-artwork`, when the
 * `source.artworkHash` vs `syncTag.artworkHash` comparison runs. Without it the
 * swap is silently missed — exactly the limitation `--check-artwork` closes.
 */
export function predictChange(cell: ChangeCell, checkArtwork: boolean): ChangeExpected {
  const { format, transition } = cell;
  if (!FIXTURE_EMBEDS_ART[format]) {
    return {
      trackPresent: true,
      ops: '',
      convergesAfterApply: true,
      reason: `${format} cannot carry embedded art in the fixture — source never had art to ${transition === 'removed' ? 'lose' : 'change'} → no diff to detect`,
    };
  }
  if (transition === 'removed') {
    return {
      trackPresent: true,
      ops: 'upgrade-artwork:artwork-removed',
      convergesAfterApply: true,
      reason:
        'source lost its embedded art → source.hasArtwork=false vs device hasArtwork=true → artwork-removed fires via metadata comparison, hash-free, so it is independent of --check-artwork; once applied the device track also has no art → converges',
    };
  }
  if (checkArtwork) {
    return {
      trackPresent: true,
      ops: 'upgrade-artwork:artwork-updated',
      convergesAfterApply: true,
      reason:
        'source.artworkHash differs from syncTag.artworkHash → artwork-updated fires; once applied the syncTag hash matches the new cover → converges',
    };
  }
  return {
    trackPresent: true,
    ops: '',
    convergesAfterApply: true,
    reason:
      'no --check-artwork → source.artworkHash undefined → the artwork-updated branch is inert → cover-swap is silently missed (documented limitation; the reason --check-artwork exists)',
  };
}

/**
 * Subsonic change detection: same `transition` axis as the directory case but
 * with the Subsonic adapter's added wrinkle — Navidrome's `coverArt` ID is
 * present whether the source has real art or not, so without `--check-artwork`
 * the adapter leaves `hasArtwork` undefined for every track. detectUpgrades
 * short-circuits both the artwork-added and artwork-removed rules when
 * hasArtwork is undefined, so neither transition is observable on the cheap
 * path: a cover swap AND an art removal are both silently missed (whereas
 * directory's `removed` is observable cheaply because directory reports a real
 * `hasArtwork=false` after the strip).
 *
 * With `--check-artwork` the adapter fetches each cover, filters Navidrome's
 * placeholder, and writes a syncTag hash. Then:
 *   - `removed`: source.hasArtwork goes true → false (placeholder filtered),
 *     and the diff fires artwork-removed.
 *   - `updated`: hash differs from the syncTag's, and artwork-updated fires.
 */
export function predictSubsonicChange(cell: ChangeCell, checkArtwork: boolean): ChangeExpected {
  const { format, transition } = cell;
  if (!FIXTURE_EMBEDS_ART[format]) {
    return {
      trackPresent: true,
      ops: '',
      convergesAfterApply: true,
      reason: `${format} cannot carry embedded art in the fixture — source never had art to ${transition === 'removed' ? 'lose' : 'change'} → no diff to detect`,
    };
  }
  if (!checkArtwork) {
    return {
      trackPresent: true,
      ops: '',
      convergesAfterApply: true,
      reason:
        'no --check-artwork → Subsonic adapter leaves hasArtwork=undefined → engine skips both artwork-added and artwork-removed → cover swap and art removal are silently missed (the cheap-path limitation --check-artwork closes)',
    };
  }
  if (transition === 'removed') {
    return {
      trackPresent: true,
      ops: 'upgrade-artwork:artwork-removed',
      convergesAfterApply: true,
      reason:
        '--check-artwork on → adapter filters Navidrome placeholder → hasArtwork=false vs device hasArtwork=true → artwork-removed fires; once applied the device track also has no art → converges',
    };
  }
  return {
    trackPresent: true,
    ops: 'upgrade-artwork:artwork-updated',
    convergesAfterApply: true,
    reason:
      '--check-artwork on → adapter computes the new artworkHash and compares vs syncTag → artwork-updated fires; once applied the syncTag hash matches the new cover → converges',
  };
}

/** Expected outcome for a compilation cell (extends the static shape). */
export interface CompilationExpected extends StaticArtExpected {
  /**
   * For an embed-capable anchor: the iPod DB thumbnail's sampled colour
   * classifies to this track's OWN cover colour (no album-cache collision).
   * `null` for bare tracks (no device art to sample).
   */
  dbArtOwnColor: boolean | null;
}

export interface CompilationObserved extends StaticArtObserved {
  dbArtOwnColor: boolean | null;
}

/** Anchor (title → expected cover RGB) palette for nearest-colour classification. */
function hexToRgb(hex: string): RgbColor {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

const COMPILATION_ANCHOR_PALETTE: ReadonlyArray<{ title: string; rgb: RgbColor }> = FORMATS.map(
  (f) => FORMAT_TITLE[f]
)
  .map((title) => ({ title, hex: compilationCoverColor(title) }))
  .filter((e): e is { title: string; hex: string } => e.hex !== undefined)
  .map((e) => ({ title: e.title, rgb: hexToRgb(e.hex) }));

/** The anchor title whose cover colour is nearest the sampled colour. */
function classifyAnchorColor(sample: RgbColor): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const { title, rgb } of COMPILATION_ANCHOR_PALETTE) {
    const dist = (sample.r - rgb.r) ** 2 + (sample.g - rgb.g) ** 2 + (sample.b - rgb.b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = title;
    }
  }
  return best;
}

/**
 * Compilation (various-artist album), iPod. Every track shares one album but
 * carries a distinct artist, so the album artwork cache — keyed on
 * `(artist, album)` (see `album-cache.ts` / `pipeline.ts buildAlbumCandidates`)
 * — places each track in its own single-element candidate group. The
 * consequence is a *split*, not a collision: a track inherits no cover from a
 * differing-artist sibling. The fixture embeds art only in the embed-capable
 * anchors (FLAC/ALAC/MP3/AAC/AIFF), each with a DISTINCT cover colour;
 * WAV/OGG/Opus ship bare. So:
 *
 * - anchors → self-embedded cover reaches the iPod artwork DB (`hasArtwork`),
 *   and the DB thumbnail's colour is this track's OWN — proving no collision
 *   bled a sibling's cover across the shared album (`dbArtOwnColor`).
 * - bare tracks → no own art, and the per-artist split denies them a sibling's
 *   cover → no art on device. (In a single-artist album they would inherit it.)
 *
 * This pins the current, deliberate `(artist, album)` keying (TASK-355.03): a
 * code change that started sharing art across a compilation's artists would
 * flip the bare cells; a coarser key that collided would flip `dbArtOwnColor`.
 */
export function predictCompilation(format: Format, checkArtwork: boolean): CompilationExpected {
  const embeds = compilationTrackEmbeds(FORMAT_TITLE[format]);
  return {
    trackPresent: true,
    deviceHasArtwork: embeds,
    idempotent: true,
    checkArtworkSource: checkArtwork ? 'cli' : 'default',
    // Compilation matrix uses a directory adapter, so the Subsonic-only
    // warning never fires.
    artworkDetectionDisabledWarning: false,
    dbArtOwnColor: embeds ? true : null,
    reason: embeds
      ? `${format} is an embed-capable anchor carrying its own distinct cover → reaches the iPod artwork DB with its own colour (no cache collision)`
      : `${format} ships bare; the compilation's distinct per-track artist isolates its (artist,album) album-cache key, so no embed-capable sibling shares a cover (the split) → no device art (correct — the file carries none)`,
  };
}

// ---------------------------------------------------------------------------
// Transfer-mode × artwork (file-level strip/preserve), iPod
// ---------------------------------------------------------------------------

/** A transfer-mode × format cell (scenario fixed at B-embedded, device iPod). */
export interface TransferArtCell {
  format: Format;
  transferMode: TransferMode;
}

export function transferArtCells(): TransferArtCell[] {
  const cells: TransferArtCell[] = [];
  for (const transferMode of TRANSFER_MODES) {
    for (const format of FORMATS) {
      cells.push({ format, transferMode });
    }
  }
  return cells;
}
export function transferArtCellKey(cell: TransferArtCell): string {
  return `${cell.transferMode}/${cell.format}`;
}
export function transferArtCellLabel(cell: TransferArtCell): string {
  return `${cell.transferMode} / ${cell.format}`;
}

/**
 * Expected outcome for a transfer-mode artwork cell. The point is the gap
 * between the two artwork signals: on the iPod the cover always reaches the
 * iTunesDB (`dbHasArtwork`), but whether the on-device *file* keeps its
 * embedded copy (`fileHasArt`) depends on the transfer mode.
 */
export interface TransferArtExpected extends CellExpectation {
  trackPresent: boolean;
  /** `device.hasArtwork` (iTunesDB) — always true here (source has art). */
  dbHasArtwork: boolean | null;
  /** The written file still carries an embedded cover. */
  fileHasArt: boolean;
}

export interface TransferArtObserved extends Record<string, unknown> {
  trackPresent: boolean;
  dbHasArtwork: boolean | null;
  fileHasArt: boolean;
}

/** The iPod the transfer-mode artwork matrix syncs to (database-artwork). */
const TRANSFER_ART_DEVICE: DeviceId = 'ipod-MA147';
/** Pipeline that yields both copy (mp3/aac) and transcode (rest) paths on iPod. */
const TRANSFER_ART_PIPELINE: Pipeline = 'transcode-aac';

/**
 * Transfer-mode × artwork on the iPod. The fixture is scenario B-embedded, so
 * every source carries embedded art. The cover always reaches the iTunesDB
 * (`dbHasArtwork = true`), but the file copied to the device keeps its embedded
 * copy only as the transfer mode + action allow (`fileArtworkSurvives`):
 *
 * - `portable` → every file keeps art.
 * - `optimized` → every file is stripped (copy and transcode).
 * - `fast` → copies (mp3/aac) keep art; transcodes (the rest) are stripped.
 *
 * This is the only matrix that reads the on-device file bytes
 * (`probeFileArtwork`); it's the only way to see the strip, which is invisible
 * to both the dry-run plan and `TrackInfo.hasArtwork`.
 */
export function predictTransferArtwork(
  cell: TransferArtCell,
  _checkArtwork: boolean
): TransferArtExpected {
  const caps = DEVICE_SPEC_BY_ID[TRANSFER_ART_DEVICE].capabilities;
  const sourceHadArt = sourceEmbedsArt('B-embedded', cell.format);
  const action = deviceAction(cell.format, caps, TRANSFER_ART_PIPELINE, 'ipod');
  const dbHasArtwork = artworkReaches(sourceHadArt, caps);
  const fileHasArt = fileArtworkSurvives(action, cell.transferMode, sourceHadArt, caps);

  let reason: string;
  if (cell.transferMode === 'portable') {
    reason = `portable preserves the embedded cover in the ${action} output; DB also has it`;
  } else if (cell.transferMode === 'optimized') {
    reason = `optimized strips the redundant file cover (${action}); the iTunesDB keeps it`;
  } else {
    reason =
      action === 'copy'
        ? 'fast direct-copies a device-native file → embedded cover rides along for free'
        : 'fast strips the cover on the transcode path (-vn); the iTunesDB keeps it';
  }

  return { trackPresent: true, dbHasArtwork, fileHasArt, reason };
}

// ---------------------------------------------------------------------------
// Artwork resize vs artworkMaxResolution
// ---------------------------------------------------------------------------

/**
 * Formats whose embedded cover is a real image stream (attached_pic), so its
 * pixel dimensions are ffprobe-readable after sync. WAV (id3 chunk) and
 * OGG/Opus (METADATA_BLOCK_PICTURE tag) carry art differently and their
 * post-transcode dimensions are not cleanly comparable, so the resize matrix
 * skips them — the resize *rule* is fully exercised by the image-stream
 * formats.
 */
export const RESIZE_FORMATS: readonly Format[] = ['flac', 'alac', 'mp3', 'aac', 'aiff'];

/**
 * Devices the resize matrix sweeps: two embedded-art devices with very
 * different `artworkMaxResolution` (generic 500, echo-mini 127) so a regression
 * that hardcoded the wrong max would show up on at least one of them, plus the
 * iPod for the database-artwork side.
 */
export const RESIZE_DEVICE_IDS: readonly DeviceId[] = ['ms-generic', 'ms-echo-mini', 'ipod-MA147'];

/** A device × format × transfer-mode cell of the resize matrix. */
export interface ResizeCell {
  device: DeviceId;
  format: Format;
  transferMode: TransferMode;
}

export function resizeCells(): ResizeCell[] {
  const cells: ResizeCell[] = [];
  for (const device of RESIZE_DEVICE_IDS) {
    for (const transferMode of TRANSFER_MODES) {
      for (const format of RESIZE_FORMATS) {
        cells.push({ device, format, transferMode });
      }
    }
  }
  return cells;
}
export function resizeCellKey(cell: ResizeCell): string {
  return `${cell.device}/${cell.transferMode}/${cell.format}`;
}
export function resizeCellLabel(cell: ResizeCell): string {
  return `${cell.device} / ${cell.transferMode} / ${cell.format}`;
}

export interface ResizeExpected extends CellExpectation {
  fileArtPresent: boolean;
  /** Cover edge length (px) in the device file. Square, so width === height. */
  width: number | null;
  height: number | null;
  /**
   * For database-artwork devices (iPod): the largest iTunesDB thumbnail is
   * bounded by `artworkMaxResolution` *and* downscaled from the source. `null`
   * for embedded-art devices (no database thumbnail to inspect).
   */
  dbArtWithinMax: boolean | null;
}

export interface ResizeObserved extends Record<string, unknown> {
  fileArtPresent: boolean;
  width: number | null;
  height: number | null;
  dbArtWithinMax: boolean | null;
}

/** Pipeline the resize matrix syncs under (gives copy + transcode paths on iPod). */
export const RESIZE_PIPELINE: Pipeline = 'transcode-aac';

/**
 * Artwork resize against `artworkMaxResolution`, swept across every transfer
 * mode — the artwork *size* must match the device's configuration regardless of
 * mode. The hires fixture's cover is 1024px (> every device max), so:
 *
 * - `ms-generic` (embedded, max 500): the file cover is kept and downscaled to
 *   500 in **every** mode — transfer mode does not change an embedded device's
 *   resize, the cover is the device's only art source.
 * - iPod (database, max 320): the file cover is left at the source 1024 where
 *   it survives (per `fileArtworkSurvives`: `portable`, or a `fast` direct
 *   copy) and stripped otherwise; either way the iTunesDB thumbnail is resized
 *   within 320 in **every** mode (`dbArtWithinMax`).
 */
export function predictResize(cell: ResizeCell, _checkArtwork: boolean): ResizeExpected {
  const spec = DEVICE_SPEC_BY_ID[cell.device];
  const caps = spec.capabilities;
  const action = deviceAction(cell.format, caps, RESIZE_PIPELINE, spec.kind);
  const present = fileArtworkSurvives(action, cell.transferMode, true, caps);
  const size = present ? expectedFileArtworkSize(HIRES_COVER_SIZE, caps) : null;
  const embedded = caps.artworkSources[0] === 'embedded';
  const isDatabaseArt = !embedded && caps.artworkSources.length > 0;

  let reason: string;
  if (embedded) {
    reason = `embedded-art device → file cover kept and downscaled to artworkMaxResolution ${caps.artworkMaxResolution} (from ${HIRES_COVER_SIZE}) in every mode`;
  } else if (present) {
    reason = `iPod ${cell.transferMode}: file cover preserved at source ${HIRES_COVER_SIZE} (${action}); the iTunesDB thumbnail is resized within ${caps.artworkMaxResolution}`;
  } else {
    reason = `iPod ${cell.transferMode}: file cover stripped (${action}); the iTunesDB thumbnail is still resized within ${caps.artworkMaxResolution}`;
  }

  return {
    fileArtPresent: present,
    width: size,
    height: size,
    dbArtWithinMax: isDatabaseArt ? true : null,
    reason,
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
  /**
   * The number of per-track sync failures the caller expects to see — the
   * count of skipBug cells whose first-sync execution legitimately fails
   * (e.g. unhandled container, transcode error). The harness asserts
   * `result.failed === expectedFailures` exactly, so an unexpected regression
   * surfaces immediately instead of being swallowed by a permissive guard.
   * Omit to expect 0 failures.
   */
  expectedFailures?: number;
}): Promise<Map<string, StaticArtObserved>> {
  const { target, configPath, checkArtwork, env } = opts;
  const expectedFailures = opts.expectedFailures ?? 0;
  const { deviceArg } = deviceAddressing(target);
  const baseArgs = ['--config', configPath, 'sync', '--device', deviceArg, '--json'];
  const initArgs = checkArtwork ? [...baseArgs, '--check-artwork'] : baseArgs;

  const { result: initResult, json: initJson } = await runCliJson<SyncOutput>(
    initArgs,
    runOpts(opts.initTimeoutMs ?? 240000, env)
  );
  if (!initJson?.success || (initJson.result?.failed ?? 0) !== expectedFailures) {
    throw new Error(
      `initial sync failed (checkArtwork=${checkArtwork}): exit=${initResult.exitCode}, ` +
        `expectedFailures=${expectedFailures}, observedFailed=${initJson?.result?.failed ?? 'n/a'}\n` +
        `  args: ${JSON.stringify(initArgs)}\n` +
        `  json: ${JSON.stringify(initJson, null, 2)}\n` +
        `  stderr: ${initResult.stderr}`
    );
  }

  const deviceTracks = await target.getTracks();

  // Dry-run plans the next sync. It performs no I/O so a failed=0 dry-run is
  // strictly correct; any per-track "failed" entry would be a planning bug,
  // not a transfer failure. A null/unparseable JSON is still hard-fail.
  const { result: dryResult, json: dryJson } = await runCliJson<SyncOutput>(
    [...initArgs, '--dry-run'],
    runOpts(opts.dryTimeoutMs ?? 120000, env)
  );
  if (!dryJson || (dryJson.result?.failed ?? 0) !== 0) {
    throw new Error(
      `dry-run sync failed (checkArtwork=${checkArtwork}): exit=${dryResult.exitCode}, ` +
        `observedFailed=${dryJson?.result?.failed ?? 'n/a'}`
    );
  }

  // Decision attribution: TASK-357's --json `decisions.checkArtwork.source` is
  // sync-wide, so we read it once and apply to every cell in this pass.
  const checkArtworkSource = (dryJson.decisions?.checkArtwork.source ??
    null) as DecisionSource | null;
  // TASK-366's `artwork-detection-disabled` plan warning is also sync-wide
  // (one warning per dry-run). Same one-shot read.
  const artworkDetectionDisabledWarning =
    dryJson.planWarnings?.some((w) => w.type === 'artwork-detection-disabled') ?? false;

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
      checkArtworkSource,
      artworkDetectionDisabledWarning,
      secondSyncOps: ops,
    });
  }
  return byKey;
}

/**
 * Compilation pass: one fresh sync of the various-artist fixture + getTracks +
 * a second dry-run, keyed by format. Like {@link observeStaticArtwork} but
 * matches device tracks by the compilation's distinct per-track artist
 * (`compilationArtist(title)`) rather than a scenario artist.
 */
export async function observeCompilation(opts: {
  target: SyncTarget;
  configPath: string;
  checkArtwork: boolean;
}): Promise<Map<string, CompilationObserved>> {
  const { target, configPath, checkArtwork } = opts;
  const { deviceArg } = deviceAddressing(target);
  const baseArgs = ['--config', configPath, 'sync', '--device', deviceArg, '--json'];
  const initArgs = checkArtwork ? [...baseArgs, '--check-artwork'] : baseArgs;

  const { result: initResult, json: initJson } = await runCliJson<SyncOutput>(
    initArgs,
    runOpts(240000)
  );
  if (initResult.exitCode !== 0 || !initJson?.success) {
    throw new Error(
      `compilation sync failed (checkArtwork=${checkArtwork}): exit=${initResult.exitCode}\n` +
        `  json: ${JSON.stringify(initJson, null, 2)}\n` +
        `  stderr: ${initResult.stderr}`
    );
  }

  const deviceTracks = await target.getTracks();
  const dbColors = await probeIpodDbArtworkColor(target.path);

  const { result: dryResult, json: dryJson } = await runCliJson<SyncOutput>(
    [...initArgs, '--dry-run'],
    runOpts(120000)
  );
  if (dryResult.exitCode !== 0 || !dryJson) {
    throw new Error(
      `compilation dry-run failed (checkArtwork=${checkArtwork}): exit=${dryResult.exitCode}`
    );
  }

  const checkArtworkSource = (dryJson.decisions?.checkArtwork.source ??
    null) as DecisionSource | null;
  const artworkDetectionDisabledWarning =
    dryJson.planWarnings?.some((w) => w.type === 'artwork-detection-disabled') ?? false;

  const byKey = new Map<string, CompilationObserved>();
  for (const format of FORMATS) {
    const title = FORMAT_TITLE[format];
    const artist = compilationArtist(title);
    const device = findDeviceTrack(deviceTracks, artist, title);
    const ops = opsForTrack(dryJson, artist, title);
    const embeds = compilationTrackEmbeds(title);
    let dbArtOwnColor: boolean | null = null;
    if (embeds) {
      const sample = dbColors.get(trackId(artist, title));
      dbArtOwnColor = sample !== undefined && classifyAnchorColor(sample) === title;
    }
    byKey.set(format, {
      trackPresent: device !== undefined,
      deviceHasArtwork: device ? device.hasArtwork : null,
      idempotent: isArtworkIdempotent(ops),
      checkArtworkSource,
      artworkDetectionDisabledWarning,
      dbArtOwnColor,
      secondSyncOps: ops,
    });
  }
  return byKey;
}

/**
 * Transfer-mode artwork pass for ONE mode: sync the embedded fixture with
 * `--transfer-mode <mode>` onto a fresh iPod, then read both artwork signals —
 * the iTunesDB flag (`getTracks`) and the on-device file's embedded cover
 * (`probeFileArtwork`). Returns per-format observed, keyed by
 * `transferArtCellKey`.
 */
export async function observeTransferArtwork(opts: {
  target: SyncTarget;
  configPath: string;
  transferMode: TransferMode;
  checkArtwork: boolean;
}): Promise<Map<string, TransferArtObserved>> {
  const { target, configPath, transferMode, checkArtwork } = opts;
  const { deviceArg } = deviceAddressing(target);
  const baseArgs = [
    '--config',
    configPath,
    'sync',
    '--device',
    deviceArg,
    '--transfer-mode',
    transferMode,
    '--json',
  ];
  const initArgs = checkArtwork ? [...baseArgs, '--check-artwork'] : baseArgs;

  const { result, json } = await runCliJson<SyncOutput>(initArgs, runOpts(240000));
  if (result.exitCode !== 0 || !json?.success) {
    throw new Error(
      `transfer-mode sync failed (${transferMode}, checkArtwork=${checkArtwork}): exit=${result.exitCode}\n` +
        `  json: ${JSON.stringify(json, null, 2)}\n` +
        `  stderr: ${result.stderr}`
    );
  }

  const deviceTracks = await target.getTracks();
  const fileArt = await probeFileArtwork(target.musicRoot());
  const artist = SCENARIO_ARTIST['B-embedded'];

  const byKey = new Map<string, TransferArtObserved>();
  for (const format of FORMATS) {
    const title = FORMAT_TITLE[format];
    const device = findDeviceTrack(deviceTracks, artist, title);
    const file = fileArt.get(trackId(artist, title));
    byKey.set(transferArtCellKey({ format, transferMode }), {
      trackPresent: device !== undefined,
      dbHasArtwork: device ? device.hasArtwork : null,
      fileHasArt: file?.hasEmbeddedArt ?? false,
    });
  }
  return byKey;
}

/**
 * Resize pass for ONE device: sync the hires fixture under `portable`, then
 * read each anchor format's on-device cover dimensions (`probeFileArtwork`).
 * Returns per-format observed, keyed by format (the caller qualifies with the
 * device id).
 */
export async function observeResize(opts: {
  target: SyncTarget;
  configPath: string;
  transferMode: TransferMode;
}): Promise<Map<string, ResizeObserved>> {
  const { target, configPath, transferMode } = opts;
  const { deviceArg } = deviceAddressing(target);
  const args = [
    '--config',
    configPath,
    'sync',
    '--device',
    deviceArg,
    '--transfer-mode',
    transferMode,
    '--json',
  ];

  const { result, json } = await runCliJson<SyncOutput>(args, runOpts(240000));
  if (result.exitCode !== 0 || !json?.success) {
    throw new Error(
      `resize sync failed (${target.name}): exit=${result.exitCode}\n` +
        `  json: ${JSON.stringify(json, null, 2)}\n` +
        `  stderr: ${result.stderr}`
    );
  }

  const fileArt = await probeFileArtwork(target.musicRoot());

  // Database-artwork devices (iPod) resize the iTunesDB thumbnail, not the
  // file; read it back to confirm it's bounded by artworkMaxResolution.
  const caps = target.capabilities;
  const isDatabaseArt = caps.artworkSources[0] !== 'embedded' && caps.artworkSources.length > 0;
  const dbArt = isDatabaseArt ? await probeIpodDbArtwork(target.path) : new Map<string, number>();
  const max = caps.artworkMaxResolution;

  const byKey = new Map<string, ResizeObserved>();
  for (const format of RESIZE_FORMATS) {
    const key = trackId(HIRES_ARTIST, FORMAT_TITLE[format]);
    const file = fileArt.get(key);
    let dbArtWithinMax: boolean | null = null;
    if (isDatabaseArt) {
      const thumbWidth = dbArt.get(key);
      dbArtWithinMax =
        thumbWidth !== undefined &&
        max !== null &&
        thumbWidth <= max &&
        thumbWidth < HIRES_COVER_SIZE;
    }
    byKey.set(format, {
      fileArtPresent: file?.hasEmbeddedArt ?? false,
      width: file?.width ?? null,
      height: file?.height ?? null,
      dbArtWithinMax,
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
 * record presence, swap in the transition's alt variant (cover-swapped for
 * `updated`, art-stripped for `removed`), dry-run, record the second-sync ops
 * per format. Directory adapter only. Returns a map keyed by format; the caller
 * qualifies the key with the transition.
 */
export async function observeChangePass(opts: {
  target: IpodTarget;
  checkArtwork: boolean;
  transition: ChangeTransition;
}): Promise<Map<string, ChangeObserved>> {
  const { target, checkArtwork, transition } = opts;
  const altFixturesDir = CHANGE_ALT_FIXTURE[transition]();
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

    // Mutate: replace the album with the transition's alt variant.
    await rm(join(sourceRoot, 'album'), { recursive: true, force: true });
    await cp(altFixturesDir, join(sourceRoot, 'album'), {
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

    // Apply the detected change for real, then dry-run a THIRD time: a clean
    // third pass means the change converged rather than re-firing every sync.
    const { result: applyResult, json: applyJson } = await runCliJson<SyncOutput>(
      initArgs,
      runOpts(240000)
    );
    if (applyResult.exitCode !== 0 || !applyJson?.success) {
      throw new Error(
        `apply sync failed (checkArtwork=${checkArtwork}): exit=${applyResult.exitCode}\n` +
          `  stderr: ${applyResult.stderr}`
      );
    }
    const { result: convResult, json: convJson } = await runCliJson<SyncOutput>(
      [...initArgs, '--dry-run'],
      runOpts(120000)
    );
    if (convResult.exitCode !== 0 || !convJson) {
      throw new Error(
        `convergence dry-run failed (checkArtwork=${checkArtwork}): exit=${convResult.exitCode}`
      );
    }

    const byKey = new Map<string, ChangeObserved>();
    for (const format of FORMATS) {
      const ops = opsForTrack(dryJson, artist, FORMAT_TITLE[format]);
      const convOps = opsForTrack(convJson, artist, FORMAT_TITLE[format]);
      byKey.set(format, {
        trackPresent: presenceByFormat.get(format) ?? false,
        ops: formatOpsString(ops),
        convergesAfterApply: isArtworkIdempotent(convOps),
        secondSyncOps: ops,
        thirdSyncOps: convOps,
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

/**
 * Change-detection pass for the Subsonic adapter. Mirrors
 * {@link observeChangePass} but with Navidrome between podkit and the source.
 *
 * Every library mutation forces a container restart with a fresh database (via
 * {@link MutableLibrarySource.mutateLibrary}) — Navidrome's artwork cache is
 * keyed on the path-derived coverArt ID, so a startScan endpoint can serve
 * stale art for the same file path. Restart-with-clean-DB is heavy (~10-30s)
 * but bulletproof.
 *
 * The Subsonic server URL's port may change across restarts on
 * dynamic-port-allocated environments, so we rebuild the podkit config after
 * every mutation rather than caching one upfront.
 */
export interface MutableLibrarySource {
  readonly serverUrl: string;
  readonly username: string;
  getEnv(): Record<string, string>;
  mutateLibrary(
    fn: (musicDir: string) => Promise<void>,
    opts?: { minAlbums?: number }
  ): Promise<void>;
}

export async function observeChangePassSubsonic(opts: {
  target: IpodTarget;
  source: MutableLibrarySource;
  buildConfig: (source: MutableLibrarySource) => Promise<string>;
  checkArtwork: boolean;
  transition: ChangeTransition;
  syncTimeoutMs?: number;
  dryTimeoutMs?: number;
}): Promise<Map<string, ChangeObserved>> {
  const { target, source, buildConfig, checkArtwork, transition } = opts;
  const altFixturesDir = CHANGE_ALT_FIXTURE[transition]();
  const artist = SCENARIO_ARTISTS.embedded;
  const env = source.getEnv();
  const initSyncTimeout = opts.syncTimeoutMs ?? 240000;
  const dryTimeout = opts.dryTimeoutMs ?? 120000;
  const ALBUM_DIR = 'multi-format-embedded';
  const configsToCleanup: string[] = [];

  // Track every fresh config so a mid-run failure doesn't leak temp dirs.
  async function freshConfig(): Promise<string> {
    const cfg = await buildConfig(source);
    configsToCleanup.push(cfg);
    return cfg;
  }

  function syncArgs(configPath: string, extra: string[] = []): string[] {
    const base = ['--config', configPath, 'sync', '--device', target.path, '--json', ...extra];
    return checkArtwork ? [...base, '--check-artwork'] : base;
  }

  try {
    // 1. Reset library to the embedded fixtures (full restart for clean state).
    await source.mutateLibrary(
      async (musicDir) => {
        const albumDir = join(musicDir, ALBUM_DIR);
        await rm(albumDir, { recursive: true, force: true });
        await cp(getMultiFormatEmbeddedFixturesDir(), albumDir, { recursive: true });
      },
      { minAlbums: 1 }
    );

    // 2. Initial sync.
    let configPath = await freshConfig();
    const { result: initResult, json: initJson } = await runCliJson<SyncOutput>(
      syncArgs(configPath),
      runOpts(initSyncTimeout, env)
    );
    if (initResult.exitCode !== 0 || !initJson?.success) {
      throw new Error(
        `subsonic initial sync failed (checkArtwork=${checkArtwork}, transition=${transition}): exit=${initResult.exitCode}\n` +
          `  stderr: ${initResult.stderr.slice(0, 2000)}`
      );
    }

    // 3. Record per-format presence on the device.
    const deviceTracks = await target.getTracks();
    const presenceByFormat = new Map<Format, boolean>();
    for (const format of FORMATS) {
      presenceByFormat.set(
        format,
        deviceTracks.some((t) => t.artist === artist && t.title === FORMAT_TITLE[format])
      );
    }

    // 4. Mutate the library: swap embedded for the transition's alt variant.
    await source.mutateLibrary(
      async (musicDir) => {
        const albumDir = join(musicDir, ALBUM_DIR);
        await rm(albumDir, { recursive: true, force: true });
        await cp(altFixturesDir, albumDir, { recursive: true });
      },
      { minAlbums: 1 }
    );

    // 5. Dry-run after the mutation — what does podkit propose?
    configPath = await freshConfig();
    const { result: dryResult, json: dryJson } = await runCliJson<SyncOutput>(
      syncArgs(configPath, ['--dry-run']),
      runOpts(dryTimeout, env)
    );
    if (dryResult.exitCode !== 0 || !dryJson || !dryJson.success) {
      throw new Error(
        `subsonic dry-run failed (checkArtwork=${checkArtwork}, transition=${transition}): exit=${dryResult.exitCode}, success=${dryJson?.success}\n` +
          `  stderr: ${dryResult.stderr.slice(0, 2000)}`
      );
    }

    // 6. Apply the detected change and verify convergence on the next dry-run.
    configPath = await freshConfig();
    const { result: applyResult, json: applyJson } = await runCliJson<SyncOutput>(
      syncArgs(configPath),
      runOpts(initSyncTimeout, env)
    );
    if (applyResult.exitCode !== 0 || !applyJson?.success) {
      throw new Error(
        `subsonic apply sync failed (checkArtwork=${checkArtwork}, transition=${transition}): exit=${applyResult.exitCode}\n` +
          `  stderr: ${applyResult.stderr.slice(0, 2000)}`
      );
    }

    configPath = await freshConfig();
    const { result: convResult, json: convJson } = await runCliJson<SyncOutput>(
      syncArgs(configPath, ['--dry-run']),
      runOpts(dryTimeout, env)
    );
    if (convResult.exitCode !== 0 || !convJson || !convJson.success) {
      throw new Error(
        `subsonic convergence dry-run failed (checkArtwork=${checkArtwork}, transition=${transition}): exit=${convResult.exitCode}, success=${convJson?.success}\n` +
          `  stderr: ${convResult.stderr.slice(0, 2000)}`
      );
    }

    const byKey = new Map<string, ChangeObserved>();
    for (const format of FORMATS) {
      const ops = opsForTrack(dryJson, artist, FORMAT_TITLE[format]);
      const convOps = opsForTrack(convJson, artist, FORMAT_TITLE[format]);
      byKey.set(format, {
        trackPresent: presenceByFormat.get(format) ?? false,
        ops: formatOpsString(ops),
        convergesAfterApply: isArtworkIdempotent(convOps),
        secondSyncOps: ops,
        thirdSyncOps: convOps,
      });
    }
    return byKey;
  } finally {
    for (const cfg of configsToCleanup) {
      await cleanupTempConfig(cfg);
    }
  }
}
