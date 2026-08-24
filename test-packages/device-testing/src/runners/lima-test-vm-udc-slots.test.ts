/**
 * Unit tests for USB device-controller slot accounting.
 *
 * The behaviour under test is a judgement call made from sysfs and configfs
 * readings, so the tests are written against the probe's record stream rather
 * than against a live VM. The most important case is the negative one: a
 * controller that reads `configured` after being cleanly released must NOT be
 * counted as occupied, because that reading latches on `dummy_hcd` and never
 * clears.
 */

import { describe, it, expect } from 'bun:test';

import {
  formatUdcSlotFailure,
  formatUdcSlotShortfall,
  formatUdcSlotSummary,
  formatUdcSlotWarning,
  parseUdcSlotProbe,
  probeUdcSlots,
} from './lima-test-vm-udc-slots.js';
import type { SubprocessRunner, SubprocessRunOpts, SubprocessRunResult } from '../subprocess.js';

// ---------------------------------------------------------------------------
// Probe record-stream fixtures
// ---------------------------------------------------------------------------

const FOUR_SLOTS = ['udc dummy_udc.0', 'udc dummy_udc.1', 'udc dummy_udc.2', 'udc dummy_udc.3'];

function stream(...lines: string[]): string {
  return `${[...FOUR_SLOTS, 'slots 4', ...lines].join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// parseUdcSlotProbe
// ---------------------------------------------------------------------------

describe('parseUdcSlotProbe', () => {
  it('reports every controller free when no gadget claims one', () => {
    const report = parseUdcSlotProbe(stream());
    expect(report.udcs).toEqual(['dummy_udc.0', 'dummy_udc.1', 'dummy_udc.2', 'dummy_udc.3']);
    expect(report.configuredSlots).toBe(4);
    expect(report.claims).toEqual([]);
    expect(report.orphans).toEqual([]);
    expect(report.free).toHaveLength(4);
  });

  it('counts a claim backed by a live daemon as in use, not leaked', () => {
    const report = parseUdcSlotProbe(
      stream('claim podkit-ipod-nano-7g-blue dummy_udc.1', 'active ipod-nano-7g-blue')
    );
    expect(report.claims).toHaveLength(1);
    expect(report.claims[0]).toMatchObject({
      gadget: 'podkit-ipod-nano-7g-blue',
      udc: 'dummy_udc.1',
      personaId: 'ipod-nano-7g-blue',
      daemonActive: true,
    });
    expect(report.orphans).toEqual([]);
    expect(report.free).toEqual(['dummy_udc.0', 'dummy_udc.2', 'dummy_udc.3']);
  });

  it('counts a claim with no daemon behind it as leaked', () => {
    const report = parseUdcSlotProbe(stream('claim podkit-ipod-nano-7g-blue dummy_udc.1'));
    expect(report.orphans).toHaveLength(1);
    expect(report.orphans[0]?.udc).toBe('dummy_udc.1');
    expect(report.free).toHaveLength(3);
  });

  it('does not infer occupancy from controllers that no gadget names', () => {
    // The probe deliberately never reports `/sys/class/udc/<n>/state`: on
    // dummy_hcd it latches at `configured` after the first bind and stays
    // there for the life of the VM. A run that used two controllers and
    // released both leaves no claim records at all — and must read as fully
    // free, however many controllers have latched.
    const report = parseUdcSlotProbe(stream());
    expect(report.free).toHaveLength(4);
    expect(formatUdcSlotFailure(report)).toBeNull();
    expect(formatUdcSlotWarning(report)).toBeNull();
  });

  it('tolerates a gadget directory that does not carry the persona prefix', () => {
    const report = parseUdcSlotProbe(stream('claim some-other-gadget dummy_udc.0'));
    expect(report.claims[0]?.personaId).toBeNull();
    expect(report.orphans).toHaveLength(1);
  });

  it('ignores blank lines and unrecognised records', () => {
    const report = parseUdcSlotProbe(`${stream('noise here', '')}\n\n`);
    expect(report.udcs).toHaveLength(4);
    expect(report.claims).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Failure / warning rendering
// ---------------------------------------------------------------------------

describe('formatUdcSlotFailure', () => {
  it('stays silent while a controller remains free', () => {
    const report = parseUdcSlotProbe(stream('claim podkit-a dummy_udc.0'));
    expect(formatUdcSlotFailure(report)).toBeNull();
  });

  it('names every leaked binding once the budget is exhausted', () => {
    const report = parseUdcSlotProbe(
      stream(
        'claim podkit-a dummy_udc.0',
        'claim podkit-b dummy_udc.1',
        'claim podkit-c dummy_udc.2',
        'claim podkit-d dummy_udc.3',
        'active a'
      )
    );
    const failure = formatUdcSlotFailure(report);
    expect(failure).toContain('All 4 dummy_hcd slots are claimed');
    expect(failure).toContain('3 of');
    expect(failure).toContain('podkit-b');
    expect(failure).toContain('podkit-d');
    expect(failure).not.toContain('podkit-a (no daemon running)');
  });

  it('distinguishes exhaustion by live daemons from exhaustion by leaks', () => {
    const report = parseUdcSlotProbe(
      stream(
        'claim podkit-a dummy_udc.0',
        'claim podkit-b dummy_udc.1',
        'claim podkit-c dummy_udc.2',
        'claim podkit-d dummy_udc.3',
        'active a',
        'active b',
        'active c',
        'active d'
      )
    );
    const failure = formatUdcSlotFailure(report);
    expect(failure).toContain('in use by live daemons');
    expect(failure).toContain('Another VM test run');
  });

  it('reports an absent gadget subsystem rather than dividing by nothing', () => {
    const report = parseUdcSlotProbe('slots 4\n');
    expect(formatUdcSlotFailure(report)).toContain('`dummy_hcd` module is not loaded');
  });
});

describe('formatUdcSlotWarning', () => {
  it('flags a leak that has not yet exhausted the budget', () => {
    const report = parseUdcSlotProbe(stream('claim podkit-a dummy_udc.0'));
    const warning = formatUdcSlotWarning(report);
    expect(warning).toContain('1 of 4');
    expect(warning).toContain('dummy_udc.0←podkit-a');
  });

  it('defers to the failure message when nothing is free', () => {
    const report = parseUdcSlotProbe(
      stream(
        'claim podkit-a dummy_udc.0',
        'claim podkit-b dummy_udc.1',
        'claim podkit-c dummy_udc.2',
        'claim podkit-d dummy_udc.3'
      )
    );
    expect(formatUdcSlotWarning(report)).toBeNull();
  });
});

describe('formatUdcSlotShortfall', () => {
  it('flags controllers that failed to register', () => {
    const report = parseUdcSlotProbe('udc dummy_udc.1\nudc dummy_udc.2\nslots 4\n');
    expect(formatUdcSlotShortfall(report)).toContain('Only 2 of the 4 configured');
  });

  it('stays silent when the count matches', () => {
    expect(formatUdcSlotShortfall(parseUdcSlotProbe(stream()))).toBeNull();
  });

  it('stays silent when the configured count is unknown', () => {
    const report = parseUdcSlotProbe(FOUR_SLOTS.join('\n'));
    expect(report.configuredSlots).toBeNull();
    expect(formatUdcSlotShortfall(report)).toBeNull();
  });
});

describe('formatUdcSlotSummary', () => {
  it('reads as a one-line banner', () => {
    const report = parseUdcSlotProbe(stream('claim podkit-a dummy_udc.0'));
    expect(formatUdcSlotSummary(report)).toBe('dummy_hcd slots: 3/4 free (1 in use, 1 leaked)');
  });
});

// ---------------------------------------------------------------------------
// probeUdcSlots
// ---------------------------------------------------------------------------

function scriptedRunner(result: SubprocessRunResult | Error): {
  runner: SubprocessRunner;
  calls: { args: string[]; opts?: SubprocessRunOpts }[];
} {
  const calls: { args: string[]; opts?: SubprocessRunOpts }[] = [];
  return {
    calls,
    runner: {
      async run(_command, args, opts) {
        calls.push({ args, opts });
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
}

describe('probeUdcSlots', () => {
  it('reads the VM in a single bounded shell invocation', async () => {
    const { runner, calls } = scriptedRunner({ stdout: stream(), stderr: '', exitCode: 0 });
    const report = await probeUdcSlots({ vmName: 'podkit-device', subprocess: runner });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args.slice(0, 4)).toEqual(['shell', 'podkit-device', '--', 'sh']);
    expect(calls[0]?.opts?.timeoutMs).toBeGreaterThan(0);
    expect(report.free).toHaveLength(4);
  });

  it('fails loudly when the probe itself cannot run', async () => {
    const { runner } = scriptedRunner({ stdout: '', stderr: 'boom', exitCode: 1 });
    await expect(probeUdcSlots({ vmName: 'podkit-device', subprocess: runner })).rejects.toThrow(
      /could not read UDC state in podkit-device.*boom/s
    );
  });

  it('requires a VM name', async () => {
    const { runner } = scriptedRunner({ stdout: '', stderr: '', exitCode: 0 });
    await expect(probeUdcSlots({ vmName: '', subprocess: runner })).rejects.toThrow(
      /vmName is required/
    );
  });
});
