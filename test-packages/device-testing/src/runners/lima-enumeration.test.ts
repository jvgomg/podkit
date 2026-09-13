/**
 * Unit tests for the persona enumeration waits.
 *
 * These waits sit in every VM test's setup hook, so their failure behaviour is
 * what a developer actually reads when the harness goes wrong. Two properties
 * matter and neither is visible from the happy path:
 *
 *   1. Every probe is individually bounded. A poll loop that checks its
 *      deadline between iterations is not bounded at all if one iteration
 *      never returns — and each iteration opens an SSH session.
 *   2. A timeout says what the harness could not do, and names the resource
 *      that was most likely missing.
 *
 * Driven through a scripted `SubprocessRunner`; no VM involved.
 */

import { describe, it, expect } from 'bun:test';

import { waitForScsiGenericEnumeration, waitForUsbEnumeration } from './lima-enumeration.js';
import type { DevicePersona } from '../personas/types.js';
import type { SubprocessRunner, SubprocessRunOpts, SubprocessRunResult } from '../subprocess.js';
import { createLimactlLink } from '@podkit/lima';

// ---------------------------------------------------------------------------
// Substrate link over a scripted runner
//
// The harness talks to a `SubstrateLink`, never to `limactl` directly — so the
// seam the assertions below record is the link's argv. Building a limactl link
// over the scripted runner keeps those assertions pinning exactly what a real
// Lima substrate receives, which is the point: they are what a second
// implementation has to reproduce.
// ---------------------------------------------------------------------------

/**
 * A runner that fails the test if anything reaches it. The default for cases
 * whose whole point is that a host-side guard fires BEFORE the substrate is
 * touched — "no runner in scope" would otherwise read as "no assertion".
 */
const neverReached: SubprocessRunner = {
  async run(command, args) {
    throw new Error(`unexpected substrate call: ${command} ${args.join(' ')}`);
  },
};

const linkTo = (instanceName: string, subprocess: SubprocessRunner = neverReached) =>
  createLimactlLink({ id: instanceName, instanceName }, { subprocess });

// ---------------------------------------------------------------------------
// Scripted runner
// ---------------------------------------------------------------------------

interface Call {
  args: string[];
  opts?: SubprocessRunOpts;
}

/**
 * Runner that answers each `limactl` invocation from `respond`. Records every
 * call so the tests can inspect the bounds that were requested.
 */
function makeRunner(
  respond: (call: Call, index: number) => SubprocessRunResult | Promise<SubprocessRunResult>
): { runner: SubprocessRunner; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    runner: {
      async run(_command, args, opts) {
        const call: Call = { args, opts };
        calls.push(call);
        return respond(call, calls.length - 1);
      },
    },
  };
}

const EMPTY: SubprocessRunResult = { stdout: '', stderr: '', exitCode: 0 };

/** Minimal persona stand-in — only the fields the waits read. */
const persona = {
  id: 'ipod-nano-7g-blue',
  usbDescriptor: { vendorId: 0x05ac, productId: 0x1209 },
} as unknown as DevicePersona;

/** Recognise the probe that polls for a SCSI generic node. */
function isScsiProbe(call: Call): boolean {
  return call.args.some((a) => a.includes('/dev/sg*'));
}

/** Recognise the probe that walks sysfs for an enumerated USB device. */
function isUsbProbe(call: Call): boolean {
  return call.args.some((a) => a.includes('idVendor'));
}

// ---------------------------------------------------------------------------
// waitForScsiGenericEnumeration
// ---------------------------------------------------------------------------

describe('waitForScsiGenericEnumeration', () => {
  it('returns as soon as a node appears', async () => {
    const { runner, calls } = makeRunner(() => ({ ...EMPTY, stdout: '/dev/sg0\n' }));
    await waitForScsiGenericEnumeration({
      link: linkTo('podkit-device', runner),
      personaId: 'echo-mini',
    });
    expect(calls).toHaveLength(1);
  });

  it('bounds each probe by the time left on the deadline', async () => {
    const { runner, calls } = makeRunner((call) => (isScsiProbe(call) ? EMPTY : EMPTY));
    await expect(
      waitForScsiGenericEnumeration({
        link: linkTo('podkit-device', runner),
        personaId: 'echo-mini',
        timeoutMs: 300,
      })
    ).rejects.toThrow(/timed out after 300ms/);

    for (const call of calls.filter(isScsiProbe)) {
      expect(call.opts?.timeoutMs).toBeGreaterThan(0);
      // Never longer than the floor a near-expired deadline is given.
      expect(call.opts?.timeoutMs).toBeLessThanOrEqual(2_000);
    }
  });

  it('treats a probe that never answered as "not yet" and keeps its deadline', async () => {
    // The bound firing rejects the underlying call. That must be absorbed into
    // the poll rather than escaping as an unrelated transport error — the
    // caller's timeout is the error that explains what went wrong.
    const { runner } = makeRunner(() => {
      throw new Error('limactl shell podkit-device timed out after 2000ms');
    });
    await expect(
      waitForScsiGenericEnumeration({
        link: linkTo('podkit-device', runner),
        personaId: 'echo-mini',
        timeoutMs: 200,
      })
    ).rejects.toThrow(/timed out after 200ms waiting for \/dev\/sg\*/);
  });

  it('reports the controller budget alongside the timeout', async () => {
    // A gadget that never enumerates is usually a gadget that never got a
    // controller. Saying so at the point of failure is the whole diagnostic.
    const { runner } = makeRunner((call) => {
      if (isScsiProbe(call)) return EMPTY;
      if (call.args.some((a) => a.includes('usb_gadget'))) {
        return {
          ...EMPTY,
          stdout: [
            'udc dummy_udc.0',
            'udc dummy_udc.1',
            'slots 2',
            'claim podkit-ghost-a dummy_udc.0',
            'claim podkit-ghost-b dummy_udc.1',
          ].join('\n'),
        };
      }
      return EMPTY;
    });

    const err = await waitForScsiGenericEnumeration({
      link: linkTo('podkit-device', runner),
      personaId: 'echo-mini',
      timeoutMs: 200,
    }).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('dummy_hcd slots: 0/2 free');
    expect((err as Error).message).toContain('podkit-ghost-a');
  });
});

// ---------------------------------------------------------------------------
// waitForUsbEnumeration
// ---------------------------------------------------------------------------

describe('waitForUsbEnumeration', () => {
  it('matches the persona on lower-case 4-hex sysfs ids', async () => {
    const { runner, calls } = makeRunner((call) =>
      isUsbProbe(call) ? { ...EMPTY, stdout: 'MATCH\n' } : EMPTY
    );
    await waitForUsbEnumeration({ link: linkTo('podkit-device', runner), persona });
    expect(calls[0]?.args.join(' ')).toContain("= '05ac'");
    expect(calls[0]?.args.join(' ')).toContain("= '1209'");
  });

  it('bounds each probe', async () => {
    const { runner, calls } = makeRunner(() => EMPTY);
    await expect(
      waitForUsbEnumeration({
        link: linkTo('podkit-device', runner),
        persona,
        timeoutMs: 300,
      })
    ).rejects.toThrow(/timed out after 300ms/);

    for (const call of calls.filter(isUsbProbe)) {
      expect(call.opts?.timeoutMs).toBeGreaterThan(0);
      expect(call.opts?.timeoutMs).toBeLessThanOrEqual(2_000);
    }
  });

  it('names the persona and the vid:pid it was waiting for', async () => {
    const { runner } = makeRunner(() => EMPTY);
    const err = await waitForUsbEnumeration({
      link: linkTo('podkit-device', runner),
      persona,
      timeoutMs: 200,
    }).catch((e: Error) => e);
    expect((err as Error).message).toContain('05ac:1209');
    expect((err as Error).message).toContain('ipod-nano-7g-blue');
  });
});
