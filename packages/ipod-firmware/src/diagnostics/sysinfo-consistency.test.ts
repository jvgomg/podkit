/**
 * Unit tests for SysInfoExtended consistency pure logic
 *
 * Tests `normaliseFireWireGuid` and `compareSysInfoConsistency` in isolation —
 * no I/O, no hardware required.
 */

import { describe, it, expect } from 'bun:test';
import { normaliseFireWireGuid, compareSysInfoConsistency } from './sysinfo-consistency.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── normaliseFireWireGuid ─────────────────────────────────────────────────────

describe('normaliseFireWireGuid', () => {
  it('converts lowercase to uppercase', () => {
    expect(normaliseFireWireGuid('000a27001dcecfb5')).toBe('000A27001DCECFB5');
  });

  it('pads short GUIDs to 16 chars with leading zeros', () => {
    expect(normaliseFireWireGuid('DEADBEEF')).toBe('00000000DEADBEEF');
  });

  it('strips 0x prefix (uppercase)', () => {
    expect(normaliseFireWireGuid('0X000A27001DCECFB5')).toBe('000A27001DCECFB5');
  });

  it('strips 0x prefix (lowercase)', () => {
    expect(normaliseFireWireGuid('0x000a27001dcecfb5')).toBe('000A27001DCECFB5');
  });

  it('is idempotent on already-normalised GUIDs', () => {
    const guid = '000A27001DCECFB5';
    expect(normaliseFireWireGuid(guid)).toBe(guid);
  });

  it('handles a full 16-char GUID correctly', () => {
    expect(normaliseFireWireGuid('000A270024A23E9E')).toBe('000A270024A23E9E');
  });
});

// ── compareSysInfoConsistency ─────────────────────────────────────────────────

describe('compareSysInfoConsistency — match', () => {
  it('returns match when on-disk GUID equals live GUID', () => {
    const guid = '000A27001DCECFB5';
    const result = compareSysInfoConsistency(makeSysinfoXml(guid), guid);

    expect(result.status).toBe('match');
    expect(result.onDiskGuid).toBe(guid);
    expect(result.liveGuid).toBe(guid);
  });

  it('normalises both to uppercase before comparing (case insensitive match)', () => {
    const onDisk = '000a27001dcecfb5';
    const live = '000A27001DCECFB5';
    const result = compareSysInfoConsistency(makeSysinfoXml(onDisk), live);

    expect(result.status).toBe('match');
    expect(result.onDiskGuid).toBe('000A27001DCECFB5');
    expect(result.liveGuid).toBe('000A27001DCECFB5');
  });

  it('pads short on-disk GUID and short live GUID before comparing', () => {
    // extractFromPlist already normalises, but liveGuid may arrive without padding
    const guid = '000A27001DCECFB5';
    // live GUID with leading zeros stripped as it might come from USB descriptor
    const liveShort = 'A27001DCECFB5';
    // This should NOT match since padding differs from the on-disk value
    const result = compareSysInfoConsistency(makeSysinfoXml(guid), liveShort);
    // 'A27001DCECFB5' pads to '000A27001DCECFB5' — matches!
    expect(result.status).toBe('match');
  });
});

describe('compareSysInfoConsistency — mismatch', () => {
  it('returns mismatch when GUIDs differ', () => {
    const onDisk = '000A27001DCECFB5';
    const live = 'DEADBEEF00001234';
    const result = compareSysInfoConsistency(makeSysinfoXml(onDisk), live);

    expect(result.status).toBe('mismatch');
    expect(result.onDiskGuid).toBe(onDisk);
    expect(result.liveGuid).toBe(live);
  });
});

describe('compareSysInfoConsistency — malformed', () => {
  it('returns malformed when XML is completely invalid', () => {
    const result = compareSysInfoConsistency('this is not xml at all', '000A27001DCECFB5');

    expect(result.status).toBe('malformed');
    expect(result.onDiskGuid).toBeUndefined();
    expect(result.liveGuid).toBeUndefined();
  });

  it('returns malformed when FireWireGUID key is absent', () => {
    const noGuidXml = `<?xml version="1.0"?>
<plist version="1.0">
<dict>
<key>SerialNumber</key><string>ABC123</string>
<key>FamilyID</key><integer>9</integer>
</dict>
</plist>`;
    const result = compareSysInfoConsistency(noGuidXml, '000A27001DCECFB5');

    expect(result.status).toBe('malformed');
  });

  it('returns malformed when XML parses but required fields (SerialNumber) are missing', () => {
    // extractFromPlist returns null when SerialNumber is missing
    const noSerialXml = `<?xml version="1.0"?>
<plist version="1.0">
<dict>
<key>FireWireGUID</key><string>000A27001DCECFB5</string>
<key>FamilyID</key><integer>9</integer>
</dict>
</plist>`;
    const result = compareSysInfoConsistency(noSerialXml, '000A27001DCECFB5');

    expect(result.status).toBe('malformed');
  });
});

describe('compareSysInfoConsistency — no-live-guid', () => {
  it('returns no-live-guid when liveGuid is null', () => {
    const guid = '000A27001DCECFB5';
    const result = compareSysInfoConsistency(makeSysinfoXml(guid), null);

    expect(result.status).toBe('no-live-guid');
    expect(result.onDiskGuid).toBe(guid);
    expect(result.liveGuid).toBeUndefined();
  });

  it('returns no-live-guid when liveGuid is undefined', () => {
    const guid = '000A27001DCECFB5';
    const result = compareSysInfoConsistency(makeSysinfoXml(guid), undefined);

    expect(result.status).toBe('no-live-guid');
    expect(result.onDiskGuid).toBe(guid);
  });

  it('returns no-live-guid when liveGuid is empty string', () => {
    const guid = '000A27001DCECFB5';
    const result = compareSysInfoConsistency(makeSysinfoXml(guid), '');

    expect(result.status).toBe('no-live-guid');
  });
});
