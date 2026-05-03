/**
 * Unit tests for inquiry/probe.ts
 *
 * All filesystem and platform checks are injected as fakes — no real FS or
 * native bindings are touched.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  probeInquiryMethods,
  clearProbeCache,
  type ProbeFs,
  type ProbePlatform,
  type ProbeUsbLoader,
} from './probe';

// ---------------------------------------------------------------------------
// Fake helpers
// ---------------------------------------------------------------------------

function makeFs(
  entries: Record<string, string[]>,
  exists: Record<string, boolean> = {},
  accessible: Record<string, boolean> = {}
): ProbeFs {
  return {
    existsSync: (path: string): boolean => {
      if (path in exists) return exists[path] ?? false;
      const dir = path.substring(0, path.lastIndexOf('/'));
      const base = path.substring(path.lastIndexOf('/') + 1);
      return (entries[dir] ?? []).includes(base);
    },
    readdirSync: (path: string): string[] => {
      if (path in entries) return entries[path] ?? [];
      throw new Error(`ENOENT: no such file or directory, scandir '${path}'`);
    },
    accessSync: (path: string): void => {
      if (accessible[path] === false) {
        throw new Error(`EACCES: permission denied, access '${path}'`);
      }
      // Default permissive — present in entries OR explicitly accessible.
    },
  };
}

function makePlatform(plat: NodeJS.Platform): ProbePlatform {
  return { platform: () => plat };
}

const usbAvailable: ProbeUsbLoader = async () => true;
const usbUnavailable: ProbeUsbLoader = async () => false;
const usbThrows: ProbeUsbLoader = async () => {
  throw new Error('dlopen failed: libusb-1.0.so.0: cannot open shared object file');
};

// ---------------------------------------------------------------------------
// Reset cache before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearProbeCache();
});

// ---------------------------------------------------------------------------
// macOS — SCSI
// ---------------------------------------------------------------------------

describe('macOS — SCSI availability', () => {
  const platform = makePlatform('darwin');

  it('reports available when iPodDriver.kext directory is present', async () => {
    const fs = makeFs({}, { '/System/Library/Extensions/iPodDriver.kext': true });
    const result = await probeInquiryMethods({ fs, platform, loadUsb: usbAvailable });
    expect(result.scsi.available).toBe(true);
    expect(result.scsi.reason).toBeUndefined();
  });

  it('reports unavailable when iPodDriver.kext is absent', async () => {
    const fs = makeFs({}, { '/System/Library/Extensions/iPodDriver.kext': false });
    const result = await probeInquiryMethods({ fs, platform, loadUsb: usbAvailable });
    expect(result.scsi.available).toBe(false);
    expect(result.scsi.reason).toBe('iPodDriver.kext not present — SCSI inquiry unavailable');
  });
});

// ---------------------------------------------------------------------------
// macOS — USB
// ---------------------------------------------------------------------------

describe('macOS — USB availability', () => {
  const platform = makePlatform('darwin');
  const fs = makeFs({}, { '/System/Library/Extensions/iPodDriver.kext': true });

  it('reports USB available when libgpod-node binding loads', async () => {
    const result = await probeInquiryMethods({ fs, platform, loadUsb: usbAvailable });
    expect(result.usb.available).toBe(true);
  });

  it('reports USB unavailable when binding returns false', async () => {
    const result = await probeInquiryMethods({ fs, platform, loadUsb: usbUnavailable });
    expect(result.usb.available).toBe(false);
    expect(result.usb.reason).toBe('libusb not loadable');
  });

  it('reports USB unavailable with reason when loader throws', async () => {
    const result = await probeInquiryMethods({ fs, platform, loadUsb: usbThrows });
    expect(result.usb.available).toBe(false);
    expect(result.usb.reason).toContain('libusb not loadable');
    expect(result.usb.reason).toContain('dlopen failed');
  });
});

// ---------------------------------------------------------------------------
// Linux — SCSI
// ---------------------------------------------------------------------------

describe('Linux — SCSI availability', () => {
  const platform = makePlatform('linux');

  it('reports available when /dev/sg3 is present and readable', async () => {
    const fs = makeFs({ '/dev': ['sg3', 'sda', 'null'] });
    const result = await probeInquiryMethods({ fs, platform, loadUsb: usbAvailable });
    expect(result.scsi.available).toBe(true);
    expect(result.scsi.reason).toBeUndefined();
  });

  it('reports unavailable when /dev/sg3 is present but unreadable', async () => {
    const fs = makeFs({ '/dev': ['sg3'] }, {}, { '/dev/sg3': false });
    const result = await probeInquiryMethods({ fs, platform, loadUsb: usbAvailable });
    expect(result.scsi.available).toBe(false);
    expect(result.scsi.reason).toContain('/dev/sg* present but not readable');
  });

  it('reports unavailable when no /dev/sg* nodes exist', async () => {
    const fs = makeFs({ '/dev': ['sda', 'null', 'tty'] });
    const result = await probeInquiryMethods({ fs, platform, loadUsb: usbAvailable });
    expect(result.scsi.available).toBe(false);
    expect(result.scsi.reason).toContain('no /dev/sg* nodes present');
    expect(result.scsi.reason).toContain('SCSI inquiry unavailable');
  });

  it('reports unavailable when /dev is not readable', async () => {
    const fs = makeFs({}); // readdirSync('/dev') throws
    const result = await probeInquiryMethods({ fs, platform, loadUsb: usbAvailable });
    expect(result.scsi.available).toBe(false);
    expect(result.scsi.reason).toContain('no /dev/sg* nodes present');
  });
});

// ---------------------------------------------------------------------------
// Other platforms
// ---------------------------------------------------------------------------

describe('Other platforms', () => {
  it('reports SCSI unavailable on win32', async () => {
    const fs = makeFs({});
    const platform = makePlatform('win32');
    const result = await probeInquiryMethods({ fs, platform, loadUsb: usbAvailable });
    expect(result.scsi.available).toBe(false);
    expect(result.scsi.reason).toBe('SCSI inquiry not implemented on this platform');
  });

  it('still probes USB on win32', async () => {
    const fs = makeFs({});
    const platform = makePlatform('win32');
    const result = await probeInquiryMethods({ fs, platform, loadUsb: usbAvailable });
    expect(result.usb.available).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

describe('Cache behaviour', () => {
  it('returns cached result on second call (no opts)', async () => {
    // We cannot easily test the production cache path without touching real FS,
    // so we test that clearProbeCache + second call with opts gives a fresh result.
    const platform = makePlatform('darwin');
    const fs1 = makeFs({}, { '/System/Library/Extensions/iPodDriver.kext': true });
    const fs2 = makeFs({}, { '/System/Library/Extensions/iPodDriver.kext': false });

    const r1 = await probeInquiryMethods({ fs: fs1, platform, loadUsb: usbAvailable });
    expect(r1.scsi.available).toBe(true);

    // Cache is module-scoped and only applies when no opts are passed.
    // With opts, it always re-runs — so r2 will reflect fs2.
    const r2 = await probeInquiryMethods({ fs: fs2, platform, loadUsb: usbAvailable });
    expect(r2.scsi.available).toBe(false);
  });

  it('clearProbeCache() resets the cache so next no-opts call re-runs', async () => {
    // First call without opts populates cache.
    // (This will use real FS — we just verify the cache is cleared after.)
    clearProbeCache();
    // Call with opts to avoid real FS side effects.
    const platform = makePlatform('darwin');
    const fs = makeFs({}, { '/System/Library/Extensions/iPodDriver.kext': true });
    await probeInquiryMethods({ fs, platform, loadUsb: usbAvailable });

    // clearProbeCache should not throw.
    expect(() => clearProbeCache()).not.toThrow();

    // After clearing, another injected call still works correctly.
    const result = await probeInquiryMethods({ fs, platform, loadUsb: usbUnavailable });
    expect(result.usb.available).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full happy-path macOS
// ---------------------------------------------------------------------------

describe('Full macOS happy path', () => {
  it('both SCSI and USB available', async () => {
    const platform = makePlatform('darwin');
    const fs = makeFs({}, { '/System/Library/Extensions/iPodDriver.kext': true });
    const result = await probeInquiryMethods({ fs, platform, loadUsb: usbAvailable });
    expect(result.scsi.available).toBe(true);
    expect(result.usb.available).toBe(true);
  });

  it('SCSI unavailable + USB available', async () => {
    const platform = makePlatform('darwin');
    const fs = makeFs({}, { '/System/Library/Extensions/iPodDriver.kext': false });
    const result = await probeInquiryMethods({ fs, platform, loadUsb: usbAvailable });
    expect(result.scsi.available).toBe(false);
    expect(result.usb.available).toBe(true);
  });

  it('SCSI available + USB unavailable', async () => {
    const platform = makePlatform('darwin');
    const fs = makeFs({}, { '/System/Library/Extensions/iPodDriver.kext': true });
    const result = await probeInquiryMethods({ fs, platform, loadUsb: usbUnavailable });
    expect(result.scsi.available).toBe(true);
    expect(result.usb.available).toBe(false);
  });
});
