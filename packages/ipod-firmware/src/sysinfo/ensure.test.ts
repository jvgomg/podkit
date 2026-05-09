/**
 * Unit tests for ensureSysInfoExtended.
 *
 * The on-disk read is a thin wrapper exercised by sysinfo-extended.test.ts
 * in @podkit/core. The cases here focus on:
 *
 * 1. Threading the full UsbFingerprint (vendorId, productId, serialNumber,
 *    bus, devnum) into the injected reader — the regression these tests
 *    guard against was passing only bus/devnum so macOS SCSI dispatch could
 *    not locate the IOService.
 * 2. The "no XML returned" error branch surfacing a transport-aware message
 *    when the production orchestrator path is exercised.
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { UsbFingerprint } from '@podkit/device-types';
import { ensureSysInfoExtended, type ReadFromUsbFn } from './ensure.js';

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-ensure-'));
}

const FINGERPRINT: UsbFingerprint = {
  vendorId: '05ac',
  productId: '1226', // iPod mini 2G — pre-5G, SCSI-only path
  serialNumber: 'YM5180A4S31',
  bus: 3,
  devnum: 7,
};

const VALID_XML = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>FireWireGUID</key><string>000A270000ABCDEF</string>
  <key>SerialNumber</key><string>YM5180A4S31</string>
  <key>FamilyID</key><integer>3</integer>
</dict>
</plist>`;

describe('ensureSysInfoExtended — fingerprint propagation', () => {
  it('passes vendorId, productId, serialNumber, bus, devnum into the injected reader', async () => {
    const dir = tmpdir();
    try {
      let received: UsbFingerprint | undefined;
      const reader: ReadFromUsbFn = (fp) => {
        received = fp;
        return VALID_XML;
      };

      const result = await ensureSysInfoExtended(dir, FINGERPRINT, { readFromUsb: reader });

      expect(result.present).toBe(true);
      expect(result.source).toBe('usb-read');

      expect(received).toEqual(FINGERPRINT);
      expect(received?.vendorId).toBe('05ac');
      expect(received?.productId).toBe('1226');
      expect(received?.serialNumber).toBe('YM5180A4S31');
      expect(received?.bus).toBe(3);
      expect(received?.devnum).toBe(7);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not invoke the reader when SysInfoExtended already exists on disk', async () => {
    const dir = tmpdir();
    try {
      const deviceDir = path.join(dir, 'iPod_Control', 'Device');
      fs.mkdirSync(deviceDir, { recursive: true });
      fs.writeFileSync(path.join(deviceDir, 'SysInfoExtended'), VALID_XML, 'utf-8');

      let calls = 0;
      const reader: ReadFromUsbFn = () => {
        calls += 1;
        return null;
      };

      const result = await ensureSysInfoExtended(dir, FINGERPRINT, { readFromUsb: reader });
      expect(result.present).toBe(true);
      expect(result.source).toBe('existing');
      expect(calls).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports "Could not read device identity from USB" when the injected reader returns null', async () => {
    // The injected-reader path keeps the historical wording — test doubles
    // bypass the orchestrator, so they cannot tell the user which transports
    // were attempted. The transport-aware wording is exercised by
    // ensureSysInfoExtended-orchestrated.test.ts.
    const dir = tmpdir();
    try {
      const reader: ReadFromUsbFn = () => null;
      const result = await ensureSysInfoExtended(dir, FINGERPRINT, { readFromUsb: reader });
      expect(result.present).toBe(false);
      expect(result.source).toBe('unavailable');
      expect(result.error).toBe('Could not read device identity from USB');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
