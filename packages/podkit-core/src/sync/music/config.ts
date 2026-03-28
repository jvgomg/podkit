/**
 * Music sync configuration and resolution
 *
 * Defines the public config surface (`MusicSyncConfig`) and a pure resolver
 * (`resolveMusicConfig`) that derives all internal state from it. This
 * eliminates temporal coupling — the handler takes one config object at
 * construction and everything it needs is derived up front.
 *
 * @module
 */

import type { FFmpegTranscoder } from '../../transcode/ffmpeg.js';
import type { QualityPreset, EncodingMode, TransferMode } from '../../transcode/types.js';
import { getPresetBitrate, getCodecPresetBitrate } from '../../transcode/types.js';
import type {
  DeviceCapabilities,
  AudioCodec,
  AudioNormalizationMode,
} from '../../device/capabilities.js';
import type { CollectionAdapter } from '../../adapters/interface.js';
import type { TransformsConfig } from '../../transforms/types.js';
import { hasEnabledTransforms } from '../../transforms/pipeline.js';
import type { RetryConfig } from './pipeline.js';
import type { TranscodeTargetCodec } from '../../transcode/codecs.js';
import type { EncoderAvailability, CodecResolutionError } from '../../transcode/codec-resolver.js';
import { resolveCodecPreferences, isCodecResolutionError } from '../../transcode/codec-resolver.js';

// =============================================================================
// Public Config
// =============================================================================

/**
 * Public configuration surface for music sync.
 *
 * Contains everything the caller naturally has — quality preset, device
 * capabilities, transcoder instance, etc. No derived values like
 * `isAlacPreset` or `resolvedQuality`; those are computed by
 * `resolveMusicConfig()`.
 */
export interface MusicSyncConfig {
  /** Quality preset for transcoding */
  quality: QualityPreset;

  /** FFmpeg transcoder instance */
  transcoder: FFmpegTranscoder;

  /** Device capabilities (codec support, artwork, etc.) */
  capabilities?: DeviceCapabilities;

  /**
   * Encoding mode for audio transcoding
   * @default 'vbr'
   */
  encoding?: EncodingMode;

  /** Explicit bitrate override in kbps */
  customBitrate?: number;

  /** Tolerance for preset change detection (kbps) */
  bitrateTolerance?: number;

  /**
   * Transfer mode controlling how files are prepared for the device
   * @default 'fast'
   */
  transferMode?: TransferMode;

  /**
   * Whether to sync artwork
   * @default true
   */
  artwork?: boolean;

  /** Metadata transforms configuration */
  transforms?: TransformsConfig;

  /** Collection adapter for remote sources (e.g. Subsonic) */
  adapter?: CollectionAdapter;

  /** Force re-transcode of all tracks */
  forceTranscode?: boolean;

  /** Force metadata update on all tracks */
  forceMetadata?: boolean;

  /** Force sync tag rewrite on all tracks */
  forceSyncTags?: boolean;

  /** Force transfer mode re-evaluation on all tracks */
  forceTransferMode?: boolean;

  /** Skip upgrade detection */
  skipUpgrades?: boolean;

  /** Continue executing after individual operation errors */
  continueOnError?: boolean;

  /** Retry configuration for failed operations */
  retryConfig?: RetryConfig;

  /** Codec preference config (lossy and lossless stacks) */
  codecPreference?: { lossy?: string[]; lossless?: string[] };

  /** Encoder availability for codec resolution (required when codecPreference is used) */
  encoderAvailability?: EncoderAvailability;
}

// =============================================================================
// Resolved Config
// =============================================================================

/**
 * Fully resolved internal state derived from `MusicSyncConfig`.
 *
 * All fields are readonly. Created by `resolveMusicConfig()` and consumed
 * internally by the music handler — callers should not construct this
 * directly.
 */
export interface ResolvedMusicConfig {
  /** The original config, preserved for pass-through */
  readonly raw: Readonly<MusicSyncConfig>;

  /** Whether quality resolves to ALAC (max preset + ALAC-capable device) */
  readonly isAlacPreset: boolean;

  /**
   * Resolved quality label for sync tags and display.
   *
   * - `'lossless'` when `quality` is `'max'` and device supports ALAC
   * - Otherwise the preset name directly (`'high'`, `'medium'`, `'low'`)
   * - `'max'` without ALAC support falls back to `'high'`
   */
  readonly resolvedQuality: string;

  /** Target bitrate for the resolved preset (from `getPresetBitrate()`) */
  readonly presetBitrate: number;

  /** Whether the device supports ALAC playback */
  readonly deviceSupportsAlac: boolean;

  /** Effective transfer mode (defaulted to `'fast'`) */
  readonly transferMode: TransferMode;

  /**
   * Maximum embedded artwork dimension (pixels, square) for devices
   * where embedded artwork is the primary source. `undefined` when the
   * device does not use embedded artwork as its primary source.
   */
  readonly artworkResize: number | undefined;

  /**
   * The device's preferred artwork source (first entry in
   * `capabilities.artworkSources`), or `undefined` when no
   * capabilities are provided.
   */
  readonly primaryArtworkSource: 'database' | 'embedded' | 'sidecar' | undefined;

  /** Audio codecs the device supports natively, or `undefined` when unknown */
  readonly supportedAudioCodecs: AudioCodec[] | undefined;

  /** Whether any metadata transforms are enabled */
  readonly transformsEnabled: boolean;

  /** Audio normalization mode for the device (defaults to 'soundcheck' when unknown) */
  readonly audioNormalization: AudioNormalizationMode;

  /** Resolved codec for lossy transcoding (from codec preference resolution) */
  readonly resolvedLossyCodec?: TranscodeTargetCodec;

  /** Resolved lossless stack (from codec preference resolution) */
  readonly resolvedLosslessStack?: (TranscodeTargetCodec | 'source')[];

  /** Codec resolution error, if resolution failed */
  readonly codecResolutionError?: CodecResolutionError;
}

// =============================================================================
// Resolver
// =============================================================================

/**
 * Derive all internal state from a `MusicSyncConfig`.
 *
 * Pure function — no side effects, no I/O. Safe to call multiple times
 * with the same input.
 */
export function resolveMusicConfig(config: MusicSyncConfig): ResolvedMusicConfig {
  const supportedAudioCodecs = config.capabilities?.supportedAudioCodecs;
  const deviceSupportsAlac = supportedAudioCodecs?.includes('alac') ?? false;

  const transferMode: TransferMode = config.transferMode ?? 'fast';

  // Artwork resize is only relevant when the device's primary artwork source
  // is 'embedded' — those devices read artwork from the audio file itself.
  const artworkSources = config.capabilities?.artworkSources;
  const primaryArtworkSource = artworkSources?.[0];
  const artworkResize =
    primaryArtworkSource === 'embedded' ? config.capabilities?.artworkMaxResolution : undefined;

  const transformsEnabled = config.transforms ? hasEnabledTransforms(config.transforms) : false;

  // Audio normalization: default to 'soundcheck' for backward compatibility
  // (iPod is the original target and doesn't always provide capabilities)
  const audioNormalization: AudioNormalizationMode =
    config.capabilities?.audioNormalization ?? 'soundcheck';

  // --- Codec preference resolution ---
  // When codecPreference + supportedAudioCodecs + encoderAvailability are all available,
  // resolve codec preferences to determine the target lossy and lossless codecs.
  let resolvedLossyCodec: TranscodeTargetCodec | undefined;
  let resolvedLosslessStack: (TranscodeTargetCodec | 'source')[] | undefined;
  let codecResolutionError: CodecResolutionError | undefined;

  if (supportedAudioCodecs && config.encoderAvailability) {
    const result = resolveCodecPreferences(
      config.codecPreference,
      supportedAudioCodecs,
      config.encoderAvailability
    );

    if (isCodecResolutionError(result)) {
      codecResolutionError = result;
    } else {
      resolvedLossyCodec = result.lossy.codec;
      resolvedLosslessStack = result.lossless.map((entry) =>
        entry === 'source' ? 'source' : entry.codec
      );
    }
  }

  // --- isAlacPreset ---
  // Repurposed: "is lossless preset" — true when quality=max and a lossless codec
  // is available (via resolved lossless stack or legacy ALAC detection).
  let isAlacPreset: boolean;
  if (resolvedLosslessStack !== undefined) {
    // Codec resolution path: lossless is available if the stack has at least one resolved codec
    const hasLosslessCodec = resolvedLosslessStack.some((entry) => entry !== 'source');
    isAlacPreset =
      config.quality === 'max' && (hasLosslessCodec || resolvedLosslessStack.includes('source'));
  } else {
    // Legacy path: ALAC only
    isAlacPreset = config.quality === 'max' && deviceSupportsAlac;
  }

  // --- resolvedQuality ---
  let resolvedQuality: string;
  if (config.quality === 'max') {
    resolvedQuality = isAlacPreset ? 'lossless' : 'high';
  } else {
    resolvedQuality = config.quality;
  }

  // --- presetBitrate ---
  // When a lossy codec is resolved, use its codec-specific bitrate table.
  // Otherwise fall back to legacy AAC-based getPresetBitrate().
  let presetBitrate: number;
  if (resolvedLossyCodec && resolvedQuality !== 'lossless') {
    const effectivePreset = (config.quality === 'max' ? 'high' : config.quality) as Exclude<
      QualityPreset,
      'max'
    >;
    presetBitrate =
      getCodecPresetBitrate(resolvedLossyCodec, effectivePreset, config.customBitrate) ??
      getPresetBitrate(effectivePreset, config.customBitrate);
  } else {
    presetBitrate = getPresetBitrate(
      isAlacPreset ? 'lossless' : config.quality === 'max' ? 'high' : config.quality,
      config.customBitrate
    );
  }

  return {
    raw: config,
    isAlacPreset,
    resolvedQuality,
    presetBitrate,
    deviceSupportsAlac,
    transferMode,
    artworkResize,
    primaryArtworkSource,
    supportedAudioCodecs,
    transformsEnabled,
    audioNormalization,
    resolvedLossyCodec,
    resolvedLosslessStack,
    codecResolutionError,
  };
}
