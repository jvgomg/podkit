/**
 * Tests for the provenance-aware unified resolver. Dispatches by
 * identity kind to either the mass-storage `getCapabilitiesResolved`
 * (with per-field provenance) or a uniform `'generation'` / `'firmware'`
 * wrap of the iPod generation table.
 */
import { describe, it, expect } from 'bun:test';
import type { DeviceIdentity } from '@podkit/device-types';
import { resolveCapabilitiesResolved } from './resolve-capabilities.js';

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
  // 5G video (MA147) — known-good identity that resolves cleanly.
  const IPOD_5G: DeviceIdentity = {
    kind: 'ipod',
    familyId: 11, // iPod 5G family
  };

  it('reports source=generation for every field when no firmware overlay is supplied', () => {
    const r = resolveCapabilitiesResolved(IPOD_5G);
    expect(r.artworkSources.source).toBe('generation');
    expect(r.supportedAudioCodecs.source).toBe('generation');
    expect(r.audioNormalization.source).toBe('generation');
  });

  it('tags supportedAudioCodecs as source=firmware when a firmware overlay supplies them', () => {
    const r = resolveCapabilitiesResolved(IPOD_5G, {
      firmware: { supportedAudioCodecs: ['aac', 'alac', 'mp3'] },
    });
    // Firmware can override the codec list — that field's source is
    // correctly 'firmware'.
    expect(r.supportedAudioCodecs.source).toBe('firmware');
  });

  // KNOWN LIMITATION: the iPod path uniformly tags every field as
  // 'firmware' when any firmware overlay is supplied, even fields the
  // firmware doesn't actually touch (artworkSources, audioNormalization,
  // …). The fix requires `@podkit/devices-ipod` to expose per-field
  // layer boundaries the way `@podkit/devices-mass-storage` does. Until
  // then the function's doc comment calls out the over-attribution as a
  // follow-up. NOT asserting `audioNormalization.source === 'firmware'`
  // here — locking that in would protect the bug, not the intent.

  it('throws on an iPod identity that resolves to no model', () => {
    expect(() =>
      resolveCapabilitiesResolved({
        kind: 'ipod',
        // No serial, no familyId.
      })
    ).toThrow(/Could not resolve iPod model/);
  });
});
