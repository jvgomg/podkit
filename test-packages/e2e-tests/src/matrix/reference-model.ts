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
