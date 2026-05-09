/**
 * Unit tests for the readiness `sysinfo` stage.
 *
 * Regression coverage for the model-identity bug: when SysInfoExtended is
 * present but its serial-suffix is not in the lookup table, the stage must
 * still resolve a rich model via cascade (ModelNumStr from the classic
 * SysInfo neighbour, FamilyID from the XML, USB productId).
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { checkSysInfo } from './sysinfo.js';

const MINI_2G_SYSINFO_EXTENDED = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>FamilyID</key><integer>3</integer>
  <key>FireWireGUID</key><string>000A270014198517</string>
  <key>SerialNumber</key><string>JQ5141TFS4G</string>
  <key>VolumeFormat</key><string>FAT32</string>
</dict>
</plist>`;

const MINI_2G_SYSINFO_TEXT = 'ModelNumStr: P9804\nVisibleBuildID: 1.3\n';

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-readiness-sysinfo-'));
}

function writeFiles(mountPoint: string, files: Record<string, string>): void {
  const deviceDir = path.join(mountPoint, 'iPod_Control', 'Device');
  fs.mkdirSync(deviceDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(deviceDir, name), content, 'utf-8');
  }
}

describe('checkSysInfo — SysInfoExtended-present cascade', () => {
  let dir: string;

  beforeEach(() => {
    dir = tmpdir();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolves the full mini 2G 4GB Pink model when SysInfoExtended + SysInfo are both present', async () => {
    // The bug: doctor --repair sysinfo-extended on a real mini 2G writes
    // SysInfoExtended (which lacks ModelNumStr) and the readiness stage
    // resolves identity via serial-suffix only. Suffix S4G WAS missing from
    // the table, so the display regressed to "Unknown iPod".
    //
    // Even after the data fix, the architectural concern stands: if the
    // serial-suffix table doesn't carry an entry, the stage must still find
    // the model via the SysInfo ModelNumStr neighbour. Strip S4G's serial
    // axis by using a serial whose suffix is definitely not in the table.
    const xml = MINI_2G_SYSINFO_EXTENDED.replace('JQ5141TFS4G', 'JQ5141TFXXX');
    writeFiles(dir, {
      SysInfoExtended: xml,
      SysInfo: MINI_2G_SYSINFO_TEXT,
    });

    const result = await checkSysInfo(dir);

    expect(result.deviceModel).toBeDefined();
    expect(result.deviceModel!.displayName).toBe('iPod mini 4GB Pink (2nd Generation)');
    expect(result.deviceModel!.generationId).toBe('mini_2g');
    expect(result.deviceModel!.modelNumber).toBe('9804');
    expect(result.stage.summary).toContain('iPod mini 4GB Pink (2nd Generation)');
    expect(result.stage.summary).toContain('P9804');
  });

  it('resolves mini 2G via the now-present S4G serial entry when SysInfo is absent', async () => {
    // With SysInfoExtended only (no SysInfo neighbour), the cascade still
    // finds mini 2G 4GB Pink via the newly-added S4G serial-suffix entry.
    writeFiles(dir, { SysInfoExtended: MINI_2G_SYSINFO_EXTENDED });

    const result = await checkSysInfo(dir);

    expect(result.deviceModel).toBeDefined();
    expect(result.deviceModel!.generationId).toBe('mini_2g');
    expect(result.deviceModel!.displayName).toContain('iPod mini');
    expect(result.deviceModel!.displayName).toContain('Pink');
  });

  it('resolves mini 2G via FamilyID when serial AND ModelNumStr both miss', async () => {
    // Strip the serial suffix and the SysInfo neighbour. Only FamilyID=3
    // remains — generation-only fallback (no colour / capacity).
    const xml = MINI_2G_SYSINFO_EXTENDED.replace('JQ5141TFS4G', 'XX0000XXXXX');
    writeFiles(dir, { SysInfoExtended: xml });

    const result = await checkSysInfo(dir);

    expect(result.deviceModel).toBeDefined();
    expect(result.deviceModel!.generationId).toBe('mini_2g');
    // No variant data — generation display only.
    expect(result.deviceModel!.color).toBeUndefined();
  });

  it('does not regress to "Unknown iPod" when SysInfoExtended + SysInfo both name a known mini 2G', async () => {
    // The exact scenario from the bug report. Pre-fix this returned
    // "Unknown iPod". Post-fix it returns the rich display name.
    writeFiles(dir, {
      SysInfoExtended: MINI_2G_SYSINFO_EXTENDED,
      SysInfo: MINI_2G_SYSINFO_TEXT,
    });

    const result = await checkSysInfo(dir);

    expect(result.stage.summary).not.toBe('Unknown iPod');
    expect(result.stage.summary).toContain('iPod mini');
  });
});
