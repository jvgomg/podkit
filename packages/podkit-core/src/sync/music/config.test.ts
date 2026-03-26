import { describe, expect, it } from 'bun:test';
import { resolveMusicConfig } from './config.js';
import type { MusicSyncConfig } from './config.js';
import type { FFmpegTranscoder } from '../../transcode/ffmpeg.js';
import type { DeviceCapabilities } from '../../device/capabilities.js';

// Minimal stub — resolveMusicConfig never calls transcoder methods
const stubTranscoder = {} as FFmpegTranscoder;

function makeConfig(overrides: Partial<MusicSyncConfig> = {}): MusicSyncConfig {
  return {
    quality: 'high',
    transcoder: stubTranscoder,
    ...overrides,
  };
}

function alacCapabilities(overrides: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
  return {
    artworkSources: ['database'],
    artworkMaxResolution: 320,
    supportedAudioCodecs: ['aac', 'alac', 'mp3'],
    supportsVideo: true,
    ...overrides,
  };
}

function aacOnlyCapabilities(overrides: Partial<DeviceCapabilities> = {}): DeviceCapabilities {
  return {
    artworkSources: ['database'],
    artworkMaxResolution: 320,
    supportedAudioCodecs: ['aac', 'mp3'],
    supportsVideo: false,
    ...overrides,
  };
}

describe('resolveMusicConfig', () => {
  describe('defaults', () => {
    it('resolves quality "high" with no capabilities', () => {
      const resolved = resolveMusicConfig(makeConfig());

      expect(resolved.resolvedQuality).toBe('high');
      expect(resolved.isAlacPreset).toBe(false);
      expect(resolved.deviceSupportsAlac).toBe(false);
      expect(resolved.transferMode).toBe('fast');
      expect(resolved.artworkResize).toBeUndefined();
      expect(resolved.primaryArtworkSource).toBeUndefined();
      expect(resolved.supportedAudioCodecs).toBeUndefined();
      expect(resolved.transformsEnabled).toBe(false);
    });

    it('preserves the original config as raw', () => {
      const config = makeConfig();
      const resolved = resolveMusicConfig(config);
      expect(resolved.raw).toBe(config);
    });

    it('defaults transferMode to "fast"', () => {
      const resolved = resolveMusicConfig(makeConfig());
      expect(resolved.transferMode).toBe('fast');
    });
  });

  describe('ALAC resolution', () => {
    it('max quality + ALAC-capable device → isAlacPreset true, resolvedQuality "lossless"', () => {
      const resolved = resolveMusicConfig(
        makeConfig({ quality: 'max', capabilities: alacCapabilities() })
      );

      expect(resolved.isAlacPreset).toBe(true);
      expect(resolved.resolvedQuality).toBe('lossless');
      expect(resolved.deviceSupportsAlac).toBe(true);
    });

    it('max quality + non-ALAC device → isAlacPreset false, resolvedQuality "high"', () => {
      const resolved = resolveMusicConfig(
        makeConfig({ quality: 'max', capabilities: aacOnlyCapabilities() })
      );

      expect(resolved.isAlacPreset).toBe(false);
      expect(resolved.resolvedQuality).toBe('high');
      expect(resolved.deviceSupportsAlac).toBe(false);
    });

    it('max quality + no capabilities → falls back to "high"', () => {
      const resolved = resolveMusicConfig(makeConfig({ quality: 'max' }));

      expect(resolved.isAlacPreset).toBe(false);
      expect(resolved.resolvedQuality).toBe('high');
      expect(resolved.deviceSupportsAlac).toBe(false);
    });

    it('non-max quality ignores ALAC capability', () => {
      const resolved = resolveMusicConfig(
        makeConfig({ quality: 'medium', capabilities: alacCapabilities() })
      );

      expect(resolved.isAlacPreset).toBe(false);
      expect(resolved.resolvedQuality).toBe('medium');
      expect(resolved.deviceSupportsAlac).toBe(true);
    });
  });

  describe('preset bitrate', () => {
    it('returns 256 for "high"', () => {
      const resolved = resolveMusicConfig(makeConfig({ quality: 'high' }));
      expect(resolved.presetBitrate).toBe(256);
    });

    it('returns 192 for "medium"', () => {
      const resolved = resolveMusicConfig(makeConfig({ quality: 'medium' }));
      expect(resolved.presetBitrate).toBe(192);
    });

    it('returns 128 for "low"', () => {
      const resolved = resolveMusicConfig(makeConfig({ quality: 'low' }));
      expect(resolved.presetBitrate).toBe(128);
    });

    it('returns ALAC estimated bitrate for max+ALAC', () => {
      const resolved = resolveMusicConfig(
        makeConfig({ quality: 'max', capabilities: alacCapabilities() })
      );
      expect(resolved.presetBitrate).toBe(900);
    });

    it('returns 256 for max without ALAC (falls back to high)', () => {
      const resolved = resolveMusicConfig(makeConfig({ quality: 'max' }));
      expect(resolved.presetBitrate).toBe(256);
    });

    it('custom bitrate overrides preset', () => {
      const resolved = resolveMusicConfig(makeConfig({ quality: 'high', customBitrate: 320 }));
      expect(resolved.presetBitrate).toBe(320);
    });
  });

  describe('artwork', () => {
    it('sets artworkResize when primary source is "embedded"', () => {
      const capabilities: DeviceCapabilities = {
        artworkSources: ['embedded'],
        artworkMaxResolution: 240,
        supportedAudioCodecs: ['aac', 'mp3'],
        supportsVideo: false,
      };
      const resolved = resolveMusicConfig(makeConfig({ capabilities }));

      expect(resolved.artworkResize).toBe(240);
      expect(resolved.primaryArtworkSource).toBe('embedded');
    });

    it('artworkResize is undefined when primary source is "database"', () => {
      const resolved = resolveMusicConfig(makeConfig({ capabilities: alacCapabilities() }));

      expect(resolved.artworkResize).toBeUndefined();
      expect(resolved.primaryArtworkSource).toBe('database');
    });

    it('artworkResize is undefined when no capabilities', () => {
      const resolved = resolveMusicConfig(makeConfig());
      expect(resolved.artworkResize).toBeUndefined();
    });
  });

  describe('supported audio codecs', () => {
    it('returns codecs from capabilities', () => {
      const resolved = resolveMusicConfig(makeConfig({ capabilities: alacCapabilities() }));
      expect(resolved.supportedAudioCodecs).toEqual(['aac', 'alac', 'mp3']);
    });

    it('returns undefined when no capabilities', () => {
      const resolved = resolveMusicConfig(makeConfig());
      expect(resolved.supportedAudioCodecs).toBeUndefined();
    });
  });

  describe('transforms', () => {
    it('transformsEnabled is false when no transforms config', () => {
      const resolved = resolveMusicConfig(makeConfig());
      expect(resolved.transformsEnabled).toBe(false);
    });

    it('transformsEnabled is false when transforms are disabled', () => {
      const resolved = resolveMusicConfig(
        makeConfig({
          transforms: {
            cleanArtists: { enabled: false, drop: false, format: 'feat. {}', ignore: [] },
          },
        })
      );
      expect(resolved.transformsEnabled).toBe(false);
    });

    it('transformsEnabled is true when a transform is enabled', () => {
      const resolved = resolveMusicConfig(
        makeConfig({
          transforms: {
            cleanArtists: { enabled: true, drop: false, format: 'feat. {}', ignore: [] },
          },
        })
      );
      expect(resolved.transformsEnabled).toBe(true);
    });
  });

  describe('transfer mode', () => {
    it('uses provided transferMode', () => {
      const resolved = resolveMusicConfig(makeConfig({ transferMode: 'portable' }));
      expect(resolved.transferMode).toBe('portable');
    });

    it('uses provided transferMode "optimized"', () => {
      const resolved = resolveMusicConfig(makeConfig({ transferMode: 'optimized' }));
      expect(resolved.transferMode).toBe('optimized');
    });
  });
});
