/**
 * Unit tests for SysInfoExtended consistency diagnostic check.
 *
 * Uses an injected filesystem reader and a synthetic `liveIdentity` on
 * `DiagnosticContext` — no real filesystem, no hardware required.
 *
 * Test sections mirror TASK-303's 15 ACs:
 *   - #1 file absent (skip), #8 no-live-data (skip), #9 invalid XML,
 *     #10 missing fields, #11 I/O error (file-state matrix)
 *   - #2/#3/#4/#5/#6/#7 axis-fold matrix
 *   - #12 GUID comparison invariants (case + zero-pad)
 *   - #13 model granularity (USB-derived live carries only generation)
 *   - #14/#15 repair coverage lives in `sysinfo-consistency-repair.test.ts`
 *     where module mocks for USB resolution + ensureSysInfoExtended are
 *     declared before the module-under-test is imported.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'bun:test';
import {
  checkSysinfoConsistency,
  sysinfoConsistencyCheck,
  type SysinfFsReader,
} from './sysinfo-consistency.js';
import type { DiagnosticContext, LiveDeviceIdentity } from '../types.js';
import { identify, type IpodModel } from '@podkit/devices-ipod';

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
  displayName: 'iPod nano (2nd Generation)',
  generationId: 'nano_2g',
  family: 'iPod nano',
  ordinal: 2,
  checksumType: 'none',
  source: 'usb',
};

const NANO_3G_MODEL: IpodModel = {
  displayName: 'iPod nano (3rd Generation)',
  generationId: 'nano_3g',
  family: 'iPod nano',
  ordinal: 3,
  checksumType: 'none',
  source: 'usb',
};

// ── Check metadata ────────────────────────────────────────────────────────────

describe('sysinfoConsistencyCheck metadata', () => {
  it('has correct id, scope and applicableTo', () => {
    expect(sysinfoConsistencyCheck.id).toBe('sysinfo-consistency');
    expect(sysinfoConsistencyCheck.name).toBe('SysInfoExtended consistency with device');
    expect(sysinfoConsistencyCheck.scope).toBe('database-health');
    expect(sysinfoConsistencyCheck.applicableTo).toEqual(['ipod']);
    expect(sysinfoConsistencyCheck.repair).toBeDefined();
  });

  it('repair does not require the iTunesDB (Bug 2: stale identity must repair on fresh devices)', () => {
    // Critical: this repair runs on freshly-formatted iPods that have no
    // database yet. If `'database'` slips into requirements, the CLI gates
    // it behind IpodDatabase.open() and the repair fails before the firmware
    // read even fires.
    expect(sysinfoConsistencyCheck.repair!.requirements).not.toContain('database');
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

// ── AC #11: I/O / permissions error on a present file ────────────────────────
//
// The file is present but `readFileSync` throws (e.g. EACCES). This is not
// "missing" (skip) and not "unparseable" (parse-failure path). It's a real
// I/O error and the check must surface the underlying message verbatim so
// the user can see *why* the file is unreadable.

describe('checkSysinfoConsistency — file present but unreadable (AC #11)', () => {
  it('returns fail + repairable when readFileSync throws (permissions error)', async () => {
    const ioError: SysinfFsReader = {
      existsSync: (p) => p === SYSINFO_PATH,
      readFileSync: () => {
        const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      },
    };
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: '000A27001DCECFB5' }),
      ioError
    );

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(true);
    expect(result.summary).toContain('could not be read');
    expect(result.summary).toContain('EACCES');
    expect(result.details?.filePath).toBe(SYSINFO_PATH);
  });

  it('surfaces non-Error throwables as strings', async () => {
    // Defensive — `catch (err)` coerces non-Error throws to strings.
    const stringThrow: SysinfFsReader = {
      existsSync: () => true,
      readFileSync: () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'EPERM raw';
      },
    };
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: '000A27001DCECFB5' }),
      stringThrow
    );

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(true);
    expect(result.summary).toContain('EPERM raw');
  });
});

// ── AC #2 / #5 / #6 strengthened: summary content + axes payload ─────────────
//
// Pin the parts of the existing happy/sad paths that the broader-stroke
// fold tests didn't already cover:
//   - #2: summary names BOTH verified axes when both pass.
//   - #5: summary names the GUID mismatch with both values WHILE the model
//         axis passes (independent-axes fold).
//   - #6: summary names the model mismatch with both displayNames WHILE the
//         GUID axis passes (the inverse partial-fail).

describe('checkSysinfoConsistency — fold rules pinned (AC #2/#5/#6)', () => {
  const guid = '000A27001DCECFB5';

  it('AC #2: both-axes pass → summary names firewireGuid + model verified', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: guid, model: NANO_2G_MODEL }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('pass');
    expect(result.repairable).toBe(false);
    // Both axis names should appear in the summary parenthetical.
    expect(result.summary).toContain('firewireGuid');
    expect(result.summary).toContain('model');
    expect(result.summary).toContain('matches live device');
    const axes = (result.details?.axes as Array<{ name: string; status: string }>) ?? [];
    expect(axes.find((a) => a.name === 'firewireGuid')?.status).toBe('pass');
    expect(axes.find((a) => a.name === 'model')?.status).toBe('pass');
  });

  it('AC #5: GUID mismatch + model match → fail names GUID mismatch with both values', async () => {
    const live = 'DEADBEEF00001234';
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: live, model: NANO_2G_MODEL }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(true);
    expect(result.summary).toContain('FireWireGUID mismatch');
    expect(result.summary).toContain(guid);
    expect(result.summary).toContain(live);
    // Model axis still passed — it shouldn't appear in the failure summary.
    expect(result.summary).not.toContain('model mismatch');
    const axes = (result.details?.axes as Array<{ name: string; status: string }>) ?? [];
    expect(axes.find((a) => a.name === 'firewireGuid')?.status).toBe('fail');
    expect(axes.find((a) => a.name === 'model')?.status).toBe('pass');
  });

  it('AC #6: GUID match + model mismatch → fail names model mismatch with both displayNames', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: guid, model: NANO_3G_MODEL }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('fail');
    expect(result.repairable).toBe(true);
    expect(result.summary).toContain('model mismatch');
    // Both displayNames present in summary. Note: the on-disk identifier
    // (MA477) resolves to a rich "iPod nano 2GB Silver (2nd Generation)"
    // displayName; the live USB-derived side carries only the generation-
    // level "iPod nano (3rd Generation)".
    expect(result.summary).toContain('iPod nano 2GB Silver (2nd Generation)');
    expect(result.summary).toContain('iPod nano (3rd Generation)');
    // GUID axis passed — it shouldn't appear.
    expect(result.summary).not.toContain('FireWireGUID mismatch');
  });
});

// ── AC #12: FireWireGUID comparator invariants ───────────────────────────────
//
// `normaliseFireWireGuid` uppercases and left-pads to 16 chars; the on-disk
// path is similarly normalised by `extractFromPlist`. Drive the comparator
// with permutations and assert all pass-equivalent forms produce a GUID-axis
// pass.

describe('checkSysinfoConsistency — GUID comparator invariants (AC #12)', () => {
  // Canonical 16-char uppercase, used as on-disk in each permutation.
  const canonical = '000A27001DCECFB5';

  // [label, on-disk-as-written-in-xml, live-as-supplied]
  // Each pair should compare equal after normalisation.
  const equivalentPairs: Array<[string, string, string]> = [
    ['lowercase live vs uppercase on-disk', canonical, canonical.toLowerCase()],
    ['uppercase live vs lowercase on-disk', canonical.toLowerCase(), canonical.toUpperCase()],
    ['mixed-case live vs canonical on-disk', canonical, '000a27001DCEcfb5'],
    // Zero-pad tolerance: live reports a short hex (leading zeros trimmed);
    // on-disk is the canonical 16-char form. `normaliseFireWireGuid` left-pads
    // with zeros, so both should resolve to `00000000DEADBEEF`.
    ['short live vs padded on-disk', '00000000DEADBEEF', 'DEADBEEF'],
    ['short live (lowercase) vs padded on-disk', '00000000DEADBEEF', 'deadbeef'],
    // Inverse direction: padded live, short on-disk. The on-disk side comes
    // from `extractFromPlist` which also pads, so we simulate by writing the
    // short form into the XML — extract will pad it for us.
    ['padded live vs short on-disk (extract pads)', 'DEADBEEF', '00000000DEADBEEF'],
    // 0x prefix is stripped by normaliser.
    ['0x-prefixed live vs canonical on-disk', canonical, `0x${canonical}`],
  ];

  for (const [label, onDisk, live] of equivalentPairs) {
    it(`treats GUIDs as equal: ${label}`, async () => {
      const result = await checkSysinfoConsistency(
        makeCtx({ firewireGuid: live }),
        presentFs(makeSysinfoXml(onDisk))
      );

      const axes = (result.details?.axes as Array<{ name: string; status: string }>) ?? [];
      const guidAxis = axes.find((a) => a.name === 'firewireGuid');
      expect(guidAxis?.status).toBe('pass');
      // Overall status: GUID passes, model axis skipped (no live model) →
      // overall pass.
      expect(result.status).toBe('pass');
    });
  }

  it('still flags genuinely different GUIDs as mismatch', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: '000A27001DCECFB5' }),
      presentFs(makeSysinfoXml('000A27001DCECFB6')) // differs in last hex digit
    );

    expect(result.status).toBe('fail');
    const axes = (result.details?.axes as Array<{ name: string; status: string }>) ?? [];
    expect(axes.find((a) => a.name === 'firewireGuid')?.status).toBe('fail');
  });
});

// ── AC #13: model comparison happens at generation granularity ───────────────
//
// On-disk SysInfoExtended typically resolves to a *rich* IpodModel with
// `capacityGb` + `color` (because `modelNumStr` or serial-suffix encodes
// those). Live USB-derived model carries *only* `generationId` because the
// USB descriptor doesn't reveal capacity/color. The comparator must therefore
// match at `generationId` granularity — anything finer would false-negative
// on every real iPod.

describe('checkSysinfoConsistency — model granularity (AC #13)', () => {
  const guid = '000A27001DCECFB5';

  it('matches when on-disk has full model info (capacity + color) but live carries only generation', async () => {
    // On-disk: modelNumStr MA477 → identify() returns the rich variant
    // "iPod nano 2GB Silver (2nd Generation)" with capacityGb + color.
    // Live: NANO_2G_MODEL — only the generation-level displayName.
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: guid, model: NANO_2G_MODEL }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('pass');
    const axes =
      (result.details?.axes as Array<{
        name: string;
        status: string;
        onDisk?: string;
        live?: string;
      }>) ?? [];
    const modelAxis = axes.find((a) => a.name === 'model');
    expect(modelAxis?.status).toBe('pass');
    // Pin the asymmetry: on-disk displayName is RICHER (capacity + color)
    // than live displayName. They are NOT string-equal. The comparator must
    // be matching on `generationId` only — anything finer would fail this
    // exact configuration on every real iPod with a SysInfoExtended file.
    expect(modelAxis?.onDisk).toBe('iPod nano 2GB Silver (2nd Generation)');
    expect(modelAxis?.live).toBe('iPod nano (2nd Generation)');
    expect(modelAxis?.onDisk).not.toBe(modelAxis?.live);
  });

  it('fails on generation mismatch even when on-disk model is much richer than live', async () => {
    // On-disk: rich nano 2G model. Live: bare nano 3G generation marker.
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: guid, model: NANO_3G_MODEL }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('fail');
    const axes = (result.details?.axes as Array<{ name: string; status: string }>) ?? [];
    expect(axes.find((a) => a.name === 'model')?.status).toBe('fail');
  });

  it('exposes onDiskGenerationId in details for downstream consumers', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: guid, model: NANO_2G_MODEL }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.details?.onDiskGenerationId).toBe('nano_2g');
    // On-disk uses the rich (MA477-resolved) displayName.
    expect(result.details?.onDiskModel).toBe('iPod nano 2GB Silver (2nd Generation)');
    expect(result.details?.onDiskGuid).toBe(guid);
  });
});

// ── Fold-rule explicit pins ──────────────────────────────────────────────────
//
// The summary fold has three branches. Pin each one with at least three tests
// (some reuse cases above; the count here is additive coverage so the fold
// rule itself is exercised in isolation).
//
//   any-axis-fail → overall fail
//   no-fails + ≥1-pass → overall pass
//   all-skip → overall skip

describe('checkSysinfoConsistency — fold rule (any-axis-fail ⇒ fail)', () => {
  const guid = '000A27001DCECFB5';

  it('fails when only the GUID axis fails (model skipped)', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: 'DEADBEEF00001234' }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('fail');
  });

  it('fails when only the model axis fails (GUID skipped)', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ model: NANO_3G_MODEL }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('fail');
  });

  it('fails when both axes fail', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: 'DEADBEEF00001234', model: NANO_3G_MODEL }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('fail');
  });
});

describe('checkSysinfoConsistency — fold rule (no fails + ≥1 pass ⇒ pass)', () => {
  const guid = '000A27001DCECFB5';

  it('passes when only the GUID axis passes (model skipped)', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: guid }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('pass');
  });

  it('passes when only the model axis passes (GUID skipped)', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ model: NANO_2G_MODEL }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('pass');
  });

  it('passes when both axes pass', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({ firewireGuid: guid, model: NANO_2G_MODEL }),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('pass');
  });
});

describe('checkSysinfoConsistency — fold rule (all skip ⇒ skip)', () => {
  const guid = '000A27001DCECFB5';

  it('skips when liveIdentity is undefined (both axes skipped)', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx(undefined),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('skip');
    expect(result.repairable).toBe(false);
    expect(result.summary).toContain('no live data');
  });

  it('skips when live identity is provided but every field is undefined', async () => {
    const result = await checkSysinfoConsistency(
      makeCtx({}),
      presentFs(makeSysinfoXml(guid, { modelNumber: 'MA477' }))
    );

    expect(result.status).toBe('skip');
    expect(result.summary).toContain('no live data');
  });

  it('skips when on-disk model is unresolvable AND no live GUID (model skip + GUID skip)', async () => {
    const xml = makeSysinfoXml(guid, { modelNumber: 'XX999', serial: 'XXX0000000X' });
    const result = await checkSysinfoConsistency(
      makeCtx({ model: NANO_2G_MODEL }), // GUID skipped, model axis sees on-disk unresolvable → skip
      presentFs(xml)
    );

    // Both axes skip → overall skip.
    expect(result.status).toBe('skip');
    const axes = (result.details?.axes as Array<{ name: string; status: string }>) ?? [];
    expect(axes.find((a) => a.name === 'firewireGuid')?.status).toBe('skip');
    expect(axes.find((a) => a.name === 'model')?.status).toBe('skip');
  });
});

// ── Real-persona smoke tests ─────────────────────────────────────────────────
//
// The matrix above is built on synthetic XML so every cell is exercised in
// isolation. We also drive the check end-to-end against a real captured
// persona XML from `@podkit/device-testing` to lock the contract on the
// production parse → identify → axis-compare path. We read the raw XML via
// a relative path because `@podkit/core` cannot take a runtime dep on
// `@podkit/device-testing` (that package depends on `@podkit/core`).
//
// Persona: `ipod-nano-7g-space-gray` — a clean both-axes-pass case.
//   • on-disk: FireWireGUID 000A270024A23E9E, SerialNumber DCYN72R8FJQ1
//     (serial suffix JQ1 → model number E971 → generation nano_7g; the
//     XML has no ModelNumStr field, so the on-disk model resolves via the
//     serial-suffix path)
//   • live: USB productId 0x1267 → generation nano_7g
//
// Persona: `ipod-video-5g-iflash-1tb` — a known model-axis mismatch.
//   The on-disk ModelNumStr `A446` resolves to generation `video_5_5g`
//   (per `tables/model-numbers.ts`), but USB productId `0x1209` resolves
//   to generation `video_5g` (per `tables/usb-ids.ts`). This 5G/5.5G
//   split is intentional — FamilyID 6 covers both — but at generation
//   granularity the comparator will flag them as mismatching. The test
//   pins the current production behaviour; if the model-axis comparison
//   gains "video_5g ≈ video_5_5g" tolerance, this test should flip to
//   asserting `pass` and the production code change must explain why.

const PERSONA_NANO_7G_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../test-packages/device-testing/src/personas/ipod-nano-7g-space-gray'
);
const PERSONA_VIDEO_5G_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../test-packages/device-testing/src/personas/ipod-video-5g-iflash-1tb'
);

describe('checkSysinfoConsistency — real persona fixtures', () => {
  it('nano 7G persona: real captured XML + live USB-derived model both pass', () => {
    const personaXml = readFileSync(join(PERSONA_NANO_7G_DIR, 'raw/sysinfo-extended.xml'), 'utf-8');
    // USB productId 0x1267 → nano_7g. `identify({from:'usb'})` is exactly
    // how the readiness pipeline derives a live model on real hardware.
    const liveModel = identify({ from: 'usb', productId: '0x1267' });
    expect(liveModel?.generationId).toBe('nano_7g');

    const liveIdentity: LiveDeviceIdentity = {
      firewireGuid: '000A270024A23E9E',
      ...(liveModel ? { model: liveModel } : {}),
    };

    return checkSysinfoConsistency(makeCtx(liveIdentity), presentFs(personaXml)).then((result) => {
      expect(result.status).toBe('pass');
      expect(result.repairable).toBe(false);
      const axes = (result.details?.axes as Array<{ name: string; status: string }>) ?? [];
      expect(axes.find((a) => a.name === 'firewireGuid')?.status).toBe('pass');
      expect(axes.find((a) => a.name === 'model')?.status).toBe('pass');
      // On-disk identity was resolved via the serial suffix (the XML has
      // no ModelNumStr field) — pin the extracted GUID to confirm the
      // production extractFromPlist path consumed the persona.
      expect(result.details?.onDiskGuid).toBe('000A270024A23E9E');
      expect(result.details?.onDiskGenerationId).toBe('nano_7g');
    });
  });

  it('video 5G persona: captured XML resolves to video_5_5g (model-axis mismatch vs USB video_5g)', () => {
    // This test documents — but does NOT validate — the known 5G/5.5G
    // asymmetry between the on-disk ModelNumStr table and the USB
    // productId table. See block-level comment above for full context.
    const personaXml = readFileSync(
      join(PERSONA_VIDEO_5G_DIR, 'raw/sysinfo-extended.xml'),
      'utf-8'
    );
    const liveModel = identify({ from: 'usb', productId: '0x1209' });
    expect(liveModel?.generationId).toBe('video_5g');

    const liveIdentity: LiveDeviceIdentity = {
      firewireGuid: '000A27001605D1A0',
      ...(liveModel ? { model: liveModel } : {}),
    };

    return checkSysinfoConsistency(makeCtx(liveIdentity), presentFs(personaXml)).then((result) => {
      // GUID axis passes — the persona's SerialNumber descriptor matches
      // its on-disk SysInfoExtended FireWireGUID (it's the same captured
      // device). The model axis fails because A446 → video_5_5g vs
      // 0x1209 → video_5g. Overall: fail.
      expect(result.status).toBe('fail');
      expect(result.repairable).toBe(true);
      const axes = (result.details?.axes as Array<{ name: string; status: string }>) ?? [];
      expect(axes.find((a) => a.name === 'firewireGuid')?.status).toBe('pass');
      expect(axes.find((a) => a.name === 'model')?.status).toBe('fail');
      // Pin the underlying generationId so a future code change that
      // reconciles 5G/5.5G in the live USB lookup (or relaxes the
      // generation comparison) trips this assertion deliberately.
      expect(result.details?.onDiskGenerationId).toBe('video_5_5g');
    });
  });
});
