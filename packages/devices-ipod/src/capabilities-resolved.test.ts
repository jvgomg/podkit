/**
 * Tests for the iPod `getCapabilitiesResolved` provenance variant.
 * Locks in the per-field source attribution: every field is
 * `'generation'` (table-derived) except `supportedAudioCodecs`, which
 * promotes to `'firmware'` only when a firmware overlay actually
 * contributes a codec not in the generation defaults.
 */
import { describe, it, expect } from 'bun:test';
import { getCapabilities, getCapabilitiesResolved } from './capabilities.js';
import { resolveIpodModel } from './resolve.js';

// 5G video (familyId 6) — supports aac + mp3 + alac + wav + aiff by table.
const model5G = resolveIpodModel({ familyId: 6 })!;

describe('getCapabilitiesResolved — generation-only baseline', () => {
  it('tags every field with source=generation when no firmware overlay is supplied', () => {
    const r = getCapabilitiesResolved(model5G);
    expect(r.artworkSources.source).toBe('generation');
    expect(r.artworkMaxResolution.source).toBe('generation');
    expect(r.supportedAudioCodecs.source).toBe('generation');
    expect(r.supportsVideo.source).toBe('generation');
    expect(r.audioNormalization.source).toBe('generation');
    expect(r.supportsAlbumArtistBrowsing.source).toBe('generation');
  });

  it('returns the same field values as the bare getCapabilities wrapper', () => {
    const bare = getCapabilities(model5G);
    const resolved = getCapabilitiesResolved(model5G);
    expect(resolved.artworkSources.value).toEqual(bare.artworkSources);
    expect(resolved.artworkMaxResolution.value).toBe(bare.artworkMaxResolution);
    expect(resolved.supportedAudioCodecs.value).toEqual(bare.supportedAudioCodecs);
    expect(resolved.supportsVideo.value).toBe(bare.supportsVideo);
    expect(resolved.audioNormalization.value).toBe(bare.audioNormalization);
    expect(resolved.supportsAlbumArtistBrowsing.value).toBe(bare.supportsAlbumArtistBrowsing);
  });
});

describe('getCapabilitiesResolved — firmware overlay attribution', () => {
  it('promotes supportedAudioCodecs to source=firmware when the overlay adds a new codec', () => {
    // 5G generation defaults: aac, mp3, alac, wav, aiff. FLAC is new.
    const r = getCapabilitiesResolved(model5G, {
      firmware: { familyId: 6, audioCodecs: [{ codec: 'FLAC' }] },
    });
    expect(r.supportedAudioCodecs.source).toBe('firmware');
    expect(r.supportedAudioCodecs.value).toContain('flac');
    expect(r.supportedAudioCodecs.value).toContain('aac');
  });

  it('keeps supportedAudioCodecs at source=generation when overlay only echoes defaults', () => {
    // AAC, MP3, ALAC are all in the 5G defaults. Re-advertising them
    // contributes nothing; the field's true source is still the table.
    const r = getCapabilitiesResolved(model5G, {
      firmware: {
        familyId: 6,
        audioCodecs: [{ codec: 'AAC' }, { codec: 'MP3' }, { codec: 'ALAC' }],
      },
    });
    expect(r.supportedAudioCodecs.source).toBe('generation');
  });

  it('keeps non-codec fields at source=generation even when firmware overlay is supplied', () => {
    // Firmware can NEVER influence artwork sources, artwork resolution,
    // video support, normalization, or album-artist browsing on iPods.
    // No matter what the overlay advertises, every non-codec field stays
    // tagged 'generation'.
    const r = getCapabilitiesResolved(model5G, {
      firmware: { familyId: 6, audioCodecs: [{ codec: 'FLAC' }, { codec: 'OPUS' }] },
    });
    expect(r.artworkSources.source).toBe('generation');
    expect(r.artworkMaxResolution.source).toBe('generation');
    expect(r.supportsVideo.source).toBe('generation');
    expect(r.audioNormalization.source).toBe('generation');
    expect(r.supportsAlbumArtistBrowsing.source).toBe('generation');
  });

  it('bare wrapper still produces the same codec list as the resolved variant', () => {
    const overlay = { familyId: 6, audioCodecs: [{ codec: 'FLAC' }] };
    const bare = getCapabilities(model5G, { firmware: overlay });
    const resolved = getCapabilitiesResolved(model5G, { firmware: overlay });
    expect(bare.supportedAudioCodecs).toEqual(resolved.supportedAudioCodecs.value);
  });
});
