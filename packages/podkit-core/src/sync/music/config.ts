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
import { getPresetBitrate } from '../../transcode/types.js';
import type { DeviceCapabilities, AudioCodec } from '../../device/capabilities.js';
import type { CollectionAdapter } from '../../adapters/interface.js';
import type { TransformsConfig } from '../../transforms/types.js';
import { hasEnabledTransforms } from '../../transforms/pipeline.js';
import type { RetryConfig } from './executor.js';

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
   * Encoding mode for AAC transcoding
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
  const isAlacPreset = config.quality === 'max' && deviceSupportsAlac;

  // 'max' resolves to 'lossless' when device supports ALAC, otherwise to 'high'
  let resolvedQuality: string;
  if (config.quality === 'max') {
    resolvedQuality = isAlacPreset ? 'lossless' : 'high';
  } else {
    resolvedQuality = config.quality;
  }

  const presetBitrate = getPresetBitrate(
    isAlacPreset ? 'lossless' : config.quality === 'max' ? 'high' : config.quality,
    config.customBitrate
  );

  const transferMode: TransferMode = config.transferMode ?? 'fast';

  // Artwork resize is only relevant when the device's primary artwork source
  // is 'embedded' — those devices read artwork from the audio file itself.
  const artworkSources = config.capabilities?.artworkSources;
  const primaryArtworkSource = artworkSources?.[0];
  const artworkResize =
    primaryArtworkSource === 'embedded' ? config.capabilities?.artworkMaxResolution : undefined;

  const transformsEnabled = config.transforms ? hasEnabledTransforms(config.transforms) : false;

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
  };
}
