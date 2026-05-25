/**
 * VM runtime setup helpers.
 *
 * Shared scaffolding for the `*.e2e.test.ts` files. Three jobs:
 *
 *   1. Detect VM availability via the `lima-test-vm` runner's
 *      `isAvailable()`. The test files use the cached boolean to
 *      `describe.skipIf` themselves on hosts without Lima.
 *   2. Group personas by required `SystemState`, filtering out any persona
 *      that has no daemon payload (`sysInfoExtendedXml === null &&
 *      massStorageBackingFile === null`). Filtering at grouping time keeps
 *      `withPersona()` from being called for personas the daemon's sidecar
 *      builder also drops — see the mirror logic in
 *      `personas/sidecar-build.ts`. VM tests are organised so
 *      `applyState()` runs once per group, not once per test (the cornerstone
 *      of ADR-016 §"Test speed strategy").
 *   3. Resolve the starter persona list.
 *
 * # Test grouping convention (standard for all VM test files)
 *
 * Every VM test file must:
 *
 *   - Call {@link resolveVmAvailability} at module top level and stash the
 *     boolean in a const (e.g. `const vmAvailable = await …`).
 *   - Apply `describe.skipIf(!vmAvailable)` to every VM `describe`.
 *   - Group `it()` blocks under a parent `describe` per `SystemState`. The
 *     setup file's `beforeAll` for the group calls `runtime.applyState(state)`
 *     once; per-test cost should be sub-second.
 *   - Use the {@link STARTER_PERSONA_IDS} constant — never inline raw persona ids.
 *
 * # Assertion families wired in `personas-baseline.e2e.test.ts`
 *
 *   - Device-scan finds the synthesised persona; lsusb cross-checks
 *     vendor/product (FunctionFS descriptor handshake).
 *   - Doctor `--scope system --json` agrees with the `SystemState` fixture.
 *
 * @module
 */

import type { DevicePersona } from '../personas/types.js';
import { personas as defaultRegistry } from '../personas/index.js';
import type { SystemState, SystemStateId } from '../system-states/types.js';
import { healthy } from '../system-states/healthy.js';
import type { TestRuntime } from '../runtime.js';
import { limaTestVmRunner } from '../runners/lima-test-vm.js';

// ---------------------------------------------------------------------------
// Starter persona list
// ---------------------------------------------------------------------------

/** Stable iteration order: ids of the 3 starter personas the original spec called out. */
export const STARTER_PERSONA_IDS = [
  'ipod-video-5g-iflash-1tb', // SCSI-fallback inquiry path
  'ipod-nano-7g-space-gray', // USB-inquiry path
  'echo-mini', // mass-storage path
] as const;

/**
 * Resolve the 3 starter `DevicePersona` objects from a registry.
 * @throws if any id is missing — that's a programming error.
 */
export function resolveStarterPersonas(
  registry: ReadonlyMap<string, DevicePersona> = defaultRegistry
): readonly DevicePersona[] {
  return STARTER_PERSONA_IDS.map((id) => {
    const persona = registry.get(id);
    if (!persona) {
      throw new Error(
        `VM starter persona '${id}' missing from registry. ` +
          `Update STARTER_PERSONA_IDS in vm-runtime-setup.ts.`
      );
    }
    return persona;
  });
}

// ---------------------------------------------------------------------------
// Persona-by-state grouping
// ---------------------------------------------------------------------------

/**
 * A group of personas that share a required `SystemState`. The VM runner
 * calls `applyState(state)` once per group, then runs every persona's tests.
 */
export interface PersonaStateGroup {
  state: SystemState;
  personas: readonly DevicePersona[];
}

/**
 * Resolve the `SystemState` required by a persona's tests.
 *
 * Today every starter persona uses `healthy` — the baseline tests verify the
 * happy path. Future doctor-coverage tests will introduce personas that pair
 * with `no-ffmpeg`, `no-libgpod`, etc. The function exists as the extension
 * point so a future persona with a different state slot naturally lands in a
 * new group without restructuring callers.
 */
export function resolveSystemStateForPersona(persona: DevicePersona): SystemState {
  // No persona currently overrides healthy; baseline tests are happy-path.
  void persona;
  return healthy;
}

/**
 * Returns `true` when `persona` has data the dummy-hcd-daemon can serve.
 *
 * The daemon's personas sidecar drops any persona where both
 * `sysInfoExtendedXml` and `massStorageBackingFile` are `null` (see
 * `personas/sidecar-build.ts`). Calling `withPersona()` for such a persona
 * exits the daemon with `persona "<id>" not in sidecar`, which would fail
 * every test in the persona's group.
 *
 * {@link groupPersonasByState} uses this gate to drop the persona at
 * grouping time instead of letting it reach `withPersona()`. Today no
 * starter persona trips this filter; it stays as a tripwire for future
 * bare personas added without a daemon payload.
 */
export function hasDaemonPayload(persona: DevicePersona): boolean {
  return persona.sysInfoExtendedXml !== null || persona.massStorageBackingFile !== null;
}

/**
 * Tracks personas that have already triggered a "no daemon payload" warning
 * in this session. Keyed by persona id so the dedupe is per-persona, not
 * per-process — adding a new bare persona later in the same `bun test` run
 * still emits its warning. Reset via {@link resetVmPersonaSkipWarnings}
 * for parallel test isolation.
 */
const vmPersonaSkipWarningsEmitted = new Set<string>();

/**
 * Reset the once-per-session per-persona skip warnings emitted by
 * {@link groupPersonasByState}. Tests only — never call from production.
 */
export function resetVmPersonaSkipWarnings(): void {
  vmPersonaSkipWarningsEmitted.clear();
}

/**
 * Build the "persona dropped" stderr line for a persona that fails
 * {@link hasDaemonPayload}. Exported so unit tests can assert against the
 * exact text.
 */
export function formatPersonaSkipWarning(persona: DevicePersona): string {
  const nullFields: string[] = [];
  if (persona.sysInfoExtendedXml === null) nullFields.push('sysInfoExtendedXml=null');
  if (persona.massStorageBackingFile === null) nullFields.push('massStorageBackingFile=null');
  return (
    `[vm] persona '${persona.id}' has no daemon payload (` +
    nullFields.join(', ') +
    `); skipping — populate sysInfoExtendedXml or massStorageBackingFile to enable`
  );
}

/**
 * Group `personas` by their required `SystemState`. The returned array's
 * entries iterate in a stable order: groups appear in the order their first
 * persona was inserted.
 *
 * Personas where {@link hasDaemonPayload} is `false` are dropped before
 * grouping — see the module header. The first time a given persona is dropped
 * in this session, `warn` is called with a single line naming the persona id,
 * the null fields, and the remediation hint.
 * Subsequent calls in the same session are silent for that persona.
 *
 * `warn` is a DI seam so tests can capture output; the default routes to
 * `console.warn` (which writes to stderr).
 */
export function groupPersonasByState(
  personas: Iterable<DevicePersona>,
  warn: (msg: string) => void = (msg) => {
    // eslint-disable-next-line no-console
    console.warn(msg);
  }
): readonly PersonaStateGroup[] {
  const groups = new Map<SystemStateId, { state: SystemState; personas: DevicePersona[] }>();
  for (const persona of personas) {
    if (!hasDaemonPayload(persona)) {
      if (!vmPersonaSkipWarningsEmitted.has(persona.id)) {
        vmPersonaSkipWarningsEmitted.add(persona.id);
        warn(formatPersonaSkipWarning(persona));
      }
      continue;
    }
    const state = resolveSystemStateForPersona(persona);
    const existing = groups.get(state.id);
    if (existing) {
      existing.personas.push(persona);
    } else {
      groups.set(state.id, { state, personas: [persona] });
    }
  }
  return Array.from(groups.values()).map(({ state, personas: ps }) => ({
    state,
    personas: ps,
  }));
}

// ---------------------------------------------------------------------------
// VM availability detection
// ---------------------------------------------------------------------------

/**
 * Emit a single warning line to stderr the first time VM tests are skipped in a
 * test session. The flag is module-scoped so re-imports across files share
 * the same once-only semantics.
 */
let skipWarningEmitted = false;

/** Reset the once-only skip-warning state. Tests only — never call from production. */
export function resetVmSkipWarning(): void {
  skipWarningEmitted = false;
}

/**
 * Probe VM availability.
 *
 * VM tests are gated behind a separate `test:vm` script (not the default
 * `bun test`), so the available-but-not-ready case here only needs to handle
 * "Lima not installed or VM instance missing". The `lima-test-vm` runner's
 * `isAvailable()` captures both: it returns `false` when `limactl` is absent
 * or the `podkit-device-harness` instance has never been created.
 *
 * Emits a single stderr warning line the first time the gate evaluates to
 * `false`. Subsequent skips are silent.
 *
 * Developer flow:
 *   1. Set up the test VM end-to-end (see tools/device-testing/lima/README.md).
 *   2. `bun run test:vm` (from the repo root or from `packages/device-testing/`).
 */
export async function resolveVmAvailability(
  runtime: TestRuntime = limaTestVmRunner,
  // DI seam for the warning emitter (tests assert the captured output).
  warn: (msg: string) => void = (msg) => {
    // eslint-disable-next-line no-console
    console.warn(msg);
  }
): Promise<boolean> {
  let available: boolean;
  try {
    available = await runtime.isAvailable();
  } catch {
    available = false;
  }
  if (!available && !skipWarningEmitted) {
    skipWarningEmitted = true;
    warn('[vm] Linux VM not available — skipping device integration tests');
  }
  return available;
}

// ---------------------------------------------------------------------------
// Test wall-time budgets
// ---------------------------------------------------------------------------

/**
 * Per-test wall-time budget for the warm-VM path (state already applied
 * for the current group, daemon already running for the persona).
 *
 * Target: under 10s per persona once the VM is hot.
 */
export const VM_WARM_TIMEOUT_MS = 10_000;

/**
 * Per-group wall-time budget for the cold path: VM boot + first
 * apply-state.sh run + first daemon start.
 *
 * Target: under 60s end-to-end.
 */
export const VM_COLD_TIMEOUT_MS = 60_000;
