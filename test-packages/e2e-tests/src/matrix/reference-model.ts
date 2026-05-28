/**
 * Reference model of podkit's sync semantics for the matrix harness.
 *
 * The matrix asserts that the real system matches this model. Rules are
 * expressed as small capability functions composed by each concern's
 * `predict()` — NOT as per-format `if` branches — so the model scales as
 * device/codec/transfer axes are added (see doc-039 §"The reference model").
 *
 * When the model and the real system disagree, exactly one is wrong; the
 * `reason` string each `predict()` attaches says which we currently believe.
 *
 * @module
 */

import type { AudioCodec, DeviceCapabilities } from '@podkit/device-types';
import type { Scenario, Format } from './axes.js';

/**
 * Whether the source *file* for a format carries embedded cover art when the
 * fixture variant calls for it. Every multi-format track opts into a working
 * embed strategy (`audio-multi-format.ts`): attached_pic for FLAC/ALAC/MP3/
 * AAC/AIFF, METADATA_BLOCK_PICTURE for OGG/Opus, an injected `id3 ` RIFF chunk
 * for WAV. Kept as a table (not a constant `true`) because it is the natural
 * seam for a future fixture that deliberately omits embed for some format.
 */
export const FIXTURE_EMBEDS_ART: Record<Format, boolean> = {
  wav: true,
  aiff: true,
  flac: true,
  alac: true,
  mp3: true,
  aac: true,
  ogg: true,
  opus: true,
};

/** Does the fixture variant for this scenario carry embedded art at all? */
export function fixtureHasEmbeddedSlot(scenario: Scenario): boolean {
  return scenario === 'B-embedded' || scenario === 'D-both';
}

/**
 * Does the source file embed cover art for this (scenario, format)?
 *
 * This is the device-side truth for both adapters: the executor preserves
 * embedded art through copy and re-embeds it through transcode, so the device
 * track's artwork state mirrors whether the source file carried embed.
 * Sidecar `cover.jpg` bytes never reach the file body, so scenarios C/D embed
 * iff the format's file body embeds.
 */
export function sourceEmbedsArt(scenario: Scenario, format: Format): boolean {
  return fixtureHasEmbeddedSlot(scenario) && FIXTURE_EMBEDS_ART[format];
}

// ---------------------------------------------------------------------------
// Pipeline (transcode-vs-copy) axis
// ---------------------------------------------------------------------------

/**
 * A pinned codec configuration that controls whether a source is copied or
 * transcoded, independent of the format's "natural" default path:
 *
 * - `prefer-copy`: `quality=max` + lossless stack `['source']`. Device-native
 *   formats (lossless or compatible-lossy) are copied; formats the device
 *   can't play natively still transcode.
 * - `transcode-aac`: `quality=high` + lossy `['aac']`. Lossless and
 *   incompatible-lossy sources transcode to AAC; compatible-lossy (mp3/aac)
 *   still copy.
 */
export type Pipeline = 'prefer-copy' | 'transcode-aac';
export const PIPELINES: readonly Pipeline[] = ['prefer-copy', 'transcode-aac'];

/** The action podkit takes for a source: copy the file or transcode it. */
export type AudioAction = 'copy' | 'transcode';

/** Source format → the codec name podkit classifies it as. */
const FORMAT_CODEC: Record<Format, AudioCodec> = {
  wav: 'wav',
  aiff: 'aiff',
  flac: 'flac',
  alac: 'alac',
  mp3: 'mp3',
  aac: 'aac',
  ogg: 'vorbis',
  opus: 'opus',
};

const LOSSLESS_FORMATS: ReadonlySet<Format> = new Set(['wav', 'aiff', 'flac', 'alac']);

/**
 * Reference mirror of podkit's classifier decision for a (format, device,
 * pipeline): does the track get copied or transcoded?
 *
 * Independent re-implementation (not an import of `@podkit/core`) so the
 * matrix prediction stays independent of the system under test (doc-039
 * §"The reference model"). Captures the classifier's first rule:
 *
 *   copy ⟺ the device plays the codec natively AND we are not forcing a
 *          lossless source down a lossy preset.
 *
 * Everything else transcodes. This is exact for the two pinned pipelines on
 * an iPod; the broad-codec mass-storage cases arrive with P4 (and will add the
 * WAV/AIFF mass-storage-output exception then).
 */
export function deviceAction(
  format: Format,
  capabilities: DeviceCapabilities,
  pipeline: Pipeline
): AudioAction {
  const codec = FORMAT_CODEC[format];
  const deviceNative = capabilities.supportedAudioCodecs.includes(codec);
  const isLossless = LOSSLESS_FORMATS.has(format);
  const resolvedQuality = pipeline === 'prefer-copy' ? 'lossless' : 'high';

  // Lossless source + non-lossless preset → transcode even when device-native.
  const forcedLossyDowngrade = isLossless && resolvedQuality !== 'lossless';
  if (deviceNative && !forcedLossyDowngrade) {
    return 'copy';
  }
  return 'transcode';
}

/**
 * Does embedded source art reach the device given the action taken?
 *
 * Copy preserves the embedded picture and transcode re-embeds it, so the
 * codec action never drops art — survival depends only on the source having
 * had art and the device having somewhere to store it. (Transfer-mode
 * stripping — `optimized` — is a separate axis, P5.)
 */
export function artworkReaches(sourceHadArt: boolean, capabilities: DeviceCapabilities): boolean {
  return sourceHadArt && capabilities.artworkSources.length > 0;
}
