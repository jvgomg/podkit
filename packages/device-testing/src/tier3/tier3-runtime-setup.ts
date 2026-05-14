/**
 * Tier 3 runtime setup helpers.
 *
 * Shared scaffolding for the `*.tier3.test.ts` files. Three jobs:
 *
 *   1. Detect Tier-3 availability via the `lima-test-vm` runner's
 *      `isAvailable()`. The test files use the cached boolean to
 *      `describe.skipIf` themselves on hosts without Lima.
 *   2. Group personas by required `SystemState`, filtering out any persona
 *      that has no daemon payload (`sysInfoExtendedXml === null &&
 *      massStorageBackingFile === null`). Filtering at grouping time keeps
 *      `withPersona()` from being called for personas the daemon's sidecar
 *      builder also drops — see TASK-322.06.01 and the mirror logic in
 *      `personas/sidecar-build.ts`. Tier-3 tests are organised so
 *      `applyState()` runs once per group, not once per test (the cornerstone
 *      of ADR-016 §"Test speed strategy").
 *   3. Resolve the starter persona list (TASK-321.02 captured personas).
 *
 * # Test grouping convention (standard for all Tier-3 test files)
 *
 * Every Tier-3 test file must:
 *
 *   - Call {@link resolveTier3Availability} at module top level and stash the
 *     boolean in a const (e.g. `const tier3Available = await …`).
 *   - Apply `describe.skipIf(!tier3Available)` to every Tier-3 `describe`.
 *   - Group `it()` blocks under a parent `describe` per `SystemState`. The
 *     setup file's `beforeAll` for the group calls `runtime.applyState(state)`
 *     once; per-test cost should be sub-second.
 *   - Use the {@link STARTER_PERSONA_IDS} constants — never inline raw persona ids.
 *
 * # Assertion families wired in `personas-baseline.tier3.test.ts`
 *
 *   - Device-scan finds the synthesised persona; lsusb cross-checks
 *     vendor/product (FunctionFS descriptor handshake landed in
 *     TASK-322.05.01).
 *   - Doctor `--scope system --json` agrees with the `SystemState` fixture
 *     (CLI surface landed in TASK-333).
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
// Starter persona list (TASK-322.06 AC #7)
// ---------------------------------------------------------------------------

/**
 * The 3 starter personas Tier 3 covers in m-19.
 *
 * Spec aliases ("ipod-video-5g-fresh", "ipod-nano-7g-populated",
 * "echo-mini-empty") map to captured persona ids in `personas/index.ts`. The
 * spec aliases are intentions ("a 5G Video", "a populated 7G nano", "an empty
 * Echo Mini") rather than literal ids — captured-persona names are what
 * actually exist in the registry.
 *
 * If a future persona is captured under a name that more closely matches the
 * spec alias (e.g. an explicit "ipod-video-5g-fresh"), swap the mapping here.
 */
export const STARTER_PERSONA_IDS = {
  /** SCSI-fallback inquiry path. */
  ipodVideo5g: 'ipod-video-5g-iflash-1tb',
  /** USB-inquiry path. */
  ipodNano7g: 'ipod-nano-7g-space-gray',
  /** Mass-storage path. */
  echoMini: 'echo-mini',
} as const;

/** Ordered list of starter persona ids (stable iteration order for tests). */
export const STARTER_PERSONA_ID_LIST = [
  STARTER_PERSONA_IDS.ipodVideo5g,
  STARTER_PERSONA_IDS.ipodNano7g,
  STARTER_PERSONA_IDS.echoMini,
] as const;

/**
 * Resolve the 3 starter `DevicePersona` objects from a registry.
 * @throws if any id is missing — that's a programming error.
 */
export function resolveStarterPersonas(
  registry: ReadonlyMap<string, DevicePersona> = defaultRegistry
): readonly DevicePersona[] {
  return STARTER_PERSONA_ID_LIST.map((id) => {
    const persona = registry.get(id);
    if (!persona) {
      throw new Error(
        `Tier-3 starter persona '${id}' missing from registry. ` +
          `Update STARTER_PERSONA_IDS in tier3-runtime-setup.ts.`
      );
    }
    return persona;
  });
}

// ---------------------------------------------------------------------------
// Persona-by-state grouping (TASK-322.06 AC #8)
// ---------------------------------------------------------------------------

/**
 * A group of personas that share a required `SystemState`. The Tier-3 runner
 * calls `applyState(state)` once per group, then runs every persona's tests.
 */
export interface PersonaStateGroup {
  state: SystemState;
  personas: readonly DevicePersona[];
}

/**
 * Resolve the `SystemState` required by a persona's tests.
 *
 * Today every starter persona uses `healthy` — the m-19 baseline tests verify
 * the happy path. Later doctor-coverage tests (TASK-307–311) will introduce
 * personas that pair with `no-ffmpeg`, `no-libgpod`, etc. The function exists
 * as the extension point so a future persona with a different state slot
 * naturally lands in a new group without restructuring callers.
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
 * grouping time instead of letting it reach `withPersona()`. This is the
 * interim safety belt described in TASK-322.06.01 — TASK-324 will capture
 * real backing-file payloads for the affected personas, at which point this
 * filter becomes a no-op for the starter set but remains as a tripwire for
 * future bare personas.
 */
export function hasDaemonPayload(persona: DevicePersona): boolean {
  return persona.sysInfoExtendedXml !== null || persona.massStorageBackingFile !== null;
}

/**
 * Tracks personas that have already triggered a "no daemon payload" warning
 * in this session. Keyed by persona id so the dedupe is per-persona, not
 * per-process — adding a new bare persona later in the same `bun test` run
 * still emits its warning. Reset via {@link resetTier3PersonaSkipWarnings}
 * for parallel test isolation.
 */
const tier3PersonaSkipWarningsEmitted = new Set<string>();

/**
 * Reset the once-per-session per-persona skip warnings emitted by
 * {@link groupPersonasByState}. Tests only — never call from production.
 */
export function resetTier3PersonaSkipWarnings(): void {
  tier3PersonaSkipWarningsEmitted.clear();
}

/**
 * Build the "persona dropped" stderr line for a persona that fails
 * {@link hasDaemonPayload}. Exported so the unit tests can assert against
 * the exact text (AC #6 — TASK-324 must appear).
 */
export function formatPersonaSkipWarning(persona: DevicePersona): string {
  const nullFields: string[] = [];
  if (persona.sysInfoExtendedXml === null) nullFields.push('sysInfoExtendedXml=null');
  if (persona.massStorageBackingFile === null) nullFields.push('massStorageBackingFile=null');
  return (
    `[tier-3] persona '${persona.id}' has no daemon payload (` +
    nullFields.join(', ') +
    `); skipping — see TASK-324 for the capture work`
  );
}

/**
 * Group `personas` by their required `SystemState`. The returned array's
 * entries iterate in a stable order: groups appear in the order their first
 * persona was inserted.
 *
 * Personas where {@link hasDaemonPayload} is `false` are dropped before
 * grouping — see the module header and TASK-322.06.01. The first time a
 * given persona is dropped in this session, `warn` is called with a single
 * line naming the persona id, the null fields, and the TASK-324 reference.
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
      if (!tier3PersonaSkipWarningsEmitted.has(persona.id)) {
        tier3PersonaSkipWarningsEmitted.add(persona.id);
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
// Tier-3 availability detection (TASK-322.06 AC #4)
// ---------------------------------------------------------------------------

/**
 * Emit a single warning line to stderr the first time Tier 3 is skipped in a
 * test session. The flag is module-scoped so re-imports across files share
 * the same once-only semantics.
 */
let skipWarningEmitted = false;

/** Reset the once-only skip-warning state. Tests only — never call from production. */
export function resetTier3SkipWarning(): void {
  skipWarningEmitted = false;
}

/**
 * Environment variable that opts into running Tier 3 tests. Tier 3 needs
 * MORE than just the VM existing: the podkit binary must be present at
 * `/usr/local/bin/podkit`, the dummy-hcd-daemon binary must be installed,
 * the systemd unit must be enabled, and the FunctionFS descriptor handshake
 * must work (TASK-322.05.01). Probing every prerequisite at suite top-level
 * is brittle, so we require an explicit opt-in instead.
 *
 * Developer flow:
 *   1. Set up the test VM end-to-end (see tools/device-testing/lima/README.md).
 *   2. `PODKIT_DEVTEST_RUN_TIER3=1 bun run test --filter @podkit/device-testing`.
 *
 * Without the env var, Tier 3 is treated as unavailable (suite skips with a
 * single stderr warning that tells the developer how to enable it).
 */
export const TIER3_RUN_ENV_VAR = 'PODKIT_DEVTEST_RUN_TIER3';

/**
 * Probe Tier-3 availability. Tier 3 runs only when ALL of:
 *
 *   - `PODKIT_DEVTEST_RUN_TIER3=1` is set in the environment
 *   - The `lima-test-vm` runner's `isAvailable()` returns `true` (limactl
 *     installed + the `podkit-test-vm` Lima instance exists)
 *
 * Emits a single stderr warning line the first time the gate evaluates to
 * `false`. Subsequent skips are silent.
 *
 * Why the env-var gate exists: a running VM is necessary but not sufficient
 * — the daemon's systemd unit must be installed, the FunctionFS descriptor
 * handshake must work (TASK-322.05.01), the podkit binary must be at the
 * expected path. Probing every prerequisite at suite load is brittle. An
 * explicit opt-in keeps the default test run clean.
 */
export async function resolveTier3Availability(
  runtime: TestRuntime = limaTestVmRunner,
  // DI seam for the warning emitter (tests assert the captured output).
  warn: (msg: string) => void = (msg) => {
    // eslint-disable-next-line no-console
    console.warn(msg);
  },
  env: Pick<NodeJS.ProcessEnv, string> = process.env
): Promise<boolean> {
  const optedIn = env[TIER3_RUN_ENV_VAR] === '1';
  if (!optedIn) {
    if (!skipWarningEmitted) {
      skipWarningEmitted = true;
      warn(`[tier-3] skipping device integration tests; set ${TIER3_RUN_ENV_VAR}=1 to enable`);
    }
    return false;
  }

  let available: boolean;
  try {
    available = await runtime.isAvailable();
  } catch {
    available = false;
  }
  if (!available && !skipWarningEmitted) {
    skipWarningEmitted = true;
    warn('[tier-3] Linux VM not available — skipping device integration tests');
  }
  return available;
}

// ---------------------------------------------------------------------------
// Test wall-time budgets (TASK-322.06 AC #5)
// ---------------------------------------------------------------------------

/**
 * Per-test wall-time budget for the warm-VM path (snapshot already restored
 * for the current group, daemon already running for the persona).
 *
 * Target: under 10s per persona once the VM is hot.
 */
export const TIER3_WARM_TIMEOUT_MS = 10_000;

/**
 * Per-group wall-time budget for the cold path: VM boot + first snapshot
 * restore + first daemon start.
 *
 * Target: under 60s end-to-end.
 */
export const TIER3_COLD_TIMEOUT_MS = 60_000;
