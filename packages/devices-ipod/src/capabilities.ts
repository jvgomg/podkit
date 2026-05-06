/**
 * Table-driven capability synthesis for iPod devices.
 *
 * `getCapabilities(identity, opts?)` synthesises a `DeviceCapabilities`
 * record purely from the per-generation entry in `GENERATIONS`. Optionally,
 * a parsed firmware overlay (`FirmwareCapabilities` from a SysInfoExtended
 * inquiry) enriches the result with codec / artwork format details that
 * the firmware advertises at runtime.
 *
 * ## Field provenance
 *
 * Every field in the returned `DeviceCapabilities` falls into one of
 * three buckets, in line with the doc-034 spec:
 *
 * | Field                          | Source     | Notes |
 * | ------------------------------ | ---------- | ----- |
 * | `artworkSources`               | (A) table  | `['database']` if `artworkMaxResolution > 0`, else `[]`. iPods read artwork from the iTunesDB ArtworkDB on disk. |
 * | `artworkMaxResolution`         | (A) table  | Per-generation maximum dimension in pixels. `null` ⇒ no artwork. |
 * | `supportedAudioCodecs`         | (A) + (C)  | `['aac','mp3']` always; `['alac','wav','aiff']` added when `supportsAlac`; firmware overlay may union additional codecs the device advertises. |
 * | `supportsVideo`                | (A) table  | Class capability — does this generation have video hardware. |
 * | `audioNormalization`           | (A) const  | All iPods use Sound Check stored in the database. |
 * | `supportsAlbumArtistBrowsing`  | (A) const  | Always `false` for stock iPod firmware (Rockbox would override at the device-type layer). |
 *
 * Bucket (A) = generation table (authoritative for class capability),
 * (B) = libgpod runtime data — *deliberately not used here*; the legacy
 *       adapter consulted libgpod's per-device `supportsArtwork`/
 *       `supportsVideo` flags but for class-capability purposes those
 *       just mirror the generation, so we drop the dependency.
 * (C) = firmware overlay (`opts.firmware`).
 *
 * @module
 */

import type {
  AudioCodec,
  DeviceArtworkSource,
  DeviceCapabilities,
  FirmwareCapabilities,
} from '@podkit/device-types';

import { GENERATIONS } from './tables/generations.js';
import type { IpodModel } from './types.js';

// =============================================================================
// Public API
// =============================================================================

/** Optional inputs to `getCapabilities`. */
export interface GetCapabilitiesOptions {
  /**
   * Optional firmware overlay (from `inquireFirmware` in `@podkit/ipod-firmware`).
   * When supplied, codec advertisements from the device firmware are unioned
   * with the table-derived defaults.
   */
  firmware?: FirmwareCapabilities;
}

/**
 * Synthesise a `DeviceCapabilities` record for an identified iPod, using the
 * generation table as the authority for class-level capability and an optional
 * firmware overlay for runtime enrichment.
 *
 * @param identity - Result of `identify()` — must include `generationId`.
 * @param opts - Optional overrides; `opts.firmware` enriches codec data.
 * @returns Capabilities suitable for the sync engine and transcoding pipeline.
 *
 * @example
 * ```ts
 * const model = identify({ from: 'usb', productId: '0x1261' });
 * const caps = getCapabilities(model!);
 * // → { supportsVideo: true, artworkMaxResolution: 320, ... }
 * ```
 */
export function getCapabilities(
  identity: IpodModel,
  opts?: GetCapabilitiesOptions
): DeviceCapabilities {
  const gen = GENERATIONS[identity.generationId];

  // ── Audio codecs (table → firmware overlay) ─────────────────────────────
  const codecs: AudioCodec[] = ['aac', 'mp3'];
  if (gen.supportsAlac) {
    codecs.push('alac', 'wav', 'aiff');
  }
  if (opts?.firmware?.audioCodecs) {
    for (const adv of opts.firmware.audioCodecs) {
      const norm = normaliseCodec(adv.codec);
      if (norm && !codecs.includes(norm)) codecs.push(norm);
    }
  }

  // ── Artwork (purely table-driven) ───────────────────────────────────────
  const artworkMaxResolution = gen.artworkMaxResolution;
  const artworkSources: DeviceArtworkSource[] =
    artworkMaxResolution !== null && artworkMaxResolution > 0 ? ['database'] : [];

  return {
    artworkSources,
    artworkMaxResolution,
    supportedAudioCodecs: codecs,
    supportsVideo: gen.supportsVideo,
    audioNormalization: 'soundcheck',
    supportsAlbumArtistBrowsing: false,
  };
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Normalise a firmware-advertised codec string to the `AudioCodec` enum.
 * Returns `undefined` for codecs the toolkit doesn't model. Case-insensitive;
 * tolerates the family of synonyms Apple emits ("AAC" / "MPEG4_AAC", etc.).
 */
function normaliseCodec(raw: string): AudioCodec | undefined {
  const lower = raw.toLowerCase();
  if (lower.includes('alac') || lower.includes('apple_lossless')) return 'alac';
  if (lower.includes('aac') || lower.includes('mpeg4')) return 'aac';
  if (lower.includes('mp3') || lower.includes('mpeg_audio')) return 'mp3';
  if (lower.includes('aiff')) return 'aiff';
  if (lower.includes('wav') || lower.includes('lpcm') || lower.includes('pcm')) return 'wav';
  if (lower.includes('flac')) return 'flac';
  if (lower.includes('opus')) return 'opus';
  if (lower.includes('ogg') || lower.includes('vorbis')) return 'ogg';
  return undefined;
}
