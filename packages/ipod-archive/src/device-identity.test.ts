/**
 * Unit tests for device-identity — the captured-SysInfoExtended sidecar
 * round-trip. The full precedence (on-disk SIE → captured sidecar → libgpod)
 * and the master-playlist name are exercised end-to-end in
 * run-transform.integration.test.ts against real seeded dumps.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CAPTURED_SYSINFO_FILENAME,
  readCapturedSysInfo,
  writeCapturedSysInfo,
} from './device-identity.js';

/** A minimal-but-valid SysInfoExtended plist (GUID + serial + FamilyID + model). */
const SIE_XML = `<?xml version="1.0"?>
<plist version="1.0">
<dict>
<key>FireWireGUID</key><string>000A27001A0647CB</string>
<key>SerialNumber</key><string>YM7275YSVQH</string>
<key>FamilyID</key><integer>9</integer>
<key>ModelNumStr</key><string>MA477</string>
</dict>
</plist>`;

describe('writeCapturedSysInfo / readCapturedSysInfo', () => {
  test('round-trips the SysInfoExtended sidecar into a parsed identity bag', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ipod-archive-sie-'));
    try {
      await writeCapturedSysInfo(dir, SIE_XML);
      const result = await readCapturedSysInfo(dir);
      expect(result?.identity.serialNumber).toBe('YM7275YSVQH');
      expect(result?.identity.firewireGuid).toBe('000A27001A0647CB');
      expect(result?.identity.modelNumStr).toBe('MA477');
      expect(result?.identity.familyId).toBe(9);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('writes to the podkit-namespaced sidecar filename', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ipod-archive-sie-'));
    try {
      await writeCapturedSysInfo(dir, SIE_XML);
      // Reading the same file directly confirms the location contract.
      const raw = await Bun.file(join(dir, CAPTURED_SYSINFO_FILENAME)).text();
      expect(raw).toContain('YM7275YSVQH');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns null when the sidecar is absent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ipod-archive-sie-'));
    try {
      expect(await readCapturedSysInfo(dir)).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a malformed sidecar yields an empty identity bag, not a throw', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ipod-archive-sie-'));
    try {
      await writeFile(join(dir, CAPTURED_SYSINFO_FILENAME), '<not a plist', 'utf8');
      const result = await readCapturedSysInfo(dir);
      // parseSysInfoExtendedXml returns a present result with an empty bag.
      expect(result?.identity.serialNumber).toBeUndefined();
      expect(result?.identity.modelNumStr).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
