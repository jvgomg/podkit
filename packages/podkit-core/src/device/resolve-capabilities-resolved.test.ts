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

  it('reports source=firmware when a firmware overlay is supplied', () => {
    const r = resolveCapabilitiesResolved(IPOD_5G, {
      firmware: { supportedAudioCodecs: ['aac', 'alac', 'mp3'] },
    });
    expect(r.supportedAudioCodecs.source).toBe('firmware');
    // The whole iPod result uniformly tagged today — refinement to
    // per-field provenance is captured in the function's doc comment as
    // a follow-up.
    expect(r.audioNormalization.source).toBe('firmware');
  });

  it('throws on an iPod identity that resolves to no model', () => {
    expect(() =>
      resolveCapabilitiesResolved({
        kind: 'ipod',
        // No serial, no familyId.
      })
    ).toThrow(/Could not resolve iPod model/);
  });
});
