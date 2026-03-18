/**
 * Unit tests for device manager factory
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  createDeviceManager,
  getDeviceManager,
  clearDeviceManagerCache,
  isPlatformSupported,
} from './manager.js';
import { UnsupportedDeviceManager } from './platforms/unsupported.js';
import { LinuxDeviceManager } from './platforms/linux.js';

describe('createDeviceManager', () => {
  it('creates macOS manager for darwin platform', () => {
    const manager = createDeviceManager('darwin');
    expect(manager.platform).toBe('darwin');
    expect(manager.isSupported).toBe(true);
  });

  it('creates Linux manager for linux platform', () => {
    const manager = createDeviceManager('linux');
    expect(manager.platform).toBe('linux');
    expect(manager.isSupported).toBe(true);
    expect(manager).toBeInstanceOf(LinuxDeviceManager);
  });

  it('creates unsupported manager for win32 platform', () => {
    const manager = createDeviceManager('win32');
    expect(manager.platform).toBe('win32');
    expect(manager.isSupported).toBe(false);
    expect(manager).toBeInstanceOf(UnsupportedDeviceManager);
  });

  it('creates unsupported manager for unknown platforms', () => {
    const manager = createDeviceManager('freebsd' as NodeJS.Platform);
    expect(manager.platform).toBe('freebsd');
    expect(manager.isSupported).toBe(false);
    expect(manager).toBeInstanceOf(UnsupportedDeviceManager);
  });
});

describe('getDeviceManager', () => {
  beforeEach(() => {
    clearDeviceManagerCache();
  });

  it('returns cached manager instance', () => {
    const first = getDeviceManager();
    const second = getDeviceManager();
    expect(first).toBe(second);
  });

  it('clears cache with clearDeviceManagerCache', () => {
    const first = getDeviceManager();
    clearDeviceManagerCache();
    const second = getDeviceManager();
    // New instance created, not the same reference
    expect(first.platform).toBe(second.platform);
  });
});

describe('isPlatformSupported', () => {
  beforeEach(() => {
    clearDeviceManagerCache();
  });

  it('returns true on supported platforms', () => {
    // This depends on the current platform
    const manager = getDeviceManager();
    expect(isPlatformSupported()).toBe(manager.isSupported);
  });
});
