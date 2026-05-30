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
import { MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS } from '@podkit/devices-mass-storage';
import { predictArtworkScaleSize } from '@podkit/core';
import type { Scenario, Format } from './axes.js';

/**
 * Whether the device stores metadata in its own database (iPod) or only in
 * the audio files (mass-storage). Mass-storage refuses to emit some codecs it
 * can otherwise play, because tag-writing into those containers is unreliable
 * (see `effectiveSupportedCodecs`); iPod is exempt.
 */
export type DeviceKind = 'ipod' | 'mass-storage';

/** File-preparation strategy. Mirrors podkit's `TransferMode`. */
export type TransferMode = 'fast' | 'optimized' | 'portable';
export const TRANSFER_MODES: readonly TransferMode[] = ['fast', 'optimized', 'portable'];

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

/** Codec → the file extension podkit writes for it (transcode output). */
export const CODEC_EXTENSION: Record<AudioCodec, string> = {
  aac: '.m4a',
  alac: '.m4a',
  mp3: '.mp3',
  flac: '.flac',
  vorbis: '.ogg',
  opus: '.opus',
  wav: '.wav',
  aiff: '.aiff',
};

/** Source format → its on-disk extension (the copy-path output extension). */
export const SOURCE_EXTENSION: Record<Format, string> = {
  wav: '.wav',
  aiff: '.aiff',
  flac: '.flac',
  alac: '.m4a',
  mp3: '.mp3',
  aac: '.m4a',
  ogg: '.ogg',
  opus: '.opus',
};

/**
 * The codecs the planner actually treats as device-native for output.
 *
 * Mass-storage drops `MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS` (wav/aiff) even
 * when the firmware lists them — tag-writing into RIFF/IFF containers is
 * unreliable, so podkit transcodes those sources to a managed codec. iPod is
 * exempt: its metadata lives in the iTunesDB, not the file. This mirrors the
 * filter the mass-storage adapter applies to `supportedAudioCodecs` before the
 * classifier sees it.
 */
export function effectiveSupportedCodecs(
  capabilities: DeviceCapabilities,
  kind: DeviceKind
): AudioCodec[] {
  if (kind === 'ipod') return capabilities.supportedAudioCodecs;
  return capabilities.supportedAudioCodecs.filter(
    (c) => !MASS_STORAGE_UNSUPPORTED_OUTPUT_CODECS.includes(c)
  );
}

/**
 * Core copy-vs-transcode decision, keyed off the device's *effective* codecs
 * and a resolved quality label. Captures the classifier's first rule:
 *
 *   copy ⟺ the device plays the codec natively AND we are not forcing a
 *          lossless source down a lossy preset.
 *
 * Everything else transcodes. Independent re-implementation (not an import of
 * `@podkit/core`) so the matrix prediction stays independent of the system
 * under test (doc-039 §"The reference model").
 */
function audioActionCore(
  format: Format,
  capabilities: DeviceCapabilities,
  kind: DeviceKind,
  resolvedQuality: 'lossless' | 'high' | 'medium' | 'low'
): AudioAction {
  const codec = FORMAT_CODEC[format];
  const deviceNative = effectiveSupportedCodecs(capabilities, kind).includes(codec);
  const isLossless = LOSSLESS_FORMATS.has(format);
  const forcedLossyDowngrade = isLossless && resolvedQuality !== 'lossless';
  return deviceNative && !forcedLossyDowngrade ? 'copy' : 'transcode';
}

/**
 * Reference mirror of podkit's classifier decision for a (format, device,
 * pipeline): does the track get copied or transcoded? `kind` selects the
 * effective-codec view (mass-storage drops wav/aiff as output).
 */
export function deviceAction(
  format: Format,
  capabilities: DeviceCapabilities,
  pipeline: Pipeline,
  kind: DeviceKind = 'ipod'
): AudioAction {
  return audioActionCore(
    format,
    capabilities,
    kind,
    pipeline === 'prefer-copy' ? 'lossless' : 'high'
  );
}

/**
 * First codec in a lossy preference stack that the device can actually emit.
 * Mirrors podkit's "first supported lossy codec wins" resolution. Returns
 * `undefined` if the device supports none of them (the matrix should not
 * exercise that — every device under test emits AAC).
 */
export function resolvedLossyCodec(
  lossyStack: readonly AudioCodec[],
  capabilities: DeviceCapabilities,
  kind: DeviceKind
): AudioCodec | undefined {
  const effective = effectiveSupportedCodecs(capabilities, kind);
  return lossyStack.find((c) => effective.includes(c));
}

/** Predicted output of a sync under an explicit lossy stack + quality label. */
export interface CodecOutcome {
  action: AudioAction;
  /** Output codec when transcoding; `undefined` on the copy path. */
  codec: AudioCodec | undefined;
  /** Output file extension (source extension on copy, codec extension on transcode). */
  extension: string;
}

/**
 * Predict the copy-vs-transcode action and the resulting output extension for
 * a (format, device, lossy stack, quality) cell — the codec concern's core.
 */
export function codecOutcome(
  format: Format,
  capabilities: DeviceCapabilities,
  kind: DeviceKind,
  lossyStack: readonly AudioCodec[],
  resolvedQuality: 'lossless' | 'high' | 'medium' | 'low'
): CodecOutcome {
  const action = audioActionCore(format, capabilities, kind, resolvedQuality);
  if (action === 'copy') {
    return { action, codec: undefined, extension: SOURCE_EXTENSION[format] };
  }
  const codec = resolvedLossyCodec(lossyStack, capabilities, kind);
  return { action, codec, extension: codec ? CODEC_EXTENSION[codec] : '<none>' };
}

/**
 * The `add-*`/`upgrade-*` copy sub-type podkit emits for a *copied* track,
 * given the device's artwork model and the transfer mode. Mirrors
 * `classifier.resolveCopyAction`: a device whose *primary* artwork source is
 * `embedded`, or any device under `optimized` mode, routes copies through
 * FFmpeg passthrough (`optimized-copy`); otherwise a plain `direct-copy`.
 *
 * The primary-artwork branch is driven by the device's capabilities, NOT by
 * whether artwork syncing is enabled: an embedded-artwork device still
 * re-muxes every copy through FFmpeg even with `artwork = false` (verified
 * empirically — generic/echo-mini copies are `optimized-copy` regardless).
 */
export function copyOpKind(
  capabilities: DeviceCapabilities,
  transferMode: TransferMode
): 'direct-copy' | 'optimized-copy' {
  if (capabilities.artworkSources[0] === 'embedded') return 'optimized-copy';
  if (transferMode === 'optimized') return 'optimized-copy';
  return 'direct-copy';
}

/**
 * Does embedded source art reach the device given the action taken?
 *
 * Copy preserves the embedded picture and transcode re-embeds it, so the
 * codec action never drops art — survival depends only on the source having
 * had art and the device having somewhere to store it. This is the
 * device-level "does the device show art" question (the iTunesDB on iPod, the
 * file on mass-storage); for whether the on-device *file* keeps its embedded
 * cover under a given transfer mode, see {@link fileArtworkSurvives}.
 */
export function artworkReaches(sourceHadArt: boolean, capabilities: DeviceCapabilities): boolean {
  return sourceHadArt && capabilities.artworkSources.length > 0;
}

/**
 * Does the embedded cover survive **in the file written to the device**, given
 * the action and transfer mode? This is distinct from {@link artworkReaches}:
 * on a database-artwork device the cover lands in the iTunesDB regardless, so
 * `artworkReaches` stays true even when the file's embedded copy is stripped.
 *
 * Capability-driven (doc-012 §"Behavior Matrix"):
 *
 * - **Embedded-artwork device** (`artworkSources[0] === 'embedded'`): the file
 *   *is* the art source, so the executor always keeps the cover in the file
 *   (resizing it to `artworkMaxResolution`), regardless of transfer mode.
 * - **Database-artwork device** (iPod): the file's embedded cover is redundant
 *   (art lives in the iTunesDB), so transfer mode decides its fate —
 *   `portable` preserves it; `optimized` strips it on every path; `fast`
 *   strips only on the transcode path (a direct copy keeps it for free,
 *   stripping would be extra work the device doesn't need).
 */
export function fileArtworkSurvives(
  action: AudioAction,
  transferMode: TransferMode,
  sourceHadArt: boolean,
  capabilities: DeviceCapabilities
): boolean {
  if (!sourceHadArt) return false;
  if (capabilities.artworkSources[0] === 'embedded') return true;
  if (transferMode === 'portable') return true;
  if (transferMode === 'optimized') return false;
  return action === 'copy';
}

/**
 * Expected square edge length of the cover **in the device file**, given the
 * source cover's size. Resize only ever downscales (never upscales — doc-012
 * §"Source artwork is smaller than device max"):
 *
 * - **Embedded-artwork device**: the file is the art source, so the executor
 *   shrinks the cover to `artworkMaxResolution` (the FFmpeg `artworkResize`
 *   path) → `min(source, max)`.
 * - **Database-artwork device** (iPod): the file's cover is left at source
 *   size — the iPod resizes only its iTunesDB thumbnail (to
 *   `artworkMaxResolution`), not the file — so the file stays at `source`.
 *
 * Assumes the cover survives in the file at all (e.g. a `portable` sync on
 * iPod, or any sync on an embedded device); see {@link fileArtworkSurvives}.
 */
export function expectedFileArtworkSize(
  sourceSize: number,
  capabilities: DeviceCapabilities
): number {
  const max = capabilities.artworkMaxResolution;
  if (capabilities.artworkSources[0] === 'embedded' && max !== null) {
    return predictArtworkScaleSize(sourceSize, max);
  }
  return sourceSize;
}
