/**
 * Unit tests for inquiry/orchestrator.ts
 *
 * All transports and the probe are dependency-injected. No real FS, native
 * bindings, or hardware is touched. The shared fixture is the captured
 * SysInfoExtended XML for the nano 2G test device.
 */

import { describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inquireFirmware, type ScsiTransport, type UsbTransport } from './orchestrator';
import type { InquiryMethodsAvailability } from './probe';
import type { UsbFingerprint } from '@podkit/device-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURE_PATH = join(
  import.meta.dir,
  '..',
  '..',
  '..',
  '..',
  'documents',
  'sysinfo-captures',
  'nano-2g-4gb-green.xml'
);

const validXml = readFileSync(FIXTURE_PATH, 'utf-8');
const validBytes = new TextEncoder().encode(validXml);

const fp: UsbFingerprint = { vendorId: '05ac', productId: '1260', bus: 1, devnum: 4 };

function avail(usb: boolean, scsi: boolean): InquiryMethodsAvailability {
  return {
    usb: { available: usb },
    scsi: { available: scsi },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('inquireFirmware', () => {
  it('returns ParsedFirmware via USB and never calls SCSI when USB succeeds', async () => {
    const usb = mock<UsbTransport>(async () => validBytes);
    const scsi = mock<ScsiTransport>(async () => {
      throw new Error('scsi should not be called');
    });

    const result = await inquireFirmware(fp, {
      transports: { usb, scsi },
      availability: avail(true, true),
    });

    expect(result).not.toBeNull();
    expect(result?.firewireGuid).toBeString();
    expect(result?.serialNumber).toBeString();
    expect(usb).toHaveBeenCalledTimes(1);
    expect(scsi).toHaveBeenCalledTimes(0);
  });

  it('falls back to SCSI when USB throws and returns ParsedFirmware', async () => {
    const usb = mock<UsbTransport>(async () => {
      throw new Error('usb transport boom');
    });
    const scsi = mock<ScsiTransport>(async () => validBytes);

    const result = await inquireFirmware(fp, {
      transports: { usb, scsi },
      availability: avail(true, true),
    });

    expect(result).not.toBeNull();
    expect(result?.firewireGuid).toBeString();
    expect(usb).toHaveBeenCalledTimes(1);
    expect(scsi).toHaveBeenCalledTimes(1);
  });

  it('returns null and does NOT fall back to SCSI when USB returns malformed XML', async () => {
    const usb = mock<UsbTransport>(async () => new TextEncoder().encode('not a plist <<<'));
    const scsi = mock<ScsiTransport>(async () => validBytes);

    const result = await inquireFirmware(fp, {
      transports: { usb, scsi },
      availability: avail(true, true),
    });

    expect(result).toBeNull();
    expect(usb).toHaveBeenCalledTimes(1);
    expect(scsi).toHaveBeenCalledTimes(0);
  });

  it('returns null gracefully when both USB and SCSI throw', async () => {
    const usb = mock<UsbTransport>(async () => {
      throw new Error('usb dead');
    });
    const scsi = mock<ScsiTransport>(async () => {
      throw new Error('scsi dead');
    });

    const result = await inquireFirmware(fp, {
      transports: { usb, scsi },
      availability: avail(true, true),
    });

    expect(result).toBeNull();
    expect(usb).toHaveBeenCalledTimes(1);
    expect(scsi).toHaveBeenCalledTimes(1);
  });

  it('returns null when bytes parse as a plist but identity extraction fails', async () => {
    // A valid plist that has no FireWireGUID/SerialNumber/FamilyID — extractFromPlist returns null.
    const minimalXml =
      '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Foo</key><string>bar</string></dict></plist>';
    const usb = mock<UsbTransport>(async () => new TextEncoder().encode(minimalXml));
    const scsi = mock<ScsiTransport>(async () => validBytes);

    const result = await inquireFirmware(fp, {
      transports: { usb, scsi },
      availability: avail(true, true),
    });

    expect(result).toBeNull();
    // Per the documented decision: a successful USB read with non-extractable
    // bytes does NOT trigger SCSI fallback.
    expect(scsi).toHaveBeenCalledTimes(0);
  });

  it('returns null without calling either transport when no methods are available', async () => {
    const usb = mock<UsbTransport>(async () => validBytes);
    const scsi = mock<ScsiTransport>(async () => validBytes);

    const result = await inquireFirmware(fp, {
      transports: { usb, scsi },
      availability: avail(false, false),
    });

    expect(result).toBeNull();
    expect(usb).toHaveBeenCalledTimes(0);
    expect(scsi).toHaveBeenCalledTimes(0);
  });

  it('uses SCSI only and never calls USB when probe reports SCSI-only', async () => {
    const usb = mock<UsbTransport>(async () => {
      throw new Error('usb should not be called');
    });
    const scsi = mock<ScsiTransport>(async () => validBytes);

    const result = await inquireFirmware(fp, {
      transports: { usb, scsi },
      availability: avail(false, true),
    });

    expect(result).not.toBeNull();
    expect(result?.firewireGuid).toBeString();
    expect(usb).toHaveBeenCalledTimes(0);
    expect(scsi).toHaveBeenCalledTimes(1);
  });

  it('forwards timeoutMs to both transports', async () => {
    let usbTimeout: number | undefined;
    let scsiTimeout: number | undefined;

    const usb: UsbTransport = async (_fp, opts) => {
      usbTimeout = opts?.timeoutMs;
      throw new Error('force scsi fallback');
    };
    const scsi: ScsiTransport = async (_fp, opts) => {
      scsiTimeout = opts?.timeoutMs;
      return validBytes;
    };

    await inquireFirmware(fp, {
      transports: { usb, scsi },
      availability: avail(true, true),
      timeoutMs: 1234,
    });

    expect(usbTimeout).toBe(1234);
    expect(scsiTimeout).toBe(1234);
  });
});
