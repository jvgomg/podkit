import { describe, expect, it } from 'bun:test';
import { resolveVideoConfig } from './config.js';
import type { VideoSyncConfig } from './config.js';
import type { VideoDeviceProfile } from '../../video/types.js';
import { DEVICE_PROFILES } from '../../video/types.js';
import type { VideoTransformsConfig } from '../../transforms/types.js';
import type { DeviceCapabilities } from '../../device/capabilities.js';

// =============================================================================
// Fixtures
// =============================================================================

const ipodClassic: VideoDeviceProfile = DEVICE_PROFILES['ipod-classic']!;

const enabledTransforms: VideoTransformsConfig = {
  showLanguage: { enabled: true, format: '({})', expand: false },
};

const disabledTransforms: VideoTransformsConfig = {
  showLanguage: { enabled: false, format: '({})', expand: false },
};

// =============================================================================
// Tests
// =============================================================================

describe('resolveVideoConfig', () => {
  describe('defaults', () => {
    it('defaults videoQuality to high when not specified', () => {
      const resolved = resolveVideoConfig({});
      expect(resolved.videoQuality).toBe('high');
    });

    it('defaults videoQuality to high when called with no arguments', () => {
      const resolved = resolveVideoConfig();
      expect(resolved.videoQuality).toBe('high');
    });

    it('defaults hardwareAcceleration to true', () => {
      const resolved = resolveVideoConfig({});
      expect(resolved.hardwareAcceleration).toBe(true);
    });

    it('defaults supportsVideo to true when no capabilities provided', () => {
      const resolved = resolveVideoConfig({});
      expect(resolved.supportsVideo).toBe(true);
    });

    it('defaults videoTransformsEnabled to false when no transforms provided', () => {
      const resolved = resolveVideoConfig({});
      expect(resolved.videoTransformsEnabled).toBe(false);
    });

    it('defaults presetBitrate to undefined when no device profile provided', () => {
      const resolved = resolveVideoConfig({});
      expect(resolved.presetBitrate).toBeUndefined();
    });

    it('defaults deviceProfile to undefined when not provided', () => {
      const resolved = resolveVideoConfig({});
      expect(resolved.deviceProfile).toBeUndefined();
    });
  });

  describe('videoQuality', () => {
    it('uses the provided quality preset', () => {
      const resolved = resolveVideoConfig({ videoQuality: 'medium' });
      expect(resolved.videoQuality).toBe('medium');
    });

    it('resolvedVideoQuality matches videoQuality', () => {
      const resolved = resolveVideoConfig({ videoQuality: 'low' });
      expect(resolved.resolvedVideoQuality).toBe('low');
    });

    it('resolvedVideoQuality defaults to high', () => {
      const resolved = resolveVideoConfig({});
      expect(resolved.resolvedVideoQuality).toBe('high');
    });
  });

  describe('hardwareAcceleration', () => {
    it('can be disabled explicitly', () => {
      const resolved = resolveVideoConfig({ hardwareAcceleration: false });
      expect(resolved.hardwareAcceleration).toBe(false);
    });

    it('can be enabled explicitly', () => {
      const resolved = resolveVideoConfig({ hardwareAcceleration: true });
      expect(resolved.hardwareAcceleration).toBe(true);
    });
  });

  describe('videoTransformsEnabled', () => {
    it('is true when transforms have an enabled transform', () => {
      const resolved = resolveVideoConfig({ videoTransforms: enabledTransforms });
      expect(resolved.videoTransformsEnabled).toBe(true);
    });

    it('is false when transforms are all disabled', () => {
      const resolved = resolveVideoConfig({ videoTransforms: disabledTransforms });
      expect(resolved.videoTransformsEnabled).toBe(false);
    });

    it('is false when videoTransforms is undefined', () => {
      const resolved = resolveVideoConfig({});
      expect(resolved.videoTransformsEnabled).toBe(false);
    });
  });

  describe('presetBitrate', () => {
    it('derives combined bitrate from device profile and quality', () => {
      const resolved = resolveVideoConfig({
        videoQuality: 'high',
        deviceProfile: ipodClassic,
      });

      // iPod Classic 'high' preset: videoBitrate=2000 + audioBitrate=128 = 2128
      expect(resolved.presetBitrate).toBe(2128);
    });

    it('varies by quality preset', () => {
      const high = resolveVideoConfig({
        videoQuality: 'high',
        deviceProfile: ipodClassic,
      });
      const low = resolveVideoConfig({
        videoQuality: 'low',
        deviceProfile: ipodClassic,
      });

      expect(high.presetBitrate).toBeGreaterThan(low.presetBitrate!);
    });

    it('is undefined when no device profile is provided', () => {
      const resolved = resolveVideoConfig({ videoQuality: 'high' });
      expect(resolved.presetBitrate).toBeUndefined();
    });

    it('derives bitrate for max preset', () => {
      const resolved = resolveVideoConfig({
        videoQuality: 'max',
        deviceProfile: ipodClassic,
      });

      // iPod Classic 'max' preset: videoBitrate=2500 + audioBitrate=160 = 2660
      expect(resolved.presetBitrate).toBe(2660);
    });
  });

  describe('supportsVideo', () => {
    it('reads from capabilities when provided', () => {
      const capabilities: DeviceCapabilities = {
        artworkSources: ['database'],
        artworkMaxResolution: 320,
        supportedAudioCodecs: ['aac', 'mp3'],
        supportsVideo: false,
      };

      const resolved = resolveVideoConfig({ capabilities });
      expect(resolved.supportsVideo).toBe(false);
    });

    it('is true when capabilities say video is supported', () => {
      const capabilities: DeviceCapabilities = {
        artworkSources: ['database'],
        artworkMaxResolution: 320,
        supportedAudioCodecs: ['aac', 'mp3'],
        supportsVideo: true,
      };

      const resolved = resolveVideoConfig({ capabilities });
      expect(resolved.supportsVideo).toBe(true);
    });
  });

  describe('raw config', () => {
    it('preserves the original config', () => {
      const config: VideoSyncConfig = {
        videoQuality: 'medium',
        hardwareAcceleration: false,
        forceMetadata: true,
      };

      const resolved = resolveVideoConfig(config);
      expect(resolved.raw.videoQuality).toBe('medium');
      expect(resolved.raw.hardwareAcceleration).toBe(false);
      expect(resolved.raw.forceMetadata).toBe(true);
    });

    it('raw config is frozen', () => {
      const resolved = resolveVideoConfig({ videoQuality: 'high' });
      expect(Object.isFrozen(resolved.raw)).toBe(true);
    });
  });
});
