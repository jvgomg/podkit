/**
 * Tests for the provenance-aware unified resolver. Dispatches by
 * identity kind: mass-storage routes through
 * `getCapabilitiesResolved` (per-field provenance from preset → defaults
 * → config), iPod routes through `@podkit/devices-ipod`'s resolved
 * variant (per-field provenance from generation table → firmware
 * overlay, where firmware only affects the codec list).
 */
import { describe, it, expect } from 'bun:test';
import type { IpodIdentity } from '@podkit/device-types';
import { resolveCapabilitiesResolved } from './resolve-capabilities.js';
import { UnknownIpodModelError } from './unknown-ipod-model.js';

describe('resolveCapabilitiesResolved — mass-storage dispatch', () => {
  it('reports source=preset on every field when no overrides are passed', () => {
    const r = resolveCapabilitiesResolved({
      kind: 'mass-storage',
      presetId: 'echo-mini',
    });
    expect(r.artworkSources.source).toBe('preset');
    expect(r.supportsVideo.source).toBe('preset');
  });

  it('threads device-config overrides through the mass-storage path', () => {
    const r = resolveCapabilitiesResolved(
      { kind: 'mass-storage', presetId: 'echo-mini' },
      { deviceConfigOverrides: { artworkMaxResolution: 96 } }
    );
    expect(r.artworkMaxResolution).toEqual({ value: 96, source: 'device-config' });
  });
});

describe('resolveCapabilitiesResolved — iPod dispatch', () => {
  // 5G video (familyId 6) — known-good identity that resolves cleanly.
  const IPOD_5G: IpodIdentity = {
    kind: 'ipod',
    firewireGuid: '0000000000000000',
    serialNumber: '',
    familyId: 6,
  };

  it('reports source=generation for every field when no firmware overlay is supplied', () => {
    const r = resolveCapabilitiesResolved(IPOD_5G);
    expect(r.artworkSources.source).toBe('generation');
    expect(r.artworkMaxResolution.source).toBe('generation');
    expect(r.supportedAudioCodecs.source).toBe('generation');
    expect(r.supportsVideo.source).toBe('generation');
    expect(r.audioNormalization.source).toBe('generation');
    expect(r.supportsAlbumArtistBrowsing.source).toBe('generation');
  });

  it('tags only supportedAudioCodecs as firmware when the overlay contributes a new codec', () => {
    const r = resolveCapabilitiesResolved(IPOD_5G, {
      firmware: { familyId: 6, audioCodecs: [{ codec: 'FLAC' }] },
    });
    // Firmware advertised FLAC, which isn't in the 5G generation defaults
    // (['aac', 'mp3', 'alac', 'wav', 'aiff']) — so the codec list grows
    // and the field is correctly tagged 'firmware'.
    expect(r.supportedAudioCodecs.source).toBe('firmware');
    expect(r.supportedAudioCodecs.value).toContain('flac');
    // Every OTHER field is purely table-derived. Firmware can't touch
    // them; they stay 'generation' even though the overlay was supplied.
    expect(r.artworkSources.source).toBe('generation');
    expect(r.artworkMaxResolution.source).toBe('generation');
    expect(r.supportsVideo.source).toBe('generation');
    expect(r.audioNormalization.source).toBe('generation');
    expect(r.supportsAlbumArtistBrowsing.source).toBe('generation');
  });

  it('keeps source=generation when the firmware overlay only echoes codecs already in the defaults', () => {
    const r = resolveCapabilitiesResolved(IPOD_5G, {
      // The 5G generation already provides AAC + MP3 + ALAC by default.
      // Re-advertising them adds nothing — provenance must stay
      // 'generation', not get promoted to 'firmware' just because the
      // overlay was supplied.
      firmware: { familyId: 6, audioCodecs: [{ codec: 'AAC' }, { codec: 'MPEG_AUDIO' }] },
    });
    expect(r.supportedAudioCodecs.source).toBe('generation');
  });

  it('throws the typed unknown-model guard on an iPod identity that resolves to no model', () => {
    expect(() =>
      resolveCapabilitiesResolved({
        kind: 'ipod',
        firewireGuid: '0000000000000000',
        serialNumber: '',
        familyId: null,
      })
    ).toThrow(UnknownIpodModelError);
  });
});
