/**
 * Unit tests for `assessIpodIdentity`.
 *
 * Exercises the cascade-driven identity orchestrator without spawning USB I/O:
 * a synthetic mount-point fixture provides whichever combination of SysInfo /
 * SysInfoExtended files we want, and `usbResolver` is stubbed in via opts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assessIpodIdentity } from './ipod-identity.js';
import type { CompleteUsbDevice } from './usb-path-resolution.js';

const NANO_2G_USB: CompleteUsbDevice = {
  vendorId: '05ac',
  productId: '1260',
  serialNumber: 'YM7275YSVQH',
  bus: 20,
  devnum: 5,
};

async function makeMount(opts: { sysInfo?: string; sysInfoExtended?: string }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ipod-identity-'));
  await mkdir(join(dir, 'iPod_Control', 'Device'), { recursive: true });
  if (opts.sysInfo !== undefined) {
    await writeFile(join(dir, 'iPod_Control', 'Device', 'SysInfo'), opts.sysInfo);
  }
  if (opts.sysInfoExtended !== undefined) {
    await writeFile(join(dir, 'iPod_Control', 'Device', 'SysInfoExtended'), opts.sysInfoExtended);
  }
  return dir;
}

describe('assessIpodIdentity', () => {
  let dir: string | undefined;

  beforeEach(() => {
    dir = undefined;
  });

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('cascades to USB product ID when SysInfo is empty (post-2006 nano 2G case)', async () => {
    dir = await makeMount({ sysInfo: '' });

    const result = await assessIpodIdentity(dir, {
      usbResolver: async () => NANO_2G_USB,
    });

    // Cascade: SIE missing → SysInfo empty (no ModelNumStr) → USB product ID 0x1260 → nano_2g
    expect(result.model).not.toBeNull();
    expect(result.model?.generationId).toBe('nano_2g');
    expect(result.model?.displayName).toContain('nano');
    expect(result.firmwareInquiry).toBe('missing');
    expect(result.usbFingerprint).toEqual(NANO_2G_USB);
    expect(result.capabilities).not.toBeNull();
    // nano 2G supports artwork (176x132)
    expect(result.capabilities?.artworkSources).toContain('database');
    expect(result.capabilities?.artworkMaxResolution).toBe(176);
    expect(result.capabilities?.supportsVideo).toBe(false);
    // checksumType: none for nano 2G
    expect(result.checksumType).toBe('none');
    expect(result.needsChecksum).toBe(false);
  });

  it('reports `unwritable` firmware-inquiry state when USB cannot be resolved', async () => {
    dir = await makeMount({ sysInfo: '' });

    const result = await assessIpodIdentity(dir, {
      usbResolver: async () => null,
    });

    expect(result.firmwareInquiry).toBe('unwritable');
    expect(result.usbFingerprint).toBeNull();
    // No USB → no productId → no cascade match → no model
    expect(result.model).toBeNull();
    expect(result.capabilities).toBeNull();
  });

  it('reports `present` when SysInfoExtended is on disk and parseable', async () => {
    // A minimal valid SysInfoExtended plist with FireWireGUID + SerialNumber.
    const sieXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>FireWireGUID</key>
  <string>000A27001A0647CB</string>
  <key>SerialNumber</key>
  <string>YM7275YSVQH</string>
</dict>
</plist>
`;
    dir = await makeMount({ sysInfo: '', sysInfoExtended: sieXml });

    const result = await assessIpodIdentity(dir, {
      usbResolver: async () => NANO_2G_USB,
    });

    expect(result.firmwareInquiry).toBe('present');
    expect(result.existing?.firewireGuid).toBe('000A27001A0647CB');
    // Cascade picks up serial → variant model (nano 2G 4GB green via VQH suffix).
    expect(result.model).not.toBeNull();
    expect(result.model?.generationId).toBe('nano_2g');
  });

  it('uses classic SysInfo ModelNumStr when SIE is missing', async () => {
    // mini 2G ModelNumStr in classic SysInfo, no SIE on disk, no USB.
    dir = await makeMount({ sysInfo: 'ModelNumStr: P9804\nFirmwareVersionStr: 1.3\n' });

    const result = await assessIpodIdentity(dir, {
      usbResolver: async () => null,
    });

    // Cascade: ModelNumStr P9804 → mini 2G variant
    expect(result.model).not.toBeNull();
    expect(result.model?.generationId).toBe('mini_2g');
    expect(result.firmwareInquiry).toBe('unwritable');
    expect(result.sysInfoModelNumber).toBe('P9804');
  });

  it('flags hash-based generations as `needsChecksum`', async () => {
    // nano 4G requires hash58 checksums.
    dir = await makeMount({ sysInfo: 'ModelNumStr: B754\n' });

    const result = await assessIpodIdentity(dir, {
      usbResolver: async () => null,
    });

    expect(result.checksumType).toBe('hash58');
    expect(result.needsChecksum).toBe(true);
  });
});
