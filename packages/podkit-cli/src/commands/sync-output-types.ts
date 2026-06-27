/**
 * JSON envelope types for `podkit sync`.
 *
 * Extracted from `sync.ts` so the structural surface lives apart from the
 * command's commander wiring + orchestration. The `MusicPresenter` /
 * `VideoPresenter` classes + `types.ts` (test surface) consume these
 * directly without pulling in the whole sync module.
 *
 * See `documents/architecture/error-handling.md` for the unified warning
 * + categorized-error model these types serialise.
 */

/**
 * Categorized error info for JSON output.
 *
 * Per-track errors set `track` to the source track name; sync-wide errors
 * (e.g. pre-flight free-space failure) leave it empty. When the underlying
 * error is a {@link CategorizedSyncError} subclass, `class` and `causes`
 * carry the typed-error provenance so JSON consumers don't have to scrape
 * the message body. See `documents/architecture/error-handling.md`.
 */
export interface ErrorInfo {
  track: string;
  category: string;
  message: string;
  retryAttempts: number;
  wasRetried: boolean;
  stack?: string;
  /** Typed-error class name when the error extends CategorizedSyncError. */
  class?: string;
  /** Per-entry failure descriptions for aggregated typed errors. */
  causes?: readonly string[];
}

/**
 * Warning info for JSON output (plan + execute phases unified).
 *
 * Replaces the prior PlanWarningInfo + ExecutionWarningInfo split. Consumers
 * pick by `phase`. Track refs are structured; consumers format as they wish.
 *
 * See documents/architecture/error-handling.md for the responsibility model.
 */
export interface WarningInfo {
  phase: 'plan' | 'execute';
  type: string;
  message: string;
  trackCount: number;
  tracks?: Array<{ artist: string; title: string; album?: string }>;
}

/**
 * Scan warning info for JSON output (file parsing issues)
 */
export interface ScanWarningInfo {
  file: string;
  message: string;
}

/**
 * Transform info for JSON output
 */
export interface TransformInfo {
  name: string;
  enabled: boolean;
  mode?: string;
  format?: string;
  /** Why the transform is in its current state (capability gating) */
  reason?: string;
  /** Warnings about this transform's configuration */
  warnings?: string[];
}

/**
 * Update breakdown by reason for JSON output
 */
export interface UpdateBreakdown {
  'transform-apply'?: number;
  'transform-remove'?: number;
  'metadata-changed'?: number;
  // Music quality axis — direction-split (replaces format-upgrade /
  // quality-upgrade / preset-upgrade / preset-downgrade). `-suppressed` counts
  // source-down changes the policy left alone (not yet produced).
  'quality-change-up'?: number;
  'quality-change-down'?: number;
  'quality-change-suppressed'?: number;
  // Video quality axis — video keeps its own preset reasons.
  'preset-upgrade'?: number;
  'preset-downgrade'?: number;
  'force-transcode'?: number;
  'transfer-mode-changed'?: number;
  'sync-tag-write'?: number;
  'artwork-added'?: number;
  'artwork-removed'?: number;
  'artwork-updated'?: number;
  'normalization-update'?: number;
  'metadata-correction'?: number;
  'force-metadata'?: number;
}

/**
 * One entry in the per-collection `qualityChanges[]` JSON array.
 *
 * Carries the classifier's decision for a single track so external tooling can
 * surface the full quality picture — including `source-down-suppressed` entries
 * the sync left alone (not yet produced, but the wire shape exists).
 */
export interface QualityChangeInfo {
  track: string;
  reason: string;
  direction: 'up' | 'down' | 'format-only';
  /** Whether the change re-encodes the file (false for source-down-suppressed). */
  reEncodes: boolean;
  targetBitrate: number;
  encodedBitrate?: number;
  sourceBitrate?: number;
}

/**
 * Summary of video content by type
 */
export interface VideoSummary {
  movieCount: number;
  showCount: number;
  episodeCount: number;
}

/**
 * JSON output structure for sync command.
 *
 * `success: true` means the sync ran. `status` reads the outcome:
 * - `'ok'`: every collection synced cleanly, exit code 0
 * - `'partial-failure'`: ran but some items failed, exit code 2
 *
 * Per-collection adapter/scan failures (sync-presenter) emit `success: false`
 * with an `error` field — those are scoped to a single collection inside a
 * multi-collection run. Hard command errors (device unreachable, ffmpeg
 * missing, etc.) are emitted via `CliErrorOutput`, exit code 1.
 */
export interface SyncOutput {
  success: boolean;
  status?: 'ok' | 'partial-failure';
  dryRun: boolean;
  source?: string;
  device?: string;
  /**
   * Sync-wide decisions with provenance attribution. Replaces the previous
   * top-level `quality`/`codec`/`codecPreference`/`transferMode` strings.
   * Consumers that need only the value read `decisions.transferMode.value`,
   * etc.; consumers that need to assert "where did this come from?" (matrix
   * tests, doctor surfaces) read `decisions.transferMode.source`. See
   * doc-040 (PRD) and {@link SyncDecisions}.
   */
  decisions?: import('./sync-decisions.js').SyncDecisions;
  transforms?: TransformInfo[];
  skipUpgrades?: boolean;
  /**
   * Sync plan summary. **Populated under `--dry-run`** and on the **not-enough-
   * space error path** (where `success: false, dryRun: false, error: '...'`
   * accompany it; see `sync-presenter.ts` around line 537). A clean real (non-
   * dry) sync emits `result` instead. Tests that ran `sync` without `--dry-run`
   * and asserted against `plan.tracksToUpdate` etc. on a successful sync are
   * silently asserting against `undefined`; use `result.completed` to inspect
   * what a real sync did.
   *
   * Field naming is shared with music sync — video sync also populates
   * `tracksToAdd` / `tracksToCopy` / `tracksToTranscode` (NOT `videosTo*`) and
   * surfaces movie/show split via `videoSummary`.
   */
  plan?: {
    tracksToAdd: number;
    tracksToRemove: number;
    tracksToUpdate: number;
    tracksToUpgrade: number;
    tracksToRelocate?: number;
    updateBreakdown?: UpdateBreakdown;
    /**
     * Per-track quality classifier decisions (music). Includes
     * `source-down-suppressed` entries (not yet produced). Present when the plan
     * produced any quality change.
     */
    qualityChanges?: QualityChangeInfo[];
    tracksToTranscode: number;
    tracksToCopy: number;
    tracksExisting: number;
    estimatedSize: number;
    estimatedTime: number;
    normalizedTracks?: number;
    albumCount?: number;
    artistCount?: number;
    videoSummary?: VideoSummary;
    preliminaries?: import('@podkit/core').PlanPreliminaries;
  };
  operations?: Array<{
    type:
      | 'add-transcode'
      | 'add-direct-copy'
      | 'add-optimized-copy'
      | 'upgrade-transcode'
      | 'upgrade-direct-copy'
      | 'upgrade-optimized-copy'
      | 'upgrade-artwork'
      | 'remove'
      | 'update-metadata'
      | 'update-sync-tag'
      | 'relocate'
      | 'video-transcode'
      | 'video-copy'
      | 'video-remove'
      | 'video-update-metadata'
      | 'video-upgrade';
    track: string;
    status?: 'pending' | 'completed' | 'failed' | 'skipped';
    error?: string;
    changes?: Array<{ field: string; from: string; to: string }>;
    reason?: string;
    /**
     * Source track's codec (e.g. 'flac', 'mp3'). Set for add/upgrade variants
     * where a source file exists; undefined for `remove`/`update-metadata`/
     * `update-sync-tag`/`relocate` (no source codec).
     */
    inputCodec?: string;
    /**
     * Resolved output codec the planner chose (e.g. 'aac' for `add-transcode`,
     * 'flac' for `add-direct-copy` of a FLAC source). Disambiguates which
     * codec a `transcode` op targets without scraping operation type strings.
     * Undefined for ops that don't write a file.
     */
    outputCodec?: string;
  }>;
  /**
   * Real-run outcome counts. **Populated only on non-dry-run syncs.** A
   * `--dry-run` emits `plan` instead. Idempotency tests should assert
   * `result.completed === 0`; detect+apply tests should assert
   * `result.completed > 0` (or an exact count where the fixture pins it).
   */
  result?: {
    completed: number;
    failed: number;
    skipped: number;
    bytesTransferred: number;
    duration: number;
  };
  eject?: {
    requested: boolean;
    success: boolean;
    error?: string;
  };
  /**
   * Sync engine warnings — plan-phase and execute-phase, unified. Filter by
   * `warning.phase` to recover the prior split. Always populated when the
   * engine emitted at least one warning; omitted when empty.
   */
  warnings?: WarningInfo[];
  scanWarnings?: ScanWarningInfo[];
  errors?: ErrorInfo[];
  error?: string;
}
