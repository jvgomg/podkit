/**
 * Unit tests for SysInfoExtended consistency diagnostic check
 *
 * Uses injected FS + USB helpers — no real filesystem or hardware required.
 */

import { describe, it, expect } from 'bun:test';
import {
  checkSysinfoConsistency,
  sysinfoConsistencyCheck,
  type SysinfFsReader,
  type UsbResolver,
} from './sysinfo-consistency.js';
import type { DiagnosticContext } from '../types.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const MOUNT = '/Volumes/IPOD';
const SYSINFO_PATH = `${MOUNT}/iPod_Control/Device/SysInfoExtended`;

/** Build a valid minimal SysInfoExtended XML payload with the given GUID. */
function makeSysinfoXml(guid: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN"
 "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>FireWireGUID</key><string>${guid}</string>
<key>SerialNumber</key><string>XY0123456789</string>
<key>FamilyID</key><integer>9</integer>
</dict>
</plist>`;
}

/** Build a minimal DiagnosticContext for testing. */
function makeCtx(): DiagnosticContext {
  return { mountPoint: MOUNT, deviceType: 'ipod' };
}

/** FS reader that reports the file absent. */
const absentFs: SysinfFsReader = {
  existsSync: () => false,
  readFileSync: () => {
    throw new Error('should not be called');
  },
};

/** Build an FS reader that returns the given XML. */
function presentFs(xml: string): SysinfFsReader {
  return {
    existsSync: (p) => p === SYSINFO_PATH,
    readFileSync: (_p, _enc) => xml,
  };
}

/** Build a USB resolver returning the given serial (or null if omitted). */
function usbReturns(serial: string | undefined): UsbResolver {
  return async () => ({ serialNumber: serial });
}

const usbFails: UsbResolver = async () => null;

// ── Check metadata ────────────────────────────────────────────────────────────

describe('sysinfoConsistencyCheck metadata', () => {
  it('has correct id, scope and applicableTo', () => {
    expect(sysinfoConsistencyCheck.id).toBe('sysinfo-consistency');
    expect(sysinfoConsistencyCheck.name).toBe('SysInfoExtended consistency with device');
    expect(sysinfoConsistencyCheck.scope).toBe('device');
    expect(sysinfoConsistencyCheck.applicableTo).toEqual(['ipod']);
    // Repair is wired from sysinfo-extended check
    expect(sysinfoConsistencyCheck.repair).toBeDefined();
  });
});

// ── File absent ───────────────────────────────────────────────────────────────

describe('checkSysinfoConsistency — file absent', () => {
  it('returns fail + repairable when SysInfoExtended does not exist', async () => {
    const result = await checkSysinfoConsistency(makeCtx(), absentFs, usbFails);

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(true);
    expect(result.summary).toContain('not present');
  });
});

// ── Matching GUIDs ────────────────────────────────────────────────────────────

describe('checkSysinfoConsistency — matching GUIDs', () => {
  it('returns pass when on-disk GUID matches live USB serial', async () => {
    const guid = '000A27001DCECFB5';
    const result = await checkSysinfoConsistency(
      makeCtx(),
      presentFs(makeSysinfoXml(guid)),
      usbReturns(guid)
    );

    expect(result.status).toBe('pass');
    expect(result.repairable).toBe(false);
    expect(result.summary).toContain(guid);
  });

  it('normalises to uppercase for comparison', async () => {
    const guid = '000a27001dcecfb5';
    const result = await checkSysinfoConsistency(
      makeCtx(),
      presentFs(makeSysinfoXml(guid)),
      usbReturns(guid.toUpperCase())
    );

    expect(result.status).toBe('pass');
  });
});

// ── Mismatched GUIDs ──────────────────────────────────────────────────────────

describe('checkSysinfoConsistency — mismatched GUIDs', () => {
  it('returns fail + repairable when GUIDs differ', async () => {
    const onDisk = '000A27001DCECFB5';
    const live = 'DEADBEEF00001234';

    const result = await checkSysinfoConsistency(
      makeCtx(),
      presentFs(makeSysinfoXml(onDisk)),
      usbReturns(live)
    );

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(true);
    expect(result.summary).toContain(onDisk);
    expect(result.summary).toContain(live);
    expect((result.details as Record<string, unknown>)['onDiskGuid']).toBe(onDisk);
    expect((result.details as Record<string, unknown>)['liveGuid']).toBe(live);
  });
});

// ── Malformed XML ─────────────────────────────────────────────────────────────

describe('checkSysinfoConsistency — malformed XML', () => {
  it('returns fail + repairable when XML is invalid', async () => {
    const badXml = 'this is not xml at all';
    const result = await checkSysinfoConsistency(
      makeCtx(),
      presentFs(badXml),
      usbReturns('000A27001DCECFB5')
    );

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(true);
    expect(result.summary).toContain('malformed');
  });

  it('returns fail + repairable when FireWireGUID key is missing', async () => {
    const noGuidXml = `<?xml version="1.0"?>
<plist version="1.0">
<dict>
<key>SerialNumber</key><string>ABC123</string>
<key>FamilyID</key><integer>9</integer>
</dict>
</plist>`;

    const result = await checkSysinfoConsistency(
      makeCtx(),
      presentFs(noGuidXml),
      usbReturns('000A27001DCECFB5')
    );

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(true);
    expect(result.summary).toContain('malformed');
  });
});

// ── USB unavailable (skip) ────────────────────────────────────────────────────

describe('checkSysinfoConsistency — USB unavailable', () => {
  it('skips rather than failing when USB resolution returns null', async () => {
    const guid = '000A27001DCECFB5';
    const result = await checkSysinfoConsistency(
      makeCtx(),
      presentFs(makeSysinfoXml(guid)),
      usbFails
    );

    expect(result.status).toBe('skip');
    expect(result.repairable).toBe(false);
    expect(result.summary).toContain(guid);
  });

  it('skips when USB resolver returns a record with no serialNumber', async () => {
    const guid = '000A27001DCECFB5';
    const result = await checkSysinfoConsistency(
      makeCtx(),
      presentFs(makeSysinfoXml(guid)),
      usbReturns(undefined)
    );

    expect(result.status).toBe('skip');
    expect(result.repairable).toBe(false);
  });
});
