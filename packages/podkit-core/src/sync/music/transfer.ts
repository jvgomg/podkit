/**
 * MusicTransferOps — encapsulates the music pipeline's "transfer to device"
 * stage 3 operations.
 *
 * Owns the two big transfer dispatchers that used to live on `MusicPipeline`:
 *   - `transferToIpod` — add-track path (transcode, direct-copy, optimized-copy);
 *     delegates to `transferUpgradeToIpod` for the four `upgrade-*` operation
 *     types.
 *   - `transferUpgradeToIpod` — upgrade path (replaces an existing track's file
 *     and/or artwork while preserving the database entry).
 *
 * Plus the small sync-tag builder used by both methods.
 *
 * Construction takes the device adapter and the artwork manager. No warnings
 * are produced here today; sync-tag failures throw rather than surface as
 * warnings. If that changes (e.g., partial-success sync-tag writes), a
 * `WarningSink` can be threaded through symmetric with `MusicArtworkManager`.
 *
 * @module
 */

import { fileTypeToAudioCodec } from './planner.js';
import { buildAudioSyncTag, buildCopySyncTag } from '../../metadata/sync-tags.js';
import type { SyncTagData } from '../../metadata/sync-tags.js';
import type { CollectionTrack } from '../../adapters/interface.js';
import type { DeviceAdapter, DeviceTrack, DeviceTrackInput } from '../../device/adapter.js';
import type { SyncOperation } from '../engine/types.js';
import type { ExecutionContext } from './execution-context.js';
import type { MusicArtworkManager } from './artwork.js';
import type { PreparedFile, MusicUpgradeOperationType } from './pipeline-types.js';

/**
 * Convert CollectionTrack to DeviceTrackInput for the device adapter.
 *
 * Lives here because `transferToIpod` is the only call site; if a future
 * caller needs it, promote to a shared module.
 */
function toDeviceTrackInput(track: CollectionTrack): DeviceTrackInput {
  return {
    title: track.title,
    artist: track.artist,
    album: track.album,
    albumArtist: track.albumArtist,
    genre: track.genre,
    year: track.year,
    trackNumber: track.trackNumber,
    discNumber: track.discNumber,
    compilation: track.compilation,
    duration: track.duration,
    bitrate: track.bitrate,
    normalization: track.normalization,
  };
}

/**
 * Encapsulates the music pipeline's stage-3 (USB I/O bound) transfer step.
 */
export class MusicTransferOps {
  constructor(
    private readonly device: DeviceAdapter,
    private readonly artwork: MusicArtworkManager
  ) {}

  /**
   * Transfer a prepared file to the iPod.
   *
   * This is the USB I/O-bound part of the operation. It adds the track to
   * the database, copies the file, and transfers artwork.
   *
   * For upgrade operations, replaces the existing file while preserving
   * the database entry (play counts, ratings, playlists).
   */
  async transferToIpod(
    prepared: PreparedFile,
    ctx: ExecutionContext
  ): Promise<{ bytesTransferred: number; track: DeviceTrack }> {
    const { operation, sourcePath, size, bitrate, filetype, artworkSourcePath } = prepared;

    // Upgrade operations: replace file on existing track
    if (
      operation.type === 'upgrade-transcode' ||
      operation.type === 'upgrade-direct-copy' ||
      operation.type === 'upgrade-optimized-copy' ||
      operation.type === 'upgrade-artwork'
    ) {
      return this.transferUpgradeToIpod(prepared, ctx);
    }

    const source = operation.source;

    // Add track to iPod database
    const trackInput: DeviceTrackInput = {
      ...toDeviceTrackInput(source),
      filetype,
      ...(bitrate !== undefined && { bitrate }),
      transferMode: ctx.transferMode,
    };

    // Write sync tag for transcode operations
    if (operation.type === 'add-transcode' && operation.preset) {
      const syncTag = this.buildSyncTagForPreset(
        operation.preset.name,
        operation.preset.targetCodec,
        ctx,
        operation.preset.bitrateOverride
      );
      if (syncTag) {
        trackInput.syncTag = syncTag;
      }
    }

    // Write sync tag for copy operations (direct-copy and optimized-copy).
    // Record the effective bitrate (transcoder output when present — optimized
    // copy may re-encode — else the source's reported bitrate) so the device-side
    // bound has authoritative `encoded` data for lossy cap enforcement.
    if (
      (operation.type === 'add-direct-copy' || operation.type === 'add-optimized-copy') &&
      ctx.syncTagConfig
    ) {
      const sourceCodec = fileTypeToAudioCodec(operation.source.fileType, operation.source.codec);
      const effectiveBitrate = bitrate ?? operation.source.bitrate;
      const copySyncTag = buildCopySyncTag(
        ctx.transferMode ?? 'fast',
        undefined,
        sourceCodec,
        effectiveBitrate
      );
      trackInput.syncTag = copySyncTag;
    }

    const track = this.device.addTrack(trackInput);

    // Copy file to device
    this.device.copyTrackFile(track, sourcePath);

    // Request ReplayGain tag writes for transcoded/optimized-copy files.
    // Direct-copy files already have correct tags from the source — no write needed.
    // FFmpeg handles MP3/FLAC/OGG during transcode, but M4A needs the tag writer.
    if (
      operation.type !== 'add-direct-copy' &&
      ctx.audioNormalization === 'replaygain' &&
      source.normalization !== undefined
    ) {
      this.device.updateTrack(track, {
        writeReplayGainTags: true,
        normalization: source.normalization,
      });
    }

    // Extract and transfer artwork if enabled.
    // Use artworkSourcePath which is the original source file (or downloaded temp for remote).
    // Skip when the source explicitly has no artwork (hasArtwork === false) — the album-level
    // artwork cache could otherwise serve a sibling track's artwork for this no-artwork track,
    // falsely setting hasArtwork=true on the iPod and triggering artwork-removed on the next sync.
    //
    // The outer `ctx.artworkEnabled` check matters even though `transferArtwork` short-
    // circuits on the same flag — the `!artHash && track.hasArtwork` stale-cleanup branch
    // below would otherwise fire on `artwork-disabled` syncs and wipe existing device
    // artwork the user wanted to keep.
    if (ctx.artworkEnabled && source.hasArtwork !== false) {
      const extractedHash = await this.artwork.transferArtwork(
        track,
        artworkSourcePath,
        source,
        ctx
      );
      // Resolve the hash for the syncTag claim. Two-stage:
      //   1. transferArtwork returns undefined when no bytes landed on the
      //      device — global artwork disabled, or sink === 'noop'. In that
      //      case we MUST NOT write syncTag.artworkHash regardless of
      //      source.artworkHash: a hash on the syncTag implies the device has
      //      art, but no bytes landed, so the next sync's detectUpgrades
      //      would fire artwork-added forever (doc-041 §3.6 churn loop).
      //   2. When bytes DID land, prefer source.artworkHash over extractedHash.
      //      For Subsonic, getCoverArt returns processed bytes that differ
      //      from the raw embedded bytes in the audio file; using the
      //      adapter's hash ensures the sync tag matches what the adapter
      //      will compute on the next scan (consistency).
      const artHash =
        extractedHash !== undefined ? (source.artworkHash ?? extractedHash) : undefined;
      // Progressive hash write: when artwork is transferred, include the hash in the sync tag.
      // For transcode operations, the sync tag already exists — append the artwork hash.
      // For copy operations, no sync tag was written above, so create a minimal one
      // containing just the artwork hash so --check-artwork can detect future changes.
      if (artHash && ctx.syncTagConfig) {
        if (track.syncTag) {
          this.device.writeSyncTag(track, { artworkHash: artHash });
        } else if (
          operation.type === 'add-direct-copy' ||
          operation.type === 'add-optimized-copy'
        ) {
          // Copy operation: no existing sync tag. Write a minimal tag with just the artwork hash.
          this.device.writeSyncTag(track, { quality: 'copy', artworkHash: artHash });
        }
      } else if (!artHash && track.hasArtwork) {
        // Defensive: artwork extraction returned null but track somehow has artwork — clean up.
        // Note we hit this branch for sink === 'noop'/'sidecar' too — but on those sinks
        // track.hasArtwork is false (no bytes ever landed), so the guard is inert.
        await this.device.removeTrackArtwork(track);
      }
    }

    return { bytesTransferred: size, track };
  }

  /**
   * Transfer an upgrade file to the iPod, replacing the existing track's file.
   *
   * Preserves the database entry (play counts, ratings, playlist membership)
   * while swapping the audio file and updating technical metadata.
   *
   * For `artwork-updated` upgrades, the audio file is NOT replaced — only the
   * artwork is re-extracted from the source and transferred to the iPod.
   */
  private async transferUpgradeToIpod(
    prepared: PreparedFile,
    ctx: ExecutionContext
  ): Promise<{ bytesTransferred: number; track: DeviceTrack }> {
    const { sourcePath, size, bitrate, filetype, artworkSourcePath } = prepared;
    const operation = prepared.operation as Extract<
      SyncOperation,
      { type: MusicUpgradeOperationType }
    >;
    const { source, target } = operation;

    // Find the existing track in the database by filePath
    const tracks = this.device.getTracks();
    let foundTrack = tracks.find((t) => t.filePath === target.filePath);

    // Fall back to metadata matching
    if (!foundTrack) {
      foundTrack = tracks.find(
        (t) => t.title === target.title && t.artist === target.artist && t.album === target.album
      );
    }

    if (!foundTrack) {
      throw new Error(
        `Track not found in database for upgrade: ${target.artist} - ${target.title}`
      );
    }

    // artwork-removed: remove artwork from iPod track and clear artworkHash from sync tag
    if (operation.reason === 'artwork-removed') {
      await this.device.removeTrackArtwork(foundTrack);
      // The adapter mutates the underlying handle's state in place; the
      // foundTrack snapshot still carries the pre-removal `hasArtwork: true`
      // but its `syncTag` is parsed from the comment (unchanged), so we can
      // continue using it as the writeSyncTag target.
      if (ctx.syncTagConfig && foundTrack.syncTag?.artworkHash) {
        foundTrack = this.device.writeSyncTag(foundTrack, { artworkHash: undefined });
      }
      return { bytesTransferred: 0, track: foundTrack };
    }

    // artwork-updated: skip audio file transfer, only re-extract and update artwork + sync tag
    if (operation.reason === 'artwork-updated') {
      if (!ctx.artworkEnabled) {
        // artwork-updated with artwork disabled is a no-op — skip silently
        return { bytesTransferred: 0, track: foundTrack };
      }
      const extractedHash = await this.artwork.transferArtwork(
        foundTrack,
        artworkSourcePath,
        source,
        ctx
      );
      // Suppress the syncTag.artworkHash claim when transferArtwork returned
      // undefined — no bytes landed on the device (sink === 'noop' / 'sidecar').
      // Writing a hash anyway would recreate the churn loop documented in
      // doc-041 §3.6. See transferToIpod for the full rationale.
      const artHash =
        extractedHash !== undefined ? (source.artworkHash ?? extractedHash) : undefined;
      if (artHash && ctx.syncTagConfig) {
        if (foundTrack.syncTag) {
          foundTrack = this.device.writeSyncTag(foundTrack, { artworkHash: artHash });
        } else {
          // No existing sync tag (e.g., copied lossy track). Write minimal tag with artwork hash.
          foundTrack = this.device.writeSyncTag(foundTrack, {
            quality: 'copy',
            artworkHash: artHash,
          });
        }
      }
      return { bytesTransferred: 0, track: foundTrack };
    }

    // Replace the audio file (preserves database entry, playlists, play counts)
    foundTrack = this.device.replaceTrackFile(foundTrack, sourcePath);

    // Update technical metadata to reflect the new file.
    //
    // Bitrate resolution order:
    //   1. `prepared.bitrate` — populated by the transcoder (upgrade-transcode
    //      and upgrade-optimized-copy don't set this today either, but
    //      future codepaths might). Always preferred when present because
    //      it reflects the ACTUAL output bytes, not the source's reported
    //      bitrate.
    //   2. `source.bitrate` — the upgraded source's reported bitrate.
    //      Required for `upgrade-direct-copy`: without it, a quality-upgrade
    //      (e.g. 96 → 256 kbps MP3 source bump) replaces the file but leaves
    //      the iPod bitrate field at the OLD value, which makes the next
    //      sync re-detect the same quality-upgrade in an infinite loop.
    const resolvedBitrate = bitrate ?? source.bitrate;
    const updateFields: import('../../device/adapter.js').DeviceTrackMetadata = {
      filetype,
      ...(resolvedBitrate !== undefined && { bitrate: resolvedBitrate }),
      ...(source.duration !== undefined && { duration: source.duration }),
      ...(source.normalization !== undefined && { normalization: source.normalization }),
    };

    // Update metadata fields from source that may have changed
    if (source.genre !== undefined) updateFields.genre = source.genre;
    if (source.year !== undefined) updateFields.year = source.year;
    if (source.trackNumber !== undefined) updateFields.trackNumber = source.trackNumber;
    if (source.discNumber !== undefined) updateFields.discNumber = source.discNumber;
    if (source.albumArtist !== undefined) updateFields.albumArtist = source.albumArtist;
    if (source.compilation !== undefined) updateFields.compilation = source.compilation;

    // Request ReplayGain tag writes for transcoded/optimized-copy upgrades.
    // Direct-copy upgrades preserve source file tags — no write needed.
    if (
      operation.type !== 'upgrade-direct-copy' &&
      ctx.audioNormalization === 'replaygain' &&
      source.normalization !== undefined
    ) {
      updateFields.writeReplayGainTags = true;
      updateFields.normalization = source.normalization;
    }

    foundTrack = this.device.updateTrack(foundTrack, updateFields);

    // Write sync tag for upgrade-transcode operations (has preset)
    if (operation.type === 'upgrade-transcode') {
      const syncTag = this.buildSyncTagForPreset(
        operation.preset.name,
        operation.preset.targetCodec,
        ctx,
        operation.preset.bitrateOverride
      );
      if (syncTag) {
        foundTrack = this.device.writeSyncTag(foundTrack, syncTag);
      }
    }

    // Write sync tag for upgrade-direct-copy and upgrade-optimized-copy
    // operations. Record the effective bitrate (transcoder output when present,
    // else the upgraded source's reported bitrate) — same resolution as the
    // track-record bitrate above.
    if (
      (operation.type === 'upgrade-direct-copy' || operation.type === 'upgrade-optimized-copy') &&
      ctx.syncTagConfig
    ) {
      const sourceCodec = fileTypeToAudioCodec(operation.source.fileType, operation.source.codec);
      const copySyncTag = buildCopySyncTag(
        ctx.transferMode ?? 'fast',
        undefined,
        sourceCodec,
        resolvedBitrate
      );
      foundTrack = this.device.writeSyncTag(foundTrack, copySyncTag);
    }

    // Extract and transfer artwork if enabled.
    // Skip when the source explicitly has no artwork (hasArtwork === false) — see transferToIpod
    // for a full explanation of why this guard is necessary, and why the `artworkEnabled`
    // check has to be at the call site (the stale-cleanup branch below has the same wipe
    // hazard as the add-track path).
    if (ctx.artworkEnabled && source.hasArtwork !== false) {
      const extractedHash = await this.artwork.transferArtwork(
        foundTrack,
        artworkSourcePath,
        source,
        ctx
      );
      // Suppress the syncTag.artworkHash claim when transferArtwork returned
      // undefined — see transferToIpod for the full rationale (doc-041 §3.6
      // churn loop).
      const artHash =
        extractedHash !== undefined ? (source.artworkHash ?? extractedHash) : undefined;
      if (artHash && ctx.syncTagConfig) {
        // Progressive hash write: include artwork hash in sync tag for future change detection
        if (foundTrack.syncTag) {
          foundTrack = this.device.writeSyncTag(foundTrack, { artworkHash: artHash });
        } else if (operation.type !== 'upgrade-transcode') {
          // Copy upgrade: no sync tag was written. Write a minimal tag with the artwork hash.
          foundTrack = this.device.writeSyncTag(foundTrack, {
            quality: 'copy',
            artworkHash: artHash,
          });
        }
      } else if (!artHash && foundTrack.hasArtwork) {
        // Artwork extraction returned null but iPod track has artwork — clean up stale artwork.
        // On 'noop'/'sidecar' sinks foundTrack.hasArtwork is false so this guard is inert.
        await this.device.removeTrackArtwork(foundTrack);
        // Clear artworkHash from sync tag if present (foundTrack.syncTag is
        // parsed from the unchanged comment field, so it survives the remove).
        if (ctx.syncTagConfig && foundTrack.syncTag?.artworkHash) {
          foundTrack = this.device.writeSyncTag(foundTrack, { artworkHash: undefined });
        }
      }
    }

    return { bytesTransferred: size, track: foundTrack };
  }

  /**
   * Build a SyncTagData from a preset name and the current sync tag config.
   *
   * Returns undefined if no sync tag config is set (sync tags disabled).
   */
  private buildSyncTagForPreset(
    presetName: string,
    targetCodec: string | undefined,
    ctx: ExecutionContext,
    bitrateOverride?: number
  ): SyncTagData | undefined {
    if (!ctx.syncTagConfig) {
      return undefined;
    }

    return buildAudioSyncTag(
      presetName,
      ctx.syncTagConfig.encodingMode,
      // Prefer the preset's explicit bitrate override over the config-wide custom
      // bitrate. A lossy cap-down transcode sets `bitrateOverride` to the cap so
      // the recorded sync-tag bitrate matches the new encoded value, making the
      // next sync idempotent. Symmetric with `expectedSyncTagFromClassification`,
      // which also prefers `preset.bitrateOverride ?? customBitrate`.
      bitrateOverride ?? ctx.syncTagConfig.customBitrate,
      ctx.transferMode,
      targetCodec
    );
  }
}
