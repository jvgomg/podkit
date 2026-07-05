/**
 * MusicHandler — ContentTypeHandler implementation for music tracks
 *
 * Thin wrapper that delegates to the Classifier + Factory + Config pattern
 * for routing decisions, and to existing music sync functions for matching,
 * diffing, and execution.
 *
 * @module
 */

import type { CollectionTrack } from '../../adapters/interface.js';
import type { DeviceAdapter, DeviceTrack } from '../../device/adapter.js';
import { isMusicMediaType } from '../../ipod/constants.js';
import { applyTransforms } from '../../transforms/pipeline.js';
import { getMatchKey, getTransformMatchKeys } from '../../metadata/matching.js';
import {
  detectUpgrades,
  getIpodFormatFamily,
  isFileReplacementUpgrade,
  isSourceLossless,
  metadataValuesDiffer,
  classifyDeviceBound,
  classifySourceBound,
} from '../engine/upgrades.js';
import type { QualityChange, QualityChangeDirection, QualityTarget } from '../engine/upgrades.js';
import { normalizationToDb } from '../../metadata/normalization.js';
import {
  calculateMusicOperationSize,
  categorizeSource,
  isLosslessSource,
  isDeviceCompatible,
  fileTypeToAudioCodec,
} from './planner.js';
import { resolveLossyReduction } from '../engine/lossy-reduction.js';
import {
  MusicPipeline,
  getMusicOperationDisplayName,
  getFileTypeLabel,
  getTranscodeFiletypeLabel,
} from './pipeline.js';
import { estimateTransferTime } from '../engine/estimation.js';
import { buildAudioSyncTag, buildCopySyncTag, syncTagsEqual } from '../../metadata/sync-tags.js';
import type { SyncTagData } from '../../metadata/sync-tags.js';
import type {
  MetadataChange,
  SyncPlan,
  Warning,
  ExecutorProgress,
  UpdateReason,
  UpgradeReason,
} from '../engine/types.js';
import type { MusicOperation } from './types.js';
import type {
  ContentTypeHandler,
  CollisionCheckInput,
  ExecutionContext,
  OperationProgress,
  DryRunSummary,
  MatchInfo,
  UnifiedSyncDiff,
} from '../engine/content-type.js';
import { partitionExisting, sweepAllExisting, formatDryRunFromPlan } from '../engine/diff-utils.js';
import type { MusicSyncConfig, ResolvedMusicConfig } from './config.js';
import { resolveMusicConfig } from './config.js';
import { MusicTrackClassifier, classifierFromConfig } from './classifier.js';
import type { TrackClassification } from './classifier.js';
import { MusicOperationFactory } from './operation-factory.js';

// =============================================================================
// Helpers
// =============================================================================

/**
 * What the next sync would write into a track's syncTag, given the classifier's
 * per-track decision. Used by `postProcessPresetChanges` to decide whether the
 * persisted syncTag still represents the current intent.
 *
 * Returns `undefined` when the classifier action wouldn't produce a *transcode*
 * syncTag — i.e. direct-copy and optimized-copy. Those land a `quality=copy`
 * syncTag handled by the in-sync short-circuit, not this comparison.
 *
 * The classifier's per-track preset is what matters here, not config-wide
 * `resolvedQuality`: a `quality=max` + `lossless=["source"]` config falls back
 * to `lossy=high` per-track when no lossless target satisfies the device for a
 * given source (e.g. WAV/AIFF/ALAC on a mass-storage device whose codecs don't
 * cover them). A config-wide expected tag (`quality=lossless`) would then
 * compare against the legitimately-written `quality=high` syncTag and fire a
 * phantom `preset-upgrade` on every sync.
 */
export function expectedSyncTagFromClassification(
  classification: TrackClassification,
  config: { encoding?: string; customBitrate?: number; resolvedLossyCodec?: string }
): SyncTagData | undefined {
  if (classification.action.type !== 'transcode') return undefined;
  const { preset } = classification.action;
  return buildAudioSyncTag(
    preset.name,
    config.encoding,
    preset.bitrateOverride ?? config.customBitrate,
    undefined,
    preset.targetCodec ?? config.resolvedLossyCodec
  );
}

/**
 * Build the QualityTarget the classifier compares against, from resolved config.
 *
 * The reduction axis is the single one resolved in `resolveMusicConfig` (from
 * `[bitrate].reduce` + the transfer mode). The add path reads that same resolved
 * axis off the classifier context, so add and re-sync can never disagree on
 * whether to reduce a track — the disagreement the shared seam exists to prevent.
 */
function qualityTargetFromConfig(config: ResolvedMusicConfig): QualityTarget {
  return {
    preset: config.resolvedQuality ?? '',
    presetBitrate: config.presetBitrate ?? 0,
    encoding: config.raw.encoding ?? 'vbr',
    customBitrate: config.raw.customBitrate,
    isAlacPreset: config.isAlacPreset ?? false,
    resolvedLossyCodec: config.resolvedLossyCodec,
    axis: config.reductionAxis,
    reductionTolerance: config.reductionTolerance,
    ...(config.deviceMaxBitrate !== undefined && { deviceMax: config.deviceMaxBitrate }),
  };
}

/**
 * Build metadata changes for transform apply/remove operations.
 * Compares basic metadata fields between two track-like objects.
 */
function buildMusicMetadataChanges(
  from: { artist: string; title: string; album: string; albumArtist?: string },
  to: { artist: string; title: string; album: string; albumArtist?: string }
): MetadataChange[] {
  const changes: MetadataChange[] = [];

  if (from.artist !== to.artist) {
    changes.push({ field: 'artist', from: from.artist, to: to.artist });
  }
  if (from.title !== to.title) {
    changes.push({ field: 'title', from: from.title, to: to.title });
  }
  if (from.album !== to.album) {
    changes.push({ field: 'album', from: from.album, to: to.album });
  }
  if (from.albumArtist !== to.albumArtist) {
    changes.push({
      field: 'albumArtist',
      from: from.albumArtist ?? '',
      to: to.albumArtist ?? '',
    });
  }

  return changes;
}

/**
 * Convert a CollectionTrack to a CollisionCheckInput (shared fields only).
 */
function toCollisionInput(source: CollectionTrack): Omit<CollisionCheckInput, 'filetype'> {
  return {
    title: source.title,
    artist: source.artist,
    albumArtist: source.albumArtist,
    album: source.album,
    trackNumber: source.trackNumber,
    discNumber: source.discNumber,
    year: source.year,
  };
}

// =============================================================================
// MusicHandler Implementation
// =============================================================================

/**
 * ContentTypeHandler implementation for music tracks.
 *
 * Takes a `MusicSyncConfig` at construction and derives all internal state
 * up front via the Classifier + Factory + Config pattern.
 */
export class MusicHandler implements ContentTypeHandler<
  CollectionTrack,
  DeviceTrack,
  MusicOperation
> {
  readonly type = 'music';

  private readonly config: ResolvedMusicConfig;
  private readonly classifier: MusicTrackClassifier;
  private readonly factory: MusicOperationFactory;

  constructor(config: MusicSyncConfig) {
    this.config = resolveMusicConfig(config);
    this.classifier = new MusicTrackClassifier(classifierFromConfig(this.config));
    this.factory = new MusicOperationFactory();
  }

  // ---- Diffing ----

  generateMatchKey(source: CollectionTrack): string {
    return getMatchKey(source);
  }

  generateDeviceMatchKey(device: DeviceTrack): string {
    return getMatchKey(device);
  }

  applyTransformKey(source: CollectionTrack): string {
    // getTransformMatchKeys always computes both keys; return the transformed one
    const keys = getTransformMatchKeys(source, this.config.raw.transforms);
    return keys.transformedKey;
  }

  getDeviceItemId(device: DeviceTrack): string {
    // DeviceTrack's filePath is unique per track on the device
    return device.filePath;
  }

  transformSourceForAdd(source: CollectionTrack): CollectionTrack {
    if (!this.config.transformsEnabled) {
      return source;
    }

    const result = applyTransforms(source, this.config.raw.transforms);
    if (!result.applied) {
      return source;
    }

    // Create a copy with transformed metadata, preserving original source info
    return {
      ...source,
      artist: result.transformed.artist,
      title: result.transformed.title,
    };
  }

  detectUpdates(
    source: CollectionTrack,
    device: DeviceTrack,
    matchInfo?: MatchInfo
  ): UpdateReason[] {
    // Transform detection (when matchInfo available)
    if (matchInfo) {
      const hasTransform = this.generateMatchKey(source) !== this.applyTransformKey(source);
      if (hasTransform) {
        if (!matchInfo.matchedByTransformKey && this.config.transformsEnabled) {
          // iPod has original metadata, transforms are enabled -> apply
          return ['transform-apply'];
        }
        if (matchInfo.matchedByTransformKey && !this.config.transformsEnabled) {
          // iPod has transformed metadata, transforms are disabled -> remove
          return ['transform-remove'];
        }
      }
    }

    let reasons = detectUpgrades(source, device) as UpdateReason[];

    // Source-vs-device quality change (was format-upgrade / quality-upgrade).
    // The unified classifier's source bound owns this; it lands as the headline
    // `quality-change` reason. The full QualityChange payload is recomputed and
    // attached in postProcessBuildChanges (Pass 0).
    //
    // Only route as an update when the change re-encodes (`reEncodes`). A
    // report-only change (one that keeps the better device copy) is left in
    // `existing`; for a sync-tagged track the device bound then surfaces it via
    // the report-only channel. An untagged track is opted out of the device bound
    // entirely, so such a change on it is silently left alone — consistent with
    // the untagged opt-out elsewhere.
    const sourceQc = this.detectSourceQualityChange(source, device);
    if (sourceQc?.reEncodes) {
      reasons.unshift('quality-change');
    }

    // When the device doesn't support audio normalization, normalization updates are meaningless
    if (this.config.audioNormalization === 'none') {
      reasons = reasons.filter((r) => r !== 'normalization-update');
    }

    // When forceTranscode is on and source is lossless, ensure file-replacement
    if (this.config.raw.forceTranscode) {
      const category = categorizeSource(source);
      if (
        isLosslessSource(category) &&
        !reasons.some((r) => isFileReplacementUpgrade(r as UpgradeReason))
      ) {
        reasons.unshift('force-transcode');
      }
    }

    // When skipUpgrades is set, filter out file-replacement upgrades
    if (this.config.raw.skipUpgrades) {
      reasons = reasons.filter((r) => !isFileReplacementUpgrade(r as UpgradeReason));
    }

    return reasons;
  }

  /**
   * Source-vs-device quality change (the classifier's source bound), with the
   * transcoding-active suppression applied.
   *
   * Behaviour-preserving: when the source is lossless and the device track is
   * already in the target AAC format, the `lossless-boundary` change is the
   * expected steady state of an active transcode pipeline (FLAC → AAC), NOT an
   * upgrade — suppress it. An MP3-on-device copy (family 'mp3') still surfaces
   * the change so the re-transcode the user expects fires. This mirrors the
   * former `detectUpgrades` + AAC-family filter in `detectUpdates`.
   */
  private detectSourceQualityChange(
    source: CollectionTrack,
    device: DeviceTrack
  ): QualityChange | null {
    const change = classifySourceBound(
      source,
      device,
      this.config.presetBitrate ?? 0,
      this.config.reductionTolerance
    );
    if (!change) return null;

    if (change.reason === 'lossless-boundary' && getIpodFormatFamily(device) === 'aac') {
      return null;
    }

    return change;
  }

  // ---- Post-processing ----

  postProcessDiff(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    // Pass 0: Populate changes for transform and upgrade updates from detectUpdates
    this.postProcessBuildChanges(diff);

    // Pass 1: Preset change detection
    this.postProcessPresetChanges(diff);

    // Pass 1.4: Surface source-down for metadata-only updates (kept in place).
    this.postProcessSourceDownReports(diff);

    // Pass 1.5: Codec change detection
    this.postProcessCodecChanges(diff);

    // Pass 2: Force transcode sweep
    this.postProcessForceTranscode(diff);

    // Pass 2.5: Adopt untagged tracks by re-encoding (--force-sync-tags-transcode).
    // Runs before the tag-only sync-tag pass so that, when both flags are set,
    // the destructive adoption claims untagged tracks first (precedence) and the
    // tag-only pass below never re-processes them.
    this.postProcessSyncTagsTranscode(diff);

    // Pass 3: Transfer mode mismatch detection
    this.postProcessTransferMode(diff);

    // Pass 4: Sync tag writing
    this.postProcessSyncTags(diff);

    // Pass 4.5: Bitrate baseline backfill (force-sync-tags only)
    this.postProcessBitrateBaseline(diff);

    // Pass 5: Force metadata rewrite
    this.postProcessForceMetadata(diff);
  }

  /**
   * Pass 0: Populate changes arrays for updates detected by detectUpdates().
   *
   * detectUpdates() only returns reason strings — this pass builds the
   * MetadataChange arrays needed for planning and display.
   */
  private postProcessBuildChanges(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    for (const update of diff.toUpdate) {
      const reason = update.reasons[0];

      // Attach the source-bound QualityChange payload (recomputed from the same
      // pure helper detectUpdates used) and its display changes. Done before the
      // already-populated guard so the payload lands even if changes pre-exist.
      if (reason === 'quality-change' && !update.qualityChange) {
        const change = this.detectSourceQualityChange(update.source, update.device);
        if (change) {
          update.qualityChange = change;
          if (!update.changes || update.changes.length === 0) {
            update.changes =
              change.reason === 'lossless-boundary'
                ? [
                    {
                      field: 'fileType',
                      from: update.device.filetype ?? 'unknown',
                      to: update.source.fileType,
                    },
                  ]
                : [
                    {
                      field: 'bitrate',
                      from: String(update.device.bitrate),
                      to: String(update.source.bitrate ?? 'unknown'),
                    },
                  ];
          }
        }
      }

      if (update.changes && update.changes.length > 0) continue; // already populated

      if (reason === 'transform-apply') {
        // Build changes from device metadata → transformed source metadata
        const transformedSource = this.transformSourceForAdd(update.source);
        update.changes = buildMusicMetadataChanges(update.device, transformedSource);
      } else if (reason === 'transform-remove') {
        // Build changes from device metadata → original source metadata
        update.changes = buildMusicMetadataChanges(update.device, update.source);
      } else if (reason === 'metadata-correction') {
        // Build changes for metadata fields that differ
        const changes: MetadataChange[] = [];
        const metadataFields = [
          'genre',
          'year',
          'trackNumber',
          'discNumber',
          'albumArtist',
          'compilation',
        ] as const;
        for (const field of metadataFields) {
          const sourceValue = update.source[field as keyof CollectionTrack];
          const ipodValue = update.device[field as keyof DeviceTrack];
          if (metadataValuesDiffer(field, sourceValue, ipodValue)) {
            changes.push({
              field: field as MetadataChange['field'],
              from: String(ipodValue ?? ''),
              to: String(sourceValue ?? ''),
            });
          }
        }
        update.changes = changes;
      } else if (reason === 'normalization-update') {
        update.changes = [
          {
            field: 'normalization',
            from: update.device.normalization
              ? `${normalizationToDb(update.device.normalization)?.toFixed(1)} dB`
              : 'absent',
            to: update.source.normalization
              ? `${normalizationToDb(update.source.normalization)?.toFixed(1)} dB`
              : 'absent',
          },
        ];
      }
    }
  }

  /**
   * Pass 1: Detect device-vs-target quality changes on existing tracks (the
   * device bound of the unified classifier — was `postProcessPresetChanges`).
   * When isAlacPreset is true, uses format-based detection (no presetBitrate
   * needed). Otherwise, when presetBitrate is provided, compares bitrate.
   * Tracks with a change are moved from existing -> toUpdate as `quality-change`.
   *
   * Sync tag priority: if a track has a sync tag, exact comparison against the
   * current config. If no sync tag, fall back to bitrate tolerance detection
   * (active for untagged lossless tracks; will be removed once sync tags are universal).
   *
   * This detector handles the *preset* dimension (quality / encoding / bitrate)
   * only. Codec dimension (lossy = ['aac'] vs ['opus']) is the responsibility
   * of `postProcessCodecChanges`, so `syncTagMatchesConfig` does not compare
   * codec — a codec change shows up via that detector, not as a quality-change.
   */
  private postProcessPresetChanges(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    const shouldCheckPreset =
      !(this.config.raw.skipUpgrades ?? false) &&
      (this.config.isAlacPreset || this.config.presetBitrate);

    if (!shouldCheckPreset) return;

    const presetBitrate = this.config.presetBitrate ?? 0;
    const target = qualityTargetFromConfig(this.config);

    partitionExisting(diff, (match) => {
      // Lossy sources take the down-only cap-reduction path. The classifier would
      // route a compatible/device-native lossy source to a COPY, but a convert
      // over-cap move must re-encode DOWN to the cap — so the classifier's routing
      // is irrelevant here. classifyDeviceBound's lossy branch reads the
      // authoritative recorded bitrate from the sync tag and reuses the shared
      // lossy-reduction seam (exact recorded-vs-cap), so the add path and re-sync
      // never disagree.
      if (!isSourceLossless(match.source)) {
        // Source bound first: a source re-ripped below the device's recorded copy
        // (`source-down-suppressed`) must keep the better device copy. Reported,
        // never re-encoded — re-encoding down to the worse source would destroy
        // quality. The configured source-proximity tolerance damps ffprobe wobble.
        const sourceChange = classifySourceBound(
          match.source,
          match.device,
          presetBitrate,
          this.config.reductionTolerance
        );
        if (sourceChange && !sourceChange.reEncodes) {
          (diff.reportOnlyQualityChanges ??= []).push({
            source: match.source,
            device: match.device,
            qualityChange: sourceChange,
          });
          return null;
        }

        // Device bound: the down-only cap reduction plus the below-raised-cap
        // report. classifyDeviceBound reads the authoritative recorded bitrate
        // from the sync tag and reuses the shared lossy-reduction seam (exact
        // recorded-vs-cap), so the add path and re-sync never disagree.
        const change = classifyDeviceBound({
          source: match.source,
          device: match.device,
          target,
        });
        if (!change) return null;

        // Below a raised cap: a previously-reduced track sits below the new cap.
        // Down-only never auto-lifts it. With `--force-transcode` the user
        // explicitly opts into re-deriving it from the (better) source up to the
        // new cap — but only when the source can actually supply more than the
        // recorded bitrate. Otherwise it is reported, never lifted.
        if (change.reason === 'below-cap') {
          const sourceCanLift = (match.source.bitrate ?? 0) > (change.encodedBitrate ?? 0);
          if (this.config.raw.forceTranscode && sourceCanLift) {
            // A forced lift re-derives the track from the (better) source. The
            // target is bounded by what the SOURCE actually offers as well as the
            // cap: re-encoding a lossy source ABOVE its own bitrate would inflate
            // the file without recovering any quality (ADR-023 §2). So a 192 kbps
            // source lifted toward a 256 cap lands at 192, not 256.
            const liftTarget = Math.min(
              match.source.bitrate ?? change.targetBitrate,
              change.targetBitrate
            );
            // Emit it as a `cap-up` so `resolveUpgradeAction` re-encodes (recording
            // the target as the preset's bitrateOverride) instead of copying the
            // source verbatim. `below-cap` stays a purely report-only reason.
            return {
              reasons: ['quality-change'],
              changes: [
                {
                  field: 'bitrate' as const,
                  from: String(change.encodedBitrate ?? match.device.bitrate),
                  to: String(liftTarget),
                },
              ],
              qualityChange: {
                ...change,
                reason: 'cap-up',
                reEncodes: true,
                direction: 'up',
                targetBitrate: liftTarget,
              },
            };
          }
          (diff.reportOnlyQualityChanges ??= []).push({
            source: match.source,
            device: match.device,
            qualityChange: change,
          });
          return null;
        }

        // Any other report-only change (`reEncodes: false`) keeps the existing
        // copy in `existing` and creates NO operation, so it never inflates
        // tracksToUpdate.
        if (!change.reEncodes) {
          (diff.reportOnlyQualityChanges ??= []).push({
            source: match.source,
            device: match.device,
            qualityChange: change,
          });
          return null;
        }
        return {
          reasons: ['quality-change'],
          changes: [
            {
              field: 'bitrate' as const,
              from: String(change.encodedBitrate ?? match.device.bitrate),
              to: String(change.targetBitrate),
            },
          ],
          qualityChange: change,
        };
      }

      const syncTag = match.device.syncTag;
      const classification = this.classifier.classify(match.source);

      // When the device sync tag says 'copy' and the classifier would also route
      // this source as a copy (device natively supports the codec), it's in sync
      // regardless of the configured quality preset.
      if (syncTag?.quality === 'copy' && classification.action.type !== 'transcode') {
        return null; // copy -> copy, in sync
      }

      const expectedSyncTag = expectedSyncTagFromClassification(classification, {
        encoding: this.config.raw.encoding,
        customBitrate: this.config.raw.customBitrate,
        resolvedLossyCodec: this.config.resolvedLossyCodec,
      });

      // Device-vs-target bound only — the source bound was already evaluated
      // (and AAC-suppressed) by detectUpdates in the match loop. Running the
      // full classifier here would re-fire the source bound without that
      // suppression and misclassify a transcoded FLAC→AAC track as
      // lossless-boundary on every sync.
      const change = classifyDeviceBound({
        source: match.source,
        device: match.device,
        target,
        expectedSyncTag,
      });

      if (!change) return null;

      // A report-only change (`reEncodes: false`) keeps the existing copy: report
      // it via the report-only channel and create no operation. Lossless device
      // moves and preconditions (encoding/lossless boundary) always carry
      // `reEncodes: true` and fall through to the re-encode path below.
      if (!change.reEncodes) {
        (diff.reportOnlyQualityChanges ??= []).push({
          source: match.source,
          device: match.device,
          qualityChange: change,
        });
        return null;
      }

      // Derive the change record from what the classifier would *actually*
      // produce for this track, not the config-wide ALAC-preset flag. Under
      // quality=max + lossless=[source] the same config can produce an ALAC
      // upgrade for one track and a bitrate upgrade for another (depending on
      // whether the lossless stack matched), and the change reason should
      // reflect the per-track outcome.
      // Legacy lossless transcode (no explicit targetCodec) implicitly targets
      // ALAC — preserve that label. A modern lossless stack with an explicit
      // targetCodec gets the precise label.
      const wouldProduceAlac =
        classification.action.type === 'transcode' &&
        classification.action.preset.name === 'lossless' &&
        (classification.action.preset.targetCodec === 'alac' ||
          classification.action.preset.targetCodec === undefined);
      const changes: MetadataChange[] = wouldProduceAlac
        ? [
            {
              field: 'lossless' as const,
              from: String(match.device.filetype ?? 'AAC'),
              to: 'ALAC',
            },
          ]
        : [
            {
              field: 'bitrate' as const,
              from: String(match.device.bitrate),
              to: String(presetBitrate),
            },
          ];

      return { reasons: ['quality-change'], changes, qualityChange: change };
    });
  }

  /**
   * Pass 1.4: Surface `source-down-suppressed` for tracks already headed to
   * `toUpdate` for a metadata-only reason.
   *
   * The preset pass reports source-down only for tracks it leaves in `existing`.
   * A track that ALSO has an in-place metadata change is moved to `toUpdate` by
   * the match loop, so its source-down would otherwise go unreported. A
   * metadata-correction rewrites tags in place — it is NOT a file replacement — so
   * the device audio is kept and the safety guarantee holds; this only adds the
   * missing visibility line. A track being re-derived from the source (any
   * file-replacement upgrade — artwork, force-transcode, codec/preset change) is
   * skipped: its audio is replaced, so "kept the better copy" would not describe
   * the outcome.
   */
  private postProcessSourceDownReports(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    const shouldCheckPreset =
      !(this.config.raw.skipUpgrades ?? false) &&
      (this.config.isAlacPreset || this.config.presetBitrate);
    if (!shouldCheckPreset) return;

    const presetBitrate = this.config.presetBitrate ?? 0;

    for (const update of diff.toUpdate) {
      if (isSourceLossless(update.source)) continue;
      // Only when the audio is kept in place — a file replacement re-derives it
      // from the (worse) source, so a "kept the better copy" report would not hold.
      if (update.reasons.some((reason) => isFileReplacementUpgrade(reason))) continue;
      const change = classifySourceBound(
        update.source,
        update.device,
        presetBitrate,
        this.config.reductionTolerance
      );
      if (!change || change.reEncodes || change.reason !== 'source-down-suppressed') continue;
      (diff.reportOnlyQualityChanges ??= []).push({
        source: update.source,
        device: update.device,
        qualityChange: change,
      });
    }
  }

  /**
   * Pass 1.5: Detect codec changes on existing tracks.
   *
   * When a resolved lossy or lossless codec is available, compare it against the
   * existing track's sync tag codec field. If they differ, the track needs
   * re-transcoding with the new codec.
   *
   * Legacy tags without a `codec` field: infer AAC for lossy transcoded tracks,
   * ALAC for lossless transcoded tracks.
   */
  private postProcessCodecChanges(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    // Only relevant when codec preferences have been resolved
    const resolvedLossyCodec = this.config.resolvedLossyCodec;
    const resolvedLosslessStack = this.config.resolvedLosslessStack;
    if (!resolvedLossyCodec && !resolvedLosslessStack) return;
    if (this.config.raw.skipUpgrades) return;

    partitionExisting(diff, (match) => {
      const syncTag = match.device.syncTag;
      if (!syncTag) return null;

      const sourceLossless = isSourceLossless(match.source);

      // Determine what codec the existing track was transcoded with
      let existingCodec: string | undefined;
      if (syncTag.codec) {
        existingCodec = syncTag.codec;
      } else if (syncTag.quality === 'copy') {
        // Copied tracks don't need codec change detection (they weren't transcoded)
        return null;
      } else if (syncTag.quality === 'lossless') {
        // Legacy lossless tag without codec → infer ALAC
        existingCodec = 'alac';
      } else {
        // Legacy lossy tag without codec → infer AAC
        existingCodec = 'aac';
      }

      // Determine what codec we'd use now.
      //
      // Both the lossless and lossy branches delegate to the classifier
      // instead of assuming the resolved codec applies. The classifier knows
      // when a compatible source would be COPIED rather than transcoded — e.g.
      // an MP3 source on a device that natively plays MP3 is direct-copied,
      // not transcoded to the resolvedLossyCodec. Treating that as a codec
      // change would fire a spurious upgrade-direct-copy `codec-changed` op
      // on every subsequent sync.
      let targetCodec: string | undefined;
      const classification = this.classifier.classify(match.source);
      if (classification.action.type !== 'transcode') {
        // Source would be direct/optimized copied — no codec change to detect.
        return null;
      }
      if (sourceLossless && this.config.resolvedQuality === 'lossless' && resolvedLosslessStack) {
        targetCodec = classification.action.preset.targetCodec ?? 'alac';
      } else if (!sourceLossless || this.config.resolvedQuality !== 'lossless') {
        targetCodec = classification.action.preset.targetCodec ?? resolvedLossyCodec;
      }

      if (!targetCodec || existingCodec === targetCodec) return null;

      return {
        reasons: ['codec-changed' as const],
        changes: [
          {
            field: 'fileType' as const,
            from: existingCodec,
            to: targetCodec,
          },
        ],
      };
    });
  }

  /**
   * Pass 2: Force re-transcoding of all lossless-source tracks.
   * Only lossless sources are affected — compatible lossy (MP3, AAC) are always
   * copied as-is and re-encoding them would only degrade quality.
   */
  private postProcessForceTranscode(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    if (!this.config.raw.forceTranscode) return;

    partitionExisting(diff, (match) => {
      if (!isSourceLossless(match.source)) return null;
      return {
        reasons: ['force-transcode'],
        changes: [
          { field: 'bitrate', from: String(match.device.bitrate ?? 'unknown'), to: 'forced' },
        ],
      };
    });
  }

  /**
   * Pass 2.5: Adopt untagged tracks (`--force-sync-tags-transcode`).
   *
   * The sync tag is the sole quality truth, so a track podkit never wrote (no
   * sync tag, or a tag without a recorded bitrate) is opted out of the normal
   * quality classifier — it is left alone on every ordinary sync. This pass is
   * the ONE explicit, destructive adoption path: it claims those untagged tracks
   * and writes the authoritative sync tag.
   *
   * The lossy target is computed by the shared {@link resolveLossyReduction}
   * seam (the same down-only, cap-bounded table the add and re-sync paths use),
   * so an adopted track is decided exactly as it would have been on add. When the
   * seam reduces or forces a cross-codec re-encode, the track is re-encoded
   * (`quality-change` → `upgrade-transcode`) and the executor establishes true
   * bitrate + encoding ground truth. When the seam keeps a device-native source
   * untouched (preserve, or within the convert tolerance), the track is adopted
   * tag-only — its authoritative copy tag is stamped without a needless
   * re-encode. Lossless sources always re-encode to the resolved preset (the
   * classifier owns that routing).
   *
   * Idempotency: once adopted, a track carries a sync tag, so the next run's
   * `if (syncTag)` guard in this pass skips it and the normal classifier owns it
   * (a re-sync is a no-op). A track that ALREADY carries a sync tag is never
   * touched here — it is left to the classifier.
   *
   * Scope: ONLY genuinely untagged tracks (`!syncTag`) — a track podkit never
   * wrote. A track that carries any podkit sync tag is authoritative: its quality
   * tier and encoding mode are recorded (a plain transcode tag legitimately omits
   * the bitrate, which is implied by the preset, and a `copy` tag legitimately
   * omits the encoding), so it is left to the classifier rather than re-encoded.
   * Re-encoding tagged tracks here would needlessly re-transcode the entire
   * already-tagged library.
   */
  private postProcessSyncTagsTranscode(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    if (!(this.config.raw.forceSyncTagsTranscode && this.config.resolvedQuality)) return;

    const cap = this.config.presetBitrate ?? 0;

    partitionExisting(diff, (match) => {
      const syncTag = match.device.syncTag;
      if (syncTag) return null;

      // A lossy source with a known bitrate and a configured cap routes its
      // adoption target through the shared lossy-reduction seam — the single
      // owner of the down-only, cap-bounded target-bitrate table — so a track is
      // never adopted to one bitrate and re-decided to a different one on the next
      // sync. (Lossless sources, and lossy sources with no usable bitrate or no
      // cap, fall through to the cap fallback below, where the classifier owns the
      // actual routing.)
      const sourceBitrate = match.source.bitrate;
      if (!isSourceLossless(match.source) && cap > 0 && sourceBitrate && sourceBitrate > 0) {
        const sourceCodec =
          fileTypeToAudioCodec(match.source.fileType, match.source.codec) ?? 'aac';
        // Determine device-native the SAME way the add-path classifier does: a
        // natively-supported codec OR a `compatible-lossy` source (categorizeSource
        // falls back to the iPod-centric set when the device declares no codecs, so
        // an unconfigured device still copies AAC/MP3 rather than needlessly
        // re-encoding it). isDeviceCompatible alone returns false for undefined
        // codecs, which would wrongly force a necessity transcode here.
        const deviceNative =
          isDeviceCompatible(match.source, this.config.supportedAudioCodecs) ||
          categorizeSource(match.source, this.config.supportedAudioCodecs) === 'compatible-lossy';
        const result = resolveLossyReduction({
          sourceCodec,
          sourceBitrate,
          deviceNative,
          targetCodec: this.config.resolvedLossyCodec ?? 'aac',
          cap,
          axis: this.config.reductionAxis,
          ...(this.config.deviceMaxBitrate !== undefined && {
            deviceMax: this.config.deviceMaxBitrate,
          }),
          tolerance: this.config.reductionTolerance,
        });

        if (result.action === 'copy') {
          // The seam keeps a device-native source untouched (preserve, or convert
          // within the tolerance band): adopt it tag-only — record the
          // authoritative copy tag (with the source bitrate, so the device-bound
          // re-sync is a no-op) rather than perform a needless re-encode.
          //
          // Artwork hash is deliberately NOT recorded: tag-only adoption transfers
          // no artwork bytes, so stamping the source hash would suppress the normal
          // artwork-added detection and the artwork would never be transferred. A
          // later ordinary sync discovers and transfers it (matching the other
          // copy-tag writer).
          const copyTag = buildCopySyncTag(
            this.config.transferMode,
            undefined,
            sourceCodec,
            sourceBitrate
          );
          return { reasons: ['sync-tag-write'], changes: [], syncTag: copyTag };
        }

        // Re-encode to the seam's target. `resolveUpgradeAction` stamps it as the
        // preset's `bitrateOverride` so the post-adoption tag matches the next
        // sync (no-op). The direction is descriptive: the seam target relative to
        // the source (an untagged track carries no recorded bitrate to compare
        // against). An over-cap source reduces DOWN (`cap-down`); a
        // preserve-necessity target may exceed the source to hold its quality in a
        // less-efficient codec, which reads as `up`. A target EQUAL to the source
        // is a pure forced codec change (`format-mismatch`) — no bitrate move, so
        // it is not labelled a quality up/down.
        const effectiveTarget = result.bitrate;
        const direction: QualityChangeDirection =
          effectiveTarget < sourceBitrate
            ? 'down'
            : effectiveTarget > sourceBitrate
              ? 'up'
              : 'format-only';
        const qualityChange: QualityChange = {
          reason:
            direction === 'down' ? 'cap-down' : direction === 'up' ? 'cap-up' : 'format-mismatch',
          direction,
          reEncodes: true,
          targetBitrate: effectiveTarget,
          sourceBitrate,
        };
        return {
          reasons: ['quality-change'],
          changes: [
            {
              field: 'bitrate' as const,
              from: String(match.device.bitrate ?? 'unknown'),
              to: String(effectiveTarget),
            },
          ],
          qualityChange,
        };
      }

      // Fallback: a lossless source (the classifier transcodes it to the resolved
      // lossless/lossy preset and ignores this payload), or a lossy source with no
      // usable bitrate / no cap — force a re-encode at the cap. The direction here
      // is descriptive only; the device's DB bitrate labels the move for display.
      const effectiveTarget = cap;
      const deviceBitrate = match.device.bitrate ?? 0;
      const direction: QualityChangeDirection =
        effectiveTarget > deviceBitrate
          ? 'up'
          : effectiveTarget < deviceBitrate
            ? 'down'
            : 'format-only';

      const qualityChange: QualityChange = {
        reason: direction === 'down' ? 'cap-down' : 'cap-up',
        direction,
        reEncodes: true,
        targetBitrate: effectiveTarget,
        sourceBitrate: match.source.bitrate,
      };

      return {
        reasons: ['quality-change'],
        changes: [
          {
            field: 'bitrate' as const,
            from: String(match.device.bitrate ?? 'unknown'),
            to: effectiveTarget ? String(effectiveTarget) : 'adopt',
          },
        ],
        qualityChange,
      };
    });
  }

  /**
   * Pass 3: Force re-processing when transfer mode changed.
   * Affects ALL tracks (including copy-format), unlike forceTranscode which only
   * affects lossless-source tracks.
   *
   * Two cases:
   * 1. Transfer mode is missing from sync tag (legacy tracks) — if the effective
   *    mode is 'fast' (the legacy default behavior), this is metadata-only (stamp
   *    the tag). If the effective mode is different, the file needs re-processing.
   * 2. Transfer mode is present but differs — file replacement needed.
   */
  private postProcessTransferMode(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    if (!(this.config.raw.forceTransferMode && this.config.transferMode)) return;

    const targetTransferMode = this.config.transferMode;

    partitionExisting(diff, (match) => {
      const syncTag = match.device.syncTag;
      const tagTransferMode = syncTag?.transferMode;

      if (tagTransferMode === targetTransferMode) {
        return null;
      } else if (!syncTag) {
        // No sync tag at all — can't stamp transfer mode. Treat as existing.
        return null;
      } else if (tagTransferMode === undefined && targetTransferMode === 'fast') {
        // Missing transfer mode + effective is 'fast': the file was already
        // transferred with fast behavior (the only behavior before transfer modes).
        // Just stamp the sync tag — no file re-transfer needed.
        const updatedTag: SyncTagData = { ...syncTag, transferMode: targetTransferMode };
        return { reasons: ['sync-tag-write'], changes: [], syncTag: updatedTag };
      } else {
        // Transfer mode actually changed (or missing + effective is not 'fast')
        // — file needs re-processing.
        return {
          reasons: ['transfer-mode-changed'],
          changes: [
            { field: 'transferMode', from: tagTransferMode ?? 'none', to: targetTransferMode },
          ],
        };
      }
    });
  }

  /**
   * Pass 4 (formerly Pass 3): Write sync tags to lossless-source tracks that are missing
   * or have outdated tags. This is metadata-only — no file replacement.
   *
   * When checkArtwork is active (source tracks have artworkHash), this also processes
   * lossy/copied sources that have artwork but no art= hash in their sync tag.
   * This establishes the artwork hash baseline so --check-artwork can detect future changes.
   * The baseline assumes the iPod artwork currently matches the source, which is the
   * expected state for a freshly synced collection.
   *
   * Scope (deliberate): this pass operates ONLY on `existing` matches — tracks
   * already on the device. Initial-add baselines are written during execution
   * by `MusicTransferOps` (see `transfer.ts`): when the source carries an
   * `artworkHash` (e.g. the directory adapter computed one, or Subsonic was
   * run with `--check-artwork`) and the artwork bytes successfully land on
   * the device, the syncTag picks up the hash on the first sync — no extra
   * flag required. `--force-sync-tags` stays opt-in here so already-set-up
   * iPods do not silently re-tag their entire library after upgrading to a
   * podkit version that ships this feature. Backfilling pre-feature tracks
   * remains an explicit `--force-sync-tags` action.
   */
  private postProcessSyncTags(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    if (!(this.config.raw.forceSyncTags && this.config.resolvedQuality)) return;

    const baseExpectedTag = buildAudioSyncTag(
      this.config.resolvedQuality,
      this.config.raw.encoding,
      this.config.raw.customBitrate,
      undefined,
      this.config.resolvedLossyCodec
    );

    partitionExisting(diff, (match) => {
      const sourceLossless = isSourceLossless(match.source);

      // For lossy (copied) sources, only process when the source has an artwork hash
      // and the iPod track is missing the art= baseline in its sync tag.
      // This ensures --force-sync-tags --check-artwork establishes baselines for ALL tracks.
      if (!sourceLossless) {
        if (match.source.artworkHash) {
          const currentTag = match.device.syncTag;
          if (!currentTag?.artworkHash || currentTag.artworkHash !== match.source.artworkHash) {
            // Build a minimal "copy" sync tag with just the artwork hash
            const copyTag: SyncTagData = {
              quality: 'copy',
              artworkHash: match.source.artworkHash,
            };
            // If there's an existing tag, preserve its fields but update the artwork hash
            const expectedTag: SyncTagData = currentTag
              ? { ...currentTag, artworkHash: match.source.artworkHash }
              : copyTag;
            return { reasons: ['sync-tag-write'], changes: [], syncTag: expectedTag };
          }
        }
        return null;
      }

      // Include artwork hash in the expected tag when available (--check-artwork active).
      // This establishes the baseline by writing the source's artwork hash — it assumes
      // the iPod artwork currently matches the source, which is the expected state for
      // a freshly synced collection.
      const expectedTag = { ...baseExpectedTag };
      if (match.source.artworkHash) {
        expectedTag.artworkHash = match.source.artworkHash;
      }

      // Structural comparison — rewrite if any field differs,
      // even if the semantic meaning is equivalent (e.g., missing encoding=vbr).
      // This ensures all tags are complete and consistent.
      const currentTag = match.device.syncTag;
      if (currentTag && syncTagsEqual(currentTag, expectedTag)) {
        return null;
      }

      return { reasons: ['sync-tag-write'], changes: [], syncTag: expectedTag };
    });
  }

  /**
   * Pass 4.5: Bitrate baseline backfill — gated on `--force-sync-tags`.
   *
   * New copies have `source.bitrate` written into the iPod track record
   * during execution (`transfer.ts:toDeviceTrackInput`). Existing iPod tracks
   * added before that path landed (or by a third-party tool that omitted the
   * field) carry `bitrate = 0`. With both sides of `detectUpgrades`'s
   * `source.bitrate && ipod.bitrate` gate populated, quality-upgrade can fire
   * when the source bitrate later rises significantly above the iPod's stored
   * value; without the iPod side, the gate silently no-ops.
   *
   * This pass is the symmetric counterpart of `postProcessSyncTags`'s
   * artwork-hash baseline backfill: opt-in (`--force-sync-tags`) so an
   * already-set-up iPod does not silently re-tag its entire library on the
   * next sync, and idempotent (only fires when `ipod.bitrate === 0` and
   * `source.bitrate` is known).
   *
   * Emits a `update-metadata` operation carrying the source bitrate. The
   * pipeline's `executeUpdateMetadata` propagates the field via
   * `updateTrack`. No file replacement.
   */
  private postProcessBitrateBaseline(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    if (!this.config.raw.forceSyncTags) return;

    partitionExisting(diff, (match) => {
      // Only backfill when the iPod side is missing a bitrate AND the source
      // has one to lend. The 0-vs-undefined distinction matters: the iPod
      // adapter normalises a missing libgpod bitrate to 0 (it's a `number`,
      // not optional), so 0 is the "not populated" sentinel.
      if (match.device.bitrate !== 0) return null;
      if (!match.source.bitrate) return null;

      return {
        reasons: ['metadata-changed'],
        changes: [
          {
            field: 'bitrate',
            from: '0',
            to: String(match.source.bitrate),
          },
        ],
      };
    });
  }

  /**
   * Pass 5: Force-metadata moves ALL remaining existing tracks to toUpdate.
   * This rewrites metadata on every matched track without re-transcoding or re-transferring.
   */
  private postProcessForceMetadata(diff: UnifiedSyncDiff<CollectionTrack, DeviceTrack>): void {
    if (!this.config.raw.forceMetadata) return;

    sweepAllExisting(diff, 'force-metadata', (match) => {
      const { source, device } = match;
      const changes: MetadataChange[] = [];

      // Compare all metadata fields and report actual differences
      const allFields = [
        'title',
        'artist',
        'album',
        'albumArtist',
        'genre',
        'year',
        'trackNumber',
        'discNumber',
        'compilation',
      ] as const;

      for (const field of allFields) {
        const sourceValue = source[field as keyof CollectionTrack];
        const ipodValue = device[field as keyof DeviceTrack];

        if (metadataValuesDiffer(field, sourceValue, ipodValue)) {
          changes.push({
            field: field as MetadataChange['field'],
            from: String(ipodValue ?? ''),
            to: String(sourceValue ?? ''),
          });
        }
      }

      // Even if no fields differ, include the track — the point of --force-metadata
      // is unconditional refresh. Use title as a no-op marker when nothing changed.
      if (changes.length === 0) {
        changes.push({
          field: 'title',
          from: device.title,
          to: source.title,
        });
      }

      return { changes };
    });
  }

  // ---- Planning ----

  planAdd(source: CollectionTrack): MusicOperation {
    const { action } = this.classifier.classify(source);
    return this.factory.createAdd(source, action);
  }

  planRemove(device: DeviceTrack): MusicOperation {
    return this.factory.createRemove(device);
  }

  /**
   * Resolve the routing action for a file-replacement upgrade.
   *
   * Normally this is the classifier's decision for the source. The exception is a
   * lossy re-encode that fired against the device's recorded quality: a `cap-down`
   * (the down-only over-cap reduction), or the adoption pass's `cap-up`/`cap-down`
   * forced re-encode. The classifier would COPY a compatible/device-native lossy
   * source as-is, but these must RE-ENCODE it — down to the cap (`cap-down`), or to
   * the adoption target. Force a transcode at the resolved preset, recording the
   * change's target bitrate as the preset's `bitrateOverride` so the executor
   * stamps the new encoded bitrate into the sync tag — making the next sync a
   * no-op (idempotent). The override comes from the change, not the config-wide
   * preset bitrate (the adoption target may be `min(source, cap)`). All other
   * upgrades (lossless-boundary, codec-changed, force-transcode,
   * transfer-mode-changed) keep the classifier's routing unchanged.
   */
  private resolveUpgradeAction(
    source: CollectionTrack,
    qualityChange?: QualityChange
  ): import('./classifier.js').MusicAction {
    if (
      (qualityChange?.reason === 'cap-down' ||
        qualityChange?.reason === 'cap-up' ||
        qualityChange?.reason === 'format-mismatch') &&
      qualityChange.reEncodes &&
      !isSourceLossless(source) &&
      this.config.resolvedQuality &&
      this.config.resolvedQuality !== 'lossless'
    ) {
      // The target the classifier/adoption computed: the cap for a down-only
      // reduction, the adoption target, or a forced same-bitrate codec change
      // (`format-mismatch`). Recorded as bitrateOverride so the post-re-encode sync
      // tag carries the new encoded bitrate (idempotency).
      const targetBitrate = qualityChange.targetBitrate;
      const preset = {
        name: this.config
          .resolvedQuality as import('../engine/types.js').TranscodePresetRef['name'],
        ...(this.config.resolvedLossyCodec && { targetCodec: this.config.resolvedLossyCodec }),
        ...(targetBitrate && { bitrateOverride: targetBitrate }),
      };
      return { type: 'transcode', preset };
    }
    return this.classifier.classify(source).action;
  }

  planUpdate(
    source: CollectionTrack,
    device: DeviceTrack,
    reasons: UpdateReason[],
    changes?: MetadataChange[],
    syncTag?: SyncTagData,
    qualityChange?: QualityChange
  ): MusicOperation[] {
    if (reasons.length === 0) return [];

    // Handle sync-tag-write: create update-sync-tag operation
    const ops: MusicOperation[] = [];
    const nonSyncTagReasons = reasons.filter((r) => r !== 'sync-tag-write');

    if (reasons.includes('sync-tag-write') && syncTag) {
      ops.push(this.factory.createSyncTagUpdate(device, syncTag));
    }

    if (nonSyncTagReasons.length === 0) return ops;

    const primaryReason = nonSyncTagReasons[0]!;

    // artwork-updated and artwork-removed need source file access for artwork re-extraction
    // or removal, but don't replace the audio file — route as upgrade-artwork
    if (primaryReason === 'artwork-updated' || primaryReason === 'artwork-removed') {
      ops.push(this.factory.createArtworkUpgrade(source, device, primaryReason as UpgradeReason));
      return ops;
    }

    // File-replacement upgrades take priority over path-mismatch. If both are
    // present, the upgrade runs now and the file stays at its current path.
    // The path-mismatch will be detected again on the next sync and resolved
    // with a relocate — self-healing in two passes.
    if (isFileReplacementUpgrade(primaryReason as UpgradeReason)) {
      const action = this.resolveUpgradeAction(source, qualityChange);
      ops.push(this.factory.createUpgrade(source, device, primaryReason as UpgradeReason, action));
      return ops;
    }

    // Path-mismatch: relocate the file on device to its expected path
    if (nonSyncTagReasons.includes('path-mismatch')) {
      const pathChange = changes?.find((c) => c.field === 'filePath');
      if (pathChange) {
        const otherChanges = changes?.filter((c) => c.field !== 'filePath');
        ops.push(
          this.factory.createRelocate(
            device,
            source,
            pathChange.to,
            otherChanges?.length ? otherChanges : undefined
          )
        );
        return ops;
      }
    }

    // Metadata-only updates — populate metadata from changes
    // Include source reference so the pipeline can access raw ReplayGain values
    ops.push(this.factory.createMetadataUpdate(device, changes ?? [], source));
    return ops;
  }

  estimateSize(op: MusicOperation): number {
    return calculateMusicOperationSize(op);
  }

  estimateTime(op: MusicOperation): number {
    const size = calculateMusicOperationSize(op);
    if (op.type === 'remove') return 0.1;
    if (op.type === 'update-metadata' || op.type === 'update-sync-tag' || op.type === 'relocate')
      return 0.01;
    return estimateTransferTime(size);
  }

  collectPlanWarnings(operations: MusicOperation[]): Warning[] {
    const warnings: Warning[] = [];
    const lossyToLossyTracks: CollectionTrack[] = [];

    for (const op of operations) {
      if (op.type === 'add-transcode' || op.type === 'upgrade-transcode') {
        const { warnLossyToLossy } = this.classifier.classify(op.source as CollectionTrack);
        if (warnLossyToLossy) {
          lossyToLossyTracks.push(op.source as CollectionTrack);
        }
      }
    }

    if (lossyToLossyTracks.length > 0) {
      warnings.push({
        phase: 'plan',
        type: 'lossy-to-lossy',
        message: `${lossyToLossyTracks.length} track${lossyToLossyTracks.length === 1 ? '' : 's'} require lossy-to-lossy conversion (OGG, Opus). This is unavoidable but results in quality loss.`,
        tracks: lossyToLossyTracks.map((t) => ({
          artist: t.artist ?? 'Unknown Artist',
          title: t.title ?? 'Unknown Title',
          album: t.album,
        })),
      });
    }

    // Warn when portable mode is used with an embedded-artwork device
    if (
      this.config.primaryArtworkSource === 'embedded' &&
      this.config.transferMode === 'portable' &&
      this.config.artworkResize &&
      operations.length > 0
    ) {
      warnings.push({
        phase: 'plan',
        type: 'embedded-artwork-resize',
        message: `Artwork resized to device maximum (${this.config.artworkResize}px) — this device reads artwork from embedded file data and cannot use full-resolution images. Portable mode preserves audio quality but artwork is optimized for the device.`,
        tracks: [],
      });
    }

    // Surface adapter-scoped plan warnings (e.g. Subsonic's fast-mode notice).
    // Adapters opt in by implementing getPlanWarnings — most omit it.
    const adapter = this.config.raw.adapter;
    if (adapter?.getPlanWarnings) {
      warnings.push(...adapter.getPlanWarnings());
    }

    return warnings;
  }

  // ---- Priority ----

  /**
   * Get the execution priority for a sync operation.
   * Lower numbers execute first. Used by the engine for ordering.
   */
  getOperationPriority(op: MusicOperation): number {
    switch (op.type) {
      case 'remove':
        return 0;
      case 'update-metadata':
      case 'update-sync-tag':
      case 'relocate':
        return 1;
      case 'add-direct-copy':
      case 'add-optimized-copy':
        return 2;
      case 'upgrade-transcode':
      case 'upgrade-direct-copy':
      case 'upgrade-optimized-copy':
      case 'upgrade-artwork':
        return 3;
      case 'add-transcode':
        return 4;
      default:
        return 5;
    }
  }

  // ---- Execution ----

  /**
   * Single-operation stub. Dead in production — `executeBatch` covers all
   * music sync flows. If this path is ever resurrected, it must forward
   * `ctx.warningSink` to the inner pipeline so warning-sink consumers
   * (music-presenter.ts, SyncOutput.warnings[]) keep working.
   */
  async *execute(
    op: MusicOperation,
    _ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress<MusicOperation>> {
    // Stub — real execution stays in MusicPipeline for now
    yield { operation: op, phase: 'starting' };
    yield { operation: op, phase: 'complete' };
  }

  async *executeBatch(
    operations: MusicOperation[],
    ctx: ExecutionContext
  ): AsyncGenerator<OperationProgress<MusicOperation>> {
    const transcoder = this.config.raw.transcoder;

    // Wrap operations in a SyncPlan for MusicPipeline
    const plan: SyncPlan<MusicOperation> = {
      operations,
      estimatedSize: operations.reduce((sum, op) => sum + this.estimateSize(op), 0),
      estimatedTime: operations.reduce((sum, op) => sum + this.estimateTime(op), 0),
      warnings: [],
    };

    // Create the 3-stage pipeline executor.
    const executor = new MusicPipeline({ device: ctx.device, transcoder });

    try {
      // Execute and bridge events
      for await (const progress of executor.execute(plan, {
        dryRun: ctx.dryRun,
        signal: ctx.signal,
        tempDir: ctx.tempDir,
        artwork: this.config.raw.artwork,
        adapter: this.config.raw.adapter,
        syncTagConfig: {
          encodingMode: this.config.raw.encoding,
          customBitrate: this.config.raw.customBitrate,
        },
        continueOnError: this.config.raw.continueOnError ?? ctx.continueOnError,
        retryConfig: this.config.raw.retryConfig,
        transferMode: this.config.transferMode,
        artworkResize: this.config.artworkResize,
        sidecarResize: this.config.sidecarResize,
        audioNormalization: this.config.audioNormalization,
      })) {
        // Filter out the batch-level 'complete' event — it's a synthetic
        // "all done" marker, not a per-operation progress signal.
        if (progress.phase === 'complete') {
          continue;
        }

        // Bridge ExecutorProgress → OperationProgress
        yield this.bridgeProgress(progress);
      }
    } finally {
      // Forward execute-phase warnings the pipeline accumulated (adapter
      // tag-write soft signals, artwork extraction failures, etc.) into the
      // executor's sink. The pipeline holds them on a private array that is
      // GC'd with the instance — without this drain they never reach
      // ExecuteResult.warnings or SyncOutput.warnings[]. Drain in `finally`
      // so an early break (e.g. fatal stage error) still surfaces what fired
      // before the throw.
      //
      // The pipeline overwrites `device.warningSink` with its own
      // accumulator inside `execute()`. After the pipeline returns, the
      // engine's outer batch loop still calls `device.save()` (ADR-019
      // Phase 1+2) — emissions inside save() (e.g. iPod portable's
      // tag-write soft signal) would otherwise land in the now-orphaned
      // pipeline sink. Rewire to the engine's sink so end-of-run save
      // warnings reach the executor's accumulator directly.
      if (ctx.warningSink) {
        for (const w of executor.getWarnings()) {
          ctx.warningSink.emit(w);
        }
        ctx.device.setWarningSink?.(ctx.warningSink);
      }
    }
  }

  /**
   * Bridge an ExecutorProgress event from MusicPipeline to an OperationProgress event.
   *
   * MusicPipeline yields one event per completed/failed/skipped operation
   * (plus batch-level 'updating-db' and 'complete' which are filtered before this).
   */
  private bridgeProgress(progress: ExecutorProgress): OperationProgress<MusicOperation> {
    let phase: OperationProgress<MusicOperation>['phase'];

    if (progress.error) {
      phase = 'failed';
    } else if (progress.skipped) {
      phase = 'complete';
    } else {
      // Successful operation completion (transcoding, copying, removing, etc.)
      phase = 'complete';
    }

    return {
      operation: progress.operation as MusicOperation,
      phase,
      progress: progress.bytesTotal > 0 ? progress.bytesProcessed / progress.bytesTotal : undefined,
      error: progress.error,
      skipped: progress.skipped,
      transcodeProgress: progress.transcodeProgress
        ? {
            percent: progress.transcodeProgress.percent,
            speed: progress.transcodeProgress.speed,
          }
        : undefined,
    };
  }

  // ---- Device ----

  getDeviceItems(device: DeviceAdapter): DeviceTrack[] {
    return getMusicDeviceItems(device);
  }

  // ---- Display ----

  getDisplayName(op: MusicOperation): string {
    return getMusicOperationDisplayName(op);
  }

  formatDryRun(plan: SyncPlan<MusicOperation>): DryRunSummary {
    return formatDryRunFromPlan(
      plan,
      (type) => {
        if (type === 'add-transcode' || type === 'add-direct-copy' || type === 'add-optimized-copy')
          return 'add';
        if (type === 'remove') return 'remove';
        if (
          type === 'update-metadata' ||
          type === 'update-sync-tag' ||
          type === 'upgrade-transcode' ||
          type === 'upgrade-direct-copy' ||
          type === 'upgrade-optimized-copy' ||
          type === 'upgrade-artwork'
        )
          return 'update';
        return null;
      },
      (op) => this.getDisplayName(op),
      (op) => this.estimateSize(op)
    );
  }

  // ---- Collision checking ----

  getCollisionCheckInputs(plan: SyncPlan<MusicOperation>): CollisionCheckInput[] {
    const inputs: CollisionCheckInput[] = [];
    for (const op of plan.operations) {
      if (op.type === 'add-transcode') {
        inputs.push({
          ...toCollisionInput(op.source),
          filetype: getTranscodeFiletypeLabel(op.preset),
        });
      } else if (op.type === 'add-direct-copy' || op.type === 'add-optimized-copy') {
        inputs.push({
          ...toCollisionInput(op.source),
          filetype: getFileTypeLabel(op.source.filePath),
        });
      }
      // upgrade-* operations target existing managed files, not unmanaged ones — skip
    }
    return inputs;
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Get music tracks from a device, excluding unmanaged mass-storage files.
 *
 * Filters by music media type and excludes unmanaged files on mass-storage devices.
 * This mirrors iPod behavior where only database tracks are surfaced. Duck-typed
 * because `managed` is a MassStorageTrack property, not on the DeviceTrack interface.
 */
export function getMusicDeviceItems(device: DeviceAdapter): DeviceTrack[] {
  return device
    .getTracks()
    .filter((track) => isMusicMediaType(track.mediaType))
    .filter((track) => !('managed' in track && !track.managed));
}

/**
 * Create a MusicHandler instance
 */
export function createMusicHandler(config: MusicSyncConfig): MusicHandler {
  return new MusicHandler(config);
}
