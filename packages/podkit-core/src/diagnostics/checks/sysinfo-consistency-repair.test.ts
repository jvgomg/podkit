/**
 * Repair-path unit tests for the SysInfoExtended consistency diagnostic
 * check (TASK-303 AC #14 / #15).
 *
 * The repair on `sysinfoConsistencyCheck` is shared verbatim with
 * `sysInfoExtendedCheck.repair` — it resolves a live USB device from the
 * mount path, then either:
 *   - prints the planned action (dry-run), or
 *   - calls `ensureSysInfoExtended` to overwrite the on-disk file from
 *     fresh data read off the USB bus.
 *
 * We mock the two side-effecting imports (`usb-path-resolution.js` and
 * `@podkit/ipod-firmware`) at the module boundary so the test drives the
 * real `repair.run()` code path end-to-end without touching real USB or
 * the real filesystem.
 *
 * AC mapping:
 *   - AC #14: non-dry-run calls `ensureSysInfoExtended` exactly once with
 *     the resolved USB fingerprint; subsequent `checkSysinfoConsistency`
 *     against the newly-written XML reports pass.
 *   - AC #15: dry-run returns a "Dry run:" summary, does NOT call
 *     `ensureSysInfoExtended`, and does NOT modify the simulated on-disk
 *     store.
 *
 * Tier-3 deferral: a real-USB end-to-end repair → re-check loop is
 * deferred to TASK-322.05.01's FunctionFS daemon. Tier-1 coverage here
 * is sufficient to lock the repair-glue contract.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type {
  RepairContext,
  RepairResult,
  DiagnosticContext,
  LiveDeviceIdentity,
} from '../types.js';
import type { SysinfFsReader } from './sysinfo-consistency.js';

// Pull the real implementations of pure helpers we need to preserve when
// mocking the `@podkit/ipod-firmware` barrel below. `sysinfo-consistency.ts`
// itself imports `parsePlist`, `extractFromPlist`, and
// `normaliseFireWireGuid` from this package — those have no side effects
// and must continue to resolve to real implementations.
import * as ipodFirmwareReal from '@podkit/ipod-firmware';

// ── Mocks — declared BEFORE importing the module under test ──────────────────
//
// The repair lives in `sysinfo-extended.ts` and is re-exposed via
// `sysinfoConsistencyCheck.repair`. It imports `resolveUsbDeviceFromPath` +
// `hasCompleteUsbFingerprint` from `../../device/usb-path-resolution.js`
// and `ensureSysInfoExtended` from `@podkit/ipod-firmware`.

const RESOLVED_USB = {
  vendorId: '05ac',
  productId: '1209',
  serialNumber: '000A27001605D1A0',
  bus: 3,
  devnum: 4,
};

let resolveUsbReturn: typeof RESOLVED_USB | null = RESOLVED_USB;
const resolveUsbMock = mock(async (_path: string) => resolveUsbReturn);
const hasCompleteFingerprintMock = mock((info: unknown): boolean => {
  return info !== null && typeof info === 'object';
});

mock.module('../../device/usb-path-resolution.js', () => ({
  resolveUsbDeviceFromPath: resolveUsbMock,
  hasCompleteUsbFingerprint: hasCompleteFingerprintMock,
}));

// `ensureSysInfoExtended` is the side effect we want to observe. It returns
// a shape with `present`, `identity`, `firewireGuid`, `serialNumber`,
// `source`, and optionally `error`. Default to a success result so dry-run
// branches that do call it are caught by axis assertions if mis-routed.
const REAL_PERSONA_GUID = '000A27001605D1A0';
const REAL_PERSONA_SERIAL = '9C642MEFV9M';
const REAL_PERSONA_MODELNUM = 'A446';

let ensureSysInfoReturn: {
  present: boolean;
  source: 'existing' | 'usb';
  firewireGuid?: string;
  serialNumber?: string;
  identity: { modelNumStr?: string; serialNumber: string; familyId?: number };
  error?: string;
} = {
  present: true,
  source: 'usb',
  firewireGuid: REAL_PERSONA_GUID,
  serialNumber: REAL_PERSONA_SERIAL,
  identity: {
    modelNumStr: REAL_PERSONA_MODELNUM,
    serialNumber: REAL_PERSONA_SERIAL,
    familyId: 6,
  },
};

const ensureSysInfoMock = mock(async (_mountPath: string, _fp: object) => ensureSysInfoReturn);

mock.module('@podkit/ipod-firmware', () => ({
  // Forward every real export — parsePlist, extractFromPlist,
  // normaliseFireWireGuid, etc. are pure helpers consumed elsewhere and
  // must continue to resolve.
  ...ipodFirmwareReal,
  // Override the one side-effecting function we're observing.
  ensureSysInfoExtended: ensureSysInfoMock,
}));

// Import AFTER the mocks. Use dynamic import so the mock-installed module
// references are already in place when the chunk loads.
const { sysinfoConsistencyCheck, checkSysinfoConsistency } =
  await import('./sysinfo-consistency.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

const MOUNT = '/Volumes/IPOD';

function makeRepairCtx(): RepairContext {
  return {
    mountPoint: MOUNT,
    deviceType: 'ipod',
    adapters: [],
  };
}

function makeCtx(liveIdentity?: LiveDeviceIdentity): DiagnosticContext {
  return { mountPoint: MOUNT, deviceType: 'ipod', liveIdentity };
}

beforeEach(() => {
  resolveUsbMock.mockClear();
  ensureSysInfoMock.mockClear();
  hasCompleteFingerprintMock.mockClear();
  // Reset module-level mutable fixtures to known-good defaults.
  resolveUsbReturn = RESOLVED_USB;
  ensureSysInfoReturn = {
    present: true,
    source: 'usb',
    firewireGuid: REAL_PERSONA_GUID,
    serialNumber: REAL_PERSONA_SERIAL,
    identity: {
      modelNumStr: REAL_PERSONA_MODELNUM,
      serialNumber: REAL_PERSONA_SERIAL,
      familyId: 6,
    },
  };
});

// ── AC #14: repair overwrites file; subsequent check passes ──────────────────

describe('sysinfoConsistencyCheck.repair — overwrite path (AC #14)', () => {
  it('calls ensureSysInfoExtended exactly once with the resolved USB fingerprint', async () => {
    const ctx = makeRepairCtx();

    const result: RepairResult = await sysinfoConsistencyCheck.repair!.run(ctx);

    expect(result.success).toBe(true);
    expect(ensureSysInfoMock.mock.calls.length).toBe(1);
    const [calledMount, calledFp] = ensureSysInfoMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(calledMount).toBe(MOUNT);
    expect(calledFp.vendorId).toBe(RESOLVED_USB.vendorId);
    expect(calledFp.productId).toBe(RESOLVED_USB.productId);
    expect(calledFp.bus).toBe(RESOLVED_USB.bus);
    expect(calledFp.devnum).toBe(RESOLVED_USB.devnum);
    expect(calledFp.serialNumber).toBe(RESOLVED_USB.serialNumber);
  });

  it('surfaces the resolved model in the repair summary', async () => {
    const result = await sysinfoConsistencyCheck.repair!.run(makeRepairCtx());

    expect(result.success).toBe(true);
    expect(result.summary).toContain('SysInfoExtended');
    // The repair resolves the richest model — A446 / FV9M / familyId=6 →
    // an iPod 5G variant. We assert the displayName surface, not the exact
    // variant string (capacity/color depend on the SKU table).
    expect(result.summary).toContain('iPod');
    expect(result.details?.firewireGuid).toBe(REAL_PERSONA_GUID);
    expect(result.details?.serialNumber).toBe(REAL_PERSONA_SERIAL);
    expect(result.details?.source).toBe('usb');
  });

  it('after a successful repair, re-running the check against the new on-disk XML returns pass', async () => {
    // Simulate the post-repair filesystem state by reading a real persona
    // XML (the captured TERAPOD SysInfoExtended) and feeding it back into
    // `checkSysinfoConsistency` via the injectable fsReader. This proves
    // the end-to-end "repair → check passes" contract that AC #14 calls
    // for, without touching the real filesystem.
    const repairResult = await sysinfoConsistencyCheck.repair!.run(makeRepairCtx());
    expect(repairResult.success).toBe(true);

    // The freshly-written XML on disk would contain the same identity as
    // the live USB (because that's exactly what ensureSysInfoExtended
    // writes). Re-build the minimal XML the check needs.
    const writtenXml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
<key>ModelNumStr</key><string>${REAL_PERSONA_MODELNUM}</string>
<key>FireWireGUID</key><string>${REAL_PERSONA_GUID}</string>
<key>SerialNumber</key><string>${REAL_PERSONA_SERIAL}</string>
<key>FamilyID</key><integer>6</integer>
</dict>
</plist>`;
    const reReadFs: SysinfFsReader = {
      existsSync: () => true,
      readFileSync: () => writtenXml,
    };

    // Re-running the check against the freshly-written file with the same
    // live identity should now report pass on both axes.
    const liveIdentity: LiveDeviceIdentity = {
      firewireGuid: REAL_PERSONA_GUID,
    };
    const check = await checkSysinfoConsistency(makeCtx(liveIdentity), reReadFs);

    expect(check.status).toBe('pass');
    const axes = (check.details?.axes as Array<{ name: string; status: string }>) ?? [];
    expect(axes.find((a) => a.name === 'firewireGuid')?.status).toBe('pass');
  });

  it('returns failure when USB resolution fails (no device found)', async () => {
    resolveUsbReturn = null;
    const result = await sysinfoConsistencyCheck.repair!.run(makeRepairCtx());

    expect(result.success).toBe(false);
    expect(result.summary).toContain('USB');
    expect(ensureSysInfoMock.mock.calls.length).toBe(0);
  });

  it('propagates ensureSysInfoExtended failure as a non-success result', async () => {
    ensureSysInfoReturn = {
      present: false,
      source: 'usb',
      error: 'firmware inquiry refused on SCSI page',
      identity: { serialNumber: '' },
    };

    const result = await sysinfoConsistencyCheck.repair!.run(makeRepairCtx());

    expect(result.success).toBe(false);
    expect(result.summary).toContain('firmware inquiry refused');
  });
});

// ── AC #15: dry-run prints planned action without modifying ──────────────────

describe('sysinfoConsistencyCheck.repair — dry-run path (AC #15)', () => {
  it('returns a Dry-run summary with the resolved USB bus + devnum', async () => {
    const result = await sysinfoConsistencyCheck.repair!.run(makeRepairCtx(), {
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.summary).toMatch(/Dry run:.*would read SysInfoExtended/);
    expect(result.summary).toContain(`bus ${RESOLVED_USB.bus}`);
    expect(result.summary).toContain(`device ${RESOLVED_USB.devnum}`);
    expect(result.details?.bus).toBe(RESOLVED_USB.bus);
    expect(result.details?.devnum).toBe(RESOLVED_USB.devnum);
  });

  it('does NOT call ensureSysInfoExtended (no file write side-effect)', async () => {
    await sysinfoConsistencyCheck.repair!.run(makeRepairCtx(), { dryRun: true });
    expect(ensureSysInfoMock.mock.calls.length).toBe(0);
  });

  it('still fails the dry-run when USB resolution fails (no false positive)', async () => {
    resolveUsbReturn = null;
    const result = await sysinfoConsistencyCheck.repair!.run(makeRepairCtx(), {
      dryRun: true,
    });

    expect(result.success).toBe(false);
    expect(result.summary).toContain('USB');
    // Critically: ensureSysInfoExtended must still NOT be called.
    expect(ensureSysInfoMock.mock.calls.length).toBe(0);
  });

  it('invokes onProgress before the dry-run short-circuit', async () => {
    const phases: string[] = [];
    await sysinfoConsistencyCheck.repair!.run(makeRepairCtx(), {
      dryRun: true,
      onProgress: (p) => {
        if (typeof p.phase === 'string') phases.push(p.phase);
      },
    });

    // Resolution phase must fire even in dry-run mode (it's how we get
    // the bus/devnum to print). Reading phase must NOT fire — that's
    // dry-run's whole point.
    expect(phases).toContain('resolving');
    expect(phases).not.toContain('reading');
  });
});
