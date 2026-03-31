/**
 * Tests for device resolution
 */

import { describe, it, expect } from 'bun:test';
import {
  resolveDevice,
  parseCliDeviceArg,
  resolveEffectiveDevice,
  resolveDevicePath,
  getDeviceIdentity,
  autoDetectDevice,
} from './device.js';
import type { PodkitConfig } from '../config/types.js';
import { DEFAULT_TRANSFORMS_CONFIG, DEFAULT_VIDEO_TRANSFORMS_CONFIG } from '../config/types.js';
import type { DeviceManager, PlatformDeviceInfo } from '@podkit/core';

// Minimal config for testing
function makeConfig(overrides: Partial<PodkitConfig> = {}): PodkitConfig {
  return {
    quality: 'high',
    artwork: true,
    tips: true,
    transforms: DEFAULT_TRANSFORMS_CONFIG,
    videoTransforms: DEFAULT_VIDEO_TRANSFORMS_CONFIG,
    ...overrides,
  };
}

describe('resolveDevice', () => {
  const configWithDevices = makeConfig({
    devices: {
      terapod: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' },
      nanopod: { volumeUuid: 'DEF-456', volumeName: 'NANOPOD' },
    },
    defaults: {
      device: 'terapod',
    },
  });

  it('resolves requested device by name', () => {
    const result = resolveDevice(configWithDevices, 'nanopod');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.entity.name).toBe('nanopod');
      expect(result.entity.config.volumeUuid).toBe('DEF-456');
    }
  });

  it('resolves default device when no name given', () => {
    const result = resolveDevice(configWithDevices);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.entity.name).toBe('terapod');
    }
  });

  it('returns error for unknown device', () => {
    const result = resolveDevice(configWithDevices, 'unknown');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('unknown');
    }
  });

  it('returns error when no devices configured', () => {
    const result = resolveDevice(makeConfig());
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('No devices configured');
    }
  });
});

describe('parseCliDeviceArg', () => {
  const config = makeConfig({
    devices: {
      terapod: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' },
    },
  });

  describe('path-like values', () => {
    it('treats absolute paths as paths', () => {
      const result = parseCliDeviceArg('/Volumes/IPOD', config);
      expect(result.type).toBe('path');
      if (result.type === 'path') {
        expect(result.path).toBe('/Volumes/IPOD');
      }
    });

    it('treats relative paths with dot as paths', () => {
      const result = parseCliDeviceArg('./ipod', config);
      expect(result.type).toBe('path');
      if (result.type === 'path') {
        expect(result.path).toBe('./ipod');
      }
    });

    it('treats paths with slashes as paths', () => {
      const result = parseCliDeviceArg('some/path', config);
      expect(result.type).toBe('path');
    });
  });

  describe('named device values', () => {
    it('resolves known device names', () => {
      const result = parseCliDeviceArg('terapod', config);
      expect(result.type).toBe('name');
      if (result.type === 'name') {
        expect(result.name).toBe('terapod');
        expect(result.device).toBeDefined();
        expect(result.device?.config.volumeUuid).toBe('ABC-123');
      }
    });

    it('returns notFound for unknown names', () => {
      const result = parseCliDeviceArg('unknown', config);
      expect(result.type).toBe('name');
      if (result.type === 'name') {
        expect(result.name).toBe('unknown');
        expect(result.device).toBeUndefined();
        expect(result.notFound).toBe(true);
      }
    });
  });

  describe('no value', () => {
    it('returns none when undefined', () => {
      const result = parseCliDeviceArg(undefined, config);
      expect(result.type).toBe('none');
    });
  });
});

describe('resolveEffectiveDevice', () => {
  const config = makeConfig({
    devices: {
      terapod: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' },
      nanopod: { volumeUuid: 'DEF-456', volumeName: 'NANOPOD' },
    },
    defaults: {
      device: 'terapod',
    },
  });

  it('uses --device path over everything else', () => {
    const cliArg = parseCliDeviceArg('/Volumes/IPOD', config);
    const result = resolveEffectiveDevice(cliArg, 'nanopod', config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.cliPath).toBe('/Volumes/IPOD');
      expect(result.device).toBeUndefined();
    }
  });

  it('uses --device named device over positional', () => {
    const cliArg = parseCliDeviceArg('nanopod', config);
    const result = resolveEffectiveDevice(cliArg, 'terapod', config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.device?.name).toBe('nanopod');
    }
  });

  it('uses positional name when --device not provided', () => {
    const cliArg = parseCliDeviceArg(undefined, config);
    const result = resolveEffectiveDevice(cliArg, 'nanopod', config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.device?.name).toBe('nanopod');
    }
  });

  it('uses default when no args provided', () => {
    const cliArg = parseCliDeviceArg(undefined, config);
    const result = resolveEffectiveDevice(cliArg, undefined, config);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.device?.name).toBe('terapod');
    }
  });

  it('returns error for unknown --device name', () => {
    const cliArg = parseCliDeviceArg('unknown', config);
    const result = resolveEffectiveDevice(cliArg, undefined, config);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('unknown');
    }
  });
});

describe('getDeviceIdentity', () => {
  it('extracts identity from resolved device', () => {
    const device = {
      name: 'terapod',
      config: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' },
    };
    const identity = getDeviceIdentity(device);

    expect(identity).toEqual({
      volumeUuid: 'ABC-123',
      volumeName: 'TERAPOD',
    });
  });

  it('returns undefined for undefined device', () => {
    const identity = getDeviceIdentity(undefined);
    expect(identity).toBeUndefined();
  });
});

// =============================================================================
// resolveDevicePath — UUID validation
// =============================================================================

/**
 * Create a mock DeviceManager for testing
 */
function mockManager(devices: PlatformDeviceInfo[] = []): DeviceManager {
  return {
    platform: 'darwin',
    isSupported: true,
    listDevices: async () => devices,
    findIpodDevices: async () => devices,
    findByVolumeUuid: async (uuid: string) => devices.find((d) => d.volumeUuid === uuid) ?? null,
    getUuidForMountPoint: async (mountPoint: string) => {
      const device = devices.find(
        (d) => d.isMounted && d.mountPoint?.replace(/\/+$/, '') === mountPoint.replace(/\/+$/, '')
      );
      return device?.volumeUuid ?? null;
    },
    eject: async () => ({ success: false, device: 'mock', error: 'mock' }),
    mount: async () => ({ success: false, device: 'mock', error: 'mock' }),
    getManualInstructions: () => 'mock',
    requiresPrivileges: () => false,
    assessDevice: async () => null,
    getSiblingVolumes: async () => [],
  };
}

function mockDevice(overrides: Partial<PlatformDeviceInfo> = {}): PlatformDeviceInfo {
  return {
    identifier: 'disk2s2',
    volumeName: 'IPOD',
    volumeUuid: 'ABC-123',
    size: 160_000_000_000,
    isMounted: true,
    mountPoint: '/Volumes/IPOD',
    ...overrides,
  };
}

describe('resolveDevicePath', () => {
  it('returns CLI path directly when no UUID configured', async () => {
    const result = await resolveDevicePath({
      cliPath: '/media/ipod',
      manager: mockManager(),
    });
    expect(result.path).toBe('/media/ipod');
    expect(result.source).toBe('cli');
  });

  it('returns CLI path when UUID matches device at same path', async () => {
    const device = mockDevice({ volumeUuid: 'ABC-123', mountPoint: '/media/ipod' });
    const result = await resolveDevicePath({
      cliPath: '/media/ipod',
      deviceIdentity: { volumeUuid: 'ABC-123', volumeName: 'IPOD' },
      manager: mockManager([device]),
    });
    expect(result.path).toBe('/media/ipod');
    expect(result.source).toBe('cli');
    expect(result.deviceInfo).toBeDefined();
  });

  it('returns error when UUID resolves to different mount point', async () => {
    const device = mockDevice({ volumeUuid: 'ABC-123', mountPoint: '/Volumes/IPOD' });
    const result = await resolveDevicePath({
      cliPath: '/media/ipod',
      deviceIdentity: { volumeUuid: 'ABC-123', volumeName: 'IPOD' },
      manager: mockManager([device]),
    });
    expect(result.path).toBeUndefined();
    expect(result.error).toContain('UUID mismatch');
    expect(result.error).toContain('ABC-123');
    expect(result.error).toContain('/media/ipod');
    expect(result.error).toContain('/Volumes/IPOD');
  });

  it('proceeds with CLI path when UUID not found (no device detection)', async () => {
    const result = await resolveDevicePath({
      cliPath: '/media/ipod',
      deviceIdentity: { volumeUuid: 'ABC-123', volumeName: 'IPOD' },
      manager: mockManager([]), // No devices found (e.g., Linux)
    });
    expect(result.path).toBe('/media/ipod');
    expect(result.source).toBe('cli');
  });

  it('auto-detects device by UUID when no CLI path', async () => {
    const device = mockDevice({ volumeUuid: 'ABC-123', mountPoint: '/Volumes/IPOD' });
    const result = await resolveDevicePath({
      deviceIdentity: { volumeUuid: 'ABC-123', volumeName: 'IPOD' },
      manager: mockManager([device]),
    });
    expect(result.path).toBe('/Volumes/IPOD');
    expect(result.source).toBe('uuid');
  });

  it('returns error when UUID auto-detect finds no device', async () => {
    const result = await resolveDevicePath({
      deviceIdentity: { volumeUuid: 'ABC-123', volumeName: 'IPOD' },
      manager: mockManager([]),
    });
    expect(result.path).toBeUndefined();
    expect(result.error).toContain('ABC-123');
    expect(result.error).toContain('not found');
  });

  it('returns helpful error for device without UUID', async () => {
    const result = await resolveDevicePath({
      deviceIdentity: { volumeName: 'IPOD' },
      manager: mockManager(),
    });
    expect(result.path).toBeUndefined();
    expect(result.error).toContain('no volumeUuid');
  });

  it('returns generic error when no device identity at all', async () => {
    const result = await resolveDevicePath({
      manager: mockManager(),
    });
    expect(result.path).toBeUndefined();
    expect(result.error).toContain('No device configured');
  });

  it('handles trailing slash normalization in path comparison', async () => {
    const device = mockDevice({ volumeUuid: 'ABC-123', mountPoint: '/media/ipod/' });
    const result = await resolveDevicePath({
      cliPath: '/media/ipod',
      deviceIdentity: { volumeUuid: 'ABC-123', volumeName: 'IPOD' },
      manager: mockManager([device]),
    });
    // Should match despite trailing slash difference
    expect(result.path).toBe('/media/ipod');
    expect(result.error).toBeUndefined();
  });

  it('auto-matches CLI path to configured device by UUID (Scenario B)', async () => {
    const device = mockDevice({
      volumeUuid: 'ABC-123',
      mountPoint: '/Volumes/IPOD',
      isMounted: true,
    });
    const configWithDevices = makeConfig({
      devices: {
        terapod: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD', quality: 'medium' },
      },
    });
    const result = await resolveDevicePath({
      cliPath: '/Volumes/IPOD',
      manager: mockManager([device]),
      config: configWithDevices,
    });
    expect(result.path).toBe('/Volumes/IPOD');
    expect(result.source).toBe('path-matched');
    expect(result.matchedDevice).toBeDefined();
    expect(result.matchedDevice?.name).toBe('terapod');
    expect(result.matchedDevice?.config.quality).toBe('medium');
  });

  it('does not auto-match when path UUID does not match any config device (Scenario B)', async () => {
    const device = mockDevice({
      volumeUuid: 'XYZ-789',
      mountPoint: '/Volumes/IPOD',
      isMounted: true,
    });
    const configWithDevices = makeConfig({
      devices: {
        terapod: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' },
      },
    });
    const result = await resolveDevicePath({
      cliPath: '/Volumes/IPOD',
      manager: mockManager([device]),
      config: configWithDevices,
    });
    expect(result.path).toBe('/Volumes/IPOD');
    expect(result.source).toBe('cli');
    expect(result.matchedDevice).toBeUndefined();
  });

  it('skips auto-match when deviceIdentity is already provided', async () => {
    const device = mockDevice({
      volumeUuid: 'ABC-123',
      mountPoint: '/Volumes/IPOD',
      isMounted: true,
    });
    const configWithDevices = makeConfig({
      devices: {
        terapod: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' },
      },
    });
    // When deviceIdentity is provided (named device scenario), auto-match is skipped
    const result = await resolveDevicePath({
      cliPath: '/Volumes/IPOD',
      deviceIdentity: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' },
      manager: mockManager([device]),
      config: configWithDevices,
    });
    expect(result.source).toBe('cli');
    // matchedDevice should not be set since we already have a named device
    expect(result.matchedDevice).toBeUndefined();
  });
});

// =============================================================================
// autoDetectDevice — Scenario A
// =============================================================================

describe('autoDetectDevice', () => {
  it('auto-selects single matching configured device', async () => {
    const device = mockDevice({
      volumeUuid: 'ABC-123',
      mountPoint: '/Volumes/IPOD',
      isMounted: true,
    });
    const config = makeConfig({
      devices: {
        terapod: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD', quality: 'medium' },
      },
    });
    const result = await autoDetectDevice(mockManager([device]), config);
    expect(result.path).toBe('/Volumes/IPOD');
    expect(result.source).toBe('auto-detected');
    expect(result.matchedDevice?.name).toBe('terapod');
    expect(result.matchedDevice?.config.quality).toBe('medium');
    expect(result.error).toBeUndefined();
  });

  it('errors with multiple matching configured devices', async () => {
    const devices = [
      mockDevice({
        identifier: 'disk2s2',
        volumeUuid: 'ABC-123',
        mountPoint: '/Volumes/TERAPOD',
        isMounted: true,
      }),
      mockDevice({
        identifier: 'disk3s2',
        volumeUuid: 'DEF-456',
        mountPoint: '/Volumes/NANOPOD',
        isMounted: true,
      }),
    ];
    const config = makeConfig({
      devices: {
        terapod: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' },
        nanopod: { volumeUuid: 'DEF-456', volumeName: 'NANOPOD' },
      },
    });
    const result = await autoDetectDevice(mockManager(devices), config);
    expect(result.path).toBeUndefined();
    expect(result.error).toContain('Multiple configured iPods detected');
    expect(result.error).toContain('terapod');
    expect(result.error).toContain('nanopod');
  });

  it('uses single connected iPod with global settings when no config match', async () => {
    const device = mockDevice({
      volumeUuid: 'UNRECOGNIZED-UUID',
      mountPoint: '/Volumes/IPOD',
      isMounted: true,
    });
    const config = makeConfig({
      devices: {
        terapod: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' },
      },
    });
    const result = await autoDetectDevice(mockManager([device]), config);
    expect(result.path).toBe('/Volumes/IPOD');
    expect(result.source).toBe('auto-detected');
    // No matchedDevice since UUID didn't match any config
    expect(result.matchedDevice).toBeUndefined();
    // Should provide a hint about saving settings
    expect(result.hint).toContain('podkit device add');
  });

  it('errors when no iPod connected', async () => {
    const config = makeConfig({
      devices: {
        terapod: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' },
      },
    });
    const result = await autoDetectDevice(mockManager([]), config);
    expect(result.path).toBeUndefined();
    expect(result.error).toContain('No iPod found');
  });

  it('errors with matched device that is not mounted', async () => {
    const device = mockDevice({
      volumeUuid: 'ABC-123',
      isMounted: false,
      mountPoint: undefined,
    });
    const config = makeConfig({
      devices: {
        terapod: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' },
      },
    });
    const result = await autoDetectDevice(mockManager([device]), config);
    expect(result.path).toBeUndefined();
    expect(result.error).toContain('not mounted');
    expect(result.matchedDevice?.name).toBe('terapod');
  });

  it('errors when multiple iPods connected but none match config', async () => {
    const devices = [
      mockDevice({
        identifier: 'disk2s2',
        volumeUuid: 'UNKNOWN-1',
        mountPoint: '/Volumes/IPOD1',
        isMounted: true,
      }),
      mockDevice({
        identifier: 'disk3s2',
        volumeUuid: 'UNKNOWN-2',
        mountPoint: '/Volumes/IPOD2',
        isMounted: true,
      }),
    ];
    const config = makeConfig({
      devices: {
        terapod: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' },
      },
    });
    const result = await autoDetectDevice(mockManager(devices), config);
    expect(result.path).toBeUndefined();
    expect(result.error).toContain('2 iPods detected');
    expect(result.error).toContain('none match');
  });

  it('works with no configured devices at all', async () => {
    const device = mockDevice({
      volumeUuid: 'ABC-123',
      mountPoint: '/Volumes/IPOD',
      isMounted: true,
    });
    const config = makeConfig();
    const result = await autoDetectDevice(mockManager([device]), config);
    expect(result.path).toBe('/Volumes/IPOD');
    expect(result.matchedDevice).toBeUndefined();
    expect(result.hint).toContain('podkit device add');
  });

  it('matches case-insensitively on UUID', async () => {
    const device = mockDevice({
      volumeUuid: 'abc-123',
      mountPoint: '/Volumes/IPOD',
      isMounted: true,
    });
    const config = makeConfig({
      devices: {
        terapod: { volumeUuid: 'ABC-123', volumeName: 'TERAPOD' },
      },
    });
    const result = await autoDetectDevice(mockManager([device]), config);
    expect(result.matchedDevice?.name).toBe('terapod');
  });
});
