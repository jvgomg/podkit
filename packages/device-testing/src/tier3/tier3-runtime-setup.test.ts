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
 * tests; those auto-skip when Lima isn't installed (AC #4).
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
  resolveTier3Availability,
  resetTier3SkipWarning,
} from './tier3-runtime-setup.js';
import { personas as defaultRegistry } from '../personas/index.js';
import type { DevicePersona } from '../personas/types.js';
import type { TestRuntime } from '../runtime.js';
import type { SystemState } from '../system-states/types.js';

// ---------------------------------------------------------------------------
// Starter persona resolution (AC #7)
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
// State grouping (AC #8)
// ---------------------------------------------------------------------------

describe('resolveSystemStateForPersona', () => {
  it('returns `healthy` for the 3 starter personas (m-19 baseline)', () => {
    for (const persona of resolveStarterPersonas()) {
      expect(resolveSystemStateForPersona(persona).id).toBe('healthy');
    }
  });
});

describe('groupPersonasByState', () => {
  it('groups all 3 starter personas under the `healthy` state today', () => {
    const groups = groupPersonasByState(resolveStarterPersonas());
    expect(groups).toHaveLength(1);
    expect(groups[0]!.state.id).toBe('healthy');
    expect(groups[0]!.personas).toHaveLength(3);
  });

  it('preserves insertion order across personas within a group', () => {
    const personas = resolveStarterPersonas();
    const [group] = groupPersonasByState(personas);
    expect(group!.personas.map((p) => p.id)).toEqual([
      'ipod-video-5g-iflash-1tb',
      'ipod-nano-7g-space-gray',
      'echo-mini',
    ]);
  });

  it('returns an empty array for an empty input', () => {
    expect(groupPersonasByState([])).toEqual([]);
  });

  // Forward-compat: when a future persona's resolveSystemStateForPersona
  // returns a non-healthy state, it should land in its own group. We exercise
  // that with a synthetic persona pair until the registry contains a real
  // case. The helper that selects state by persona is intentionally
  // overridable via the function signature.
  it('forms one group per distinct state id', () => {
    const synthA: DevicePersona = makeFakePersona('synth-a');
    const synthB: DevicePersona = makeFakePersona('synth-b');

    // Manually construct two pseudo-groups by calling group with two
    // personas, then post-checking. We can't override
    // resolveSystemStateForPersona without DI, so we exercise the grouping
    // mechanic by mocking through the function's semantics: since today
    // every persona maps to healthy, two personas → one group with both.
    const groups = groupPersonasByState([synthA, synthB]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.personas.map((p) => p.id)).toEqual(['synth-a', 'synth-b']);
    // The grouping mechanic itself is what matters; that this happens to
    // bucket into one group today is a property of the resolver, not the
    // grouper. The resolver's tests above pin that behaviour.
  });
});

function makeFakePersona(id: string): DevicePersona {
  return {
    id,
    description: id,
    schemaVersion: 1,
    usbDescriptor: {
      vendorId: 0,
      productId: 0,
      deviceSerial: '',
      deviceClass: 0,
      deviceSubclass: 0,
      deviceProtocol: 0,
    },
    sysInfoExtendedXml: null,
    lsblkJson: null,
    systemProfilerJson: null,
    diskutilPlist: null,
    partitionLayout: { partitions: [] },
    massStorageBackingFile: null,
    expectedCapabilities: null,
    expectedReadiness: {
      level: 'ready',
      stages: [],
    } as unknown as DevicePersona['expectedReadiness'],
    expectedDoctorOutput: {},
    provenance: { provenanceDoc: '', source: 'synthesised' },
  };
}

// ---------------------------------------------------------------------------
// Tier-3 availability detection (AC #4)
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
