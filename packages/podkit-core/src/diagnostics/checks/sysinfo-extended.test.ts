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
 *
 * Stubs for `ensureSysInfoExtended` and `resolveUsbDeviceFromPath` are
 * injected via the `SysInfoExtendedRepairDeps` seam (agents/testing.md
 * §"Mocking: prefer DI over mock.module()") so this file does not touch
 * Bun's process-global module registry.
 */

import { describe, it, expect } from 'bun:test';
import type { UsbFingerprint } from '@podkit/device-types';
import {
  sysInfoExtendedCheck,
  runSysInfoExtendedRepair,
  type SysInfoExtendedRepairDeps,
} from './sysinfo-extended.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const STALE_GUID = '000A270000DEADBEEF';
const FRESH_GUID = '000A270000ABCDEF';

const FAKE_USB: UsbFingerprint = {
  vendorId: '05ac',
  productId: '1226',
  serialNumber: 'YM5180A4S31',
  bus: 3,
  devnum: 7,
};

function buildDeps(
  fakeEnsure: NonNullable<SysInfoExtendedRepairDeps['ensureSysInfoExtended']>
): SysInfoExtendedRepairDeps {
  return {
    ensureSysInfoExtended: fakeEnsure,
    resolveUsbDeviceFromPath: (async () => FAKE_USB) as never,
    hasCompleteUsbFingerprint: ((_info: unknown): _info is never => true) as never,
  };
}

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

describe('runSysInfoExtendedRepair (Bug 1: force re-write)', () => {
  it('consistency repair threads force: true into ensureSysInfoExtended so the on-disk file is rewritten', async () => {
    const calls: Array<{ force: boolean | undefined }> = [];
    const fakeEnsure: SysInfoExtendedRepairDeps['ensureSysInfoExtended'] = async (
      _mountPoint,
      _fp,
      opts
    ) => {
      calls.push({ force: opts?.force });
      return {
        present: true,
        source: 'usb-read',
        identity: { firewireGuid: FRESH_GUID, serialNumber: 'YM5180A4S31', familyId: 3 },
        firewireGuid: FRESH_GUID,
        serialNumber: 'YM5180A4S31',
      } satisfies Awaited<ReturnType<NonNullable<typeof fakeEnsure>>>;
    };

    // sysinfo-consistency wires the runner with force=true.
    const result = await runSysInfoExtendedRepair(
      {
        mountPoint: '/tmp/podkit-sysinfo-repair-test',
        deviceType: 'ipod',
        adapters: [],
      },
      undefined,
      /* force */ true,
      buildDeps(fakeEnsure)
    );

    expect(result.success).toBe(true);
    expect(calls.length).toBe(1);
    // The critical assertion: consistency repair must thread force=true.
    expect(calls[0]!.force).toBe(true);
    // Confirm the result references the fresh GUID surfaced by ensure.
    expect(result.details?.firewireGuid).toBe(FRESH_GUID);
  });

  it('sysinfo-extended repair (default) does NOT force overwrite', async () => {
    // Symmetric guard: the file-genuinely-missing repair must keep the
    // default behaviour. Otherwise we'd be hammering USB on every run.
    const calls: Array<{ force: boolean | undefined }> = [];
    const fakeEnsure: SysInfoExtendedRepairDeps['ensureSysInfoExtended'] = async (
      _mountPoint,
      _fp,
      opts
    ) => {
      calls.push({ force: opts?.force });
      return {
        present: true,
        source: 'existing',
        identity: { firewireGuid: STALE_GUID, serialNumber: 'YM5180A4S31', familyId: 3 },
        firewireGuid: STALE_GUID,
        serialNumber: 'YM5180A4S31',
      } satisfies Awaited<ReturnType<NonNullable<typeof fakeEnsure>>>;
    };

    // sysinfo-extended wires the runner with force=false.
    const result = await runSysInfoExtendedRepair(
      {
        mountPoint: '/tmp/podkit-sysinfo-repair-test',
        deviceType: 'ipod',
        adapters: [],
      },
      undefined,
      /* force */ false,
      buildDeps(fakeEnsure)
    );

    expect(result.success).toBe(true);
    expect(calls.length).toBe(1);
    // Critical: default repair must NOT force.
    expect(calls[0]!.force).toBeFalsy();
  });
});
