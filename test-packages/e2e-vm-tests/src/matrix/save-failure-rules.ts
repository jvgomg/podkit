/**
 * Save-failure concern — predict() + cell + expected/observed shapes.
 *
 * The save-failure matrix sweeps capability shape × source format × codec
 * config × transfer mode × failure mode, asserting four to five observations
 * per cell:
 *
 *   1. Whether the planner's pre-flight (free-space check, etc.) intercepts
 *      the failure BEFORE `save()` runs. When it does, the sync exits with
 *      `{success: false, error: "..."}` and a synthetic `errors[]` entry
 *      (post-TASK-378 AC #8: e.g. `class: 'NotEnoughSpacePlanTime'`) —
 *      the typed save() error path is unreachable for this cell, but the
 *      envelope still carries structured detail.
 *   2. Typed error class thrown out of `save()` (or `null` when the planner
 *      pre-flight intercepted, or when the failure surfaces only as a
 *      categorized executor error).
 *   3. Partial device-state shape after the throw — what landed on disk
 *      before the fault tripped.
 *   4. Whether the next sync (after fault cleanup) re-fires an `add-*` or
 *      `upgrade-*` op for the un-landed tracks.
 *   5. Whether `podkit doctor --json` surfaces `.podkit-tmp` orphans from a
 *      torn atomic write or other debris.
 *
 * @module
 */

import type { CellExpectation } from './harness.js';

// ---------------------------------------------------------------------------
// Capability shapes
// ---------------------------------------------------------------------------

/**
 * Capability shape table — three synthesised flavours of the mass-storage
 * `generic` preset, varied along the artwork + codec + audio-normalization
 * axes. Cells reference these by id; the test harness materialises them
 * into a `[devices.<name>]` config override.
 *
 * Shape names are capability-derived (NOT model-derived) — adding a new
 * shape means adding a new entry here, not minting a new device fixture.
 */
export const CAPABILITY_SHAPES = {
  embedded: {
    deviceType: 'generic' as const,
    artworkSources: ['embedded'] as const,
    supportedAudioCodecs: ['flac', 'mp3', 'aac'] as const,
    audioNormalization: 'replaygain' as const,
  },
  'embedded-vorbis': {
    deviceType: 'generic' as const,
    artworkSources: ['embedded'] as const,
    supportedAudioCodecs: ['vorbis', 'mp3', 'aac'] as const,
    audioNormalization: 'none' as const,
  },
  'sidecar-mixed': {
    deviceType: 'generic' as const,
    artworkSources: ['sidecar', 'embedded'] as const,
    supportedAudioCodecs: ['flac', 'mp3', 'aac', 'vorbis'] as const,
    audioNormalization: 'replaygain' as const,
  },
  // iPod shapes (Stage C). Device type `ipod` — capabilities are read from
  // the on-device iTunesDB, not config overrides; the cell pins which model
  // gpod-tool initialises so podkit resolves the matching capability set.
  // `ipodModel` is the gpod-tool `--model` argument (model number, no `M/MP/F`
  // prefix per gpod-tool's convention). `9160` = iPod mini 1G (no artwork);
  // `MA147` = iPod Video 5G (artwork via ArtworkDB).
  'ipod-noart': {
    deviceType: 'ipod' as const,
    ipodModel: '9160' as const,
    artworkSources: [] as const,
    supportedAudioCodecs: ['aac', 'mp3'] as const,
    audioNormalization: 'soundcheck' as const,
  },
  'ipod-artwork': {
    deviceType: 'ipod' as const,
    ipodModel: 'MA147' as const,
    artworkSources: ['database'] as const,
    supportedAudioCodecs: ['aac', 'mp3', 'alac', 'wav', 'aiff'] as const,
    audioNormalization: 'soundcheck' as const,
  },
} as const;

export type CapabilityShape = keyof typeof CAPABILITY_SHAPES;

// ---------------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------------

/** Source-track audio format. Phase C.2 fans out FLAC + OGG. Stage C adds MP3 for iPod cells. */
export type SourceFormat = 'flac' | 'ogg' | 'mp3';

/**
 * Codec config — the lossy preference stack plus the resolved quality label
 * that drives copy-vs-transcode. `prefer-copy` = `quality=max` + lossless
 * stack `['source']`. `transcode-aac` = `quality=high` + lossy `['aac']`.
 */
export type CodecConfig = 'prefer-copy' | 'transcode-aac';

/** Transfer mode. Stage C extends with `portable` (iPod warn-only path). */
export type TransferMode = 'fast' | 'portable';

/**
 * Failure mode — provisioned via SystemState (`enospc`) or a chmod fault
 * (`track-readonly` / `album-readonly` / `cover-collision` /
 * `manifest-dir-readonly` / `itunesdb-readonly` / `move-parent-readonly`).
 */
export type FailureMode =
  | 'enospc'
  | 'enospc-post-sweep'
  | 'enospc-estimate-drift'
  | 'track-readonly'
  | 'album-readonly'
  | 'cover-collision'
  | 'manifest-dir-readonly'
  | 'itunesdb-readonly'
  | 'move-parent-readonly';

/**
 * Resolved sync-path the planner picks: direct copy of the source body,
 * an FFmpeg-passthrough copy (re-mux), or a full transcode to AAC.
 */
export type SyncPath = 'direct-copy' | 'optimized-copy' | 'transcode-aac';

// ---------------------------------------------------------------------------
// Cell
// ---------------------------------------------------------------------------

export interface SaveFailCell {
  shape: CapabilityShape;
  sourceFormat: SourceFormat;
  codecConfig: CodecConfig;
  transferMode: TransferMode;
  failureMode: FailureMode;
}

export function saveFailCellKey(cell: SaveFailCell): string {
  return `${cell.shape}/${cell.sourceFormat}/${cell.codecConfig}/${cell.transferMode}/${cell.failureMode}`;
}

export function saveFailCellLabel(cell: SaveFailCell): string {
  return `${cell.shape} / ${cell.sourceFormat} / ${cell.codecConfig} / ${cell.transferMode} / ${cell.failureMode}`;
}

// ---------------------------------------------------------------------------
// SyncPath derivation (reference model)
// ---------------------------------------------------------------------------

/** Source format → device codec name. */
const FORMAT_CODEC: Record<SourceFormat, string> = {
  flac: 'flac',
  ogg: 'vorbis',
  mp3: 'mp3',
};

const LOSSLESS_FORMATS: ReadonlySet<SourceFormat> = new Set(['flac']);

/**
 * Predict the syncPath the planner will pick for a (shape, source format,
 * codec config, transfer mode) combination. Mirrors the e2e host matrix's
 * `codecOutcome` + `copyOpKind` logic without importing from
 * `@podkit/e2e-tests` (the VM test package deliberately avoids that
 * dependency).
 */
export function derivedSyncPath(
  shape: CapabilityShape,
  sourceFormat: SourceFormat,
  codecConfig: CodecConfig,
  transferMode: TransferMode
): SyncPath {
  const caps = CAPABILITY_SHAPES[shape];
  const codec = FORMAT_CODEC[sourceFormat];
  const deviceNative = caps.supportedAudioCodecs.includes(codec as never);
  const isLossless = LOSSLESS_FORMATS.has(sourceFormat);
  const resolvedQuality: 'lossless' | 'high' = codecConfig === 'prefer-copy' ? 'lossless' : 'high';
  const forcedLossyDowngrade = isLossless && resolvedQuality !== 'lossless';
  const action: 'copy' | 'transcode' = deviceNative && !forcedLossyDowngrade ? 'copy' : 'transcode';

  if (action === 'transcode') return 'transcode-aac';

  // Embedded-primary artwork → re-mux via FFmpeg passthrough (optimized-copy).
  if (caps.artworkSources[0] === 'embedded') return 'optimized-copy';
  // `transferMode` is currently fixed to 'fast'; the branch is left wired
  // so future modes (e.g. 'optimized') route through optimized-copy.
  void transferMode;
  return 'direct-copy';
}

// ---------------------------------------------------------------------------
// Expectation / observation shapes
// ---------------------------------------------------------------------------

export type ThrowsClass =
  | 'MoveError'
  | 'CopyError'
  | 'TagWriteError'
  | 'PictureWriteError'
  | 'SidecarWriteError'
  | 'DatabaseWriteError'
  | 'InsufficientSpaceAfterCleanup'
  | null;

export type ErrorCategory =
  | 'copy'
  | 'transcode'
  | 'database'
  | 'artwork'
  | 'space'
  | 'unknown'
  | null;

export type PartialDeviceState =
  | 'no-files-landed'
  | 'no-tracks-landed'
  | 'some-tracks-landed'
  | 'all-tracks-landed'
  | 'file-copied-tags-old'
  | 'file-copied-no-tags-no-pictures'
  | 'file-copied-no-sidecar'
  | 'file-copied-manifest-stale'
  | 'preseed-only'
  | 'preseed-plus-new-file'
  | 'database-stale';

/** Observation envelope per cell. */
export interface SaveFailObserved extends Record<string, unknown> {
  /** Did the planner-level pre-flight intercept before save()? */
  plannerRejects: boolean;
  /** Typed error class thrown out of save(), or null. */
  throwsClass: ThrowsClass;
  /** Category recovered from the surfaced error envelope. */
  errorCategory: ErrorCategory;
  /** Partial device-state shape after the throw. */
  partialDeviceState: PartialDeviceState;
  /** Does the next dry-run sync re-fire an `add-*` or `upgrade-*` op? */
  rescanRefiresAddOrUpgrade: boolean;
  /**
   * Does the doctor surface `.podkit-tmp` orphans (debris from a torn atomic
   * copy)? `false` when no debris is detectable; `null` when the doctor
   * invocation produced no parseable output.
   */
  doctorSeesPodkitTmp: boolean | null;
  /**
   * Top-level `error:` field on the sync JSON envelope — populated by the
   * planner pre-flight on a refusal; absent on a save() typed throw.
   */
  errorMessage?: string;
  /**
   * Number of failed-track entries the sync reported (the "Failed: N
   * track(s)" line, or the count of `[<category>]` blocks under it).
   * For Stage D — pinning the MoveError throw-on-first asymmetry: even when
   * two tracks queued relocates, only the first failure surfaces.
   */
  failedTrackCount: number;
  /**
   * Whether the sync surfaced a warning entry attributed to portable tag
   * write (iPod portable mode, file-tag soft-warn path). True only when
   * the warning is present; false when no such warning is observed.
   */
  portableTagWarn: boolean;
  /**
   * Typed-error detail recovered from `sync --json`'s errors[] envelope for
   * the ADR-018 post-sweep cell. Populated only when the surfaced error
   * class is `InsufficientSpaceAfterCleanup`; absent otherwise.
   *
   * The fields mirror the typed-error payload shape in
   * `packages/podkit-core/src/sync/engine/errors.ts` so the matrix can
   * assert the structured `bytesFreedBySweep` + `failedSweepPaths` carry
   * through to the CLI consumer.
   */
  postSweepDetail?: {
    bytesFreedBySweep: number;
    failedSweepPathsCount: number;
  } | null;
  /** Free-form debug echo on mismatch — diff renderer surfaces this verbatim. */
  debug?: unknown;
}

export interface SaveFailExpected extends CellExpectation {
  plannerRejects: boolean;
  throwsClass: ThrowsClass;
  errorCategory: ErrorCategory;
  partialDeviceState: PartialDeviceState;
  rescanRefiresAddOrUpgrade: boolean;
  doctorSeesPodkitTmp: boolean | null;
  /**
   * Regex the planner-pre-flight `error:` field must match. Set only when
   * `plannerRejects === true`. The harness's diff comparator matches the
   * regex against `observed.errorMessage`; `null` means "no constraint"
   * (used by cells where plannerRejects=false).
   */
  errorMessageMatches: RegExp | null;
  /**
   * Expected count of failed-track entries the sync should report. Most
   * cells have 1 (single-cause aggregate, one track per sync). Stage D
   * pins the MoveError throw-on-first asymmetry: even when 2+ tracks
   * queued relocates, only 1 failure surfaces. `null` = no constraint.
   */
  failedTrackCount: number | null;
  /**
   * Expected value for `observed.portableTagWarn`. Default false. iPod
   * portable cells expect true: file-tag failure surfaces as a warning,
   * not a thrown error.
   */
  portableTagWarn: boolean;
  /**
   * Expected typed-error payload detail. Set only by the ADR-018 post-sweep
   * cell where the typed `InsufficientSpaceAfterCleanup` envelope carries
   * structured fields the matrix wants to pin. Omitted for every other
   * cell — the diff comparator skips missing keys.
   */
  postSweepDetail?: {
    bytesFreedBySweep: number;
    failedSweepPathsCount: number;
  } | null;
}

// ---------------------------------------------------------------------------
// Cells — Phase C.2 fan-out
// ---------------------------------------------------------------------------

const MASS_STORAGE_SHAPES: readonly CapabilityShape[] = [
  'embedded',
  'embedded-vorbis',
  'sidecar-mixed',
];
const IPOD_SHAPES: readonly CapabilityShape[] = ['ipod-noart', 'ipod-artwork'];
const MASS_STORAGE_FORMATS: readonly SourceFormat[] = ['flac', 'ogg'];
const IPOD_FORMATS: readonly SourceFormat[] = ['flac', 'mp3'];
const CODEC_CONFIGS: readonly CodecConfig[] = ['prefer-copy', 'transcode-aac'];
const FAILURE_MODES_CHMOD: readonly FailureMode[] = [
  'track-readonly',
  'album-readonly',
  'cover-collision',
  'manifest-dir-readonly',
  'move-parent-readonly',
];

function generateFanOut(): SaveFailCell[] {
  const cells: SaveFailCell[] = [];
  // ENOSPC cell — Phase C.1 (Option A): embedded shape × FLAC × prefer-copy × fast.
  // Pins the plan-time pre-flight envelope path.
  cells.push({
    shape: 'embedded',
    sourceFormat: 'flac',
    codecConfig: 'prefer-copy',
    transferMode: 'fast',
    failureMode: 'enospc',
  });
  // TASK-412: ADR-018 post-sweep recompute cell — embedded × flac × prefer-copy × fast.
  // Pins the path where the plan-time gate passes (free + debrisCleanup
  // covers the estimate), the sweep partially fails (chattr-immutable
  // debris files survive rm), and the post-sweep statfs recompute throws
  // InsufficientSpaceAfterCleanup before any track is attempted.
  cells.push({
    shape: 'embedded',
    sourceFormat: 'flac',
    codecConfig: 'prefer-copy',
    transferMode: 'fast',
    failureMode: 'enospc-post-sweep',
  });
  // TASK-412: estimate-drift cell — embedded × mp3 × prefer-copy × fast.
  // Pins the path where both the plan-time gate AND the post-sweep gate
  // pass (the planner's typical-bitrate estimate fits the mount free)
  // but the source mp3's actual bytes exceed it, so the transfer phase
  // atomic copy ENOSPCs mid-write. Raw fs error → no typed wrap on this
  // path; categorized as `'copy'` via operation-type fallback.
  cells.push({
    shape: 'embedded',
    sourceFormat: 'mp3',
    codecConfig: 'prefer-copy',
    transferMode: 'fast',
    failureMode: 'enospc-estimate-drift',
  });
  // Mass-storage chmod-based fan-out (Phase C.2 + Stage D).
  for (const shape of MASS_STORAGE_SHAPES) {
    for (const sourceFormat of MASS_STORAGE_FORMATS) {
      for (const codecConfig of CODEC_CONFIGS) {
        for (const failureMode of FAILURE_MODES_CHMOD) {
          cells.push({
            shape,
            sourceFormat,
            codecConfig,
            transferMode: 'fast',
            failureMode,
          });
        }
      }
    }
  }
  // iPod fan-out (Stage C): itunesdb-readonly across (ipod-noart, ipod-artwork)
  // × (flac, mp3) × prefer-copy × fast. Plus one portable + track-readonly
  // cell per iPod shape for the warn-only path.
  for (const shape of IPOD_SHAPES) {
    for (const sourceFormat of IPOD_FORMATS) {
      cells.push({
        shape,
        sourceFormat,
        codecConfig: 'prefer-copy',
        transferMode: 'fast',
        failureMode: 'itunesdb-readonly',
      });
    }
    // Portable warn-only: one cell per iPod shape (mp3 to keep the iPod
    // file system writes minimal; FLAC would be transcoded to AAC and the
    // warn-path semantics are codec-agnostic).
    cells.push({
      shape,
      sourceFormat: 'mp3',
      codecConfig: 'prefer-copy',
      transferMode: 'portable',
      failureMode: 'track-readonly',
    });
  }
  return cells;
}

export const SAVE_FAIL_CELLS: readonly SaveFailCell[] = generateFanOut();

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

/**
 * Predict observation envelope for a (shape × format × codec × transfer ×
 * failure) cell.
 *
 * ENOSPC special case: the planner-level pre-flight free-space check
 * intercepts BEFORE `save()` can fire its typed errors — see
 * `documents/architecture/sync/planning.md` "Free-space contract —
 * plan-time" + `save-transactions.md` "Free-space contract — execute-
 * time". This cell pins the plan-time envelope path; the ADR-018
 * post-sweep recompute path (sweep partial-fail + still insufficient)
 * is structurally not reachable from a device-mount-near-full mount
 * because the plan-time gate fires first. The post-sweep recompute
 * cell needs its own SystemState variant (mount sized to fit estimate
 * + a fault that makes the sweep partially recoverable) — tracked as
 * follow-up work.
 */
export function predictSaveFail(cell: SaveFailCell): SaveFailExpected {
  if (cell.failureMode === 'enospc') {
    return predictEnospc(cell);
  }
  if (cell.failureMode === 'enospc-post-sweep') {
    return predictPostSweep(cell);
  }
  if (cell.failureMode === 'enospc-estimate-drift') {
    return predictEstimateDrift(cell);
  }
  return predictChmodFault(cell);
}

function predictEnospc(cell: SaveFailCell): SaveFailExpected {
  return {
    plannerRejects: true,
    throwsClass: null,
    errorCategory: null,
    partialDeviceState: 'no-files-landed',
    rescanRefiresAddOrUpgrade: true,
    doctorSeesPodkitTmp: false,
    errorMessageMatches: /^Not enough space\. Need [0-9.]+ [KMGT]?B, have [0-9.]+ [KMGT]?B$/,
    failedTrackCount: 0,
    portableTagWarn: false,
    postSweepDetail: null,
    reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × ENOSPC — planner pre-flight intercepts ENOSPC before save() can fire its typed errors (see planning.md + save-transactions.md "Free-space contract" subsections). Sync exits with envelope-level "Not enough space..." plus a synthetic NotEnoughSpacePlanTime entry in errors[] (TASK-378 AC #8); post-cleanup rescan re-queues the unwritten add ops.`,
  };
}

/**
 * ADR-018 post-sweep recompute cell (TASK-412).
 *
 * The mount carries chattr-immutable `.podkit-tmp` debris under the Music
 * content path. Plan-time envelope `free + debrisCleanup.totalBytes`
 * covers the source's `estimateCopySize`, but the per-path `rm` in
 * `runPreliminariesPreFlight` returns EPERM for every immutable file, so
 * `freedBytes = 0` and `failedSweepPaths.length = 2`. The post-sweep
 * `statfsSync` reads the original free, which is below the estimate, and
 * `assertSpaceAfterSweep` throws `InsufficientSpaceAfterCleanup`.
 */
function predictPostSweep(cell: SaveFailCell): SaveFailExpected {
  return {
    plannerRejects: false,
    throwsClass: 'InsufficientSpaceAfterCleanup',
    errorCategory: 'space',
    partialDeviceState: 'no-files-landed',
    rescanRefiresAddOrUpgrade: true,
    // The fault setup chattr +i's two pre-seeded `.podkit-tmp` files so the
    // per-path rm in `runPreliminariesPreFlight` returns EPERM. Those tmps
    // survive on disk, and after TASK-413's helper fix (which correctly
    // reads `debris-files-mass-storage` instead of the legacy
    // `orphan-files-mass-storage`) doctor sees them as debris → `true`.
    // Previously masked because the helper queried the wrong check ID and
    // returned `false` for any cell with leftover .podkit-tmp residue.
    doctorSeesPodkitTmp: true,
    errorMessageMatches: /^Not enough space after debris cleanup\./,
    failedTrackCount: 0,
    portableTagWarn: false,
    postSweepDetail: {
      bytesFreedBySweep: 0,
      failedSweepPathsCount: 2,
    },
    reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × ENOSPC-post-sweep — ADR-018 post-sweep statfs recompute fires when the sweep cannot recover the bytes the plan-time envelope counted on. Two chattr-immutable .podkit-tmp files survive the per-path rm (EPERM), so freedBytes stays 0 and freshFree shows the original (insufficient) free. Throws InsufficientSpaceAfterCleanup before any track is attempted; rescan re-fires the unwritten add ops. The surviving .podkit-tmp tmps are visible to doctor's debris-files-mass-storage check (doctorSeesPodkitTmp: true).`,
  };
}

/**
 * Estimate-drift mid-save cell (TASK-412).
 *
 * Mount sized to fit `estimateCopySize` (typical-bitrate × duration) but
 * not the source's actual bytes. Plan-time + post-sweep gates both pass;
 * the transfer-phase `atomicCopyFile` ENOSPCs mid-write. The raw fs error
 * is wrapped in a typed `CopyError extends CategorizedSyncError` at the
 * `MassStorageAdapter.copyTrackFile` boundary, so `categorizeError` reads
 * `'copy'` off the class (not via operation-type fallback) and the
 * underlying errno survives on `CopyError.errorCode`.
 */
function predictEstimateDrift(cell: SaveFailCell): SaveFailExpected {
  return {
    plannerRejects: false,
    throwsClass: 'CopyError',
    errorCategory: 'copy',
    partialDeviceState: 'no-files-landed',
    rescanRefiresAddOrUpgrade: true,
    // Atomic copy writes to `<target>.podkit-tmp` then renames on success;
    // an ENOSPC mid-write throws BEFORE the rename, but the tmp file may
    // survive. The `rm` cleanup is the helper's responsibility — check
    // doctor for the residual.
    doctorSeesPodkitTmp: false,
    errorMessageMatches: null,
    // `add-direct-copy` retries once via DEFAULT_RETRY_CONFIG.copy=1, so
    // the same track surfaces twice in failure count terms — but the
    // CLI's "Failed: N tracks" header counts unique tracks, not attempts.
    // Use `null` to skip the numeric assertion until we observe the real
    // behaviour against the VM.
    failedTrackCount: null,
    portableTagWarn: false,
    postSweepDetail: null,
    reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × ENOSPC-estimate-drift — plan-time + post-sweep gates both pass (mount fits estimateCopySize prediction) but the 320kbps mp3 source's actual bytes exceed the free space. Transfer-phase atomicCopyFile ENOSPCs mid-write; raw fs error wrapped in typed CopyError at the copyTrackFile boundary; categorizer reads 'copy' off the class. Rescan re-queues the un-landed add op.`,
  };
}

function predictChmodFault(cell: SaveFailCell): SaveFailExpected {
  const syncPath = derivedSyncPath(
    cell.shape,
    cell.sourceFormat,
    cell.codecConfig,
    cell.transferMode
  );
  const caps = CAPABILITY_SHAPES[cell.shape];
  const isSidecarPrimary = caps.artworkSources[0] === 'sidecar';
  const isEmbeddedPrimary = caps.artworkSources[0] === 'embedded';
  const isIpod = caps.deviceType === 'ipod';
  void isEmbeddedPrimary;

  switch (cell.failureMode) {
    case 'track-readonly': {
      // Pre-seed: first sync lands the file (managed). Source genre is
      // mutated. Second sync queues a tag-update diff on the managed file
      // (in-place taglib write). After TASK-376, `TagLibTagWriter.writeTags`
      // routes through `atomicWriteFileWithSync` (write sibling tmp → fsync
      // → renameat over target). A plain `chmod 0444` no longer trips the
      // write because the parent dir stays writable and rename ignores file
      // perms. The fault instead applies ext4's immutable bit (`chattr +i`)
      // to the target inode, which blocks both `unlinkat()` and the rename
      // overlay regardless of dir perms — EPERM surfaces inside the taglib
      // flush and the adapter wraps it as TagWriteError. The iPod portable
      // path soft-warns via WarningSink instead of throwing.
      if (isIpod && cell.transferMode === 'portable') {
        return {
          plannerRejects: false,
          throwsClass: null,
          errorCategory: null,
          partialDeviceState: 'preseed-only',
          rescanRefiresAddOrUpgrade: false,
          doctorSeesPodkitTmp: false,
          errorMessageMatches: null,
          failedTrackCount: 0,
          portableTagWarn: true,
          reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × track-readonly — iPod portable mode: iTunesDB is authoritative for playback; file tag write failure surfaces as a warning, not a thrown error. Pre-seeded; source mutated; chattr +i lands EPERM on the atomic rename in the in-place tag write; warning emitted via WarningSink (--json + summary).`,
        };
      }
      return {
        plannerRejects: false,
        throwsClass: 'TagWriteError',
        errorCategory: 'copy',
        partialDeviceState: 'preseed-only',
        rescanRefiresAddOrUpgrade: true,
        doctorSeesPodkitTmp: false,
        errorMessageMatches: null,
        failedTrackCount: 1,
        portableTagWarn: false,
        reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × track-readonly — syncPath=${syncPath}; pre-seed lands the file on first sync, source genre mutated, then chattr +i on the target inode blocks the second sync's atomic tag-write rename with EPERM → TagWriteError. The file body from first sync remains on disk with stale tags.`,
      };
    }

    case 'album-readonly': {
      // The album directory is chmod 0500 BEFORE the sync runs. Every
      // syncPath (direct-copy, optimized-copy, transcode-aac) ultimately
      // funnels through `MassStorageAdapter.copyTrackFile` to land the
      // (possibly transcoded) source body on the device. That call wraps
      // the raw fs EACCES in a typed CopyError, so the executor's
      // categorizer reads 'copy' off the class regardless of the operation
      // type — even add-transcode ops now classify as 'copy' here, NOT
      // 'transcode', because the failure mode is the device-side file copy
      // not the FFmpeg transcode itself (which succeeded into a temp dir).
      //
      // `failedTrackCount: null` because the executor's retry policy
      // generates an extra dedup-suffixed copy attempt — observed count
      // is 2 (1 original + 1 dedup-retry), but the underlying behaviour
      // we care about (no files land) is captured by partialDeviceState.
      void syncPath;
      return {
        plannerRejects: false,
        throwsClass: 'CopyError',
        errorCategory: 'copy',
        partialDeviceState: 'no-files-landed',
        rescanRefiresAddOrUpgrade: true,
        doctorSeesPodkitTmp: false,
        errorMessageMatches: null,
        failedTrackCount: null,
        portableTagWarn: false,
        reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × album-readonly — syncPath=${syncPath}; chmod 0500 on the album dir blocks copyTrackFile's atomic copy regardless of whether the source is a raw input (direct/optimized) or a transcoded temp (transcode-aac). Raw fs EACCES wrapped in typed CopyError at the adapter boundary; categorized 'copy' off the class. No files land. failedTrackCount unconstrained — the retry policy can produce dedup-suffixed phantom attempts that count separately.`,
      };
    }

    case 'cover-collision': {
      // A DIRECTORY exists at <album>/cover.jpg before the sync runs. Only
      // sidecar-primary shapes actually try to write a peer cover.jpg —
      // others would treat this as out-of-band debris and ignore it. For
      // sidecar-primary shapes the copy + tag stages succeed; the sidecar
      // write's atomic tmp+rename fails because rename(2) onto a dir
      // returns EISDIR. SidecarWriteError.
      if (!isSidecarPrimary) {
        // This combination is impossible — skipped at the cells level.
        return {
          plannerRejects: false,
          throwsClass: null,
          errorCategory: null,
          partialDeviceState: 'all-tracks-landed',
          rescanRefiresAddOrUpgrade: false,
          doctorSeesPodkitTmp: false,
          errorMessageMatches: null,
          failedTrackCount: 0,
          portableTagWarn: false,
          reason: `IMPOSSIBLE: ${cell.shape} does not write sidecars — the cover.jpg collision is invisible to save(). Skipped at cells.`,
        };
      }
      return {
        plannerRejects: false,
        throwsClass: 'SidecarWriteError',
        errorCategory: 'copy',
        partialDeviceState: 'file-copied-no-sidecar',
        // The sidecar write is flushed in save() AFTER tag writes. The sync tag
        // (including artworkHash) is written to the file tags before save() throws
        // SidecarWriteError. On the next scan the planner sees a track with a
        // matching artworkHash in its comment tag and produces zero diff — the
        // cover.jpg is missing but the planner has no way to detect it (it trusts
        // the artworkHash in the sync tag, not the filesystem). So the rescan does
        // NOT refire an add/upgrade op.
        rescanRefiresAddOrUpgrade: false,
        doctorSeesPodkitTmp: false,
        errorMessageMatches: null,
        failedTrackCount: 1,
        portableTagWarn: false,
        reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × cover-collision — syncPath=${syncPath}; <album>/cover.jpg pre-exists as a directory; source has embedded artwork so the pipeline reaches the sidecar write; sidecar tmp+rename fails with EISDIR → SidecarWriteError. Audio + tag stages succeed and the artworkHash sync tag is committed to the file BEFORE save() throws. Rescan does NOT refire: the planner trusts artworkHash in the sync tag and sees no diff (the missing cover.jpg is invisible to the planner).`,
      };
    }

    case 'manifest-dir-readonly': {
      // chmod 0500 on <mount>/.podkit/ BEFORE the sync. After TASK-404 the
      // per-device sync lock acquires `<mount>/.podkit/sync.lock` BEFORE any
      // track operation runs; the lock create hits EACCES on the read-only
      // dir. TASK-413 wraps that EACCES in a typed `LockUnavailableError`
      // which the sync orchestrator translates to a `CliError` (code
      // LOCK_UNAVAILABLE) emitted BEFORE save() ever runs. Symptoms:
      //   - syncExit: 1 with a clean stderr message (no JS stack trace).
      //   - No per-track error envelope → errorCategory: null,
      //     failedTrackCount: 0.
      //   - No files landed → partialDeviceState: 'no-files-landed' and the
      //     next dry-run sync re-fires the add op (rescan: true).
      // The old "copy succeeds; manifest write fails late" prediction
      // captured the pre-TASK-404 behaviour where the manifest write inside
      // save() was the first thing to hit .podkit/. With the lock now
      // gating the whole sync, the early-typed-failure path supersedes it.
      void syncPath;
      return {
        plannerRejects: false,
        throwsClass: null,
        errorCategory: null,
        partialDeviceState: 'no-files-landed',
        rescanRefiresAddOrUpgrade: true,
        doctorSeesPodkitTmp: false,
        errorMessageMatches: null,
        failedTrackCount: 0,
        portableTagWarn: false,
        reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × manifest-dir-readonly — TASK-413: the per-device sync lock at <mount>/.podkit/sync.lock cannot be created (.podkit/ is chmod 0555 → EACCES). Wrapped as LockUnavailableError → typed CliError (code LOCK_UNAVAILABLE) emitted BEFORE save() runs, so no per-track error envelope, no files landed, rescan still wants to add. Replaces the pre-TASK-404 "manifest write fails late" path.`,
      };
    }

    case 'itunesdb-readonly': {
      // iPod cell — first sync creates iPod_Control/iTunes/iTunesDB; chmod
      // 0555 on the iTunes/ dir blocks libgpod's tmp+rename for the
      // database write in save() stage 1. Wrapped as DatabaseWriteError.
      return {
        plannerRejects: false,
        throwsClass: 'DatabaseWriteError',
        errorCategory: 'database',
        partialDeviceState: 'database-stale',
        rescanRefiresAddOrUpgrade: true,
        // The failure happens inside libgpod's iTunesDB write (`.<DB>.<rand>`
        // sidecar; not a `.podkit-tmp`). After TASK-413 the
        // `doctorSeesPodkitTmp` helper inspects `debris-files-ipod`, which
        // walks for `.podkit-tmp` residue only — libgpod's tmp pattern is
        // ignored. So the check fires `pass` with empty debris and the
        // helper returns `false`, not `null`.
        doctorSeesPodkitTmp: false,
        errorMessageMatches: null,
        failedTrackCount: 1,
        portableTagWarn: false,
        reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × itunesdb-readonly — iPod cell. Pre-seed (first sync) wires up iTunesDB; chmod 0555 on the iTunes dir blocks the second sync's libgpod tmp+rename → save() stage 1 throws DatabaseWriteError (categorised 'database', no retry). New track was copied to disk but the database write didn't land. doctor's debris-files-ipod check sees no .podkit-tmp residue (libgpod's tmp pattern is not .podkit-tmp).`,
      };
    }

    case 'move-parent-readonly': {
      // Stage D — MoveError throw-on-first asymmetry. Pre-seed lands two
      // tracks on the device under their canonical paths. Source tracks
      // are mutated (album rename) so the second sync queues two relocates
      // to a NEW album dir. chmod 0555 on the new album's parent
      // (`<musicDir>/<artist>/`) blocks fs.renameSync in save() stage 1.
      //
      // Throw-on-first: even though both relocates are queued, the loop
      // throws on the FIRST EACCES — `causes.length === 1`. The second
      // relocate never attempts. This pins the asymmetry doc-041 §3.3
      // describes (settle-all for tag/picture/sidecar; throw-on-first for
      // move).
      return {
        plannerRejects: false,
        throwsClass: 'MoveError',
        errorCategory: 'copy',
        partialDeviceState: 'preseed-only',
        rescanRefiresAddOrUpgrade: true,
        doctorSeesPodkitTmp: false,
        errorMessageMatches: null,
        failedTrackCount: 1,
        portableTagWarn: false,
        reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × move-parent-readonly — pre-seed lands 2 managed tracks; source mutated so the planner queues 2 relocates to a new artist/album path; chmod 0555 on the destination's parent dir blocks fs.renameSync. Throw-on-first: only the first relocate's EACCES surfaces as MoveError; the second never runs. Pinning the asymmetry: 2 relocates queued, 1 failure surfaced.`,
      };
    }

    default: {
      throw new Error(`predictChmodFault: unhandled failure mode "${cell.failureMode as string}"`);
    }
  }
}
