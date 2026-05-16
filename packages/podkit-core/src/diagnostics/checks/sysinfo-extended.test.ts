/**
 * Unit tests for the SysInfoExtended repair handlers.
 *
 * Two repair flavours share the same runner:
 *   - `sysinfo-extended` repair (file genuinely missing) — force=false
 *   - `sysinfo-consistency` repair (file present but stale) — force=true
 *
 * Detailed end-to-end coverage of the shared runner (mount path resolution,
 * dry-run, ensure invocation, post-write re-check) lives in
 * `sysinfo-consistency-repair.test.ts`. This file pins the metadata
 * contracts that gate the doctor CLI's behaviour:
 *
 *   - Neither repair declares `'database'` — they must run on fresh devices
 *     with no iTunesDB (Bug 2: chicken-and-egg).
 *   - The consistency repair threads `force: true` into ensure so a stale
 *     on-disk file actually gets rewritten (Bug 1: false success).
 */

import { describe, it, expect, mock } from 'bun:test';
// Capture the REAL @podkit/ipod-firmware exports up-front so we can re-export
// the unmocked surface (parsePlist, normaliseFireWireGuid, etc.) alongside
// our stubbed ensureSysInfoExtended below. Without this, mock.module would
// replace the whole module with a partial shape and sysinfo-consistency.ts'
// other imports would crash at module-load time.
import * as realFirmware from '@podkit/ipod-firmware';

// ── Mock USB resolution so the repair runner can execute end-to-end ──────────
// The repair handler calls `resolveUsbDeviceFromPath`; it needs to see a
// non-null fingerprint to proceed past the early "could not find USB" guard.

mock.module('../../device/usb-path-resolution.js', () => ({
  resolveUsbDeviceFromPath: async () => ({
    vendorId: '05ac',
    productId: '1226',
    serialNumber: 'YM5180A4S31',
    bus: 3,
    devnum: 7,
  }),
  hasCompleteUsbFingerprint: () => true,
}));

// Imports come AFTER mock.module so the mocked module is loaded.
const { sysInfoExtendedCheck } = await import('./sysinfo-extended.js');
const realEnsure = realFirmware.ensureSysInfoExtended;

// ── Fixtures ────────────────────────────────────────────────────────────────

const STALE_GUID = '000A270000DEADBEEF';
const FRESH_GUID = '000A270000ABCDEF';

// ── Repair metadata ─────────────────────────────────────────────────────────

describe('sysInfoExtendedCheck.repair metadata', () => {
  it('declares writable-device but NOT database (Bug 2: must run on fresh devices)', () => {
    const reqs = sysInfoExtendedCheck.repair!.requirements;
    expect(reqs).toContain('writable-device');
    expect(reqs).not.toContain('database');
    // Specifically: the chicken-and-egg gate was the CLI opening
    // IpodDatabase.open() before invoking this repair. The 'database'
    // requirement is the signal the CLI uses to skip that open. Asserting
    // its absence here locks the contract.
  });
});

// ── Bug 1: stale-SIE consistency repair forces re-write ─────────────────────

describe('sysinfoConsistencyCheck.repair (Bug 1: force re-write)', () => {
  it('threads force: true into ensureSysInfoExtended so the on-disk file is rewritten', async () => {
    const calls: Array<{ force: boolean | undefined }> = [];
    const fakeEnsure: typeof realEnsure = async (_mountPoint, _fp, opts) => {
      calls.push({ force: opts?.force });
      return {
        present: true,
        source: 'usb-read',
        identity: { firewireGuid: FRESH_GUID, serialNumber: 'YM5180A4S31', familyId: 3 },
        firewireGuid: FRESH_GUID,
        serialNumber: 'YM5180A4S31',
      };
    };

    mock.module('@podkit/ipod-firmware', () => ({
      ...realFirmware,
      ensureSysInfoExtended: fakeEnsure,
    }));

    try {
      const { sysinfoConsistencyCheck: stubbedConsistency } =
        await import('./sysinfo-consistency.js');

      const result = await stubbedConsistency.repair!.run({
        mountPoint: '/tmp/podkit-sysinfo-repair-test',
        deviceType: 'ipod',
        adapters: [],
      });

      expect(result.success).toBe(true);
      expect(calls.length).toBe(1);
      // The critical assertion: consistency repair must thread force=true.
      expect(calls[0]!.force).toBe(true);
      // Confirm the result references the fresh GUID surfaced by ensure.
      expect(result.details?.firewireGuid).toBe(FRESH_GUID);
    } finally {
      mock.module('@podkit/ipod-firmware', () => realFirmware);
    }
  });

  it('sysinfo-extended repair (default) does NOT force overwrite', async () => {
    // Symmetric guard: the file-genuinely-missing repair must keep the
    // default behaviour. Otherwise we'd be hammering USB on every run.
    const calls: Array<{ force: boolean | undefined }> = [];
    const fakeEnsure: typeof realEnsure = async (_mountPoint, _fp, opts) => {
      calls.push({ force: opts?.force });
      return {
        present: true,
        source: 'existing',
        identity: { firewireGuid: STALE_GUID, serialNumber: 'YM5180A4S31', familyId: 3 },
        firewireGuid: STALE_GUID,
        serialNumber: 'YM5180A4S31',
      };
    };

    mock.module('@podkit/ipod-firmware', () => ({
      ...realFirmware,
      ensureSysInfoExtended: fakeEnsure,
    }));

    try {
      const { sysInfoExtendedCheck: stubbedExtended } = await import('./sysinfo-extended.js');

      const result = await stubbedExtended.repair!.run({
        mountPoint: '/tmp/podkit-sysinfo-repair-test',
        deviceType: 'ipod',
        adapters: [],
      });

      expect(result.success).toBe(true);
      expect(calls.length).toBe(1);
      // Critical: default repair must NOT force.
      expect(calls[0]!.force).toBeFalsy();
    } finally {
      mock.module('@podkit/ipod-firmware', () => realFirmware);
    }
  });
});
