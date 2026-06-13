/**
 * Pure helpers extracted from the music pipeline: filetype detection,
 * filetype/display labels, transcode preset construction, operation display
 * names, phase mapping, plan-size accounting.
 *
 * Kept stateless (no `this`, no module-level state) so they're trivially
 * testable in isolation and don't widen `pipeline.ts`'s import surface.
 * `pipeline.ts` re-exports the public symbols so existing consumers of
 * `@podkit/core` (and the package-internal imports) don't break.
 *
 * @module
 */

import { extname } from 'node:path';

import type { CollectionTrack } from '../../adapters/interface.js';
import type { AudioFileType } from '../../types.js';
import type { EncoderConfig, OptimizedCopyFormat } from '../../transcode/ffmpeg.js';
import { getCodecMetadata } from '../../transcode/codecs.js';
import {
  getCodecPresetBitrate,
  getCodecVbrQuality,
  type EncodingMode,
  type QualityPreset,
} from '../../transcode/types.js';
import type { SyncOperation, SyncPlan, SyncProgress, TranscodePresetRef } from '../engine/types.js';

function assertNever(_value: never, message: string): never {
  throw new Error(message);
}

/**
 * Map a known file extension to its `AudioFileType` discriminant, or `null`
 * for unrecognised extensions.
 *
 * Kept extension-driven (not codec-driven) because the call sites only have
 * `source.filePath` in scope and ALAC tracks legitimately diverge from this
 * mapping: ALAC lives in a `.m4a` container but has `fileType = 'alac'`. The
 * extension `.m4a` therefore resolves to `m4a` (AAC display label) here, and
 * the codec-aware paths handle ALAC disambiguation elsewhere
 * (see `getOptimizedCopyFormat`).
 */
export function extensionToAudioFileType(ext: string): AudioFileType | null {
  switch (ext) {
    case '.mp3':
      return 'mp3';
    case '.m4a':
      return 'm4a';
    case '.aac':
      return 'aac';
    case '.alac':
      return 'alac';
    case '.opus':
      return 'opus';
    case '.flac':
      return 'flac';
    case '.ogg':
      return 'ogg';
    case '.wav':
      return 'wav';
    case '.aiff':
    case '.aif':
      return 'aiff';
    default:
      return null;
  }
}

/**
 * Get the human-readable filetype label for an `AudioFileType` discriminant.
 *
 * Exhaustive over `AudioFileType` via `assertNever`: adding a new member to
 * `AudioFileType` is a compile error here, forcing an explicit decision
 * instead of silently producing a `'Audio file'` fallback (which the
 * mass-storage adapter then turns into a `.Audio file` filename on the
 * device — see `KNOWN_DEBRIS_EXTENSIONS` in `device/mass-storage-utils.ts`).
 */
export function getFileTypeLabelForFileType(fileType: AudioFileType): string {
  switch (fileType) {
    case 'mp3':
      return 'MPEG audio file';
    case 'm4a':
    case 'aac':
      return 'AAC audio file';
    case 'alac':
      // Match CODEC_METADATA.alac.filetypeLabel so the mass-storage adapter's
      // resolveFileExtension round-trips this label back to .m4a (ALAC's real
      // container) instead of landing a `.Apple Lossless audio file` filename.
      return 'ALAC audio file';
    case 'opus':
      return 'Opus audio file';
    case 'flac':
      return 'FLAC audio file';
    case 'ogg':
      return 'Ogg Vorbis audio file';
    case 'wav':
      return 'WAV audio file';
    case 'aiff':
      return 'AIFF audio file';
    default:
      return assertNever(fileType, `unhandled AudioFileType for filetype label: ${fileType}`);
  }
}

/**
 * Get a human-readable filetype label based on file extension.
 *
 * Used for the iPod database `filetype` field which displays the format
 * in iTunes and on the device.
 *
 * Unrecognised extensions return the generic `'Audio file'` fallback. This
 * is preserved for defence-in-depth: source files reach this helper from
 * adapter-supplied `CollectionTrack.filePath` strings, and an upstream bug
 * that delivered a non-audio path (or a typed-but-not-yet-mapped extension)
 * shouldn't crash the sync. The compile-time exhaustiveness check lives in
 * `getFileTypeLabelForFileType` instead.
 */
export function getFileTypeLabel(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const fileType = extensionToAudioFileType(ext);
  if (fileType === null) return 'Audio file';
  return getFileTypeLabelForFileType(fileType);
}

/**
 * Map a track's source `fileType` to the FFmpeg container format used for
 * optimized-copy. Exhaustive over `AudioFileType`: adding a new file type
 * forces an explicit decision here (the compiler points at the never branch).
 *
 * ALAC files are stored in the same .m4a container as AAC; the codec is the
 * disambiguator, so it overrides the fileType-based mapping when present.
 */
export function getOptimizedCopyFormat(track: CollectionTrack): OptimizedCopyFormat {
  if (track.codec?.toLowerCase() === 'alac') return 'alac';
  switch (track.fileType) {
    case 'mp3':
      return 'mp3';
    case 'alac':
      return 'alac';
    case 'opus':
      return 'opus';
    case 'ogg':
      return 'vorbis';
    case 'flac':
      return 'flac';
    case 'm4a':
    case 'aac':
      return 'm4a';
    case 'wav':
    case 'aiff':
      // WAV/AIFF aren't valid optimized-copy outputs on any device today —
      // mass-storage filters them and iPod transcodes lossless to ALAC/AAC.
      // Surface the misuse early instead of corrupting the file with the
      // wrong container.
      throw new Error(
        `optimized-copy unsupported for ${track.fileType} sources (would need a separate container handler)`
      );
    default:
      return assertNever(
        track.fileType,
        `unhandled fileType for optimized-copy: ${track.fileType}`
      );
  }
}

/**
 * Build a transcode preset argument for the transcoder.
 *
 * When the preset has a targetCodec, builds a full EncoderConfig so the
 * transcoder knows which codec to use. Otherwise falls back to passing
 * the preset name directly (legacy AAC path).
 */
export function buildTranscodePreset(
  preset: TranscodePresetRef,
  encodingMode?: EncodingMode
): QualityPreset | 'lossless' | EncoderConfig {
  if (!preset.targetCodec) {
    // Legacy path: pass preset name (resolves to AAC internally)
    return preset.name;
  }

  // Lossless: ALAC uses the legacy 'lossless' string path; FLAC uses EncoderConfig
  if (preset.name === 'lossless') {
    if (preset.targetCodec === 'flac') {
      return { codec: 'flac', bitrateKbps: 0, encoding: 'vbr' };
    }
    return 'lossless';
  }

  // Build EncoderConfig for codec-aware transcoding
  const config: EncoderConfig = {
    codec: preset.targetCodec,
    bitrateKbps:
      preset.bitrateOverride ?? getCodecPresetBitrate(preset.targetCodec, preset.name) ?? 256,
    encoding: encodingMode ?? 'vbr',
    quality: getCodecVbrQuality(preset.targetCodec, preset.name),
  };
  return config;
}

/**
 * Get the output file extension for a transcode preset.
 * When the preset has a targetCodec, uses codec metadata; otherwise defaults to `.m4a` (AAC).
 */
export function getTranscodeOutputExtension(preset: TranscodePresetRef): string {
  if (preset.targetCodec) {
    return getCodecMetadata(preset.targetCodec).extension;
  }
  return '.m4a';
}

/**
 * Get the filetype label for a transcode preset.
 * When the preset has a targetCodec, uses codec metadata; otherwise defaults to `'AAC audio file'`.
 */
export function getTranscodeFiletypeLabel(preset: TranscodePresetRef): string {
  if (preset.targetCodec) {
    return getCodecMetadata(preset.targetCodec).filetypeLabel;
  }
  return 'AAC audio file';
}

/**
 * Get a display name for an operation (for progress reporting)
 */
export function getMusicOperationDisplayName(operation: SyncOperation): string {
  switch (operation.type) {
    case 'add-transcode':
      return `${operation.source.artist} - ${operation.source.title}`;
    case 'add-direct-copy':
      return `${operation.source.artist} - ${operation.source.title}`;
    case 'add-optimized-copy':
      return `${operation.source.artist} - ${operation.source.title}`;
    case 'remove':
      return `${operation.track.artist} - ${operation.track.title}`;
    case 'update-metadata':
    case 'update-sync-tag':
      return `${operation.track.artist} - ${operation.track.title}`;
    case 'relocate':
      return `${operation.source.artist} - ${operation.source.title}`;
    case 'upgrade-transcode':
    case 'upgrade-direct-copy':
    case 'upgrade-optimized-copy':
    case 'upgrade-artwork':
      return `${operation.source.artist} - ${operation.source.title}`;
    case 'video-transcode':
    case 'video-copy':
      return operation.source.title;
    case 'video-remove':
      return operation.video.title;
    case 'video-update-metadata':
      return operation.video.title;
    case 'video-upgrade':
      return operation.source.title;
  }
}

/**
 * Calculate total bytes for a plan
 */
export function calculateTotalBytes(plan: SyncPlan): number {
  // Use the estimated size from the plan
  return plan.estimatedSize;
}

/**
 * Get the phase name for an operation type
 */
export function getPhaseForOperation(operation: SyncOperation): SyncProgress['phase'] {
  switch (operation.type) {
    case 'add-transcode':
      return 'transcoding';
    case 'add-direct-copy':
    case 'add-optimized-copy':
      return 'copying';
    case 'remove':
      return 'removing';
    case 'update-metadata':
    case 'update-sync-tag':
    case 'relocate':
      return 'updating-metadata';
    case 'upgrade-transcode':
    case 'upgrade-direct-copy':
    case 'upgrade-optimized-copy':
    case 'upgrade-artwork':
      return 'upgrading';
    case 'video-transcode':
      return 'video-transcoding';
    case 'video-copy':
      return 'video-copying';
    case 'video-remove':
      return 'removing';
    case 'video-update-metadata':
      return 'video-updating-metadata';
    case 'video-upgrade':
      return 'video-upgrading';
  }
}
