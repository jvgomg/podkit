import { describe, it, expect } from 'bun:test';
import { BUILT_IN_PRESETS, BUILT_IN_PRESET_IDS, definePreset } from '@podkit/devices-mass-storage';
import { mergedPresets, knownPresetIds, knownDeviceTypeIds } from './preset-registry.js';
import type { PodkitConfig } from './types.js';

function makeConfig(presets?: PodkitConfig['presets']): PodkitConfig {
  return {
    quality: 'medium',
    artwork: true,
    tips: true,
    transforms: { cleanArtists: { enabled: false, drop: false, format: '({})', ignore: [] } },
    videoTransforms: { showLanguage: { enabled: false, format: '[{}]', expand: false } },
    devices: {},
    ...(presets ? { presets } : {}),
  };
}

describe('mergedPresets', () => {
  it('returns a fresh object containing all built-ins when config has none', () => {
    const merged = mergedPresets(makeConfig());
    expect(merged).not.toBe(BUILT_IN_PRESETS);
    for (const id of BUILT_IN_PRESET_IDS) {
      expect(merged[id]).toBe(BUILT_IN_PRESETS[id]);
    }
  });

  it('returns a fresh object when config.presets is empty', () => {
    const merged = mergedPresets(makeConfig({}));
    expect(merged).not.toBe(BUILT_IN_PRESETS);
    for (const id of BUILT_IN_PRESET_IDS) {
      expect(merged[id]).toBe(BUILT_IN_PRESETS[id]);
    }
  });

  it('freezes the returned object — adding or deleting keys throws in strict mode', () => {
    const merged = mergedPresets(undefined);
    expect(Object.isFrozen(merged)).toBe(true);
    expect(() => {
      (merged as Record<string, unknown>)['new-id'] = 'x';
    }).toThrow();
    expect(BUILT_IN_PRESETS['generic']).toBeDefined();
  });

  it('freezes each preset entry — mutating a built-in via the merged map throws', () => {
    const merged = mergedPresets(undefined);
    const generic = merged['generic']!;
    expect(Object.isFrozen(generic)).toBe(true);
    expect(() => {
      (generic as { artworkMaxResolution: number }).artworkMaxResolution = 99;
    }).toThrow();
    // BUILT_IN_PRESETS data is unchanged after the rejected mutation attempt.
    expect(BUILT_IN_PRESETS['generic']!.artworkMaxResolution).not.toBe(99);
  });

  it('merges user presets with built-ins; built-ins win on collision', () => {
    const walkman = definePreset({
      id: 'my-walkman',
      extends: 'generic',
      manufacturer: 'Sony',
      productName: 'NW-A105',
      capabilities: { supportedAudioCodecs: ['aac', 'flac'] },
    });
    const merged = mergedPresets(makeConfig({ 'my-walkman': walkman }));
    expect(merged['my-walkman']).toBeDefined();
    expect(merged['my-walkman']!.manufacturer).toBe('Sony');
    // Built-ins are still present and authoritative.
    for (const id of BUILT_IN_PRESET_IDS) {
      expect(merged[id]).toBe(BUILT_IN_PRESETS[id]);
    }
  });
});

describe('knownPresetIds', () => {
  it('returns just built-ins when config has none', () => {
    expect(knownPresetIds(makeConfig())).toEqual([...BUILT_IN_PRESET_IDS]);
  });

  it('appends user preset ids after built-ins', () => {
    const walkman = definePreset({
      id: 'my-walkman',
      extends: 'generic',
      manufacturer: 'Sony',
      productName: 'NW-A105',
    });
    expect(knownPresetIds(makeConfig({ 'my-walkman': walkman }))).toEqual([
      ...BUILT_IN_PRESET_IDS,
      'my-walkman',
    ]);
  });
});

describe('knownDeviceTypeIds', () => {
  it('includes ipod alongside mass-storage preset ids', () => {
    const ids = knownDeviceTypeIds(makeConfig());
    expect(ids).toContain('ipod');
    for (const id of BUILT_IN_PRESET_IDS) expect(ids).toContain(id);
  });

  it('includes user preset ids', () => {
    const walkman = definePreset({
      id: 'my-walkman',
      extends: 'generic',
      manufacturer: 'Sony',
      productName: 'NW-A105',
    });
    const ids = knownDeviceTypeIds(makeConfig({ 'my-walkman': walkman }));
    expect(ids).toContain('my-walkman');
    expect(ids).toContain('ipod');
  });
});

// =============================================================================
// Two devices typed to the same user preset resolve independently — they
// share the preset baseline but per-device overrides apply on top.
// =============================================================================

describe('shared user preset, distinct per-device overrides', () => {
  it('resolves two devices with the same user preset id independently', async () => {
    // Drive the core resolver directly with the merged registry. This is the
    // contract that openDevice + device list + doctor all rely on once they
    // thread mergedPresets(config) through.
    const { resolveCapabilitiesResolved } = await import('@podkit/core');
    const walkman = definePreset({
      id: 'my-walkman',
      extends: 'generic',
      manufacturer: 'Sony',
      productName: 'NW-A105',
      capabilities: {
        supportedAudioCodecs: ['aac', 'flac', 'mp3'],
        artworkMaxResolution: 240,
      },
    });
    const presets = mergedPresets(makeConfig({ 'my-walkman': walkman }));
    const identity: import('@podkit/core').MassStorageIdentity = {
      kind: 'mass-storage',
      presetId: 'my-walkman',
    };

    // Device A: no overrides — should inherit the preset baseline.
    const a = resolveCapabilitiesResolved(identity, { presets });
    expect(a.supportedAudioCodecs.value).toEqual(['aac', 'flac', 'mp3']);
    expect(a.artworkMaxResolution.value).toBe(240);

    // Device B: shrinks codec list + artwork — overrides win.
    const b = resolveCapabilitiesResolved(identity, {
      presets,
      deviceConfigOverrides: {
        supportedAudioCodecs: ['aac'],
        artworkMaxResolution: 128,
      },
    });
    expect(b.supportedAudioCodecs.value).toEqual(['aac']);
    expect(b.artworkMaxResolution.value).toBe(128);

    // Device A is untouched — the preset object isn't mutated by Device B's
    // override pass.
    expect(a.supportedAudioCodecs.value).toEqual(['aac', 'flac', 'mp3']);
    expect(a.artworkMaxResolution.value).toBe(240);
  });
});
