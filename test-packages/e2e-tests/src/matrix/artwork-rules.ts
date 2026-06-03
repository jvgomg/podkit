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
  MULTI_FORMAT_DEFAULT_COVER_SIZE,
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
  trackId,
  type Format,
  type ScenarioFormatCell,
} from './axes.js';
import {
  FIXTURE_EMBEDS_ART,
  artworkReaches,
  deviceAction,
  expectedFileArtworkSize,
  expectedSidecarSize,
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
  probeSidecarArtwork,
  type RgbColor,
} from './device-artwork.js';
import {
  findDeviceTrack,
  formatOpsString,
  isArtworkIdempotent,
  opsForTrack,
  type CellExpectation,
  type OpSummary,
  type SkipDecision,
} from './harness.js';

/**
 * Devices the host artwork matrix sweeps (the source-side scenario × format
 * × pipeline matrix; the transfer-artwork and resize matrices each carry
 * their own device sweeps including rockbox). iPod (database artwork) and
 * two embedded-art mass-storage presets. Post-TASK-370 / TASK-372 every cell
 * asserts real behaviour with no `skipBug` fences.
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
 * Post-TASK-370 / TASK-372 fence shape.
 *
 * Two layered primitives collapsed the old "embed via FFmpeg vs. taglib
 * OGG carve-out vs. setArtworkFromData no-op vs. nowhere-to-land" matrix
 * into a single dispatch on `track.artworkSink`:
 *
 *   - iPod (sink = 'database')       → `setArtworkFromData` always lands.
 *   - mass-storage embedded primary  → `updateTrack({ embeddedPictureData })`
 *     routes through node-taglib-sharp, which handles every container —
 *     including non-OGG outputs that used to drop bytes. So
 *     `ms-echo-mini` and `ms-generic` now pass adapter-fallback bytes
 *     through to the device file regardless of format/scenario.
 *   - mass-storage sidecar primary   → `adapter.writeSidecar()` (TASK-370)
 *     writes a peer `cover.jpg` at `artworkMaxResolution`. Rockbox stays
 *     out of `ARTWORK_DEVICE_IDS` (that sweep is for the source-side
 *     scenario × format × pipeline product); the transfer-artwork and
 *     resize matrices each carry their own rockbox cells.
 *
 * Net effect: no skipBug fences remain. The function is preserved so a
 * future regression that breaks sink dispatch surfaces here rather than
 * silently widening the diff. Today this returns null for every cell in
 * ARTWORK_DEVICE_IDS.
 */
export function skipArtworkCell(_cell: PipelineDeviceCell): SkipDecision | null {
  // Reserved for future regressions — every current cell passes.
  return null;
}

// ---------------------------------------------------------------------------
// Predictions
// ---------------------------------------------------------------------------

/**
 * Directory adapter, swept across the device axis. The pinned codec pipeline
 * controls copy-vs-transcode (P2); the device's capabilities decide both that
 * action and whether art reaches the device. Predictions key off
 * `target.capabilities`, never the device name.
 *
 * Post-TASK-372 the device-side dispatch is uniform across every embedded /
 * database sink: every non-A scenario lands art on the device because the
 * directory adapter's getArtwork fallback supplies sidecar / album-cover
 * bytes whenever the audio body lacks embed, and `track.artworkSink` picks
 * the write path that delivers those bytes (setArtworkFromData for iPod,
 * updateTrack({ embeddedPictureData }) for embedded-primary mass-storage —
 * which handles ALL containers via node-taglib-sharp, not just OGG). The
 * iPod-vs-mass-storage split this predictor used to carry is gone.
 *
 * Sidecar-primary devices still fall out of the matrix via `skipArtworkCell`
 * (TASK-370 will land `adapter.writeSidecar()`); the predictor doesn't need
 * a branch for them.
 */
export function predictDirectory(
  cell: PipelineDeviceCell,
  checkArtwork: boolean
): StaticArtExpected {
  const { scenario, format, pipeline, device } = cell;
  const spec = DEVICE_SPEC_BY_ID[device];
  const action = deviceAction(format, spec.capabilities, pipeline, spec.kind);
  const store = spec.kind === 'ipod' ? 'database-artwork' : 'embedded-artwork';

  // The directory adapter's getArtwork fallback (TASK-142) closes the gap
  // between "source file embed" and "album has art" — the executor picks up
  // peer cover.jpg / folder.jpg bytes whenever the audio body lacks embed.
  // TASK-372 then routes those bytes through the right write path for the
  // device's artworkSink, so every non-A album lands art on any device with
  // a non-empty artworkSources list.
  const albumHasArt = scenario !== 'A-none';
  const deviceHasArt = artworkReaches(albumHasArt, spec.capabilities);

  let reason: string;
  if (scenario === 'A-none') {
    reason = `no art anywhere → device gets none (${action} path)`;
  } else if (scenario === 'C-sidecar') {
    reason = `sidecar detected by adapter → fallback bytes routed via track.artworkSink to the device (${store}, ${action} path)`;
  } else if (!FIXTURE_EMBEDS_ART[format]) {
    reason = `${format} carries no embedded art in fixture → adapter fallback supplies the album cover (${store}, ${action} path)`;
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
 * **Device-axis coverage.** `ScenarioFormatCell` has no device axis — the
 * docker matrix runs through `withTarget` which creates an `IpodTarget` —
 * but the prediction's `deviceHasArtwork = albumHasArt` claim is now valid
 * for any device whose `artworkSink` writes (database / embedded). TASK-372
 * collapsed the per-container split: setArtworkFromData lands on iPod,
 * updateTrack({ embeddedPictureData }) lands on every mass-storage embedded
 * container via node-taglib-sharp. A future mass-storage Subsonic sweep
 * still needs to filter sidecar-primary devices (the writer is deferred to
 * TASK-370), but the iPod-only branching this predictor used to need is
 * gone.
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

/**
 * A transfer-mode × format × device cell.
 *
 * Pre-TASK-370 this was iPod-only (`TRANSFER_ART_DEVICE = 'ipod-MA147'`); the
 * transfer-mode rules only made sense for a database-artwork device because
 * mass-storage's file body IS the artwork. With sidecar-primary devices
 * (rockbox) landing the peer cover, the matrix now sweeps device too:
 *
 *   - iPod (database): same iTunesDB-vs-file-body gap as before.
 *   - rockbox (sidecar): the peer cover lands in every transfer mode at
 *     `artworkMaxResolution`; the file body's embedded copy follows the
 *     transcode/copy + transfer-mode rules (strip / preserve), with no
 *     embedded-art-only short-circuit.
 *
 * Embedded-primary devices (echo-mini / generic) stay out of this sweep —
 * the resize matrix covers them.
 */
export interface TransferArtCell {
  device: DeviceId;
  format: Format;
  transferMode: TransferMode;
}

/** Devices the transfer-artwork matrix sweeps. */
export const TRANSFER_ART_DEVICE_IDS: readonly DeviceId[] = ['ipod-MA147', 'ms-rockbox'];

export function transferArtCells(): TransferArtCell[] {
  const cells: TransferArtCell[] = [];
  for (const device of TRANSFER_ART_DEVICE_IDS) {
    for (const transferMode of TRANSFER_MODES) {
      for (const format of FORMATS) {
        cells.push({ device, format, transferMode });
      }
    }
  }
  return cells;
}
export function transferArtCellKey(cell: TransferArtCell): string {
  return `${cell.device}/${cell.transferMode}/${cell.format}`;
}
export function transferArtCellLabel(cell: TransferArtCell): string {
  return `${cell.device} / ${cell.transferMode} / ${cell.format}`;
}

/**
 * Expected outcome for a transfer-mode artwork cell. Two artwork signals,
 * plus an optional peer cover for sidecar-primary devices:
 *
 *   - `dbHasArtwork` — the cover in the iTunesDB. Always present on iPod
 *     (the source has art); `null` on non-database devices because there's
 *     no second store to compare against.
 *   - `fileHasArt` — the written file still carries an embedded cover.
 *     Driven by `fileArtworkSurvives`: database devices follow transfer
 *     mode, sidecar devices always strip (the file body is redundant when
 *     a peer cover lives next to it).
 *   - `sidecarPresent` / `sidecarSize` — the peer `cover.jpg` written by
 *     `adapter.writeSidecar` on sidecar-primary devices. `null` for
 *     non-sidecar devices (no peer to look for).
 */
export interface TransferArtExpected extends CellExpectation {
  trackPresent: boolean;
  /** iTunesDB cover — `true` on iPod with source art, `null` elsewhere. */
  dbHasArtwork: boolean | null;
  /** The written file still carries an embedded cover. */
  fileHasArt: boolean;
  /** Peer `cover.jpg` exists in the album dir (sidecar-primary only). */
  sidecarPresent: boolean | null;
  /**
   * Sidecar cover edge length (px, square) — `expectedSidecarSize(source, caps)`.
   * `null` for non-sidecar-primary devices and when the cover is absent.
   */
  sidecarSize: number | null;
}

export interface TransferArtObserved extends Record<string, unknown> {
  trackPresent: boolean;
  dbHasArtwork: boolean | null;
  fileHasArt: boolean;
  sidecarPresent: boolean | null;
  sidecarSize: number | null;
}

/** Pipeline that yields both copy (mp3/aac) and transcode (rest) paths. */
const TRANSFER_ART_PIPELINE: Pipeline = 'transcode-aac';

/**
 * Transfer-mode × artwork, swept across device. Fixture is B-embedded so the
 * source always carries embedded art. The visible signals diverge across the
 * two stores per `fileArtworkSurvives` + `artworkPrimary`:
 *
 *   - iPod (database): the iTunesDB cover always lands. The file body keeps
 *     its embedded cover under `portable`, strips under `optimized`, and on
 *     `fast` keeps it only for the copy path (mp3/aac native to iPod).
 *   - rockbox (sidecar): the peer `cover.jpg` always lands at
 *     `artworkMaxResolution`. The file body's embedded cover follows the
 *     transcode/copy rule: `portable` keeps it (FFmpeg `-c:v copy`),
 *     `optimized`/`fast` strip it (`-vn`) — but `fast` keeps it on a
 *     direct copy because the file isn't re-muxed at all.
 *
 * This is the only matrix that reads on-device file bytes (`probeFileArtwork`)
 * and the new peer cover (`probeSidecarArtwork`); both are invisible to the
 * dry-run plan and to `TrackInfo.hasArtwork`.
 */
export function predictTransferArtwork(
  cell: TransferArtCell,
  _checkArtwork: boolean
): TransferArtExpected {
  const spec = DEVICE_SPEC_BY_ID[cell.device];
  const caps = spec.capabilities;
  const sourceHadArt = sourceEmbedsArt('B-embedded', cell.format);
  const action = deviceAction(cell.format, caps, TRANSFER_ART_PIPELINE, spec.kind);
  const isDatabase = caps.artworkSources[0] === 'database';
  const isSidecarPrimary = caps.artworkSources[0] === 'sidecar';
  const dbHasArtwork = isDatabase ? artworkReaches(sourceHadArt, caps) : null;
  const fileHasArt = fileArtworkSurvives(action, cell.transferMode, sourceHadArt, caps);
  // Sidecar predictions only apply to sidecar-primary devices. The reference
  // model returns null for non-sidecar; the matrix asserts null vs null on
  // those cells so a peer cover unexpectedly landing on iPod would surface.
  const sidecarPresent = isSidecarPrimary ? sourceHadArt : null;
  const sidecarSize =
    isSidecarPrimary && sourceHadArt
      ? expectedSidecarSize(MULTI_FORMAT_DEFAULT_COVER_SIZE, caps)
      : null;

  let reason: string;
  if (isDatabase) {
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
  } else if (isSidecarPrimary) {
    const sidecarPhrase = sourceHadArt
      ? `peer cover.jpg lands at artworkMaxResolution ${caps.artworkMaxResolution}`
      : 'no source art → no peer cover written';
    if (cell.transferMode === 'portable') {
      reason = `portable preserves the embedded cover in the file body; ${sidecarPhrase}`;
    } else if (cell.transferMode === 'optimized') {
      reason = `optimized strips the redundant file cover (${action}); ${sidecarPhrase}`;
    } else {
      reason =
        action === 'copy'
          ? `fast direct-copies the file → embedded cover rides along; ${sidecarPhrase}`
          : `fast strips the cover on the transcode path (-vn); ${sidecarPhrase}`;
    }
  } else {
    reason = `embedded-primary device should not be in the transfer-art sweep (use the resize matrix)`;
  }

  return {
    trackPresent: true,
    dbHasArtwork,
    fileHasArt,
    sidecarPresent,
    sidecarSize,
    reason,
  };
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
 * different `artworkMaxResolution` (generic 500, echo-mini 127), the iPod for
 * the database-artwork side, and rockbox for the sidecar-primary side.
 * Together they cover every artworkPrimary value the reference model knows
 * about, so a regression that hardcoded the wrong resize path or the wrong
 * max would show up on at least one of them.
 */
export const RESIZE_DEVICE_IDS: readonly DeviceId[] = [
  'ms-generic',
  'ms-echo-mini',
  'ipod-MA147',
  'ms-rockbox',
];

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
  /** Peer `cover.jpg` exists in the album dir (sidecar-primary only). */
  sidecarPresent: boolean | null;
  /**
   * Sidecar cover edge length (px) — `expectedSidecarSize(HIRES_COVER_SIZE, caps)`.
   * `null` for non-sidecar-primary devices and when the cover is absent.
   */
  sidecarSize: number | null;
}

export interface ResizeObserved extends Record<string, unknown> {
  fileArtPresent: boolean;
  width: number | null;
  height: number | null;
  dbArtWithinMax: boolean | null;
  sidecarPresent: boolean | null;
  sidecarSize: number | null;
}

/** Pipeline the resize matrix syncs under (gives copy + transcode paths on iPod). */
export const RESIZE_PIPELINE: Pipeline = 'transcode-aac';

/**
 * Artwork resize against `artworkMaxResolution`, swept across every transfer
 * mode and device — the artwork *size* must match the device's configuration
 * regardless of mode. The hires fixture's cover is 1024px (> every device max):
 *
 * - `ms-generic` (embedded, max 500) / `ms-echo-mini` (embedded, max 127): the
 *   file cover is kept and downscaled to the device max in **every** mode —
 *   transfer mode does not change an embedded device's resize.
 * - iPod (database, max 320): the file cover is left at the source 1024 where
 *   it survives (per `fileArtworkSurvives`: `portable`, or a `fast` direct
 *   copy) and stripped otherwise; either way the iTunesDB thumbnail is resized
 *   within 320 in **every** mode (`dbArtWithinMax`).
 * - rockbox (sidecar, max 320): the file body strips its embedded cover (the
 *   reference model says sidecar-primary devices never keep file-body art),
 *   AND a peer `cover.jpg` at 320 lands next to every track. The sidecar
 *   resize matches `expectedSidecarSize(HIRES_COVER_SIZE, caps)`.
 */
export function predictResize(cell: ResizeCell, _checkArtwork: boolean): ResizeExpected {
  const spec = DEVICE_SPEC_BY_ID[cell.device];
  const caps = spec.capabilities;
  const action = deviceAction(cell.format, caps, RESIZE_PIPELINE, spec.kind);
  const present = fileArtworkSurvives(action, cell.transferMode, true, caps);
  const size = present ? expectedFileArtworkSize(HIRES_COVER_SIZE, caps) : null;
  const primary = caps.artworkSources[0];
  const isEmbedded = primary === 'embedded';
  const isDatabaseArt = primary === 'database';
  const isSidecarPrimary = primary === 'sidecar';
  const sidecarSize = isSidecarPrimary ? expectedSidecarSize(HIRES_COVER_SIZE, caps) : null;

  let reason: string;
  if (isEmbedded) {
    reason = `embedded-art device → file cover kept and downscaled to artworkMaxResolution ${caps.artworkMaxResolution} (from ${HIRES_COVER_SIZE}) in every mode`;
  } else if (isSidecarPrimary) {
    const fileBodyPhrase = present
      ? `file body preserves the embedded cover at source ${HIRES_COVER_SIZE} (${action})`
      : `file body strips the embedded cover (${action})`;
    reason = `sidecar-primary device: ${fileBodyPhrase}; peer cover.jpg at artworkMaxResolution ${caps.artworkMaxResolution} (from ${HIRES_COVER_SIZE}) lands in every mode`;
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
    sidecarPresent: isSidecarPrimary ? true : null,
    sidecarSize,
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
 * Transfer-mode artwork pass for ONE (device, mode): sync the embedded
 * fixture with `--transfer-mode <mode>` onto a fresh target, then read each
 * artwork signal. Returns per-format observed, keyed by `transferArtCellKey`.
 *
 * Three observation channels:
 *   - `dbHasArtwork`: iTunesDB cover (iPod only — `null` elsewhere).
 *   - `fileHasArt`: on-device file's embedded cover via `probeFileArtwork`.
 *   - `sidecarPresent` / `sidecarSize`: peer `cover.jpg` next to the audio
 *     file via `probeSidecarArtwork` — only meaningful on sidecar-primary
 *     devices (`null` on iPod, where there's no peer cover to probe).
 */
export async function observeTransferArtwork(opts: {
  target: SyncTarget;
  configPath: string;
  device: DeviceId;
  transferMode: TransferMode;
  checkArtwork: boolean;
}): Promise<Map<string, TransferArtObserved>> {
  const { target, configPath, device: deviceId, transferMode, checkArtwork } = opts;
  const spec = DEVICE_SPEC_BY_ID[deviceId];
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
      `transfer-mode sync failed (${deviceId}, ${transferMode}, checkArtwork=${checkArtwork}): exit=${result.exitCode}\n` +
        `  json: ${JSON.stringify(json, null, 2)}\n` +
        `  stderr: ${result.stderr}`
    );
  }

  const deviceTracks = await target.getTracks();
  const fileArt = await probeFileArtwork(target.musicRoot());
  const artist = SCENARIO_ARTIST['B-embedded'];
  // Database-artwork devices (iPod) get the DB signal; on others the cell
  // explicitly predicts `null` so observation matches.
  const isDatabase = spec.capabilities.artworkSources[0] === 'database';
  const isSidecarPrimary = spec.capabilities.artworkSources[0] === 'sidecar';
  // Album dir on the device: the multi-format fixture's album tag is
  // `${albumCategory} (Embedded)`; we don't need to predict it precisely
  // because every track on the B-embedded variant is in the *same* album dir.
  // We discover it by walking the music root once and finding the directory
  // containing any of our format files. Cheap: O(albums on device).
  const sidecarAlbumDirs = isSidecarPrimary ? await findAlbumDirsUnder(target.musicRoot()) : [];

  const byKey = new Map<string, TransferArtObserved>();
  for (const format of FORMATS) {
    const title = FORMAT_TITLE[format];
    const device = findDeviceTrack(deviceTracks, artist, title);
    const file = fileArt.get(trackId(artist, title));
    let sidecarPresent: boolean | null = null;
    let sidecarSize: number | null = null;
    if (isSidecarPrimary) {
      // The fixture has ONE album dir containing every format; the peer
      // cover lives there. Probe the first album dir we found (any will do
      // — they all share the same cover).
      const albumDir = sidecarAlbumDirs[0];
      if (albumDir !== undefined) {
        const cover = await probeSidecarArtwork(target.musicRoot(), albumDir);
        sidecarPresent = cover.present;
        // For the resize matrix the size assertion is pixel-perfect; here
        // we report width as the dimension signal (cover is square) so a
        // single `width === height === expectedSidecarSize` check holds.
        sidecarSize = cover.width;
      } else {
        sidecarPresent = false;
      }
    }
    byKey.set(transferArtCellKey({ device: deviceId, format, transferMode }), {
      trackPresent: device !== undefined,
      dbHasArtwork: device ? (isDatabase ? device.hasArtwork : null) : null,
      fileHasArt: file?.hasEmbeddedArt ?? false,
      sidecarPresent,
      sidecarSize,
    });
  }
  return byKey;
}

/**
 * Walk a device music root and return the relative paths of every leaf
 * directory that contains at least one audio file. Used to find the album
 * dir where a sidecar `cover.jpg` should live without hardcoding the path
 * template (which differs across mass-storage presets).
 */
async function findAlbumDirsUnder(musicRoot: string): Promise<string[]> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const audioExt = new Set(['.flac', '.mp3', '.m4a', '.opus', '.ogg', '.wav', '.aiff', '.aif']);
  const albumDirs = new Set<string>();
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const dot = entry.name.lastIndexOf('.');
        if (dot !== -1 && audioExt.has(entry.name.slice(dot).toLowerCase())) {
          albumDirs.add(path.relative(musicRoot, path.dirname(full)));
        }
      }
    }
  }
  await walk(musicRoot);
  return [...albumDirs];
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
  const primary = caps.artworkSources[0];
  const isDatabaseArt = primary === 'database';
  const isSidecarPrimary = primary === 'sidecar';
  const dbArt = isDatabaseArt ? await probeIpodDbArtwork(target.path) : new Map<string, number>();
  const max = caps.artworkMaxResolution;
  // Sidecar-primary devices write peer cover.jpg per album. The hires fixture
  // has ONE album dir containing every format; probe the first album dir we
  // find. All anchor tracks share the same peer cover.
  const sidecarAlbumDirs = isSidecarPrimary ? await findAlbumDirsUnder(target.musicRoot()) : [];
  const sidecarCover =
    isSidecarPrimary && sidecarAlbumDirs[0] !== undefined
      ? await probeSidecarArtwork(target.musicRoot(), sidecarAlbumDirs[0])
      : null;

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
      // The peer cover is per-album, not per-track; every anchor format on
      // this album sees the same observation.
      sidecarPresent: isSidecarPrimary ? (sidecarCover?.present ?? false) : null,
      sidecarSize: isSidecarPrimary ? (sidecarCover?.width ?? null) : null,
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
