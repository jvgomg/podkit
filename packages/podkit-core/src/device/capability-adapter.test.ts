import { describe, expect, it } from 'bun:test';
import { createIpodCapabilities } from './capability-adapter.js';
import type { LibgpodDeviceInfo } from './capability-adapter.js';

function makeDevice(overrides?: Partial<LibgpodDeviceInfo>): LibgpodDeviceInfo {
  return {
    supportsArtwork: true,
    supportsVideo: true,
    generation: 'classic_3',
    modelNumber: 'MC293',
    ...overrides,
  };
}

describe('createIpodCapabilities', () => {
  describe('video support from libgpod', () => {
    it('uses libgpod supportsVideo=true', () => {
      const caps = createIpodCapabilities(makeDevice({ supportsVideo: true }));
      expect(caps.supportsVideo).toBe(true);
    });

    it('uses libgpod supportsVideo=false', () => {
      const caps = createIpodCapabilities(makeDevice({ supportsVideo: false }));
      expect(caps.supportsVideo).toBe(false);
    });
  });

  describe('artwork from libgpod + supplemental resolution', () => {
    it('has database artwork source when libgpod says artwork supported', () => {
      const caps = createIpodCapabilities(makeDevice({ supportsArtwork: true }));
      expect(caps.artworkSources).toEqual(['database']);
    });

    it('has no artwork sources when libgpod says artwork not supported', () => {
      const caps = createIpodCapabilities(makeDevice({ supportsArtwork: false }));
      expect(caps.artworkSources).toEqual([]);
      expect(caps.artworkMaxResolution).toBe(0);
    });

    it('returns correct resolution for classic (320)', () => {
      const caps = createIpodCapabilities(makeDevice({ generation: 'classic_3' }));
      expect(caps.artworkMaxResolution).toBe(320);
    });

    it('returns correct resolution for nano 3G (320)', () => {
      const caps = createIpodCapabilities(makeDevice({ generation: 'nano_3' }));
      expect(caps.artworkMaxResolution).toBe(320);
    });

    it('returns correct resolution for nano 4G (240)', () => {
      const caps = createIpodCapabilities(makeDevice({ generation: 'nano_4' }));
      expect(caps.artworkMaxResolution).toBe(240);
    });

    it('returns correct resolution for nano 5G (240)', () => {
      const caps = createIpodCapabilities(makeDevice({ generation: 'nano_5' }));
      expect(caps.artworkMaxResolution).toBe(240);
    });

    it('returns correct resolution for nano 6G (240)', () => {
      const caps = createIpodCapabilities(makeDevice({ generation: 'nano_6' }));
      expect(caps.artworkMaxResolution).toBe(240);
    });

    it('returns correct resolution for nano 1-2G (176)', () => {
      expect(
        createIpodCapabilities(makeDevice({ generation: 'nano_1' })).artworkMaxResolution
      ).toBe(176);
      expect(
        createIpodCapabilities(makeDevice({ generation: 'nano_2' })).artworkMaxResolution
      ).toBe(176);
    });

    it('returns correct resolution for photo (320)', () => {
      const caps = createIpodCapabilities(makeDevice({ generation: 'photo' }));
      expect(caps.artworkMaxResolution).toBe(320);
    });

    it('returns 0 for unknown generation even if libgpod says artwork supported', () => {
      const caps = createIpodCapabilities(makeDevice({ generation: 'unknown' }));
      expect(caps.artworkMaxResolution).toBe(0);
    });
  });

  describe('codec support from generation metadata', () => {
    it('includes alac for ALAC-capable generations', () => {
      const caps = createIpodCapabilities(makeDevice({ generation: 'classic_3' }));
      expect(caps.supportedAudioCodecs).toContain('alac');
      expect(caps.supportedAudioCodecs).toContain('wav');
      expect(caps.supportedAudioCodecs).toContain('aiff');
    });

    it('excludes alac for non-ALAC generations', () => {
      const caps = createIpodCapabilities(makeDevice({ generation: 'nano_2' }));
      expect(caps.supportedAudioCodecs).not.toContain('alac');
      expect(caps.supportedAudioCodecs).toEqual(['aac', 'mp3']);
    });

    it('includes alac for fourth gen (audit fix)', () => {
      const caps = createIpodCapabilities(makeDevice({ generation: 'fourth' }));
      expect(caps.supportedAudioCodecs).toContain('alac');
    });

    it('includes alac for photo (audit fix)', () => {
      const caps = createIpodCapabilities(makeDevice({ generation: 'photo' }));
      expect(caps.supportedAudioCodecs).toContain('alac');
    });

    it('includes alac for mini_2 (audit fix)', () => {
      const caps = createIpodCapabilities(makeDevice({ generation: 'mini_2' }));
      expect(caps.supportedAudioCodecs).toContain('alac');
    });

    it('includes alac for touch (audit fix)', () => {
      const caps = createIpodCapabilities(makeDevice({ generation: 'touch_1' }));
      expect(caps.supportedAudioCodecs).toContain('alac');
    });

    it('always includes aac and mp3', () => {
      const caps = createIpodCapabilities(makeDevice({ generation: 'shuffle_1' }));
      expect(caps.supportedAudioCodecs).toContain('aac');
      expect(caps.supportedAudioCodecs).toContain('mp3');
    });
  });

  describe('iPod constants', () => {
    it('always uses soundcheck normalization', () => {
      const caps = createIpodCapabilities(makeDevice());
      expect(caps.audioNormalization).toBe('soundcheck');
    });

    it('always has supportsAlbumArtistBrowsing=false', () => {
      const caps = createIpodCapabilities(makeDevice());
      expect(caps.supportsAlbumArtistBrowsing).toBe(false);
    });
  });
});
