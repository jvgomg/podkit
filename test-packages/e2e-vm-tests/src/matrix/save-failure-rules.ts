/**
 * Save-failure concern — predict() + cell + expected/observed shapes.
 *
 * The save-failure matrix sweeps capability shape × source format × codec
 * config × transfer mode × failure mode, asserting four to five observations
 * per cell:
 *
 *   1. Whether the planner's pre-flight (free-space check, etc.) intercepts
 *      the failure BEFORE `save()` runs. When it does, the sync exits with
 *      `{success: false, error: "..."}` and NO `errors[]` array — the typed
 *      save() error is unreachable for this cell.
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
  | 'TagWriteError'
  | 'PictureWriteError'
  | 'SidecarWriteError'
  | 'DatabaseWriteError'
  | null;

export type ErrorCategory = 'copy' | 'transcode' | 'database' | 'artwork' | 'unknown' | null;

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
  cells.push({
    shape: 'embedded',
    sourceFormat: 'flac',
    codecConfig: 'prefer-copy',
    transferMode: 'fast',
    failureMode: 'enospc',
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
 * `save-transactions.md` and TASK-378 for the broader free-space-handling
 * audit. Until that audit lands, the matrix pins the current behaviour
 * (envelope-only `error: "Not enough space..."`, no `errors[]`) rather
 * than predicting the typed throw path that is unreachable today.
 */
export function predictSaveFail(cell: SaveFailCell): SaveFailExpected {
  if (cell.failureMode === 'enospc') {
    return predictEnospc(cell);
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
    reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × ENOSPC — planner pre-flight intercepts ENOSPC before save() can fire its typed errors (see save-transactions.md and TASK-378). Sync exits with envelope-level "Not enough space..." and no errors[] array; post-cleanup rescan re-queues the unwritten add ops.`,
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
      // Pre-seed: first sync lands the file (managed). Source title is
      // mutated. Second sync queues a tag-update diff on the managed file
      // (in-place taglib write). chmod 0444 makes the tag-write open() fail
      // with EACCES → TagWriteError. The PortableTagWriter path on iPod
      // soft-warns instead of throwing — surface as a warning.
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
          reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × track-readonly — iPod portable mode: iTunesDB is authoritative for playback; file tag write failure surfaces as a warning, not a thrown error. Pre-seeded; source mutated; chmod 0444 lands EACCES on the in-place tag write; warning emitted via WarningSink (--json + summary).`,
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
        reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × track-readonly — syncPath=${syncPath}; pre-seed lands the file on first sync, source title mutated, then chmod 0444 makes the second sync's in-place tag-write open() fail with EACCES → TagWriteError. The file body from first sync remains on disk with stale tags.`,
      };
    }

    case 'album-readonly': {
      // The album directory is chmod 0500 BEFORE the sync runs. The copy
      // stage cannot create the target file → fails before save() reaches
      // any tag/picture/sidecar stage. For sidecar-primary shapes the
      // sidecar write would also fail, but the copy fails first.
      //
      // The mass-storage adapter's copy stage runs OUTSIDE save() (in
      // copyTrackFile / atomicCopyFile), so the raw fs EACCES propagates
      // as a plain Error categorized by the executor to the operation type
      // that was running when the fault fired. When syncPath='optimized-copy'
      // or 'direct-copy', the file-copy op is categorized 'copy'. When
      // syncPath='transcode-aac', the FFmpeg transcode runs first (to a temp
      // output), then the atomic copy/rename into the album dir fails —
      // the executor categorizes that error as 'transcode' because the op
      // type is a transcode op.
      //
      // `failedTrackCount: null` because the executor's retry policy
      // generates an extra dedup-suffixed copy attempt — observed count
      // is 2 (1 original + 1 dedup-retry), but the underlying behaviour
      // we care about (no files land) is captured by partialDeviceState.
      const albumReadonlyCategory: ErrorCategory =
        syncPath === 'transcode-aac' ? 'transcode' : 'copy';
      return {
        plannerRejects: false,
        throwsClass: null,
        errorCategory: albumReadonlyCategory,
        partialDeviceState: 'no-files-landed',
        rescanRefiresAddOrUpgrade: true,
        doctorSeesPodkitTmp: false,
        errorMessageMatches: null,
        failedTrackCount: null,
        portableTagWarn: false,
        reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × album-readonly — syncPath=${syncPath}; chmod 0500 on the album dir blocks atomicCopyFile's mkdir/create before save() runs. Raw fs EACCES → categorized '${albumReadonlyCategory}' by operation-type fallback; no typed class. No files land. failedTrackCount unconstrained — the retry policy can produce dedup-suffixed phantom attempts that count separately.`,
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
      // chmod 0500 on <mount>/.podkit/ BEFORE the sync. Every other save()
      // stage runs to completion (copy, tag, picture, sidecar all succeed);
      // the final manifest write hits EACCES on the tmp file create inside
      // .podkit/. The manifest write currently propagates the raw fs error
      // (no typed class for manifest writes today), so it surfaces as a
      // plain Error categorized to whichever fallback bucket the executor
      // assigns. The category tracks the active operation type that triggered
      // the save(): 'copy' when the sync path was a direct/optimized copy op,
      // 'transcode' when the sync path was a transcode op.
      const manifestReadonlyCategory: ErrorCategory =
        syncPath === 'transcode-aac' ? 'transcode' : 'copy';
      return {
        plannerRejects: false,
        throwsClass: null,
        errorCategory: manifestReadonlyCategory,
        partialDeviceState: 'file-copied-manifest-stale',
        rescanRefiresAddOrUpgrade: false,
        doctorSeesPodkitTmp: false,
        errorMessageMatches: null,
        failedTrackCount: 1,
        portableTagWarn: false,
        reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × manifest-dir-readonly — syncPath=${syncPath}; copy + tag + picture + sidecar stages succeed; manifest write into .podkit/ fails with EACCES. No typed error class for manifest writes today. Error category follows the active operation type: '${manifestReadonlyCategory}' for syncPath=${syncPath}. Tracks physically landed with correct tags → rescan sees them, no add ops re-fire.`,
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
        // iPod doesn't use a mass-storage manifest — `orphan-files-mass-storage`
        // check is skip/absent and `doctorSeesPodkitTmp` returns null.
        doctorSeesPodkitTmp: null,
        errorMessageMatches: null,
        failedTrackCount: 1,
        portableTagWarn: false,
        reason: `${cell.shape} × ${cell.sourceFormat} × ${cell.codecConfig} × ${cell.transferMode} × itunesdb-readonly — iPod cell. Pre-seed (first sync) wires up iTunesDB; chmod 0555 on the iTunes dir blocks the second sync's libgpod tmp+rename → save() stage 1 throws DatabaseWriteError (categorised 'database', no retry). New track was copied to disk but the database write didn't land.`,
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
