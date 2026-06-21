import { describe, it, expect } from 'bun:test';
import type { IpodIdentityAssessment } from '@podkit/core';
import { OutputContext } from '../../output/index.js';
import { BufferSink } from '../../test-utils/buffer-sink.js';
import { offerFirmwareInquiry } from './add-firmware-inquiry.js';

function makeOut(): { out: OutputContext; stdout: BufferSink; stderr: BufferSink } {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const out = OutputContext.fromGlobalOpts(
    { json: false, quiet: false, verbose: 0, color: false, tips: false, tty: false },
    {},
    { stdout, stderr }
  );
  return { out, stdout, stderr };
}

function assessment(partial: Partial<IpodIdentityAssessment> = {}): IpodIdentityAssessment {
  return {
    model: null,
    capabilities: null,
    needsChecksum: false,
    checksumType: undefined,
    firmwareInquiry: 'present',
    existing: null,
    usbFingerprint: null,
    sysInfoModelNumber: undefined,
    ...partial,
  };
}

describe('offerFirmwareInquiry — prompt flow (interactive)', () => {
  it('shows the SYSINFO_MISSING prompt lines when SIE missing + not unsupported + flag not opted-out', async () => {
    const { out, stdout } = makeOut();
    const result = await offerFirmwareInquiry({
      assessment: assessment({ firmwareInquiry: 'missing' }),
      autoConfirm: false,
      recordUnsupported: false,
      out,
      name: 'mypod',
      mountPoint: '/Volumes/iPod',
      confirmFn: async () => true,
      deps: { runInquiry: async (_mp, a) => ({ assessment: a, firmwareWritten: true }) },
    });
    expect(result.proceed).toBe(true);
    const text = stdout.text();
    expect(text).toContain('SysInfo/SysInfoExtended is missing');
    expect(text).toContain('podkit can read it from the device firmware');
  });

  it('uses the "Add ... and write SysInfoExtended?" prompt when offer is true', async () => {
    let promptShown = '';
    const { out } = makeOut();
    await offerFirmwareInquiry({
      assessment: assessment({ firmwareInquiry: 'missing' }),
      autoConfirm: false,
      recordUnsupported: false,
      out,
      name: 'mypod',
      mountPoint: '/Volumes/iPod',
      confirmFn: async (msg) => {
        promptShown = msg;
        return true;
      },
      deps: { runInquiry: async (_mp, a) => ({ assessment: a, firmwareWritten: true }) },
    });
    expect(promptShown).toBe('Add this iPod as "mypod" and write SysInfoExtended?');
  });

  it('uses the plain "Add ..." prompt when offer is false (no SIE write context)', async () => {
    let promptShown = '';
    const { out } = makeOut();
    await offerFirmwareInquiry({
      assessment: assessment({ firmwareInquiry: 'present' }),
      autoConfirm: false,
      recordUnsupported: false,
      out,
      name: 'mypod',
      mountPoint: '/Volumes/iPod',
      confirmFn: async (msg) => {
        promptShown = msg;
        return true;
      },
    });
    expect(promptShown).toBe('Add this iPod as "mypod"?');
  });

  it('returns proceed: false when the user declines + prints Cancelled', async () => {
    const { out, stdout } = makeOut();
    const result = await offerFirmwareInquiry({
      assessment: assessment({ firmwareInquiry: 'missing' }),
      autoConfirm: false,
      recordUnsupported: false,
      out,
      name: 'mypod',
      mountPoint: '/Volumes/iPod',
      confirmFn: async () => false,
    });
    expect(result.proceed).toBe(false);
    expect(stdout.text()).toContain('Cancelled. No changes made.');
  });

  it('does NOT call runInquiry when user declines', async () => {
    let inquiryCalls = 0;
    const { out } = makeOut();
    await offerFirmwareInquiry({
      assessment: assessment({ firmwareInquiry: 'missing' }),
      autoConfirm: false,
      recordUnsupported: false,
      out,
      name: 'mypod',
      mountPoint: '/Volumes/iPod',
      confirmFn: async () => false,
      deps: {
        runInquiry: async (_mp, a) => {
          inquiryCalls++;
          return { assessment: a, firmwareWritten: true };
        },
      },
    });
    expect(inquiryCalls).toBe(0);
  });
});

describe('offerFirmwareInquiry — recordUnsupported skip', () => {
  it('does NOT offer SIE when the user already acknowledged the device is unsupported', async () => {
    let inquiryCalls = 0;
    let promptShown = '';
    const { out } = makeOut();
    const result = await offerFirmwareInquiry({
      assessment: assessment({ firmwareInquiry: 'missing' }),
      autoConfirm: false,
      recordUnsupported: true,
      out,
      name: 'mypod',
      mountPoint: '/Volumes/iPod',
      confirmFn: async (msg) => {
        promptShown = msg;
        return true;
      },
      deps: {
        runInquiry: async (_mp, a) => {
          inquiryCalls++;
          return { assessment: a, firmwareWritten: true };
        },
      },
    });
    expect(result.proceed).toBe(true);
    expect(promptShown).toBe('Add this iPod as "mypod"?');
    expect(inquiryCalls).toBe(0);
    expect(result.proceed && result.firmwareWritten).toBe(false);
  });
});

describe('offerFirmwareInquiry — autoConfirm', () => {
  it('skips the prompt entirely when autoConfirm=true (no confirmFn call)', async () => {
    let confirmCalls = 0;
    const { out } = makeOut();
    const result = await offerFirmwareInquiry({
      assessment: assessment({ firmwareInquiry: 'missing' }),
      autoConfirm: true,
      recordUnsupported: false,
      out,
      name: 'mypod',
      mountPoint: '/Volumes/iPod',
      confirmFn: async () => {
        confirmCalls++;
        return false;
      },
      deps: { runInquiry: async (_mp, a) => ({ assessment: a, firmwareWritten: true }) },
    });
    expect(confirmCalls).toBe(0);
    expect(result.proceed).toBe(true);
  });

  it('still runs the inquiry on autoConfirm if SIE is missing (slick path)', async () => {
    let inquiryCalls = 0;
    const { out } = makeOut();
    const result = await offerFirmwareInquiry({
      assessment: assessment({ firmwareInquiry: 'missing' }),
      autoConfirm: true,
      recordUnsupported: false,
      out,
      name: 'mypod',
      mountPoint: '/Volumes/iPod',
      confirmFn: async () => false,
      deps: {
        runInquiry: async (_mp, a) => {
          inquiryCalls++;
          return { assessment: a, firmwareWritten: true };
        },
      },
    });
    expect(inquiryCalls).toBe(1);
    expect(result.proceed && result.firmwareWritten).toBe(true);
  });
});

describe('offerFirmwareInquiry — inquiry result handling', () => {
  it('threads the updated assessment back to the caller', async () => {
    const before = assessment({ firmwareInquiry: 'missing', sysInfoModelNumber: 'BEFORE' });
    const after = assessment({ firmwareInquiry: 'present', sysInfoModelNumber: 'AFTER' });
    const { out } = makeOut();
    const result = await offerFirmwareInquiry({
      assessment: before,
      autoConfirm: true,
      recordUnsupported: false,
      out,
      name: 'mypod',
      mountPoint: '/Volumes/iPod',
      confirmFn: async () => true,
      deps: { runInquiry: async () => ({ assessment: after, firmwareWritten: true }) },
    });
    expect(result.proceed && result.assessment?.sysInfoModelNumber).toBe('AFTER');
  });

  it('surfaces sysInfoWriteError as a non-fatal warning + retry hint', async () => {
    const { out, stdout, stderr } = makeOut();
    const result = await offerFirmwareInquiry({
      assessment: assessment({ firmwareInquiry: 'missing' }),
      autoConfirm: true,
      recordUnsupported: false,
      out,
      name: 'mypod',
      mountPoint: '/Volumes/iPod',
      confirmFn: async () => true,
      deps: {
        runInquiry: async (_mp, a) => ({
          assessment: a,
          firmwareWritten: false,
          sysInfoWriteError: 'USB inquiry refused by kernel',
        }),
      },
    });
    expect(result.proceed).toBe(true);
    // Warning → stderr.
    expect(stderr.text()).toContain(
      'Failed to read SysInfoExtended from USB: USB inquiry refused by kernel'
    );
    // Retry hint → stdout (out.print, not out.warn).
    expect(stdout.text()).toContain('Run `podkit doctor --repair sysinfo-extended` to retry.');
  });
});

describe('offerFirmwareInquiry — null assessment', () => {
  it('proceeds with the plain prompt (no SIE) when assessment is null', async () => {
    let inquiryCalls = 0;
    let promptShown = '';
    const { out } = makeOut();
    const result = await offerFirmwareInquiry({
      assessment: null,
      autoConfirm: false,
      recordUnsupported: false,
      out,
      name: 'mypod',
      mountPoint: '/Volumes/iPod',
      confirmFn: async (msg) => {
        promptShown = msg;
        return true;
      },
      deps: {
        runInquiry: async (_mp, a) => {
          inquiryCalls++;
          return { assessment: a, firmwareWritten: true };
        },
      },
    });
    expect(result.proceed).toBe(true);
    expect(promptShown).toBe('Add this iPod as "mypod"?');
    expect(inquiryCalls).toBe(0);
  });
});
