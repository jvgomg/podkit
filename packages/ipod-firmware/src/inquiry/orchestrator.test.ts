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
import {
  inquireFirmware,
  inquireFirmwareDetailed,
  type ScsiTransport,
  type UsbTransport,
} from './orchestrator';
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

  it('forwards the full UsbFingerprint to the SCSI transport on USB failure (SCSI-fallback fingerprint propagation)', async () => {
    // Regression: ensureSysInfoExtended used to construct a fingerprint with
    // empty vendorId/productId so macOS SCSI dispatch could not locate the
    // IOService. With the fix in place, the orchestrator must hand the SCSI
    // transport the same identifiers it received. This guards against any
    // future change that strips fields between orchestrator entry and SCSI
    // dispatch.
    const fullFp: UsbFingerprint = {
      vendorId: '05ac',
      productId: '1226',
      serialNumber: 'YM5180A4S31',
      bus: 3,
      devnum: 7,
    };

    let scsiFp: UsbFingerprint | undefined;
    const usb = mock<UsbTransport>(async () => {
      throw new Error('usb dead — pre-5G iPod, fall back to SCSI');
    });
    const scsi: ScsiTransport = async (fp) => {
      scsiFp = fp;
      return validBytes;
    };

    const result = await inquireFirmware(fullFp, {
      transports: { usb, scsi },
      availability: avail(true, true),
    });

    expect(result).not.toBeNull();
    expect(scsiFp).toEqual(fullFp);
    expect(scsiFp?.vendorId).toBe('05ac');
    expect(scsiFp?.productId).toBe('1226');
    expect(scsiFp?.serialNumber).toBe('YM5180A4S31');
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

describe('inquireFirmwareDetailed', () => {
  it('reports plan="usb-then-scsi" with a single usb-success attempt when USB works', async () => {
    const usb = mock<UsbTransport>(async () => validBytes);
    const scsi = mock<ScsiTransport>(async () => {
      throw new Error('scsi should not be called');
    });

    const detailed = await inquireFirmwareDetailed(fp, {
      transports: { usb, scsi },
      availability: avail(true, true),
    });

    expect(detailed.firmware).not.toBeNull();
    expect(detailed.plan).toBe('usb-then-scsi');
    expect(detailed.attempts).toEqual([{ transport: 'usb', outcome: 'success' }]);
  });

  it('reports usb transport-error followed by scsi success on fallback (SCSI-only iPod scenario)', async () => {
    // Mirrors the production behaviour for pre-5G iPods like the mini 2G:
    // USB inquiry throws (the device does not implement the firmware control
    // transfer), the orchestrator falls through to SCSI, SCSI succeeds. The
    // detailed result must capture both attempts so callers can render an
    // accurate "tried USB and SCSI" diagnostic.
    const usb = mock<UsbTransport>(async () => {
      throw new Error('usb transport boom');
    });
    const scsi = mock<ScsiTransport>(async () => validBytes);

    const detailed = await inquireFirmwareDetailed(fp, {
      transports: { usb, scsi },
      availability: avail(true, true),
    });

    expect(detailed.firmware).not.toBeNull();
    expect(detailed.plan).toBe('usb-then-scsi');
    expect(detailed.attempts).toHaveLength(2);
    expect(detailed.attempts[0]).toMatchObject({ transport: 'usb', outcome: 'transport-error' });
    expect(detailed.attempts[1]).toEqual({ transport: 'scsi', outcome: 'success' });
  });

  it('reports both transports failing when USB throws and SCSI throws', async () => {
    const usb = mock<UsbTransport>(async () => {
      throw new Error('usb dead');
    });
    const scsi = mock<ScsiTransport>(async () => {
      throw new Error('scsi dead');
    });

    const detailed = await inquireFirmwareDetailed(fp, {
      transports: { usb, scsi },
      availability: avail(true, true),
    });

    expect(detailed.firmware).toBeNull();
    expect(detailed.plan).toBe('usb-then-scsi');
    expect(detailed.attempts).toHaveLength(2);
    expect(detailed.attempts[0]).toMatchObject({ transport: 'usb', outcome: 'transport-error' });
    expect(detailed.attempts[1]).toMatchObject({ transport: 'scsi', outcome: 'transport-error' });
  });

  it('reports plan="none" with no attempts when no transport is available', async () => {
    const usb = mock<UsbTransport>(async () => validBytes);
    const scsi = mock<ScsiTransport>(async () => validBytes);

    const detailed = await inquireFirmwareDetailed(fp, {
      transports: { usb, scsi },
      availability: avail(false, false),
    });

    expect(detailed.firmware).toBeNull();
    expect(detailed.plan).toBe('none');
    expect(detailed.attempts).toEqual([]);
    expect(usb).toHaveBeenCalledTimes(0);
    expect(scsi).toHaveBeenCalledTimes(0);
  });

  it('reports a parse-error attempt (and does NOT fall back to SCSI) when USB returns malformed bytes', async () => {
    const usb = mock<UsbTransport>(async () => new TextEncoder().encode('not a plist <<<'));
    const scsi = mock<ScsiTransport>(async () => validBytes);

    const detailed = await inquireFirmwareDetailed(fp, {
      transports: { usb, scsi },
      availability: avail(true, true),
    });

    expect(detailed.firmware).toBeNull();
    expect(detailed.plan).toBe('usb-then-scsi');
    expect(detailed.attempts).toEqual([{ transport: 'usb', outcome: 'parse-error' }]);
    expect(scsi).toHaveBeenCalledTimes(0);
  });

  it('reports a single SCSI attempt when probe says SCSI-only', async () => {
    const usb = mock<UsbTransport>(async () => {
      throw new Error('usb should not be called');
    });
    const scsi = mock<ScsiTransport>(async () => validBytes);

    const detailed = await inquireFirmwareDetailed(fp, {
      transports: { usb, scsi },
      availability: avail(false, true),
    });

    expect(detailed.firmware).not.toBeNull();
    expect(detailed.plan).toBe('scsi-only');
    expect(detailed.attempts).toEqual([{ transport: 'scsi', outcome: 'success' }]);
  });
});
