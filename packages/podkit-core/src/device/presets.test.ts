import { describe, expect, it } from 'bun:test';
import { DEVICE_PRESETS, getDevicePreset, resolveDeviceCapabilities } from './presets.js';

describe('DEVICE_PRESETS', () => {
  it('echo-mini supports Album Artist browsing', () => {
    expect(DEVICE_PRESETS['echo-mini'].supportsAlbumArtistBrowsing).toBe(true);
  });

  it('rockbox supports Album Artist browsing', () => {
    expect(DEVICE_PRESETS.rockbox.supportsAlbumArtistBrowsing).toBe(true);
  });

  it('generic supports Album Artist browsing', () => {
    expect(DEVICE_PRESETS.generic.supportsAlbumArtistBrowsing).toBe(true);
  });
});

describe('resolveDeviceCapabilities', () => {
  it('returns preset as-is when no overrides', () => {
    const caps = resolveDeviceCapabilities('rockbox');
    expect(caps).toEqual(DEVICE_PRESETS.rockbox);
  });

  it('returns undefined for unknown device type', () => {
    expect(resolveDeviceCapabilities('unknown-device')).toBeUndefined();
  });

  it('merges supportsAlbumArtistBrowsing override', () => {
    const caps = resolveDeviceCapabilities('generic', { supportsAlbumArtistBrowsing: false });
    expect(caps!.supportsAlbumArtistBrowsing).toBe(false);
    // Other fields should be unchanged
    expect(caps!.supportedAudioCodecs).toEqual(DEVICE_PRESETS.generic.supportedAudioCodecs);
  });

  it('keeps preset supportsAlbumArtistBrowsing when not overridden', () => {
    const caps = resolveDeviceCapabilities('rockbox', { artworkMaxResolution: 100 });
    expect(caps!.supportsAlbumArtistBrowsing).toBe(true);
    expect(caps!.artworkMaxResolution).toBe(100);
  });
});

describe('getDevicePreset', () => {
  it('returns preset for known types', () => {
    expect(getDevicePreset('echo-mini')).toBeDefined();
    expect(getDevicePreset('rockbox')).toBeDefined();
    expect(getDevicePreset('generic')).toBeDefined();
  });

  it('returns undefined for unknown types', () => {
    expect(getDevicePreset('ipod')).toBeUndefined();
    expect(getDevicePreset('foobar')).toBeUndefined();
  });
});
