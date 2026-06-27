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
import { calculateMusicOperationSize, categorizeSource, isLosslessSource } from './planner.js';
import {
  MusicPipeline,
  getMusicOperationDisplayName,
  getFileTypeLabel,
  getTranscodeFiletypeLabel,
} from './pipeline.js';
import { estimateTransferTime } from '../engine/estimation.js';
import { buildAudioSyncTag, syncTagsEqual } from '../../metadata/sync-tags.js';
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
 * The legacy `bitrateTolerance` knob (which once slackened the now-removed
 * DB-bitrate fallback) is reinterpreted here as the symmetric default for the
 * source-bound tolerances: a user who set `bitrateTolerance` still gets a
 * (now source-bound) damper, while an explicit `toleranceUp`/`toleranceDown`
 * always wins. The classifier applies `?? 0` at the comparison, so an unset
 * value stays exact.
 */
function qualityTargetFromConfig(config: ResolvedMusicConfig): QualityTarget {
  return {
    preset: config.resolvedQuality ?? '',
    presetBitrate: config.presetBitrate ?? 0,
    encoding: config.raw.encoding ?? 'vbr',
    customBitrate: config.raw.customBitrate,
    isAlacPreset: config.isAlacPreset ?? false,
    resolvedLossyCodec: config.resolvedLossyCodec,
    toleranceUp: config.raw.toleranceUp ?? config.raw.bitrateTolerance,
    toleranceDown: config.raw.toleranceDown ?? config.raw.bitrateTolerance,
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
    // Only route as an update when the policy gate fires (`reEncodes`). A
    // suppressed source-bound change (e.g. a source improvement under
    // `bitrate.sync = down-only`/`off`) is left in `existing`; for a sync-tagged
    // track the device bound then surfaces it via the report-only channel. An
    // untagged track is opted out of the device bound entirely, so a suppressed
    // improvement on it is silently left alone — consistent with the untagged
    // opt-out elsewhere.
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
      this.config.bitrateSync
    );
    if (!change) return null;

    if (change.reason === 'lossless-boundary' && getIpodFormatFamily(device) === 'aac') {
      return null;
    }

    // A lossy source whose bitrate exceeds the cap is owned by the device-bound
    // cap path, not the (cap-unaware) source bound. The source bound compares the
    // raw source bitrate against the device's DB bitrate; after a cap-down the
    // device sits AT the cap, so for a same-family source still above the cap the
    // source bound would fire `source-improved` and COPY the over-cap source back
    // — re-exceeding the cap and oscillating against the next sync's cap-down.
    // The device bound handles this correctly: it reads the authoritative sync-tag
    // bitrate and re-encodes from the source to `min(source, cap)`. With no lossy
    // cap (a lossless target) the legacy source-improved copy is left in place.
    const cap = this.config.presetBitrate ?? 0;
    if (change.reason === 'source-improved' && cap > 0 && (source.bitrate ?? 0) > cap) {
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
      // Lossy sources take a dedicated cap-enforcement path. The classifier
      // would route a compatible/device-native lossy source to a COPY, but a
      // lossy cap move must re-encode (DOWN to the cap, or UP from the source
      // toward min(source, cap)) — so the classifier's routing is irrelevant
      // here. classifyDeviceBound's lossy branch reads the authoritative recorded
      // bitrate from the sync tag.
      if (!isSourceLossless(match.source)) {
        const change = classifyDeviceBound({
          source: match.source,
          device: match.device,
          target,
          policy: this.config.bitrateSync,
        });
        if (!change) return null;
        // A source-down change (the source re-ripped below the device copy) is
        // report-only: keep the better device copy in `existing`, surface it via
        // the report-only channel, and create NO operation. Returning null here
        // leaves the track in `existing` so it never inflates tracksToUpdate.
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
        policy: this.config.bitrateSync,
      });

      if (!change) return null;

      // A policy-suppressed change (e.g. a lossless preset move under
      // `bitrate.sync = off`/`up-only`) keeps the existing copy: report it via
      // the report-only channel and create no operation. Preconditions
      // (encoding/lossless boundary) always carry `reEncodes: true` and fall
      // through to the re-encode path below.
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
   * the ONE explicit, destructive adoption path: it routes those untagged
   * tracks to a re-encode (`quality-change` → `upgrade-transcode`) targeting the
   * resolved device quality, so the executor establishes true bitrate + encoding
   * ground truth and writes the authoritative sync tag.
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

      // Force a re-encode from the source. For lossy sources with a cap the
      // effective ceiling is min(source, cap); `resolveUpgradeAction` reads this
      // off the attached `qualityChange` and stamps it as the preset's
      // bitrateOverride so the post-adoption tag matches the next sync (no-op).
      // For lossless sources the classifier owns routing (transcode to the
      // resolved lossless/lossy preset) and ignores this payload.
      const lossy = !isSourceLossless(match.source);
      const effectiveTarget = lossy && cap > 0 ? Math.min(match.source.bitrate ?? cap, cap) : cap;

      // The adoption re-encode bypasses the policy gate, so the direction is
      // descriptive only — it labels the move for the change summary and JSON.
      // Read the device's DB bitrate purely for that display (it is not used to
      // decide anything). Adopting an over-cap track moves it down.
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
   * Normally this is the classifier's decision for the source. The exception is
   * a lossy re-encode that fired on the device bound: cap-DOWN, cap-UP, a CBR/VBR
   * `encoding-mismatch`, or a source-down that the `match-all` policy chose to
   * follow. The classifier would COPY a compatible/device-native lossy source
   * as-is, but these must RE-ENCODE it — down to the configured cap, up from the
   * source toward the effective ceiling `min(source, cap)`, to the same effective
   * target with a flipped encoding mode, or down to the (degraded) source under
   * `match-all`. Force a transcode at the resolved preset, recording the change's
   * effective target bitrate as the preset's `bitrateOverride` so the executor
   * stamps the new encoded bitrate into the sync tag — making the next sync a
   * no-op (idempotent). The target may be the source bitrate (cap-up bounded by
   * the source, or a followed source-down), so the override comes from the
   * change, not the config-wide preset bitrate. All other upgrades
   * (source-improved, lossless-boundary, codec-changed, force-transcode,
   * transfer-mode-changed) keep the classifier's routing unchanged.
   */
  private resolveUpgradeAction(
    source: CollectionTrack,
    qualityChange?: QualityChange
  ): import('./classifier.js').MusicAction {
    if (
      (qualityChange?.reason === 'cap-down' ||
        qualityChange?.reason === 'cap-up' ||
        qualityChange?.reason === 'encoding-mismatch' ||
        qualityChange?.reason === 'source-down-suppressed') &&
      qualityChange.reEncodes &&
      !isSourceLossless(source) &&
      this.config.resolvedQuality &&
      this.config.resolvedQuality !== 'lossless'
    ) {
      // The effective target the classifier computed: the cap for cap-down,
      // min(source, cap) for cap-up. Recorded as bitrateOverride so the
      // post-re-encode sync tag carries the new encoded bitrate (idempotency).
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
