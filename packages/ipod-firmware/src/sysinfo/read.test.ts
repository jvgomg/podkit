/**
 * Tests for readSysInfoExtended + parseSysInfoExtendedXml, focused on the
 * classic-SysInfo neighbour fallback for ModelNumStr — the path that matters
 * when the extended plist is present-but-modelless or malformed.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSysInfoExtended, parseSysInfoExtendedXml } from './read.js';
import { SYSINFO_EXTENDED_PATH, SYSINFO_PATH } from './paths.js';

/** A valid SysInfoExtended plist with GUID + serial + FamilyID but no ModelNumStr. */
const SIE_NO_MODEL = `<?xml version="1.0"?>
<plist version="1.0">
<dict>
<key>FireWireGUID</key><string>000A27001A0647CB</string>
<key>SerialNumber</key><string>YM7275YSVQH</string>
<key>FamilyID</key><integer>9</integer>
</dict>
</plist>`;

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** Create a mount point with the given SysInfoExtended / classic SysInfo contents. */
function mount(opts: { sie?: string; sysInfo?: string }): string {
  const root = mkdtempSync(join(tmpdir(), 'sie-read-'));
  dirs.push(root);
  mkdirSync(join(root, 'iPod_Control', 'Device'), { recursive: true });
  if (opts.sie !== undefined) writeFileSync(join(root, SYSINFO_EXTENDED_PATH), opts.sie, 'utf8');
  if (opts.sysInfo !== undefined) writeFileSync(join(root, SYSINFO_PATH), opts.sysInfo, 'utf8');
  return root;
}

describe('readSysInfoExtended', () => {
  test('returns null when SysInfoExtended is absent', () => {
    expect(readSysInfoExtended(mount({}))).toBeNull();
  });

  test('folds classic SysInfo ModelNumStr in when the extended plist carries none', () => {
    const root = mount({ sie: SIE_NO_MODEL, sysInfo: 'ModelNumStr: MA477\n' });
    const result = readSysInfoExtended(root);
    expect(result?.identity.serialNumber).toBe('YM7275YSVQH');
    expect(result?.identity.modelNumStr).toBe('MA477'); // from the neighbour
  });

  test('recovers ModelNumStr from the neighbour even when the extended plist is malformed', () => {
    const root = mount({ sie: '<not a plist', sysInfo: 'ModelNumStr: MA477\n' });
    const result = readSysInfoExtended(root);
    expect(result).not.toBeNull(); // present-but-unparseable is still "present"
    expect(result?.identity.modelNumStr).toBe('MA477');
  });
});

describe('parseSysInfoExtendedXml', () => {
  test('parses a valid plist into the identity bag', () => {
    const result = parseSysInfoExtendedXml(SIE_NO_MODEL);
    expect(result?.identity.firewireGuid).toBe('000A27001A0647CB');
    expect(result?.identity.familyId).toBe(9);
  });

  test('returns null only for empty XML', () => {
    expect(parseSysInfoExtendedXml('   ')).toBeNull();
    expect(parseSysInfoExtendedXml('<garbage')?.identity.serialNumber).toBeUndefined();
  });
});
