import { describe, expect, it } from 'bun:test';
import type { DeviceCapabilities } from '@podkit/core';
import type { DeviceConfig, PodkitConfig } from './types.js';
import { DEFAULT_TRANSFORMS_CONFIG, DEFAULT_VIDEO_TRANSFORMS_CONFIG } from './types.js';
import {
  resolveGlobalConfig,
  resolveDeviceSettings,
  formatResolved,
  GLOBAL_EXPLICIT_SOURCES,
} from './resolve.js';

// =============================================================================
// Helpers
// =============================================================================

/** Minimal valid PodkitConfig for testing */
function makeConfig(overrides?: Partial<PodkitConfig>): PodkitConfig {
  return {
    quality: 'high',
    artwork: true,
    tips: true,
    transforms: DEFAULT_TRANSFORMS_CONFIG,
    videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
    ...overrides,
  };
}

/** Capabilities for a device that supports everything */
const FULL_CAPABILITIES: DeviceCapabilities = {
  artworkSources: ['database'],
  artworkMaxResolution: 320,
  supportedAudioCodecs: ['aac', 'mp3', 'alac'],
  supportsVideo: true,
  audioNormalization: 'soundcheck',
  supportsAlbumArtistBrowsing: false,
};

/** Capabilities for a device with no video support */
const NO_VIDEO_CAPABILITIES: DeviceCapabilities = {
  ...FULL_CAPABILITIES,
  supportsVideo: false,
};

/** Capabilities for a device with no artwork support */
const NO_ARTWORK_CAPABILITIES: DeviceCapabilities = {
  ...FULL_CAPABILITIES,
  artworkSources: [],
  artworkMaxResolution: null,
};

// =============================================================================
// resolveGlobalConfig
// =============================================================================

describe('resolveGlobalConfig', () => {
  it('resolves defaults when only quality is set', () => {
    const result = resolveGlobalConfig(makeConfig());

    expect(result.quality).toEqual({ value: 'high', source: 'global' });
    expect(result.audio).toEqual({ value: 'high', source: 'global-quality' });
    expect(result.video).toEqual({ value: 'high', source: 'global-quality' });
    expect(result.artwork).toEqual({ value: true, source: 'global' });
  });

  it('uses explicit audioQuality over inherited quality', () => {
    const result = resolveGlobalConfig(makeConfig({ audioQuality: 'max' }));

    expect(result.quality).toEqual({ value: 'high', source: 'global' });
    expect(result.audio).toEqual({ value: 'max', source: 'global' });
  });

  it('uses explicit videoQuality over inherited quality', () => {
    const result = resolveGlobalConfig(makeConfig({ videoQuality: 'medium' }));

    expect(result.video).toEqual({ value: 'medium', source: 'global' });
  });

  it('inherits audio and video from custom quality', () => {
    const result = resolveGlobalConfig(makeConfig({ quality: 'low' }));

    expect(result.quality).toEqual({ value: 'low', source: 'global' });
    expect(result.audio).toEqual({ value: 'low', source: 'global-quality' });
    expect(result.video).toEqual({ value: 'low', source: 'global-quality' });
  });

  it('resolves artwork=false', () => {
    const result = resolveGlobalConfig(makeConfig({ artwork: false }));

    expect(result.artwork).toEqual({ value: false, source: 'global' });
  });
});

// =============================================================================
// resolveDeviceSettings — quality
// =============================================================================

describe('resolveDeviceSettings', () => {
  describe('quality column', () => {
    it('uses device quality when set', () => {
      const config = makeConfig();
      const device: DeviceConfig = { quality: 'medium' };

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.quality).toEqual({ value: 'medium', source: 'device' });
    });

    it('falls back to global quality', () => {
      const config = makeConfig({ quality: 'low' });
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.quality).toEqual({ value: 'low', source: 'global-quality' });
    });
  });

  // ===========================================================================
  // Audio
  // ===========================================================================

  describe('audio', () => {
    it('uses device audioQuality when set', () => {
      const config = makeConfig();
      const device: DeviceConfig = { audioQuality: 'max' };

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.audio).toEqual({ value: 'max', source: 'device' });
    });

    it('inherits from device quality', () => {
      const config = makeConfig();
      const device: DeviceConfig = { quality: 'medium' };

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.audio).toEqual({ value: 'medium', source: 'device-quality' });
    });

    it('falls back to global audioQuality', () => {
      const config = makeConfig({ audioQuality: 'low' });
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.audio).toEqual({ value: 'low', source: 'global' });
    });

    it('falls back to global quality', () => {
      const config = makeConfig({ quality: 'medium' });
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.audio).toEqual({ value: 'medium', source: 'global-quality' });
    });

    it('device audioQuality wins over device quality', () => {
      const config = makeConfig();
      const device: DeviceConfig = { quality: 'low', audioQuality: 'max' };

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.audio).toEqual({ value: 'max', source: 'device' });
    });
  });

  // ===========================================================================
  // Video
  // ===========================================================================

  describe('video', () => {
    it('returns unknown when capabilities are null (disconnected iPod)', () => {
      const config = makeConfig();
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, null, false, false);

      expect(result.video).toEqual({ value: null, source: 'unknown' });
    });

    it('returns unsupported when device has no video', () => {
      const config = makeConfig();
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(
        config,
        'test',
        device,
        NO_VIDEO_CAPABILITIES,
        false,
        false
      );

      expect(result.video).toEqual({ value: null, source: 'unsupported' });
    });

    it('uses device videoQuality when set', () => {
      const config = makeConfig();
      const device: DeviceConfig = { videoQuality: 'low' };

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.video).toEqual({ value: 'low', source: 'device' });
    });

    it('inherits from device quality', () => {
      const config = makeConfig();
      const device: DeviceConfig = { quality: 'medium' };

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.video).toEqual({ value: 'medium', source: 'device-quality' });
    });

    it('falls back to global videoQuality', () => {
      const config = makeConfig({ videoQuality: 'low' });
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.video).toEqual({ value: 'low', source: 'global' });
    });

    it('falls back to global quality', () => {
      const config = makeConfig({ quality: 'medium' });
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.video).toEqual({ value: 'medium', source: 'global-quality' });
    });
  });

  // ===========================================================================
  // Artwork
  // ===========================================================================

  describe('artwork', () => {
    it('returns unknown when capabilities are null (disconnected iPod)', () => {
      const config = makeConfig();
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, null, false, false);

      expect(result.artwork).toEqual({ value: null, source: 'unknown' });
    });

    it('returns unsupported when device has no artwork sources', () => {
      const config = makeConfig();
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(
        config,
        'test',
        device,
        NO_ARTWORK_CAPABILITIES,
        false,
        false
      );

      expect(result.artwork).toEqual({ value: null, source: 'unsupported' });
    });

    it('uses device artwork when set', () => {
      const config = makeConfig();
      const device: DeviceConfig = { artwork: false };

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.artwork).toEqual({ value: false, source: 'device' });
    });

    it('resolves device artwork=true through the chain (source device)', () => {
      // With no `false` anywhere, the explicit-false bypass is skipped and
      // resolution reaches the resolveChain cascade. An explicit device
      // `true` is returned with source 'device' (vs. inheriting 'global').
      // Note: a global `false` would veto via the bypass above — covered
      // separately — so global must be non-false to exercise this path.
      const config = makeConfig({ artwork: true });
      const device: DeviceConfig = { artwork: true };

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.artwork).toEqual({ value: true, source: 'device' });
    });

    it('falls back to global artwork', () => {
      const config = makeConfig({ artwork: false });
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.artwork).toEqual({ value: false, source: 'global' });
    });

    it('honors explicit device artwork=false even when capabilities are null', () => {
      // Settings are resolved before device capabilities load in some call
      // paths; without this carve-out the user's explicit disable would
      // resolve to `unknown` and the call-site fallback `?? true` would
      // re-enable artwork against the user's wishes.
      const config = makeConfig();
      const device: DeviceConfig = { artwork: false };

      const result = resolveDeviceSettings(config, 'test', device, null, false, false);

      expect(result.artwork).toEqual({ value: false, source: 'device' });
    });

    it('honors explicit global artwork=false even when capabilities are null', () => {
      const config = makeConfig({ artwork: false });
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, null, false, false);

      expect(result.artwork).toEqual({ value: false, source: 'global' });
    });

    it('honors explicit device artwork=false even when device has no artwork sources', () => {
      const config = makeConfig();
      const device: DeviceConfig = { artwork: false };

      const result = resolveDeviceSettings(
        config,
        'test',
        device,
        NO_ARTWORK_CAPABILITIES,
        false,
        false
      );

      expect(result.artwork).toEqual({ value: false, source: 'device' });
    });
  });

  // ===========================================================================
  // Metadata
  // ===========================================================================

  describe('metadata', () => {
    it('preserves device name, type, connected, isDefault', () => {
      const config = makeConfig();
      const device: DeviceConfig = { type: 'echo-mini' };

      const result = resolveDeviceSettings(
        config,
        'mydevice',
        device,
        NO_VIDEO_CAPABILITIES,
        true,
        true
      );

      expect(result.name).toBe('mydevice');
      expect(result.type).toBe('echo-mini');
      expect(result.connected).toBe(true);
      expect(result.isDefault).toBe(true);
    });

    it('defaults type to ipod when not set', () => {
      const config = makeConfig();
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, null, false, false);

      expect(result.type).toBe('ipod');
    });
  });

  // ===========================================================================
  // Simple settings (encoding, transferMode, etc.)
  // ===========================================================================

  describe('simple settings', () => {
    it('uses device encoding over global', () => {
      const config = makeConfig({ encoding: 'cbr' });
      const device: DeviceConfig = { encoding: 'vbr' };

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.encoding).toEqual({ value: 'vbr', source: 'device' });
    });

    it('falls back to global encoding', () => {
      const config = makeConfig({ encoding: 'cbr' });
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.encoding).toEqual({ value: 'cbr', source: 'global' });
    });

    it('defaults encoding to undefined', () => {
      const config = makeConfig();
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.encoding).toEqual({ value: undefined, source: 'default' });
    });

    it('resolves transferMode through chain', () => {
      const config = makeConfig();
      const device: DeviceConfig = { transferMode: 'optimized' };

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.transferMode).toEqual({ value: 'optimized', source: 'device' });
    });

    it('defaults transferMode to fast', () => {
      const config = makeConfig();
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.transferMode).toEqual({ value: 'fast', source: 'default' });
    });

    it('resolves checkArtwork with default false', () => {
      const config = makeConfig();
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.checkArtwork).toEqual({ value: false, source: 'default' });
    });

    it('uses device checkArtwork over global', () => {
      const config = makeConfig({ checkArtwork: true });
      const device: DeviceConfig = { checkArtwork: false };

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.checkArtwork).toEqual({ value: false, source: 'device' });
    });

    it('resolves skipUpgrades with default false', () => {
      const config = makeConfig();
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.skipUpgrades).toEqual({ value: false, source: 'default' });
    });

    it('resolves customBitrate through chain', () => {
      const config = makeConfig({ customBitrate: 192 });
      const device: DeviceConfig = {};

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.customBitrate).toEqual({ value: 192, source: 'global' });
    });

    it('resolves bitrateTolerance through chain', () => {
      const config = makeConfig();
      const device: DeviceConfig = { bitrateTolerance: 0.1 };

      const result = resolveDeviceSettings(config, 'test', device, FULL_CAPABILITIES, false, false);

      expect(result.bitrateTolerance).toEqual({ value: 0.1, source: 'device' });
    });
  });
});

// =============================================================================
// Full resolution scenario
// =============================================================================

describe('full resolution scenarios', () => {
  it('connected iPod with video support inherits global quality', () => {
    const config = makeConfig({ quality: 'high' });
    const device: DeviceConfig = { volumeUuid: 'ABC' };

    const result = resolveDeviceSettings(config, 'terapod', device, FULL_CAPABILITIES, true, true);

    expect(result.quality.value).toBe('high');
    expect(result.quality.source).toBe('global-quality');
    expect(result.audio.value).toBe('high');
    expect(result.audio.source).toBe('global-quality');
    expect(result.video.value).toBe('high');
    expect(result.video.source).toBe('global-quality');
    expect(result.artwork.value).toBe(true);
    expect(result.artwork.source).toBe('global');
  });

  it('echo-mini with max quality, no video support', () => {
    const config = makeConfig({ quality: 'high' });
    const device: DeviceConfig = { type: 'echo-mini', quality: 'max' };

    const result = resolveDeviceSettings(
      config,
      'echomini',
      device,
      NO_VIDEO_CAPABILITIES,
      false,
      false
    );

    expect(result.quality).toEqual({ value: 'max', source: 'device' });
    expect(result.audio).toEqual({ value: 'max', source: 'device-quality' });
    expect(result.video).toEqual({ value: null, source: 'unsupported' });
    expect(result.artwork.value).toBe(true);
  });

  it('disconnected iPod shows unknown for video and artwork', () => {
    const config = makeConfig();
    const device: DeviceConfig = { volumeUuid: 'XYZ' };

    const result = resolveDeviceSettings(config, 'nano', device, null, false, false);

    expect(result.audio.value).toBe('high');
    expect(result.video.source).toBe('unknown');
    expect(result.artwork.source).toBe('unknown');
  });
});

// =============================================================================
// formatResolved
// =============================================================================

describe('formatResolved', () => {
  it('shows value without brackets for device source', () => {
    expect(formatResolved({ value: 'high', source: 'device' })).toBe('high');
  });

  it('wraps inherited values in brackets', () => {
    expect(formatResolved({ value: 'high', source: 'device-quality' })).toBe('[high]');
    expect(formatResolved({ value: 'high', source: 'global' })).toBe('[high]');
    expect(formatResolved({ value: 'high', source: 'global-quality' })).toBe('[high]');
    expect(formatResolved({ value: 'high', source: 'default' })).toBe('[high]');
  });

  it('shows ✗ for unsupported', () => {
    expect(formatResolved({ value: null, source: 'unsupported' })).toBe('\u2717');
  });

  it('shows ? for unknown', () => {
    expect(formatResolved({ value: null, source: 'unknown' })).toBe('?');
  });

  it('formats boolean values', () => {
    expect(formatResolved({ value: true, source: 'device' })).toBe('on');
    expect(formatResolved({ value: false, source: 'device' })).toBe('off');
    expect(formatResolved({ value: true, source: 'global' })).toBe('[on]');
  });
});

// =============================================================================
// formatResolved with GLOBAL_EXPLICIT_SOURCES (replaces the deleted
// formatGlobalResolved — same semantics via the explicitSources option)
// =============================================================================

describe('formatResolved with GLOBAL_EXPLICIT_SOURCES', () => {
  const opts = { explicitSources: GLOBAL_EXPLICIT_SOURCES };

  it('shows value without brackets for global source', () => {
    expect(formatResolved({ value: 'max', source: 'global' }, opts)).toBe('max');
  });

  it('wraps inherited values in brackets', () => {
    expect(formatResolved({ value: 'high', source: 'global-quality' }, opts)).toBe('[high]');
    expect(formatResolved({ value: 'high', source: 'default' }, opts)).toBe('[high]');
  });

  it('formats boolean values', () => {
    expect(formatResolved({ value: true, source: 'global' }, opts)).toBe('on');
    expect(formatResolved({ value: false, source: 'global' }, opts)).toBe('off');
  });

  it('treats device-config as inherited at the global boundary', () => {
    expect(formatResolved({ value: 'FiiO', source: 'device-config' }, opts)).toBe('[FiiO]');
  });
});

describe('formatResolved with device-config explicit (default)', () => {
  it('treats device-config as explicit (no brackets) — capability-cascade per-device override', () => {
    expect(formatResolved({ value: 'AliExpress', source: 'device-config' })).toBe('AliExpress');
  });

  it('treats preset as inherited (brackets)', () => {
    expect(formatResolved({ value: 'FiiO', source: 'preset' })).toBe('[FiiO]');
  });
});
