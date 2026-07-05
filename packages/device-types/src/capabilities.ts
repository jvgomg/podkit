/**
 * Device capabilities types
 *
 * Shared type definitions for device capabilities, used by the sync engine
 * to make device-aware decisions without knowing which specific device
 * is connected.
 *
 * The iPod-specific `getDeviceCapabilities()` function lives in
 * `ipod/capabilities.ts` — it imports these types and returns
 * a populated `DeviceCapabilities` for a given iPod generation.
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

/** Where the device reads artwork from */
export type DeviceArtworkSource = 'database' | 'embedded' | 'sidecar';

/** All valid artwork source values */
export const ARTWORK_SOURCES: readonly DeviceArtworkSource[] = [
  'database',
  'embedded',
  'sidecar',
] as const;

/**
 * Audio codecs a device can play natively.
 *
 * These name the **audio stream codec**, not the file container. A device
 * declaring `'vorbis'` is implicitly declaring support for Vorbis in its
 * canonical container (OGG, `.ogg` extension). `'opus'` is canonically an
 * OGG container as well (RFC 7845) but uses the disambiguated `.opus`
 * extension by convention. See `CODEC_CANONICAL_CONTAINER`.
 *
 * Note on rename: the literal `'ogg'` was previously used here to mean
 * "OGG Vorbis." It was ambiguous — `.ogg` is a container that can hold
 * Vorbis or Opus (or, rarely, FLAC). The codec slot now names the codec.
 */
export type AudioCodec = 'aac' | 'alac' | 'mp3' | 'flac' | 'vorbis' | 'opus' | 'wav' | 'aiff';

/** All valid audio codec values */
export const AUDIO_CODECS: readonly AudioCodec[] = [
  'aac',
  'alac',
  'mp3',
  'flac',
  'vorbis',
  'opus',
  'wav',
  'aiff',
] as const;

/**
 * Audio file containers podkit recognises.
 *
 * Container is the on-disk packaging — distinct from the audio stream
 * codec inside it. Most codecs have a single canonical container (see
 * `CODEC_CANONICAL_CONTAINER`). The OGG container in particular can hold
 * Vorbis, Opus, FLAC, or Speex, which is why podkit names container and
 * codec on separate axes.
 *
 * Declared today as part of the codec/container design principle but not
 * yet enforced by the sync planner. Reserved for the container-aware sync
 * work tracked in the Phase 2/3 PRD.
 */
export type AudioContainer = 'mp4' | 'mp3' | 'flac' | 'ogg' | 'wav' | 'aiff';

/** All valid container values */
export const AUDIO_CONTAINERS: readonly AudioContainer[] = [
  'mp4',
  'mp3',
  'flac',
  'ogg',
  'wav',
  'aiff',
] as const;

/**
 * Canonical container for each audio codec.
 *
 * "Canonical" = the container that podkit produces when transcoding, and
 * the container podkit assumes a device accepts a codec in when no
 * `containerConstraints` override is set on the device preset.
 *
 * Non-canonical combinations (e.g. FLAC-in-OGG, Opus-in-`.ogg`) exist in
 * the wild but are rare. Phase 2 introduces planner handling for them.
 */
export const CODEC_CANONICAL_CONTAINER: Record<AudioCodec, AudioContainer> = {
  aac: 'mp4',
  alac: 'mp4',
  mp3: 'mp3',
  flac: 'flac',
  vorbis: 'ogg',
  opus: 'ogg',
  wav: 'wav',
  aiff: 'aiff',
};

/**
 * Audio normalization mode the device supports.
 *
 * - `'soundcheck'` — Apple Sound Check (iPod; stored in device database)
 * - `'replaygain'` — ReplayGain tags (Rockbox, some DAPs; read from file tags)
 * - `'none'` — Device does not support volume normalization
 */
export type AudioNormalizationMode = 'soundcheck' | 'replaygain' | 'none';

/** Device capabilities for sync engine decisions */
export interface DeviceCapabilities {
  /** Where the device reads artwork from, ordered by priority (first = preferred) */
  artworkSources: DeviceArtworkSource[];
  /**
   * Maximum artwork display resolution in pixels (square, width === height).
   * `null` when the device has no display or no artwork support.
   */
  artworkMaxResolution: number | null;
  /** Audio codecs the device can play natively without transcoding */
  supportedAudioCodecs: AudioCodec[];
  /**
   * Maximum lossy audio bitrate (kbps) the device can play, when the device
   * declares one. Absent → unbounded (the device imposes no ceiling beyond the
   * configured quality preset).
   *
   * A **hard device constraint**, distinct from the quality preset (a user
   * preference). The lossy-reduction seam folds it into the effective ceiling on
   * every transcode target — `min(quality cap, maxAudioBitrate)` — and, because a
   * device cannot store or play a track above it, it forces a device-native
   * source that exceeds it to be reduced even under `preserve` (the reduction axis
   * is a preference; a device constraint is enforced regardless). It only ever
   * lowers a target, never lifts one.
   */
  maxAudioBitrate?: number;
  /**
   * Per-codec container constraints.
   *
   * Optional. When set for a codec, restricts the set of containers podkit
   * will pass through to the device for that codec. When omitted, the
   * device is assumed to accept the codec only in its canonical container
   * (see `CODEC_CANONICAL_CONTAINER`).
   *
   * Example: a device that accepts FLAC in both native `.flac` and
   * OGG-FLAC `.ogg` declares `{ flac: ['flac', 'ogg'] }`.
   *
   * Declared today; sync-planner enforcement lands in Phase 2 of the
   * container-aware sync work. Until then, the field is parsed but not
   * acted on.
   */
  containerConstraints?: Partial<Record<AudioCodec, AudioContainer[]>>;
  /** Whether the device supports video playback */
  supportsVideo: boolean;
  /** Audio normalization mode the device supports */
  audioNormalization: AudioNormalizationMode;
  /**
   * Whether the device uses Album Artist for browse navigation.
   *
   * When true, the device groups tracks by Album Artist in its artist list,
   * so the `cleanArtists` transform is unnecessary. When false (e.g. iPod
   * stock firmware), the device only uses the Artist field for browsing.
   */
  supportsAlbumArtistBrowsing: boolean;
}
