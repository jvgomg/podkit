/**
 * Transcoding types and presets
 *
 * FFmpeg-based transcoding for converting audio files
 * to iPod-compatible formats (AAC/M4A or ALAC).
 *
 * ## Quality Presets
 *
 * 4 quality tiers with VBR as default encoding mode:
 *
 * | Preset | Default encoding | Target | Behaviour |
 * |--------|-----------------|--------|-----------|
 * | `max` | — | Lossless or ~256 | ALAC if device supports it and source is lossless; otherwise identical to `high` |
 * | `high` | VBR | ~256 kbps | Transparent quality (default) |
 * | `medium` | VBR | ~192 kbps | Excellent quality |
 * | `low` | VBR | ~128 kbps | Space-efficient |
 *
 * @see ADR-010 for full design context
 */

// =============================================================================
// Quality Presets
// =============================================================================

/**
 * Quality preset names for transcoding
 *
 * - `max`: ALAC if device supports it and source is lossless; otherwise identical to `high`
 * - `high`: VBR ~256 kbps - transparent quality (default)
 * - `medium`: VBR ~192 kbps - excellent quality
 * - `low`: VBR ~128 kbps - good quality, space-efficient
 */
export type QualityPreset = 'max' | 'high' | 'medium' | 'low';

/**
 * All valid quality preset names
 */
export const QUALITY_PRESETS: readonly QualityPreset[] = ['max', 'high', 'medium', 'low'] as const;

/**
 * Check if a string is a valid quality preset
 */
export function isValidQualityPreset(value: string): value is QualityPreset {
  return QUALITY_PRESETS.includes(value as QualityPreset);
}

// =============================================================================
// Encoding Mode
// =============================================================================

/**
 * Encoding mode for AAC transcoding
 *
 * - `vbr`: Variable bitrate — better quality per byte (default)
 * - `cbr`: Constant bitrate — predictable file sizes
 */
export type EncodingMode = 'vbr' | 'cbr';

/**
 * All valid encoding mode names
 */
export const ENCODING_MODES: readonly EncodingMode[] = ['vbr', 'cbr'] as const;

// =============================================================================
// Transfer Mode
// =============================================================================

/**
 * Transfer mode for synced files
 *
 * Controls how files are prepared for the target device:
 *
 * - `fast` (default): Optimize for sync speed. Transcoded files have artwork
 *   stripped. Copy-format files (MP3, M4A, ALAC→ALAC) use direct file copy.
 * - `optimized`: Optimize for device storage. Transcoded files have artwork
 *   stripped. Copy-format files are routed through FFmpeg with audio stream
 *   copy to strip embedded artwork without re-encoding.
 * - `portable`: Optimize for file portability. Transcoded files preserve
 *   embedded artwork. Copy-format files use direct file copy.
 */
export type TransferMode = 'fast' | 'optimized' | 'portable';

/**
 * All valid transfer mode names
 */
export const TRANSFER_MODES: readonly TransferMode[] = ['fast', 'optimized', 'portable'] as const;

/**
 * Check if a string is a valid transfer mode
 */
export function isValidTransferMode(value: string): value is TransferMode {
  return TRANSFER_MODES.includes(value as TransferMode);
}

// =============================================================================
// Transcode Configuration
// =============================================================================

/**
 * Configuration for transcoding operations
 */
export interface TranscodeConfig {
  /**
   * Quality tier for transcoding
   *
   * - `max`: ALAC if device supports it and source is lossless; otherwise identical to `high`
   * - `high`: ~256 kbps (default)
   * - `medium`: ~192 kbps
   * - `low`: ~128 kbps
   */
  quality: QualityPreset;

  /**
   * Encoding mode override.
   *
   * VBR (variable bitrate) is the default and provides better quality per byte.
   * CBR (constant bitrate) produces predictable file sizes and enables tighter
   * preset change detection.
   *
   * @default 'vbr'
   */
  encoding?: EncodingMode;

  /**
   * Custom bitrate override in kbps (64-320).
   *
   * When set, overrides the preset's target bitrate for AAC encoding.
   * Ignored when `max` resolves to ALAC (lossless has no target bitrate).
   */
  customBitrate?: number;
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
 * AAC preset definitions for the three lossy tiers.
 *
 * `max` is NOT included because it resolves to either ALAC (no AAC preset needed)
 * or to `high` (uses high's AAC preset). The resolution happens in the planner.
 *
 * These are the VBR defaults. CBR uses the same targetKbps but mode='cbr'.
 */
export const AAC_PRESETS: Record<Exclude<QualityPreset, 'max'>, AacPreset> = {
  high: { mode: 'vbr', quality: 5, targetKbps: 256 },
  medium: { mode: 'vbr', quality: 4, targetKbps: 192 },
  low: { mode: 'vbr', quality: 2, targetKbps: 128 },
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
 * Get the target bitrate for a preset (for size estimation and preset change detection).
 *
 * `max` returns the same as `high` (256 kbps) since when `max` resolves to AAC
 * it uses the `high` preset settings. When `max` resolves to ALAC, bitrate
 * is not used for comparison.
 *
 * When `customBitrate` is provided, it overrides the preset target.
 */
export function getPresetBitrate(
  preset: QualityPreset | 'lossless',
  customBitrate?: number
): number {
  if (customBitrate !== undefined) {
    return customBitrate;
  }
  if (preset === 'lossless') {
    return ALAC_PRESET.estimatedKbps;
  }
  if (preset === 'max') {
    // max resolves to high's target when used as AAC
    return AAC_PRESETS.high.targetKbps;
  }
  return AAC_PRESETS[preset].targetKbps;
}

/**
 * Check if a preset is the `max` preset (which may resolve to ALAC).
 *
 * The `max` preset is device-aware: it produces ALAC on ALAC-capable devices
 * and falls back to `high` AAC on others. Use this to check if a preset
 * _might_ produce lossless output.
 */
export function isMaxPreset(preset: QualityPreset): boolean {
  return preset === 'max';
}

/**
 * Check if the effective encoding mode is VBR.
 *
 * @param encoding - The encoding mode from config, or undefined for default (VBR)
 */
export function isVbrEncoding(encoding?: EncodingMode): boolean {
  return (encoding ?? 'vbr') === 'vbr';
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
  /**
   * Transfer mode for transcoded output.
   *
   * - `fast` (default): strips embedded artwork (`-vn`).
   * - `optimized`: strips embedded artwork (`-vn`).
   * - `portable`: preserves embedded artwork (`-c:v copy`).
   */
  transferMode?: TransferMode;
  /**
   * Resize embedded artwork to this maximum dimension (pixels, square).
   *
   * When set, embedded artwork is resized during transcode instead of being
   * stripped or preserved at full resolution. The artwork will not be upscaled
   * (if source artwork is smaller than this value, it is kept as-is).
   *
   * Used for devices where embedded artwork is the primary display source
   * (e.g., Echo Mini). When set, takes priority over transferMode for artwork
   * handling — the device cannot use full-res artwork, so it is always resized.
   */
  artworkResize?: number;
}
