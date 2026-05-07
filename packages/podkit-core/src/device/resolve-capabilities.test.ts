/**
 * Unit tests for resolveCapabilities and identifyCapabilities.
 *
 * Verifies dispatch, bridging, fallback, and override semantics.
 */

import { describe, expect, it } from 'bun:test';

import { resolveCapabilities, identifyCapabilities } from './resolve-capabilities.js';
import type { IpodIdentity, MassStorageIdentity, DeviceIdentity } from '@podkit/device-types';
import type { FirmwareCapabilities } from '@podkit/device-types';

// =============================================================================
// Helpers
// =============================================================================

function makeIpodIdentity(overrides: Partial<IpodIdentity> = {}): IpodIdentity {
  return {
    kind: 'ipod',
    firewireGuid: '000A27001DCECFB5',
    serialNumber: '5U851AEH3R0', // nano_4g suffix '3R0' is in the serial table
    familyId: 15, // nano_4g
    ...overrides,
  };
}

function makeMassStorageIdentity(presetId?: string): MassStorageIdentity {
  return {
    kind: 'mass-storage',
    presetId,
  };
}

// =============================================================================
// iPod path
// =============================================================================

describe('resolveCapabilities — iPod identity', () => {
  it('dispatches to iPod capabilities via serial suffix lookup', () => {
    // Serial '5U851AEH3R0' → suffix '3R0' → nano_4g
    const identity = makeIpodIdentity();
    const caps = resolveCapabilities(identity);

    // nano_4g: ALAC-capable, video, artwork 240px
    expect(caps.supportedAudioCodecs).toContain('aac');
    expect(caps.supportedAudioCodecs).toContain('mp3');
    expect(caps.supportedAudioCodecs).toContain('alac');
    expect(caps.supportsVideo).toBe(true);
    expect(caps.artworkMaxResolution).toBe(240);
    expect(caps.audioNormalization).toBe('soundcheck');
    expect(caps.supportsAlbumArtistBrowsing).toBe(false);
  });

  it('falls back to familyId lookup when serial suffix is not in table', () => {
    // serialNumber short / not in table — fall back to familyId 3 → mini_2g
    const identity = makeIpodIdentity({
      serialNumber: 'UNKN', // 4-char serial, suffix 'KNW' not in table
      familyId: 3, // mini_2g
    });
    const caps = resolveCapabilities(identity);

    // mini_2g: ALAC-capable, no video, no artwork
    expect(caps.supportedAudioCodecs).toContain('alac');
    expect(caps.supportsVideo).toBe(false);
    expect(caps.artworkMaxResolution).toBeNull();
  });

  it('falls back to familyId lookup for nano_2g (familyId=9)', () => {
    const identity = makeIpodIdentity({
      serialNumber: 'XXXXXXX', // suffix 'XXX' not in table
      familyId: 9, // nano_2g
    });
    const caps = resolveCapabilities(identity);

    // nano_2g: no ALAC, no video, artwork 176px
    expect(caps.supportedAudioCodecs).not.toContain('alac');
    expect(caps.supportsVideo).toBe(false);
    expect(caps.artworkMaxResolution).toBe(176);
  });

  it('throws when familyId is unknown and serial is not in table', () => {
    const identity = makeIpodIdentity({
      serialNumber: 'XXXXXXX', // suffix not in table
      familyId: 9999, // unknown familyId
    });
    expect(() => resolveCapabilities(identity)).toThrow(
      /Could not resolve iPod model from identity/
    );
  });

  it('throws when familyId is -1 (not detected) and serial is not in table', () => {
    const identity = makeIpodIdentity({
      serialNumber: 'XXXXXXX',
      familyId: -1,
    });
    expect(() => resolveCapabilities(identity)).toThrow(
      /Could not resolve iPod model from identity/
    );
  });

  it('merges firmware overlay when provided', () => {
    const identity = makeIpodIdentity(); // nano_4g
    const firmware: FirmwareCapabilities = {
      familyId: 15,
      audioCodecs: [
        { codec: 'AAC' },
        { codec: 'MP3' },
        { codec: 'Apple_Lossless' },
        { codec: 'FLAC' }, // hypothetical Rockbox-style overlay
      ],
    };
    const caps = resolveCapabilities(identity, { firmware });

    expect(caps.supportedAudioCodecs).toContain('flac');
    expect(caps.supportedAudioCodecs).toContain('alac');
  });

  it('resolves capabilities for unsupported devices (notSupportedReason on identity, not on caps)', () => {
    // familyId 18 → nano_7g, which is unsupported by libgpod but hardware-capable
    const identity = makeIpodIdentity({
      serialNumber: 'XXXXXXX',
      familyId: 18,
      notSupportedReason: 'nano 7G not supported',
    });
    // resolveCapabilities still returns capabilities even for unsupported devices —
    // capability resolution is about hardware class; the notSupportedReason lives on
    // the identity and is surfaced by the CLI, not by capability resolution.
    const caps = resolveCapabilities(identity);
    // nano_7g hardware: ALAC-capable, video, artwork 240px
    expect(caps.supportedAudioCodecs).toContain('alac');
    expect(caps.supportsVideo).toBe(true);
    expect(caps.artworkMaxResolution).toBe(240);
  });
});

// =============================================================================
// Mass-storage path
// =============================================================================

describe('resolveCapabilities — mass-storage identity', () => {
  it('resolves echo-mini preset capabilities', () => {
    const identity = makeMassStorageIdentity('echo-mini');
    const caps = resolveCapabilities(identity);

    expect(caps.supportedAudioCodecs).toContain('flac');
    expect(caps.supportsVideo).toBe(false);
    expect(caps.audioNormalization).toBe('none');
    expect(caps.supportsAlbumArtistBrowsing).toBe(true);
  });

  it('resolves rockbox preset capabilities', () => {
    const identity = makeMassStorageIdentity('rockbox');
    const caps = resolveCapabilities(identity);

    expect(caps.supportedAudioCodecs).toContain('opus');
    expect(caps.audioNormalization).toBe('replaygain');
  });

  it('resolves generic preset when no presetId provided', () => {
    const identity = makeMassStorageIdentity(); // no presetId → falls back to 'generic'
    const caps = resolveCapabilities(identity);

    expect(caps.supportedAudioCodecs).toContain('aac');
    expect(caps.supportedAudioCodecs).toContain('mp3');
  });

  it('applies per-call overrides on top of preset', () => {
    const identity = makeMassStorageIdentity('echo-mini');
    const overrides: Partial<import('@podkit/device-types').DeviceCapabilities> = {
      artworkMaxResolution: 64,
      supportsAlbumArtistBrowsing: false,
    };
    const caps = resolveCapabilities(identity, { overrides });

    // Override applied
    expect(caps.artworkMaxResolution).toBe(64);
    expect(caps.supportsAlbumArtistBrowsing).toBe(false);
    // Non-overridden fields from preset remain
    expect(caps.supportedAudioCodecs).toContain('flac');
  });

  it('accepts a custom preset registry', () => {
    const identity = makeMassStorageIdentity('my-custom-dap');
    const customPreset = {
      artworkSources: [] as import('@podkit/device-types').DeviceArtworkSource[],
      artworkMaxResolution: null,
      supportedAudioCodecs: ['flac', 'wav'] as import('@podkit/device-types').AudioCodec[],
      supportsVideo: false,
      audioNormalization: 'none' as import('@podkit/device-types').AudioNormalizationMode,
      supportsAlbumArtistBrowsing: false,
      contentPaths: { musicDir: 'Music', moviesDir: 'Video/Movies', tvShowsDir: 'Video/Shows' },
    };
    const caps = resolveCapabilities(identity, {
      presets: { 'my-custom-dap': customPreset },
    });

    expect(caps.supportedAudioCodecs).toContain('flac');
    expect(caps.artworkMaxResolution).toBeNull();
  });

  it('throws for unregistered preset id with empty preset map', () => {
    const identity = makeMassStorageIdentity('no-such-preset');
    expect(() => resolveCapabilities(identity, { presets: {} })).toThrow(/no preset found/i);
  });
});

// =============================================================================
// Unknown kind guard
// =============================================================================

describe('resolveCapabilities — unknown kind', () => {
  it('throws for an unrecognised identity kind', () => {
    const bad = { kind: 'floppy-disk' } as unknown as DeviceIdentity;
    expect(() => resolveCapabilities(bad)).toThrow(/unknown identity kind/i);
  });
});

// =============================================================================
// identifyCapabilities
// =============================================================================

describe('identifyCapabilities', () => {
  it('resolves capabilities from an IpodModel directly', async () => {
    const { identify } = await import('@podkit/devices-ipod');
    const model = identify({ from: 'sysinfo', modelNumStr: 'B754' }); // nano_4g 8GB Black
    expect(model).toBeDefined();

    const caps = identifyCapabilities(model!);
    expect(caps.supportedAudioCodecs).toContain('alac');
    expect(caps.supportsVideo).toBe(true);
    expect(caps.artworkMaxResolution).toBe(240);
    expect(caps.audioNormalization).toBe('soundcheck');
  });

  it('accepts a firmware overlay', async () => {
    const { identify } = await import('@podkit/devices-ipod');
    const model = identify({ from: 'sysinfo', modelNumStr: 'B754' })!;
    const firmware: FirmwareCapabilities = {
      familyId: 15,
      audioCodecs: [{ codec: 'FLAC' }],
    };
    const caps = identifyCapabilities(model, { firmware });

    expect(caps.supportedAudioCodecs).toContain('flac');
  });

  it('resolves classic_1g model with no artwork and no video', async () => {
    const { identify } = await import('@podkit/devices-ipod');
    // Use USB lookup for a 1G classic — no serial/model table entry
    // Use USB lookup for a 1G classic — no serial/model table entry
    identify({ from: 'usb', productId: '0x1101' }); // hypothetical; likely undefined
    // Fall back to a generation-based identify
    const { GENERATIONS } = await import('@podkit/devices-ipod');
    const gen = GENERATIONS['classic_1g'];
    const syntheticModel = {
      displayName: gen.displayName,
      generationId: 'classic_1g' as const,
      checksumType: gen.checksumType,
      source: 'usb' as const,
    };
    const caps = identifyCapabilities(syntheticModel);

    expect(caps.supportedAudioCodecs).not.toContain('alac');
    expect(caps.supportsVideo).toBe(false);
    expect(caps.artworkMaxResolution).toBeNull();
  });
});
