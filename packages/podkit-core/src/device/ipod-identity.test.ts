/**
 * Unit tests for `assessIpodIdentity`.
 *
 * Exercises the cascade-driven identity orchestrator without spawning USB I/O:
 * a synthetic mount-point fixture provides whichever combination of SysInfo /
 * SysInfoExtended files we want, and `usbResolver` is stubbed in via opts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assessIpodIdentity,
  ensureSysInfoExtendedAndReassess,
  isIdentityFullyEmpty,
  summariseIdentitySignals,
  type IpodIdentityAssessment,
} from './ipod-identity.js';
import type { CompleteUsbDevice } from './usb-path-resolution.js';
import type { SysInfoExtendedResult } from '@podkit/ipod-firmware';

const NANO_2G_USB: CompleteUsbDevice = {
  vendorId: '05ac',
  productId: '1260',
  serialNumber: 'YM7275YSVQH',
  bus: 20,
  devnum: 5,
};

async function makeMount(opts: { sysInfo?: string; sysInfoExtended?: string }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'ipod-identity-'));
  await mkdir(join(dir, 'iPod_Control', 'Device'), { recursive: true });
  if (opts.sysInfo !== undefined) {
    await writeFile(join(dir, 'iPod_Control', 'Device', 'SysInfo'), opts.sysInfo);
  }
  if (opts.sysInfoExtended !== undefined) {
    await writeFile(join(dir, 'iPod_Control', 'Device', 'SysInfoExtended'), opts.sysInfoExtended);
  }
  return dir;
}

describe('assessIpodIdentity', () => {
  let dir: string | undefined;

  beforeEach(() => {
    dir = undefined;
  });

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('cascades to USB product ID when SysInfo is empty (post-2006 nano 2G case)', async () => {
    dir = await makeMount({ sysInfo: '' });

    const result = await assessIpodIdentity(dir, {
      usbResolver: async () => NANO_2G_USB,
    });

    // Cascade: SIE missing → SysInfo empty (no ModelNumStr) → USB product ID 0x1260 → nano_2g
    expect(result.model).not.toBeNull();
    expect(result.model?.generationId).toBe('nano_2g');
    expect(result.model?.displayName).toContain('nano');
    expect(result.firmwareInquiry).toBe('missing');
    expect(result.usbFingerprint).toEqual(NANO_2G_USB);
    expect(result.capabilities).not.toBeNull();
    // nano 2G supports artwork (176x132)
    expect(result.capabilities?.artworkSources).toContain('database');
    expect(result.capabilities?.artworkMaxResolution).toBe(176);
    expect(result.capabilities?.supportsVideo).toBe(false);
    // checksumType: none for nano 2G
    expect(result.checksumType).toBe('none');
    expect(result.needsChecksum).toBe(false);
  });

  it('reports `unwritable` firmware-inquiry state when USB cannot be resolved', async () => {
    dir = await makeMount({ sysInfo: '' });

    const result = await assessIpodIdentity(dir, {
      usbResolver: async () => null,
    });

    expect(result.firmwareInquiry).toBe('unwritable');
    expect(result.usbFingerprint).toBeNull();
    // No USB → no productId → no cascade match → no model
    expect(result.model).toBeNull();
    expect(result.capabilities).toBeNull();
  });

  it('reports `present` when SysInfoExtended is on disk and parseable', async () => {
    // A minimal valid SysInfoExtended plist with FireWireGUID + SerialNumber.
    const sieXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>FireWireGUID</key>
  <string>000A27001A0647CB</string>
  <key>SerialNumber</key>
  <string>YM7275YSVQH</string>
</dict>
</plist>
`;
    dir = await makeMount({ sysInfo: '', sysInfoExtended: sieXml });

    const result = await assessIpodIdentity(dir, {
      usbResolver: async () => NANO_2G_USB,
    });

    expect(result.firmwareInquiry).toBe('present');
    expect(result.existing?.firewireGuid).toBe('000A27001A0647CB');
    // Cascade picks up serial → variant model (nano 2G 4GB green via VQH suffix).
    expect(result.model).not.toBeNull();
    expect(result.model?.generationId).toBe('nano_2g');
  });

  it('uses classic SysInfo ModelNumStr when SIE is missing', async () => {
    // mini 2G ModelNumStr in classic SysInfo, no SIE on disk, no USB.
    dir = await makeMount({ sysInfo: 'ModelNumStr: P9804\nFirmwareVersionStr: 1.3\n' });

    const result = await assessIpodIdentity(dir, {
      usbResolver: async () => null,
    });

    // Cascade: ModelNumStr P9804 → mini 2G variant
    expect(result.model).not.toBeNull();
    expect(result.model?.generationId).toBe('mini_2g');
    expect(result.firmwareInquiry).toBe('unwritable');
    expect(result.sysInfoModelNumber).toBe('P9804');
  });

  it('flags hash-based generations as `needsChecksum`', async () => {
    // nano 4G requires hash58 checksums.
    dir = await makeMount({ sysInfo: 'ModelNumStr: B754\n' });

    const result = await assessIpodIdentity(dir, {
      usbResolver: async () => null,
    });

    expect(result.checksumType).toBe('hash58');
    expect(result.needsChecksum).toBe(true);
  });
});

describe('ensureSysInfoExtendedAndReassess', () => {
  function makeBaseAssessment(
    overrides: Partial<IpodIdentityAssessment> = {}
  ): IpodIdentityAssessment {
    return {
      model: null,
      capabilities: null,
      needsChecksum: false,
      checksumType: undefined,
      firmwareInquiry: 'missing',
      existing: null,
      usbFingerprint: NANO_2G_USB,
      sysInfoModelNumber: undefined,
      ...overrides,
    };
  }

  const writeSuccess: SysInfoExtendedResult = {
    present: true,
    source: 'usb-read',
    identity: { firewireGuid: '000A27001A0647CB', serialNumber: 'YM7275YSVQH' },
  };

  const writeFailure: SysInfoExtendedResult = {
    present: false,
    source: 'unavailable',
    identity: {},
    error: 'SCSI transport returned data but it could not be parsed',
  };

  it('is a no-op when the input assessment lacks a usbFingerprint', async () => {
    const input = makeBaseAssessment({ usbFingerprint: null });
    let writeCalled = false;
    let assessCalled = false;

    const result = await ensureSysInfoExtendedAndReassess('/fake/mount', input, {
      ensureSysInfoExtended: async () => {
        writeCalled = true;
        return writeSuccess;
      },
      assessIdentity: async () => {
        assessCalled = true;
        return input;
      },
    });

    expect(result.assessment).toBe(input);
    expect(result.firmwareWritten).toBe(false);
    expect(result.sysInfoWriteError).toBeUndefined();
    expect(writeCalled).toBe(false);
    expect(assessCalled).toBe(false);
  });

  it('writes SIE, re-assesses, and returns updated assessment on success', async () => {
    const input = makeBaseAssessment();
    const reassessed = makeBaseAssessment({
      firmwareInquiry: 'present',
      sysInfoModelNumber: 'A1199',
    });
    const captured: { writeMount?: string; writeFp?: unknown; reassessMount?: string } = {};

    const result = await ensureSysInfoExtendedAndReassess('/fake/mount', input, {
      ensureSysInfoExtended: async (mp, fp) => {
        captured.writeMount = mp;
        captured.writeFp = fp;
        return writeSuccess;
      },
      assessIdentity: async (mp) => {
        captured.reassessMount = mp;
        return reassessed;
      },
    });

    expect(captured.writeMount).toBe('/fake/mount');
    expect(captured.writeFp).toBe(NANO_2G_USB);
    expect(captured.reassessMount).toBe('/fake/mount');
    expect(result.firmwareWritten).toBe(true);
    expect(result.assessment).toBe(reassessed);
    expect(result.sysInfoWriteError).toBeUndefined();
  });

  it('returns sysInfoWriteError and leaves assessment unchanged on write failure', async () => {
    const input = makeBaseAssessment();
    let assessCalled = false;

    const result = await ensureSysInfoExtendedAndReassess('/fake/mount', input, {
      ensureSysInfoExtended: async () => writeFailure,
      assessIdentity: async () => {
        assessCalled = true;
        return input;
      },
    });

    expect(result.firmwareWritten).toBe(false);
    expect(result.assessment).toBe(input);
    expect(result.sysInfoWriteError).toBe(
      'SCSI transport returned data but it could not be parsed'
    );
    expect(assessCalled).toBe(false);
  });

  it('falls back to "unknown error" when the write result has no error string', async () => {
    const input = makeBaseAssessment();
    const result = await ensureSysInfoExtendedAndReassess('/fake/mount', input, {
      ensureSysInfoExtended: async () => ({
        present: false,
        source: 'unavailable',
        identity: {},
      }),
    });
    expect(result.sysInfoWriteError).toBe('unknown error');
  });
});

describe('isIdentityFullyEmpty', () => {
  function makeAssessment(overrides: Partial<IpodIdentityAssessment> = {}): IpodIdentityAssessment {
    return {
      model: null,
      capabilities: null,
      needsChecksum: false,
      checksumType: undefined,
      firmwareInquiry: 'unwritable',
      existing: null,
      usbFingerprint: null,
      sysInfoModelNumber: undefined,
      ...overrides,
    };
  }

  it('returns true when nothing was resolved: unwritable + no model + no USB + no SysInfo + no --type', () => {
    expect(isIdentityFullyEmpty(makeAssessment())).toBe(true);
  });

  it('returns true when the assessment itself is null and no --type was given', () => {
    expect(isIdentityFullyEmpty(null)).toBe(true);
  });

  it('returns false when assessment is null but --type was given', () => {
    expect(isIdentityFullyEmpty(null, 'ipod')).toBe(false);
  });

  it('returns false when a USB fingerprint was resolved (partial cascade)', () => {
    expect(isIdentityFullyEmpty(makeAssessment({ usbFingerprint: NANO_2G_USB }))).toBe(false);
  });

  it('returns false when classic SysInfo ModelNumStr was read off disk', () => {
    expect(isIdentityFullyEmpty(makeAssessment({ sysInfoModelNumber: 'MA147' }))).toBe(false);
  });

  it('returns false when the cascade resolved a model', () => {
    expect(
      isIdentityFullyEmpty(
        makeAssessment({
          model: {
            displayName: 'iPod nano (2nd Generation)',
            generationId: 'nano_2g',
            checksumType: 'none',
            source: 'usb',
          },
        })
      )
    ).toBe(false);
  });

  it('returns false when firmwareInquiry is "missing" (USB inquiry possible)', () => {
    expect(
      isIdentityFullyEmpty(
        makeAssessment({ firmwareInquiry: 'missing', usbFingerprint: NANO_2G_USB })
      )
    ).toBe(false);
  });

  it('returns false when firmwareInquiry is "present" (SysInfoExtended on disk)', () => {
    expect(isIdentityFullyEmpty(makeAssessment({ firmwareInquiry: 'present' }))).toBe(false);
  });

  it('returns false when --type was supplied, regardless of cascade emptiness', () => {
    expect(isIdentityFullyEmpty(makeAssessment(), 'ipod')).toBe(false);
    expect(isIdentityFullyEmpty(makeAssessment(), 'echo-mini')).toBe(false);
  });
});

describe('summariseIdentitySignals', () => {
  it('returns all-false when assessment is null and no --type was given', () => {
    expect(summariseIdentitySignals(null)).toEqual({
      hasModel: false,
      hasSysInfoModelNumber: false,
      hasUsbFingerprint: false,
      hasSysInfoExtended: false,
      hasUserType: false,
    });
  });

  it('flips hasUserType when --type is given', () => {
    expect(summariseIdentitySignals(null, 'ipod').hasUserType).toBe(true);
  });

  it('correctly identifies present vs missing signals for a partial cascade', () => {
    const assessment: IpodIdentityAssessment = {
      model: null,
      capabilities: null,
      needsChecksum: false,
      checksumType: undefined,
      firmwareInquiry: 'unwritable',
      existing: null,
      usbFingerprint: NANO_2G_USB,
      sysInfoModelNumber: undefined,
    };
    const sig = summariseIdentitySignals(assessment);
    expect(sig.hasUsbFingerprint).toBe(true);
    expect(sig.hasSysInfoModelNumber).toBe(false);
    expect(sig.hasSysInfoExtended).toBe(false);
    expect(sig.hasModel).toBe(false);
  });

  it('correctly identifies signals for a healthy iPod on re-add with SysInfoExtended but no USB', () => {
    const assessment: IpodIdentityAssessment = {
      model: {
        displayName: 'iPod nano (2nd Generation)',
        generationId: 'nano_2g',
        checksumType: 'none',
        source: 'sysinfo',
      },
      capabilities: {
        artworkSources: ['database'],
        artworkMaxResolution: 176,
        supportedAudioCodecs: ['aac', 'mp3'],
        supportsVideo: false,
        audioNormalization: 'soundcheck',
        supportsAlbumArtistBrowsing: false,
      },
      needsChecksum: false,
      checksumType: 'none',
      firmwareInquiry: 'present',
      existing: {
        present: true,
        firewireGuid: '000A27001A0647CB',
        identity: {
          firewireGuid: '000A27001A0647CB',
          serialNumber: 'ABC123',
          modelNumStr: 'MA147',
          familyId: 1,
        },
        source: 'existing',
      },
      usbFingerprint: null,
      sysInfoModelNumber: undefined,
    };
    const sig = summariseIdentitySignals(assessment);
    expect(sig.hasSysInfoExtended).toBe(true);
    expect(sig.hasModel).toBe(true);
    expect(sig.hasUsbFingerprint).toBe(false);
    expect(sig.hasSysInfoModelNumber).toBe(false);
  });
});
