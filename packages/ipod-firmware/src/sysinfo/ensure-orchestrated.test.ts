/**
 * Integration tests for ensureSysInfoExtended driving the full inquiry
 * orchestrator (no `readFromUsb` injection — `inquireOptions` only).
 *
 * Covers the regression where the orchestrator was handed an incomplete
 * fingerprint (vendorId/productId empty) so macOS SCSI dispatch could not
 * locate the IOService for SCSI-only iPods (mini 2G, nano 2G, iPod 5G).
 *
 * The unit-level "single transport returns null" wiring lives in
 * ensure.test.ts. These tests exercise the full path: ensure.ts asks the
 * orchestrator for a result, the orchestrator dispatches the
 * `usb-then-scsi` plan against mock transports, and ensure.ts assembles
 * the user-facing error message from the per-attempt outcomes.
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { UsbFingerprint } from '@podkit/device-types';
import { ensureSysInfoExtended } from './ensure.js';
import type { ScsiTransport, UsbTransport } from '../inquiry/orchestrator.js';
import type { InquiryMethodsAvailability } from '../inquiry/probe.js';

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-ensure-orch-'));
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

const VALID_BYTES = new TextEncoder().encode(VALID_XML);

function avail(usb: boolean, scsi: boolean): InquiryMethodsAvailability {
  return { usb: { available: usb }, scsi: { available: scsi } };
}

describe('ensureSysInfoExtended → orchestrator integration', () => {
  it('writes SysInfoExtended via SCSI fallback when USB throws and the fingerprint is fully populated', async () => {
    // The mini-2G/nano-2G/iPod-5G case: USB transport throws (does not
    // implement the firmware control transfer or libusb cannot claim the
    // interface), so the orchestrator falls through to SCSI. macOS SCSI
    // requires vendorId+productId+serialNumber to locate the IOService —
    // this test asserts that the populated fingerprint is threaded all the
    // way through to the SCSI transport, AND that the final XML lands on
    // disk via ensure.ts's success path.
    const dir = tmpdir();
    try {
      const usbCalls: UsbFingerprint[] = [];
      const scsiCalls: UsbFingerprint[] = [];
      const usb: UsbTransport = async (fp) => {
        usbCalls.push(fp);
        throw new Error('USB inquiry not supported on this device');
      };
      const scsi: ScsiTransport = async (fp) => {
        scsiCalls.push(fp);
        return VALID_BYTES;
      };

      const result = await ensureSysInfoExtended(dir, FINGERPRINT, {
        inquireOptions: {
          transports: { usb, scsi },
          availability: avail(true, true),
        },
      });

      // Result + persisted file
      expect(result.present).toBe(true);
      expect(result.source).toBe('usb-read');
      expect(result.serialNumber).toBe('YM5180A4S31');
      expect(result.firewireGuid).toBe('000A270000ABCDEF');

      const written = fs.readFileSync(
        path.join(dir, 'iPod_Control', 'Device', 'SysInfoExtended'),
        'utf-8'
      );
      expect(written).toBe(VALID_XML);

      // Orchestrator dispatch: USB attempted then SCSI fallback, both got
      // the full fingerprint (regression guard).
      expect(usbCalls).toHaveLength(1);
      expect(scsiCalls).toHaveLength(1);
      expect(usbCalls[0]).toEqual(FINGERPRINT);
      expect(scsiCalls[0]).toEqual(FINGERPRINT);
      expect(scsiCalls[0]?.vendorId).toBe('05ac');
      expect(scsiCalls[0]?.productId).toBe('1226');
      expect(scsiCalls[0]?.serialNumber).toBe('YM5180A4S31');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the all-transport-error message when USB throws and SCSI throws', async () => {
    const dir = tmpdir();
    try {
      const usb: UsbTransport = async () => {
        throw new Error('usb dead');
      };
      const scsi: ScsiTransport = async () => {
        throw new Error('scsi dead');
      };

      const result = await ensureSysInfoExtended(dir, FINGERPRINT, {
        inquireOptions: {
          transports: { usb, scsi },
          availability: avail(true, true),
        },
      });

      expect(result.present).toBe(false);
      expect(result.source).toBe('unavailable');
      expect(result.error).toBe('Could not read device identity from USB and SCSI');

      // No file written.
      expect(fs.existsSync(path.join(dir, 'iPod_Control', 'Device', 'SysInfoExtended'))).toBe(
        false
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the mixed-outcome message when USB throws and SCSI returns parse-fail bytes', async () => {
    const dir = tmpdir();
    try {
      const usb: UsbTransport = async () => {
        throw new Error('usb dead');
      };
      const scsi: ScsiTransport = async () => new TextEncoder().encode('garbage <<< not xml');

      const result = await ensureSysInfoExtended(dir, FINGERPRINT, {
        inquireOptions: {
          transports: { usb, scsi },
          availability: avail(true, true),
        },
      });

      expect(result.present).toBe(false);
      expect(result.source).toBe('unavailable');
      expect(result.error).toBe(
        'Could not read device identity: USB failed and SCSI returned data that could not be parsed'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the all-parse-error message when the only transport returns unparseable bytes', async () => {
    const dir = tmpdir();
    try {
      const usb: UsbTransport = async () => new TextEncoder().encode('garbage <<<');
      const scsi: ScsiTransport = async () => {
        throw new Error('scsi should not be called');
      };

      const result = await ensureSysInfoExtended(dir, FINGERPRINT, {
        inquireOptions: {
          transports: { usb, scsi },
          availability: avail(true, false), // usb-only plan
        },
      });

      expect(result.present).toBe(false);
      expect(result.source).toBe('unavailable');
      expect(result.error).toBe(
        'Could not read device identity: USB returned data but it could not be parsed'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not invoke the SCSI transport when USB succeeds with unparseable bytes (orchestrator rule 3)', async () => {
    // Guards orchestrator rule 3: a USB transport _success_ whose bytes fail
    // to parse must NOT trigger SCSI fallback — re-querying via SCSI would
    // hide the real failure (corrupt firmware / truncated transfer / encoding
    // mismatch) behind a transport mismatch. The user-facing message is the
    // all-parse-error wording (USB-only), and SCSI is never dispatched even
    // though the plan is `usb-then-scsi`.
    const dir = tmpdir();
    try {
      let scsiInvoked = false;
      const usb: UsbTransport = async () => new TextEncoder().encode('garbage <<<');
      const scsi: ScsiTransport = async () => {
        scsiInvoked = true;
        return VALID_BYTES;
      };

      const result = await ensureSysInfoExtended(dir, FINGERPRINT, {
        inquireOptions: {
          transports: { usb, scsi },
          availability: avail(true, true), // usb-then-scsi plan
        },
      });

      expect(scsiInvoked).toBe(false);
      expect(result.present).toBe(false);
      expect(result.source).toBe('unavailable');
      expect(result.error).toBe(
        'Could not read device identity: USB returned data but it could not be parsed'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
