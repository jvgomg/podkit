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
  CapabilitySource,
  DeviceArtworkSource,
  DeviceCapabilities,
  FirmwareCapabilities,
  ResolvedDeviceCapabilities,
} from '@podkit/device-types';
import { projectResolved } from '@podkit/device-types';

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
  // Backward-compat: project the resolved variant down to bare values.
  // Sharing the merge logic with `getCapabilitiesResolved` keeps the two
  // entry points byte-for-byte equivalent. iPod synthesisers don't emit
  // `containerConstraints`, so the cast is harmless here.
  const resolved = getCapabilitiesResolved(identity, opts);
  return projectResolved(resolved) as DeviceCapabilities;
}

/**
 * Provenance-aware variant of {@link getCapabilities}. Each field carries
 * the layer that contributed it — `'generation'` for table-derived
 * defaults, `'firmware'` only on the codec list when a firmware overlay
 * actually unioned a new codec into the result.
 *
 * The firmware overlay can only influence `supportedAudioCodecs` today
 * (per the doc-034 spec — bucket (C)); every other field is bucket (A)
 * and tagged `'generation'` regardless of whether `opts.firmware` was
 * supplied. So passing a firmware overlay that doesn't advertise any
 * new codecs leaves every field tagged `'generation'`.
 *
 * @param identity - Result of `identify()`.
 * @param opts - Optional firmware overlay (`opts.firmware`).
 * @returns `ResolvedDeviceCapabilities` suitable for `device info` and
 *   other provenance consumers.
 *
 * @example
 * ```ts
 * const r = getCapabilitiesResolved(model);
 * // → r.supportedAudioCodecs = { value: ['aac','mp3','alac','wav','aiff'], source: 'generation' }
 *
 * const r2 = getCapabilitiesResolved(model, { firmware: { audioCodecs: [{ codec: 'FLAC' }] } });
 * // → r2.supportedAudioCodecs.source = 'firmware'  (firmware unioned 'flac' onto the base)
 * // → r2.artworkSources.source        = 'generation'  (firmware doesn't touch artwork)
 * ```
 */
export function getCapabilitiesResolved(
  identity: IpodModel,
  opts?: GetCapabilitiesOptions
): ResolvedDeviceCapabilities {
  const gen = GENERATIONS[identity.generationId];

  // ── Audio codecs (table → firmware overlay) ─────────────────────────────
  const baseCodecs: AudioCodec[] = ['aac', 'mp3'];
  if (gen.supportsAlac) baseCodecs.push('alac', 'wav', 'aiff');

  let codecs = baseCodecs;
  let codecsSource: CapabilitySource = 'generation';
  if (opts?.firmware?.audioCodecs) {
    const merged = [...baseCodecs];
    let firmwareContributed = false;
    for (const adv of opts.firmware.audioCodecs) {
      const norm = normaliseCodec(adv.codec);
      if (norm && !merged.includes(norm)) {
        merged.push(norm);
        firmwareContributed = true;
      }
    }
    if (firmwareContributed) {
      codecs = merged;
      codecsSource = 'firmware';
    }
    // If the firmware overlay was supplied but it advertised only codecs
    // already in the generation defaults, the resulting list is identical
    // to the generation-derived list and `source: 'generation'` is the
    // truthful attribution. Don't promote to 'firmware' just because the
    // overlay was *supplied* — only when it actually contributed.
  }

  // ── Artwork (purely table-driven) ───────────────────────────────────────
  const artworkMaxResolution = gen.artworkMaxResolution;
  const artworkSources: DeviceArtworkSource[] =
    artworkMaxResolution !== null && artworkMaxResolution > 0 ? ['database'] : [];

  return {
    artworkSources: { value: artworkSources, source: 'generation' },
    artworkMaxResolution: { value: artworkMaxResolution, source: 'generation' },
    supportedAudioCodecs: { value: codecs, source: codecsSource },
    supportsVideo: { value: gen.supportsVideo, source: 'generation' },
    audioNormalization: { value: 'soundcheck', source: 'generation' },
    supportsAlbumArtistBrowsing: { value: false, source: 'generation' },
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
  if (lower.includes('vorbis') || lower.includes('ogg')) return 'vorbis';
  return undefined;
}
