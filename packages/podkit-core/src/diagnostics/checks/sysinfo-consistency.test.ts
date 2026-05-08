/**
 * Unit tests for SysInfoExtended consistency diagnostic check.
 *
 * Uses an injected filesystem reader and a synthetic `liveIdentity` on
 * `DiagnosticContext` — no real filesystem, no hardware required.
 */

import { describe, it, expect } from 'bun:test';
import {
  checkSysinfoConsistency,
  sysinfoConsistencyCheck,
  type SysinfFsReader,
} from './sysinfo-consistency.js';
import type { DiagnosticContext, LiveDeviceIdentity } from '../types.js';
import type { IpodModel } from '@podkit/devices-ipod';

// ── Helpers ──────────────────────────────────────────────────────────────────

const MOUNT = '/Volumes/IPOD';
const SYSINFO_PATH = `${MOUNT}/iPod_Control/Device/SysInfoExtended`;

/**
 * A SysInfoExtended XML with the given GUID and a model number that
 * resolves to iPod nano 2nd gen (`MA477`). The serial-number suffix
 * `RXX` resolves to nano 2nd gen too — so the on-disk model axis will
 * always pick up "nano 2nd generation" unless the caller overrides.
 */
function makeSysinfoXml(
  guid: string,
  opts: { modelNumber?: string; serial?: string } = {}
): string {
  const modelLine = opts.modelNumber
    ? `<key>ModelNumStr</key><string>${opts.modelNumber}</string>\n`
    : '';
  const serial = opts.serial ?? 'XY0123456RXX';
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
${modelLine}<key>FireWireGUID</key><string>${guid}</string>
<key>SerialNumber</key><string>${serial}</string>
<key>FamilyID</key><integer>9</integer>
</dict>
</plist>`;
}

function makeCtx(liveIdentity?: LiveDeviceIdentity): DiagnosticContext {
  return { mountPoint: MOUNT, deviceType: 'ipod', liveIdentity };
}

const absentFs: SysinfFsReader = {
  existsSync: () => false,
  readFileSync: () => {
    throw new Error('readFileSync should not be called when file is absent');
  },
};

function presentFs(xml: string): SysinfFsReader {
  return {
    existsSync: (p) => p === SYSINFO_PATH,
    readFileSync: () => xml,
  };
}

const NANO_2G_MODEL: IpodModel = {
  displayName: 'iPod nano 2nd generation',
  generationId: 'nano_2g',
  checksumType: 'none',
  source: 'usb',
};

const NANO_3G_MODEL: IpodModel = {
  displayName: 'iPod nano 3rd generation',
  generationId: 'nano_3g',
  checksumType: 'none',
  source: 'usb',
};

// ── Check metadata ────────────────────────────────────────────────────────────

describe('sysinfoConsistencyCheck metadata', () => {
  it('has correct id, scope and applicableTo', () => {
    expect(sysinfoConsistencyCheck.id).toBe('sysinfo-consistency');
    expect(sysinfoConsistencyCheck.name).toBe('SysInfoExtended consistency with device');
    expect(sysinfoConsistencyCheck.scope).toBe('device');
    expect(sysinfoConsistencyCheck.applicableTo).toEqual(['ipod']);
    expect(sysinfoConsistencyCheck.repair).toBeDefined();
  });
});

// ── File absent ───────────────────────────────────────────────────────────────

describe('checkSysinfoConsistency — file absent', () => {
  it('returns skip when SysInfoExtended does not exist (absence is not failure)', async () => {
    const result = await checkSysinfoConsistency(makeCtx(), absentFs);

    expect(result.status).toBe('skip');
    expect(result.repairable).toBe(false);
    expect(result.summary).toContain('not present');
  });
});

// ── Malformed file (present but corrupt) ──────────────────────────────────────

describe('checkSysinfoConsistency — file present but malformed', () => {
  it('returns fail + repairable when XML is invalid', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: '000A27001DCECFB5' }),
      presentFs('this is not xml at all')
    );

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(true);
    expect(result.summary).toContain('failed to parse');
  });

  it('returns fail + repairable when required identity fields are missing', async () => {
    const noGuidXml = `<?xml version="1.0"?>
<plist version="1.0">
<dict>
<key>SerialNumber</key><string>ABC123</string>
<key>FamilyID</key><integer>9</integer>
</dict>
</plist>`;
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: '000A27001DCECFB5' }),
      presentFs(noGuidXml)
    );

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(true);
    expect(result.summary).toContain('missing required identity fields');
  });
});

// ── GUID axis ─────────────────────────────────────────────────────────────────

describe('checkSysinfoConsistency — GUID axis', () => {
  const guid = '000A27001DCECFB5';

  it('passes the GUID axis when on-disk and live match (case-insensitive)', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: guid.toLowerCase() }),
      presentFs(makeSysinfoXml(guid))
    );

    expect(result.status).toBe('pass');
    expect(result.summary).toContain('firewireGuid');
    const axes = (result.details?.axes as Array<{ name: string; status: string }>) ?? [];
    const guidAxis = axes.find((a) => a.name === 'firewireGuid');
    expect(guidAxis?.status).toBe('pass');
  });

  it('fails (repairable) when GUIDs differ', async () => {
    const live = 'DEADBEEF00001234';
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: live }),
      presentFs(makeSysinfoXml(guid))
    );

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(true);
    expect(result.summary).toContain('FireWireGUID mismatch');
    expect(result.summary).toContain(guid);
    expect(result.summary).toContain(live);
  });

  it('skips the GUID axis when no live FireWireGUID is provided', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({
        /* no firewireGuid */
      }),
      presentFs(makeSysinfoXml(guid))
    );

    // No live data on either axis → overall skip.
    expect(result.status).toBe('skip');
    expect(result.summary).toContain('no live data');
  });
});

// ── Model axis ────────────────────────────────────────────────────────────────

describe('checkSysinfoConsistency — model axis', () => {
  const guid = '000A27001DCECFB5';

  it('passes when on-disk and live model resolve to the same generation', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: guid, model: NANO_2G_MODEL }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('pass');
    const axes = (result.details?.axes as Array<{ name: string; status: string }>) ?? [];
    expect(axes.find((a) => a.name === 'model')?.status).toBe('pass');
  });

  it('fails (repairable) when on-disk and live model differ in generation', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: guid, model: NANO_3G_MODEL }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(true);
    expect(result.summary).toContain('model mismatch');
  });

  it('skips the model axis when no live model is provided', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: guid }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    // GUID axis passes — overall pass — but model axis is skipped.
    expect(result.status).toBe('pass');
    const axes = (result.details?.axes as Array<{ name: string; status: string }>) ?? [];
    const modelAxis = axes.find((a) => a.name === 'model');
    expect(modelAxis?.status).toBe('skip');
  });

  it('skips the model axis when the on-disk file resolves to no known model', async () => {
    const xml = makeSysinfoXml(guid, { modelNumber: 'XX999', serial: 'XXX0000000X' });
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: guid, model: NANO_2G_MODEL }),
      presentFs(xml)
    );

    expect(result.status).toBe('pass');
    const axes = (result.details?.axes as Array<{ name: string; status: string }>) ?? [];
    expect(axes.find((a) => a.name === 'model')?.status).toBe('skip');
  });
});

// ── Mixed axis outcomes ───────────────────────────────────────────────────────

describe('checkSysinfoConsistency — mixed axes', () => {
  const guid = '000A27001DCECFB5';

  it('reports both failures when GUID and model both disagree', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: 'DEADBEEF00001234', model: NANO_3G_MODEL }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('fail');
    expect(result.summary).toContain('FireWireGUID mismatch');
    expect(result.summary).toContain('model mismatch');
  });

  it('fails overall if any single axis fails (model mismatch with GUID match)', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: guid, model: NANO_3G_MODEL }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('fail');
  });
});

// ── No live data at all ───────────────────────────────────────────────────────

describe('checkSysinfoConsistency — no live identity', () => {
  it('returns skip when ctx.liveIdentity is undefined entirely', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx(undefined),
      presentFs(makeSysinfoXml('000A27001DCECFB5'))
    );

    expect(result.status).toBe('skip');
    expect(result.summary).toContain('no live data');
  });
});
