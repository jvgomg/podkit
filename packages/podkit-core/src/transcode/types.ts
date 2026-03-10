/**
 * Transcoding types and presets
 *
 * FFmpeg-based transcoding for converting audio files
 * to iPod-compatible formats (AAC/M4A or ALAC).
 *
 * ## Quality Presets
 *
 * All presets are self-contained (no separate mode flag):
 *
 * | Preset | Type | Target | Notes |
 * |--------|------|--------|-------|
 * | `alac` | Lossless | N/A | Only from lossless sources |
 * | `max` | VBR | ~320 kbps | Highest VBR quality level |
 * | `max-cbr` | CBR | 320 kbps | Guaranteed 320 kbps |
 * | `high` | VBR | ~256 kbps | Transparent quality (default) |
 * | `high-cbr` | CBR | 256 kbps | Predictable file sizes |
 * | `medium` | VBR | ~192 kbps | Excellent quality |
 * | `medium-cbr` | CBR | 192 kbps | |
 * | `low` | VBR | ~128 kbps | Good quality, space-efficient |
 * | `low-cbr` | CBR | 128 kbps | |
 */

// =============================================================================
// Quality Presets
// =============================================================================

/**
 * Quality preset names for transcoding
 *
 * - `alac`: Lossless (ALAC) - only valid for lossless sources
 * - `max`: VBR ~320 kbps - highest VBR quality level
 * - `max-cbr`: CBR 320 kbps - guaranteed 320 kbps
 * - `high`: VBR ~256 kbps - transparent quality (default)
 * - `high-cbr`: CBR 256 kbps - predictable file sizes
 * - `medium`: VBR ~192 kbps - excellent quality
 * - `medium-cbr`: CBR 192 kbps
 * - `low`: VBR ~128 kbps - good quality, space-efficient
 * - `low-cbr`: CBR 128 kbps
 */
export type QualityPreset =
  | 'alac'
  | 'max'
  | 'max-cbr'
  | 'high'
  | 'high-cbr'
  | 'medium'
  | 'medium-cbr'
  | 'low'
  | 'low-cbr';

/**
 * All valid quality preset names
 */
export const QUALITY_PRESETS: readonly QualityPreset[] = [
  'alac',
  'max',
  'max-cbr',
  'high',
  'high-cbr',
  'medium',
  'medium-cbr',
  'low',
  'low-cbr',
] as const;

/**
 * Check if a string is a valid quality preset
 */
export function isValidQualityPreset(value: string): value is QualityPreset {
  return QUALITY_PRESETS.includes(value as QualityPreset);
}

// =============================================================================
// Transcode Configuration
// =============================================================================

/**
 * Configuration for transcoding operations
 */
export interface TranscodeConfig {
  /**
   * Primary quality target (applies to lossless sources)
   *
   * - For lossless sources: used directly
   * - For lossy sources with 'alac': uses fallback
   * - For compatible lossy sources (MP3, AAC): copies as-is
   */
  quality: QualityPreset;

  /**
   * Quality preset for lossy sources when quality='alac'.
   *
   * When the primary quality is set to 'alac' (lossless), lossy source files
   * (MP3, OGG, etc.) cannot be converted to lossless. This preset determines
   * the AAC quality used for those files instead.
   *
   * Default: 'max' if quality='alac', otherwise inherits from quality
   */
  lossyQuality?: Exclude<QualityPreset, 'alac'>;
}

/**
 * Resolve the effective lossy quality preset
 */
export function resolveLossyQuality(config: TranscodeConfig): Exclude<QualityPreset, 'alac'> {
  if (config.lossyQuality) {
    return config.lossyQuality;
  }
  // Default is 'max' if quality is 'alac', otherwise use quality
  return config.quality === 'alac' ? 'max' : config.quality;
}

// =============================================================================
// Preset Definitions
// =============================================================================

/**
 * AAC preset configuration (VBR or CBR)
 */
export interface AacPreset {
  mode: 'vbr' | 'cbr';
  /** VBR quality level (1-5 scale) - only for VBR mode */
  quality?: number;
  /** Target bitrate in kbps (for VBR: approximate, for CBR: exact) */
  targetKbps: number;
}

/**
 * AAC preset definitions
 *
 * Note: VBR presets may not hit exact target bitrates. FFmpeg's native AAC VBR
 * tops out around ~256 kbps, so 'max' VBR may produce similar bitrates to 'high'.
 * Use 'max-cbr' for guaranteed 320 kbps.
 */
export const AAC_PRESETS: Record<Exclude<QualityPreset, 'alac'>, AacPreset> = {
  // VBR presets (variable bitrate, better quality-per-byte)
  max: { mode: 'vbr', quality: 5, targetKbps: 320 },
  high: { mode: 'vbr', quality: 5, targetKbps: 256 },
  medium: { mode: 'vbr', quality: 4, targetKbps: 192 },
  low: { mode: 'vbr', quality: 2, targetKbps: 128 },

  // CBR presets (constant bitrate, predictable sizes)
  'max-cbr': { mode: 'cbr', targetKbps: 320 },
  'high-cbr': { mode: 'cbr', targetKbps: 256 },
  'medium-cbr': { mode: 'cbr', targetKbps: 192 },
  'low-cbr': { mode: 'cbr', targetKbps: 128 },
} as const;

/**
 * ALAC preset configuration
 */
export const ALAC_PRESET = {
  codec: 'alac' as const,
  container: 'm4a' as const,
  /** Estimated average bitrate for ALAC (CD quality ~900 kbps) */
  estimatedKbps: 900,
} as const;

/**
 * Get the target bitrate for a preset (for size estimation)
 */
export function getPresetBitrate(preset: QualityPreset): number {
  if (preset === 'alac') {
    return ALAC_PRESET.estimatedKbps;
  }
  return AAC_PRESETS[preset].targetKbps;
}

/**
 * Check if a preset is lossless
 */
export function isLosslessPreset(preset: QualityPreset): boolean {
  return preset === 'alac';
}

/**
 * Check if a preset uses VBR encoding
 */
export function isVbrPreset(preset: QualityPreset): boolean {
  if (preset === 'alac') {
    return false; // ALAC is lossless, not VBR
  }
  return AAC_PRESETS[preset].mode === 'vbr';
}

/**
 * AAC-only quality presets (excludes 'alac')
 */
export type AacQualityPreset = Exclude<QualityPreset, 'alac'>;

/**
 * All AAC quality preset names (for validation)
 */
export const AAC_QUALITY_PRESETS: readonly AacQualityPreset[] = [
  'max',
  'max-cbr',
  'high',
  'high-cbr',
  'medium',
  'medium-cbr',
  'low',
  'low-cbr',
] as const;

/**
 * Check if a string is a valid AAC quality preset (not ALAC)
 */
export function isValidAacPreset(value: string): value is AacQualityPreset {
  return AAC_QUALITY_PRESETS.includes(value as AacQualityPreset);
}

/**
 * Capabilities detected from FFmpeg installation
 */
export interface TranscoderCapabilities {
  /** FFmpeg version string */
  version: string;
  /** Path to FFmpeg binary */
  path: string;
  /** Available AAC encoders (e.g., 'aac', 'libfdk_aac') */
  aacEncoders: string[];
  /** Preferred AAC encoder */
  preferredEncoder: string;
}

/**
 * Result of a transcode operation
 */
export interface TranscodeResult {
  /** Path to output file */
  outputPath: string;
  /** Output file size in bytes */
  size: number;
  /** Transcode duration in milliseconds */
  duration: number;
  /** Output bitrate in kbps */
  bitrate: number;
}

/**
 * Audio file metadata from probing
 */
export interface AudioMetadata {
  /** Duration in milliseconds */
  duration: number;
  /** Bitrate in kbps */
  bitrate: number;
  /** Sample rate in Hz */
  sampleRate: number;
  /** Number of channels */
  channels: number;
  /** Codec name */
  codec: string;
  /** Container format */
  format: string;
}

/**
 * Transcoder interface for audio conversion
 */
export interface Transcoder {
  /**
   * Detect FFmpeg installation and capabilities
   */
  detect(): Promise<TranscoderCapabilities>;

  /**
   * Transcode an audio file to iPod-compatible format
   */
  transcode(input: string, output: string, preset: QualityPreset): Promise<TranscodeResult>;

  /**
   * Probe an audio file for metadata
   */
  probe(file: string): Promise<AudioMetadata>;
}

/**
 * Progress callback for transcode operations
 *
 * Used for both audio and video transcoding progress reporting.
 * Video transcoding may include additional fields (frame, speed, bitrate).
 */
export interface TranscodeProgress {
  /** Current position in seconds */
  time: number;
  /** Total duration in seconds */
  duration: number;
  /** Percentage complete (0-100) */
  percent: number;
  /** Current frame number (optional, video only) */
  frame?: number;
  /** Current encoding speed (optional, e.g., 1.5 for 1.5x) */
  speed?: number;
  /** Current bitrate in kbps (optional, video only) */
  bitrate?: number;
}

/**
 * Options for transcode operations
 */
export interface TranscodeOptions {
  /** Override FFmpeg binary path */
  ffmpegPath?: string;
  /** Progress callback */
  onProgress?: (progress: TranscodeProgress) => void;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
}
