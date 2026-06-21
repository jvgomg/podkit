/**
 * Unit tests for unsupported platform device manager
 */

import { describe, it, expect } from 'bun:test';
import { UnsupportedDeviceManager, createUnsupportedManager } from './unsupported.js';

describe('UnsupportedDeviceManager', () => {
  describe('eject', () => {
    it('returns unsupported error with instructions', async () => {
      const manager = new UnsupportedDeviceManager('linux');
      const result = await manager.eject('/mnt/ipod');

      expect(result.success).toBe(false);
      expect(result.device).toBe('/mnt/ipod');
      expect(result.error).toContain('not supported on linux');
      expect(result.error).toContain('udisksctl');
    });

    it('includes windows-specific instructions', async () => {
      const manager = new UnsupportedDeviceManager('win32');
      const result = await manager.eject('E:\\');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not supported on win32');
      expect(result.error).toContain('Safely Remove Hardware');
    });
  });

  describe('mount', () => {
    it('returns unsupported error with instructions', async () => {
      const manager = new UnsupportedDeviceManager('linux');
      const result = await manager.mount('/dev/sdb1');

      expect(result.success).toBe(false);
      expect(result.device).toBe('/dev/sdb1');
      expect(result.error).toContain('not supported on linux');
      expect(result.error).toContain('mount');
    });

    it('includes windows-specific instructions', async () => {
      const manager = new UnsupportedDeviceManager('win32');
      const result = await manager.mount('\\Device\\Harddisk1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not supported on win32');
      expect(result.error).toContain('Disk Management');
    });
  });

  describe('scan', () => {
    it('returns empty array', async () => {
      const manager = new UnsupportedDeviceManager('linux');
      const devices = await manager.scan();
      expect(devices).toEqual([]);
    });

    it('returns empty array for the iPod kind', async () => {
      const manager = new UnsupportedDeviceManager('linux');
      const ipods = await manager.scan({ kinds: ['ipod'] });
      expect(ipods).toEqual([]);
    });
  });

  describe('locate', () => {
    it('returns null by UUID', async () => {
      const manager = new UnsupportedDeviceManager('linux');
      const device = await manager.locate({ volumeUuid: 'ABC-123' });
      expect(device).toBeNull();
    });

    it('returns null by path', async () => {
      const manager = new UnsupportedDeviceManager('linux');
      const device = await manager.locate({ path: '/Volumes/iPod' });
      expect(device).toBeNull();
    });
  });

  describe('getManualInstructions', () => {
    it('returns linux eject instructions', () => {
      const manager = new UnsupportedDeviceManager('linux');
      const instructions = manager.getManualInstructions('eject');

      expect(instructions).toContain('Linux');
      expect(instructions).toContain('udisksctl unmount');
      expect(instructions).toContain('udisksctl power-off');
    });

    it('returns linux mount instructions', () => {
      const manager = new UnsupportedDeviceManager('linux');
      const instructions = manager.getManualInstructions('mount');

      expect(instructions).toContain('Linux');
      expect(instructions).toContain('lsblk');
      expect(instructions).toContain('sudo mount');
    });

    it('returns windows eject instructions', () => {
      const manager = new UnsupportedDeviceManager('win32');
      const instructions = manager.getManualInstructions('eject');

      expect(instructions).toContain('Windows');
      expect(instructions).toContain('Safely Remove Hardware');
      expect(instructions).toContain('Eject');
    });

    it('returns windows mount instructions', () => {
      const manager = new UnsupportedDeviceManager('win32');
      const instructions = manager.getManualInstructions('mount');

      expect(instructions).toContain('Windows');
      expect(instructions).toContain('Disk Management');
      expect(instructions).toContain('Drive Letter');
    });

    it('returns generic instructions for unknown platforms', () => {
      const manager = new UnsupportedDeviceManager('freebsd');
      const instructions = manager.getManualInstructions('eject');

      expect(instructions).toContain('operating system');
    });
  });

  describe('properties', () => {
    it('has correct platform', () => {
      const manager = new UnsupportedDeviceManager('test-platform');
      expect(manager.platform).toBe('test-platform');
    });

    it('isSupported is false', () => {
      const manager = new UnsupportedDeviceManager('linux');
      expect(manager.isSupported).toBe(false);
    });
  });
});

describe('createUnsupportedManager', () => {
  it('creates manager with specified platform', () => {
    const manager = createUnsupportedManager('custom');
    expect(manager.platform).toBe('custom');
    expect(manager.isSupported).toBe(false);
  });
});
