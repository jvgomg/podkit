/**
 * Unit tests for the Tier-3 runtime setup helpers.
 *
 * Tier 3 vs Tier 1/2 distinction:
 *   - Tier 1: injectable transports (pure TS, runs everywhere).
 *   - Tier 2: native subprocesses against canned fixtures (per-host suffix).
 *   - Tier 3: Linux VM + dummy_hcd + FunctionFS daemon (macOS dev hosts via Lima).
 *
 * **This file** tests the *setup helpers themselves* — persona resolution,
 * state grouping, availability detection. It runs unconditionally on every
 * host because it doesn't touch a real VM (uses fake runtimes).
 *
 * The companion `personas-baseline.tier3.test.ts` contains the actual Tier-3
 * tests; those auto-skip when Lima isn't installed.
 *
 * Test grouping convention (standard for all Tier-3 tests):
 *   personas are grouped by `SystemState`, `applyState()` runs once per group
 *   (not once per test) — see ADR-016 §"Test speed strategy".
 */

import { describe, it, expect, beforeEach } from 'bun:test';

import {
  STARTER_PERSONA_IDS,
  STARTER_PERSONA_ID_LIST,
  resolveStarterPersonas,
  resolveSystemStateForPersona,
  groupPersonasByState,
  hasDaemonPayload,
  resolveTier3Availability,
  resetTier3SkipWarning,
  resetTier3PersonaSkipWarnings,
  formatPersonaSkipWarning,
} from './tier3-runtime-setup.js';
import { personas as defaultRegistry } from '../personas/index.js';
import type { DevicePersona } from '../personas/types.js';
import type { TestRuntime } from '../runtime.js';
import type { SystemState } from '../system-states/types.js';

// ---------------------------------------------------------------------------
// Starter persona resolution
// ---------------------------------------------------------------------------

describe('STARTER_PERSONA_ID_LIST', () => {
  it('contains the 3 starter ids in stable order', () => {
    expect(STARTER_PERSONA_ID_LIST).toEqual([
      STARTER_PERSONA_IDS.ipodVideo5g,
      STARTER_PERSONA_IDS.ipodNano7g,
      STARTER_PERSONA_IDS.echoMini,
    ]);
    expect(STARTER_PERSONA_ID_LIST).toHaveLength(3);
  });

  it('covers SCSI-fallback, USB-inquiry, and mass-storage paths', () => {
    expect(STARTER_PERSONA_IDS.ipodVideo5g).toBe('ipod-video-5g-iflash-1tb');
    expect(STARTER_PERSONA_IDS.ipodNano7g).toBe('ipod-nano-7g-space-gray');
    expect(STARTER_PERSONA_IDS.echoMini).toBe('echo-mini');
  });
});

describe('resolveStarterPersonas', () => {
  it('returns the 3 personas from the default registry', () => {
    const result = resolveStarterPersonas();
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.id)).toEqual([
      'ipod-video-5g-iflash-1tb',
      'ipod-nano-7g-space-gray',
      'echo-mini',
    ]);
  });

  it('every starter id exists in the default registry', () => {
    for (const id of STARTER_PERSONA_ID_LIST) {
      expect(defaultRegistry.has(id)).toBe(true);
    }
  });

  it('throws if a starter id is missing from the registry', () => {
    const truncated = new Map(defaultRegistry);
    truncated.delete('echo-mini');
    expect(() => resolveStarterPersonas(truncated)).toThrow(/echo-mini/);
  });
});

// ---------------------------------------------------------------------------
// State grouping
// ---------------------------------------------------------------------------

describe('resolveSystemStateForPersona', () => {
  it('returns `healthy` for the 3 starter personas', () => {
    for (const persona of resolveStarterPersonas()) {
      expect(resolveSystemStateForPersona(persona).id).toBe('healthy');
    }
  });
});

describe('groupPersonasByState', () => {
  beforeEach(() => {
    resetTier3PersonaSkipWarnings();
  });

  it('groups all 3 starter personas under the `healthy` state', () => {
    // Every starter persona has daemon payload, so the grouper retains all three.
    const groups = groupPersonasByState(resolveStarterPersonas(), () => {});
    expect(groups).toHaveLength(1);
    expect(groups[0]!.state.id).toBe('healthy');
    expect(groups[0]!.personas.map((p) => p.id)).toEqual([
      'ipod-video-5g-iflash-1tb',
      'ipod-nano-7g-space-gray',
      'echo-mini',
    ]);
  });

  it('does NOT drop `echo-mini` (echo-mini carries massStorageBackingFile)', () => {
    // echo-mini was populated with an in-VM synthesis recipe. The daemon-
    // payload filter remains in place as a tripwire for future bare personas;
    // this assertion confirms the tripwire no longer trips on the starter set.
    const warnings: string[] = [];
    const groups = groupPersonasByState(resolveStarterPersonas(), (m) => warnings.push(m));
    const idsInGroups = groups.flatMap((g) => g.personas.map((p) => p.id));
    expect(idsInGroups).toContain('echo-mini');
    expect(warnings).toEqual([]);
  });

  it('preserves insertion order across personas within a group', () => {
    const personas = resolveStarterPersonas();
    const [group] = groupPersonasByState(personas, () => {});
    expect(group!.personas.map((p) => p.id)).toEqual([
      'ipod-video-5g-iflash-1tb',
      'ipod-nano-7g-space-gray',
      'echo-mini',
    ]);
  });

  it('returns an empty array for an empty input', () => {
    expect(groupPersonasByState([])).toEqual([]);
  });

  it('forms one group per distinct state id', () => {
    // Two synthetic personas with daemon payload so they survive the filter
    // — today every persona maps to healthy, so they bucket together.
    const synthA = makeFakePersona('synth-a', { sysInfoExtendedXml: '<xml/>' });
    const synthB = makeFakePersona('synth-b', { sysInfoExtendedXml: '<xml/>' });

    const groups = groupPersonasByState([synthA, synthB], () => {});
    expect(groups).toHaveLength(1);
    expect(groups[0]!.personas.map((p) => p.id)).toEqual(['synth-a', 'synth-b']);
  });
});

// ---------------------------------------------------------------------------
// Daemon-payload filter
// ---------------------------------------------------------------------------

describe('hasDaemonPayload', () => {
  it('returns false when both fields are null', () => {
    expect(hasDaemonPayload(makeFakePersona('bare'))).toBe(false);
  });

  it('returns true when only `sysInfoExtendedXml` is set', () => {
    expect(hasDaemonPayload(makeFakePersona('xml-only', { sysInfoExtendedXml: '<xml/>' }))).toBe(
      true
    );
  });

  it('returns true when only `massStorageBackingFile` is set', () => {
    expect(
      hasDaemonPayload(
        makeFakePersona('backing-only', {
          massStorageBackingFile: {
            synthesis: { sizeMiB: 1, filesystem: 'FAT32', label: 'X', files: [] },
            resetStrategy: 'copy-on-write',
          } as unknown as DevicePersona['massStorageBackingFile'],
        })
      )
    ).toBe(true);
  });

  it('returns true when both are set', () => {
    expect(
      hasDaemonPayload(
        makeFakePersona('both', {
          sysInfoExtendedXml: '<xml/>',
          massStorageBackingFile: {
            synthesis: { sizeMiB: 1, filesystem: 'FAT32', label: 'X', files: [] },
            resetStrategy: 'copy-on-write',
          } as unknown as DevicePersona['massStorageBackingFile'],
        })
      )
    ).toBe(true);
  });
});

describe('groupPersonasByState daemon-payload filter', () => {
  beforeEach(() => {
    resetTier3PersonaSkipWarnings();
  });

  it('excludes a synthetic persona with both fields null', () => {
    const warnings: string[] = [];
    const groups = groupPersonasByState([makeFakePersona('bare')], (m) => warnings.push(m));
    expect(groups).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it('includes a synthetic persona with only `sysInfoExtendedXml` set', () => {
    const warnings: string[] = [];
    const groups = groupPersonasByState(
      [makeFakePersona('xml-only', { sysInfoExtendedXml: '<xml/>' })],
      (m) => warnings.push(m)
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.personas.map((p) => p.id)).toEqual(['xml-only']);
    expect(warnings).toEqual([]);
  });

  it('includes a synthetic persona with only `massStorageBackingFile` set', () => {
    const warnings: string[] = [];
    const groups = groupPersonasByState(
      [
        makeFakePersona('backing-only', {
          massStorageBackingFile: {
            synthesis: { sizeMiB: 1, filesystem: 'FAT32', label: 'X', files: [] },
            resetStrategy: 'copy-on-write',
          } as unknown as DevicePersona['massStorageBackingFile'],
        }),
      ],
      (m) => warnings.push(m)
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.personas.map((p) => p.id)).toEqual(['backing-only']);
    expect(warnings).toEqual([]);
  });

  it('warning text names the persona id, the null fields, and the remediation hint', () => {
    const warnings: string[] = [];
    groupPersonasByState([makeFakePersona('drop-me')], (m) => warnings.push(m));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'drop-me'");
    expect(warnings[0]).toContain('sysInfoExtendedXml=null');
    expect(warnings[0]).toContain('massStorageBackingFile=null');
    expect(warnings[0]).toMatch(/populate sysInfoExtendedXml or massStorageBackingFile/);
  });

  it('emits one warning per excluded persona on first invocation', () => {
    const warnings: string[] = [];
    groupPersonasByState(
      [makeFakePersona('drop-a'), makeFakePersona('drop-b'), makeFakePersona('drop-c')],
      (m) => warnings.push(m)
    );
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain("'drop-a'");
    expect(warnings[1]).toContain("'drop-b'");
    expect(warnings[2]).toContain("'drop-c'");
  });

  it('subsequent calls in the same session do not re-emit for the same persona', () => {
    const warnings: string[] = [];
    const bare = makeFakePersona('repeat-me');
    groupPersonasByState([bare], (m) => warnings.push(m));
    groupPersonasByState([bare], (m) => warnings.push(m));
    groupPersonasByState([bare], (m) => warnings.push(m));
    expect(warnings).toHaveLength(1);
  });

  it('dedupe key is the persona id (different ids both emit)', () => {
    const warnings: string[] = [];
    groupPersonasByState([makeFakePersona('alpha')], (m) => warnings.push(m));
    groupPersonasByState([makeFakePersona('beta')], (m) => warnings.push(m));
    // Re-emit alpha — should be silent on second call.
    groupPersonasByState([makeFakePersona('alpha')], (m) => warnings.push(m));
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("'alpha'");
    expect(warnings[1]).toContain("'beta'");
  });

  it('resetTier3PersonaSkipWarnings restores fresh emission state', () => {
    const warnings: string[] = [];
    const bare = makeFakePersona('cycle-me');
    groupPersonasByState([bare], (m) => warnings.push(m));
    expect(warnings).toHaveLength(1);

    resetTier3PersonaSkipWarnings();

    groupPersonasByState([bare], (m) => warnings.push(m));
    expect(warnings).toHaveLength(2);
  });
});

describe('formatPersonaSkipWarning', () => {
  it('lists every null field in the message body', () => {
    const msg = formatPersonaSkipWarning(makeFakePersona('zonked'));
    expect(msg).toContain("'zonked'");
    expect(msg).toContain('sysInfoExtendedXml=null');
    expect(msg).toContain('massStorageBackingFile=null');
    expect(msg).toMatch(/populate sysInfoExtendedXml or massStorageBackingFile/);
  });
});

function makeFakePersona(id: string, overrides: Partial<DevicePersona> = {}): DevicePersona {
  return {
    id,
    description: id,
    schemaVersion: 2,
    usbDescriptor: {
      vendorId: 0,
      productId: 0,
      deviceSerial: null,
      deviceClass: 0,
      deviceSubclass: 0,
      deviceProtocol: 0,
      bMaxPacketSize0: 64,
      bcdUSB: 0x0200,
      bcdDevice: 0x0001,
      bNumConfigurations: 1,
      configurations: [
        {
          bConfigurationValue: 1,
          bNumInterfaces: 1,
          bmAttributes: 0x80,
          bMaxPower: 0xfa,
          interfaces: [
            {
              bInterfaceNumber: 0,
              bAlternateSetting: 0,
              bInterfaceClass: 0x08,
              bInterfaceSubClass: 0x06,
              bInterfaceProtocol: 0x50,
              endpoints: [],
            },
          ],
        },
      ],
      stringDescriptors: {},
    },
    sysInfoExtendedXml: null,
    lsblkJson: null,
    systemProfilerJson: null,
    diskutilPlist: null,
    partitionLayout: { luns: [{ lun: 0, partitions: [] }] },
    massStorageBackingFile: null,
    expectedCapabilities: null,
    expectedReadiness: {
      level: 'ready',
      stages: [],
    } as unknown as DevicePersona['expectedReadiness'],
    expectedDoctorOutput: {},
    provenance: { provenanceDoc: '', source: 'synthesised' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tier-3 availability detection
// ---------------------------------------------------------------------------

function fakeRuntime(opts: {
  available: boolean | (() => Promise<boolean>);
  throwOnAvailability?: boolean;
}): TestRuntime {
  return {
    id: 'lima-test-vm',
    async isAvailable() {
      if (opts.throwOnAvailability) throw new Error('boom');
      if (typeof opts.available === 'function') return opts.available();
      return opts.available;
    },
    async prepare() {},
    async applyState(_state: SystemState) {
      void _state;
    },
    async run() {
      return { stdout: '', stderr: '', exitCode: 0, signal: null };
    },
    async teardown() {},
  };
}

describe('resolveTier3Availability', () => {
  const optedIn = { PODKIT_DEVTEST_RUN_TIER3: '1' } as const;
  const optedOut = {} as const;

  beforeEach(() => {
    resetTier3SkipWarning();
  });

  it('returns true when opted in and the runner is available', async () => {
    const warnings: string[] = [];
    const result = await resolveTier3Availability(
      fakeRuntime({ available: true }),
      (m) => warnings.push(m),
      optedIn
    );
    expect(result).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('returns false and emits a warning when the env var is unset (default)', async () => {
    const warnings: string[] = [];
    const result = await resolveTier3Availability(
      fakeRuntime({ available: true }), // runner IS available; gate is the env var
      (m) => warnings.push(m),
      optedOut
    );
    expect(result).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('PODKIT_DEVTEST_RUN_TIER3=1');
  });

  it('returns false when opted in but the runner is unavailable', async () => {
    const warnings: string[] = [];
    const result = await resolveTier3Availability(
      fakeRuntime({ available: false }),
      (m) => warnings.push(m),
      optedIn
    );
    expect(result).toBe(false);
    expect(warnings).toEqual([
      '[tier-3] Linux VM not available — skipping device integration tests',
    ]);
  });

  it('only emits the warning once per test session (idempotent)', async () => {
    const warnings: string[] = [];
    const rt = fakeRuntime({ available: false });
    await resolveTier3Availability(rt, (m) => warnings.push(m), optedIn);
    await resolveTier3Availability(rt, (m) => warnings.push(m), optedIn);
    await resolveTier3Availability(rt, (m) => warnings.push(m), optedIn);
    expect(warnings).toHaveLength(1);
  });

  it('returns false (and does not throw) when isAvailable() throws', async () => {
    const warnings: string[] = [];
    const result = await resolveTier3Availability(
      fakeRuntime({ available: false, throwOnAvailability: true }),
      (m) => warnings.push(m),
      optedIn
    );
    expect(result).toBe(false);
    expect(warnings).toHaveLength(1);
  });
});
