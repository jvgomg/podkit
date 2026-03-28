/**
 * Codec metadata table
 *
 * Source of truth for all supported transcoding target codecs.
 * Consumed by the codec resolver, FFmpeg builders, and device adapters.
 *
 * WAV and AIFF are valid source formats but are NOT transcoding targets,
 * so they do not appear in this table.
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Codec identifiers for transcoding targets.
 *
 * These are the codecs that podkit can produce as output.
 * Source-only formats (WAV, AIFF) are not included.
 */
export type TranscodeTargetCodec = 'aac' | 'alac' | 'opus' | 'mp3' | 'flac';

/**
 * Metadata describing a codec's container, file format, and FFmpeg settings.
 */
export interface CodecMetadata {
  /** Audio codec name */
  codec: TranscodeTargetCodec;
  /** Container format */
  container: string;
  /** File extension (with leading dot) */
  extension: string;
  /** FFmpeg `-f` format flag */
  ffmpegFormat: string;
  /** Human-readable filetype label for device databases */
  filetypeLabel: string;
  /** Output sample rate in Hz */
  sampleRate: number;
  /** Lossy or lossless */
  type: 'lossy' | 'lossless';
}

// =============================================================================
// Codec Metadata Table
// =============================================================================

/**
 * Codec metadata for all supported transcoding targets.
 *
 * This is the canonical source of truth for container format, file extension,
 * FFmpeg format flag, and other codec properties.
 */
export const CODEC_METADATA: Record<TranscodeTargetCodec, CodecMetadata> = {
  aac: {
    codec: 'aac',
    container: 'M4A',
    extension: '.m4a',
    ffmpegFormat: 'ipod',
    filetypeLabel: 'AAC audio file',
    sampleRate: 44100,
    type: 'lossy',
  },
  alac: {
    codec: 'alac',
    container: 'M4A',
    extension: '.m4a',
    ffmpegFormat: 'ipod',
    filetypeLabel: 'ALAC audio file',
    sampleRate: 44100,
    type: 'lossless',
  },
  opus: {
    codec: 'opus',
    container: 'OGG',
    extension: '.opus',
    ffmpegFormat: 'ogg',
    filetypeLabel: 'Opus audio file',
    sampleRate: 48000,
    type: 'lossy',
  },
  mp3: {
    codec: 'mp3',
    container: 'MP3',
    extension: '.mp3',
    ffmpegFormat: 'mp3',
    filetypeLabel: 'MPEG audio file',
    sampleRate: 44100,
    type: 'lossy',
  },
  flac: {
    codec: 'flac',
    container: 'FLAC',
    extension: '.flac',
    ffmpegFormat: 'flac',
    filetypeLabel: 'FLAC audio file',
    sampleRate: 44100,
    type: 'lossless',
  },
} as const;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get codec metadata for a given codec identifier.
 *
 * @param codec - The codec to look up
 * @returns The codec's metadata
 */
export function getCodecMetadata(codec: TranscodeTargetCodec): CodecMetadata {
  return CODEC_METADATA[codec];
}

// =============================================================================
// Default Codec Stacks
// =============================================================================

/**
 * Default lossy codec preference stack (ordered by priority).
 *
 * When transcoding lossy audio, the first codec in this list that the
 * target device supports will be used.
 */
export const DEFAULT_LOSSY_STACK: TranscodeTargetCodec[] = ['opus', 'aac', 'mp3'];

/**
 * Default lossless codec preference stack (ordered by priority).
 *
 * When quality=max and the source is lossless, the first entry in this
 * list that the target device supports will be used. The special value
 * `'source'` means "copy the source file as-is without transcoding".
 */
export const DEFAULT_LOSSLESS_STACK: (TranscodeTargetCodec | 'source')[] = [
  'source',
  'flac',
  'alac',
];
