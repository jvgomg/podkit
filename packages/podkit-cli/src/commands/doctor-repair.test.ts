/**
 * Tests for `commands/doctor-repair.ts`.
 *
 * Pins two contracts in particular:
 *
 *  1. `preflightCascadeRefusal` throws `CliError(INCOMPATIBLE_DEVICE_TYPE)`
 *     with the typed `unsupported` payload + the printText fallback the
 *     CLI's iPod `--repair` path uses for its user-facing render.
 *
 *  2. The CLI's iPod `runRepair` path NEVER calls `IpodDatabase.open` on
 *     a cascade-unsupported device. This is the load-bearing reason the
 *     preflight runs BEFORE the db open at all: opening libgpod against
 *     SQLite-based unsupported generations (hashAB nano 6/7, shuffle
 *     3/4, iOS) risks corrupting on-device state.
 */

import { describe, it, expect } from 'bun:test';
import type { DiagnosticCheck, IpodIdentityAssessment } from '@podkit/core';
import type { ReadinessUnsupportedReason } from '@podkit/device-types';
import { OutputContext } from '../output/index.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
import { CliError } from '../errors.js';
import { preflightCascadeRefusal } from './doctor-repair.js';
import { runRepair } from './doctor.js';

const UNSUPPORTED_REASON: ReadinessUnsupportedReason = {
  kind: 'ios-device',
  headline: 'iOS device not supported by podkit.',
  details: ['Use Apple Music / Finder to sync this device.'],
  docsUrl: 'https://example.test/docs/supported-devices',
};

function makeFakeCheck(opts: { id?: string } = {}): DiagnosticCheck {
  return {
    id: opts.id ?? 'fake-check',
    name: 'Fake Check',
    scope: 'database-health',
    applicableTo: ['ipod'],
    check: async () => ({ status: 'pass', summary: '', repairable: true }),
    repair: {
      description: 'fake repair',
      requirements: ['database'], // Forces IpodDatabase.open to be a candidate.
      run: async () => ({ success: true, summary: 'fake done' }),
    },
  };
}

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

describe('preflightCascadeRefusal', () => {
  it('throws CliError(INCOMPATIBLE_DEVICE_TYPE) with the typed payload on a refused device', async () => {
    const check = makeFakeCheck();
    let thrown: unknown;
    try {
      await preflightCascadeRefusal(
        check,
        { deviceType: 'ipod', mountPoint: '/Volumes/iPod' },
        {
          assessIpodIdentity: async () =>
            ({
              model: { unsupportedReason: UNSUPPORTED_REASON },
            }) as unknown as IpodIdentityAssessment,
        }
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(CliError);
    if (thrown instanceof CliError) {
      expect(thrown.code).toBe('INCOMPATIBLE_DEVICE_TYPE');
      expect(thrown.message).toBe(UNSUPPORTED_REASON.headline);
      expect(thrown.details).toEqual({ checkId: 'fake-check', unsupported: UNSUPPORTED_REASON });
    }
  });

  it('returns silently for a supported device', async () => {
    const check = makeFakeCheck();
    await expect(
      preflightCascadeRefusal(
        check,
        { deviceType: 'ipod', mountPoint: '/Volumes/iPod' },
        {
          assessIpodIdentity: async () =>
            ({ model: { unsupportedReason: undefined } }) as unknown as IpodIdentityAssessment,
        }
      )
    ).resolves.toBeUndefined();
  });

  it('returns silently for non-iPod ctx', async () => {
    const check = makeFakeCheck();
    let assessCalls = 0;
    await preflightCascadeRefusal(
      check,
      { deviceType: 'mass-storage', mountPoint: '/Volumes/EchoMini' },
      {
        assessIpodIdentity: async () => {
          assessCalls++;
          return {} as IpodIdentityAssessment;
        },
      }
    );
    expect(assessCalls).toBe(0);
  });

  it('returns silently when assessIpodIdentity throws (best-effort I/O)', async () => {
    const check = makeFakeCheck();
    await expect(
      preflightCascadeRefusal(
        check,
        { deviceType: 'ipod', mountPoint: '/Volumes/iPod' },
        {
          assessIpodIdentity: async () => {
            throw new Error('USB unavailable');
          },
        }
      )
    ).resolves.toBeUndefined();
  });

  it("threads the reason's printText through so the CLI renders headline + details + See:", async () => {
    const check = makeFakeCheck();
    let thrown: CliError | undefined;
    try {
      await preflightCascadeRefusal(
        check,
        { deviceType: 'ipod', mountPoint: '/Volumes/iPod' },
        {
          assessIpodIdentity: async () =>
            ({
              model: { unsupportedReason: UNSUPPORTED_REASON },
            }) as unknown as IpodIdentityAssessment,
        }
      );
    } catch (err) {
      thrown = err as CliError;
    }
    expect(thrown?.printText).toBeDefined();

    // Drive the printText fallback against a buffered out and assert the
    // rendered shape matches the historical inline preflight output.
    const { out, stdout, stderr } = makeOut();
    thrown!.printText!(out);
    expect(stderr.text()).toContain(UNSUPPORTED_REASON.headline);
    expect(stdout.text()).toContain('Use Apple Music / Finder to sync this device.');
    expect(stdout.text()).toContain(`See: ${UNSUPPORTED_REASON.docsUrl}`);
  });
});

describe('runRepair — refusal short-circuits IpodDatabase.open', () => {
  it('throws BEFORE calling IpodDatabase.open on a cascade-refused device', async () => {
    // This is the load-bearing contract: opening libgpod against SQLite-
    // based unsupported generations (hashAB nano 6/7, shuffle 3/4, iOS)
    // risks corrupting on-device state, so the refusal must fire before
    // any open call. If a future edit reorders the preflight after the
    // open, this test fails loudly.
    let openCalls = 0;
    let thrown: CliError | undefined;
    const check = makeFakeCheck(); // requirements includes 'database'

    const fakeIpodDatabase = {
      open: async () => {
        openCalls++;
        return { trackCount: 0, close: () => {}, getInfo: () => ({}) } as unknown as Awaited<
          ReturnType<typeof import('@podkit/core').IpodDatabase.open>
        >;
      },
    };

    const fakeCore = {
      assessIpodIdentity: async () =>
        ({ model: { unsupportedReason: UNSUPPORTED_REASON } }) as unknown as IpodIdentityAssessment,
      IpodDatabase: fakeIpodDatabase,
      DOCS_URLS: { supportedDevices: 'https://example.test/supported-devices' },
    };

    const { out } = makeOut();
    try {
      await runRepair(
        '/Volumes/iPod',
        check as unknown as NonNullable<
          ReturnType<typeof import('@podkit/core').getDiagnosticCheck>
        >,
        { dryRun: false },
        out,
        { music: {} } as ReturnType<typeof import('../context.js').getContext>['config'],
        {
          loadCore: async () => fakeCore as unknown as typeof import('@podkit/core'),
          // Thread the refused assessment in via the explicit seam so the
          // preflight uses it instead of the real assessIpodIdentity.
          assessIpodIdentity: async () =>
            ({
              model: { unsupportedReason: UNSUPPORTED_REASON },
            }) as unknown as IpodIdentityAssessment,
        }
      );
    } catch (err) {
      thrown = err as CliError;
    }
    expect(thrown).toBeInstanceOf(CliError);
    expect(thrown?.code).toBe('INCOMPATIBLE_DEVICE_TYPE');
    expect(openCalls).toBe(0);
  });

  it('never invokes the repair pipeline for a non-database check on a cascade-refused device (darwin)', async () => {
    // Gap: the IpodDatabase.open sentinel only catches db-requiring repairs.
    // A check with no 'database' requirement (e.g. sysinfo-consistency) would
    // skip db.open entirely and reach runRepairPipeline unchecked.
    // This test uses requirements:[] and tracks repair.run directly — proving
    // preflightCascadeRefusal fires before runRepairPipeline regardless of
    // whether a database is needed.
    let repairRunCalls = 0;
    const check: ReturnType<typeof makeFakeCheck> = {
      id: 'sysinfo-no-db',
      name: 'Sysinfo No DB',
      scope: 'database-health',
      applicableTo: ['ipod'],
      check: async () => ({ status: 'pass', summary: '', repairable: true }),
      repair: {
        description: 'no-db repair',
        requirements: [], // No 'database' — IpodDatabase.open is never a candidate.
        run: async () => {
          repairRunCalls++;
          return { success: true, summary: 'done' };
        },
      },
    };

    const fakeCore = {
      IpodDatabase: {
        open: async () => {
          throw new Error('IpodDatabase.open must not be called');
        },
      },
      DOCS_URLS: { supportedDevices: 'https://example.test/supported-devices' },
    };

    const { out } = makeOut();
    let thrown: CliError | undefined;
    try {
      await runRepair(
        '/Volumes/iPod',
        check as unknown as NonNullable<
          ReturnType<typeof import('@podkit/core').getDiagnosticCheck>
        >,
        { dryRun: false },
        out,
        { music: {} } as ReturnType<typeof import('../context.js').getContext>['config'],
        {
          loadCore: async () => fakeCore as unknown as typeof import('@podkit/core'),
          assessIpodIdentity: async () =>
            ({
              model: { unsupportedReason: UNSUPPORTED_REASON },
            }) as unknown as IpodIdentityAssessment,
        }
      );
    } catch (err) {
      thrown = err as CliError;
    }

    expect(thrown).toBeInstanceOf(CliError);
    expect(thrown?.code).toBe('INCOMPATIBLE_DEVICE_TYPE');
    // The repair.run must never have been reached — the preflight threw first.
    expect(repairRunCalls).toBe(0);
  });

  it('still calls IpodDatabase.open when the device is supported', async () => {
    let openCalls = 0;
    const check = makeFakeCheck();

    const fakeIpodDatabase = {
      open: async () => {
        openCalls++;
        return { trackCount: 0, close: () => {}, getInfo: () => ({}) } as unknown as Awaited<
          ReturnType<typeof import('@podkit/core').IpodDatabase.open>
        >;
      },
    };

    const fakeCore = {
      IpodDatabase: fakeIpodDatabase,
      DOCS_URLS: { supportedDevices: 'https://example.test/supported-devices' },
    };

    const { out } = makeOut();
    await runRepair(
      '/Volumes/iPod',
      check as unknown as NonNullable<ReturnType<typeof import('@podkit/core').getDiagnosticCheck>>,
      { dryRun: false },
      out,
      { music: {} } as ReturnType<typeof import('../context.js').getContext>['config'],
      {
        loadCore: async () => fakeCore as unknown as typeof import('@podkit/core'),
        assessIpodIdentity: async () =>
          ({
            model: { unsupportedReason: undefined },
          }) as unknown as IpodIdentityAssessment,
      }
    );
    expect(openCalls).toBe(1);
  });
});
