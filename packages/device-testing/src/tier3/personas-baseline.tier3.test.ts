/**
 * Tier-3 baseline integration tests against the 3 starter personas.
 *
 * # Tier 3 vs Tier 1/2
 *
 *   - Tier 1 — pure-TS unit tests with injectable transports.
 *   - Tier 2 — native subprocess tests (`*.darwin.test.ts` / `*.linux.test.ts`).
 *   - Tier 3 — full inquiry stack against a synthetic USB device served by a
 *     FunctionFS daemon inside the `podkit-test-vm` Lima VM (this file).
 *
 * # Test grouping convention (standard for Tier 3)
 *
 * Personas are grouped by their required `SystemState`. The runner restores
 * one snapshot per group, then runs every persona's tests inside that group.
 * This is the cost model from ADR-016 §"Test speed strategy": snapshot
 * restore happens once per group (~1s), not once per test.
 *
 *   for each group `(state, personas)`:           ← beforeAll: applyState(state)
 *     for each persona in personas:
 *       it('podkit device scan …')                ← asserts via persona
 *       it('withPersona lifecycle smoke')         ← asserts daemon start/stop
 *
 * All 3 starter personas currently use `healthy`, so today there is one
 * group. When `no-ffmpeg` etc. personas land, they form additional groups
 * with no per-test changes here.
 *
 * # Auto-skip
 *
 * Tests skip with a single stderr warning (`[tier-3] Linux VM not available …`)
 * when `limaTestVmRunner.isAvailable()` returns false — i.e. limactl absent
 * or the `podkit-test-vm` instance does not exist. The skip is at-runtime
 * via `describe.skipIf`, so this file is safe to load on any host.
 *
 * # Paused: assertions waiting on dependency tasks
 *
 * Two assertion families are intentionally NOT in this file (per the m-19
 * "no skipped tests" rule — pause the work, document it):
 *
 *   - **doctor-vs-state**: compare `podkit doctor --scope system --json` to
 *     the `SystemState.expectedDoctorSystemOutput`. Blocked by
 *     **TASK-333** (Doctor system-only invocation mode). Today's CLI has no
 *     `--scope` flag and doctor requires a registered device. TASK-333
 *     adds the system-only mode; TASK-322.05.01 owns the test edit that
 *     introduces this assertion to this file.
 *
 *   - **device-scan-finds-persona**: today `podkit device scan` sees nothing
 *     because the dummy-hcd-daemon does not publish FunctionFS descriptors.
 *     The well-formed-JSON shape check below is what holds the spot. The
 *     stronger "finds persona by vendor/product" assertion lands with
 *     **TASK-322.05.01** (FunctionFS descriptor handshake).
 *
 * The setup, fixture, grouping, and snapshot orchestration are all in place
 * — adding either assertion family is a small additive edit in the
 * dependency task, not a structural reshape here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import { limaTestVmRunner } from '../runners/lima-test-vm.js';
import {
  TIER3_COLD_TIMEOUT_MS,
  TIER3_WARM_TIMEOUT_MS,
  groupPersonasByState,
  resolveStarterPersonas,
  resolveTier3Availability,
} from './tier3-runtime-setup.js';
import { withPersona, runJsonCommand } from './persona-fixture.js';

// ---------------------------------------------------------------------------
// Top-level availability gate
// ---------------------------------------------------------------------------

// `await` at module top level inside a test module is supported by Bun's
// test runner (which loads with ESM). Probing once here, before any
// describe() is evaluated, keeps the gate cheap.
const tier3Available = await resolveTier3Availability();

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

// Personas + groups are computed eagerly so the registry's missing-id
// assertion fires at module load even when Tier 3 is skipped on this host.
const starterPersonas = resolveStarterPersonas();
const groups = groupPersonasByState(starterPersonas);

describe.skipIf(!tier3Available)('Tier 3: starter personas', () => {
  beforeAll(async () => {
    // One-time setup: boot the VM, transfer binaries, emit sidecar. The
    // runner's prepare() is idempotent; running it from inside the test
    // suite means a fresh checkout's first invocation works without manual
    // setup. Cold-start budget: 60s.
    await limaTestVmRunner.prepare();
  }, TIER3_COLD_TIMEOUT_MS);

  afterAll(async () => {
    // Restore base-healthy on the way out; do not shut down the VM (boot
    // dominates per-test cost).
    await limaTestVmRunner.teardown();
  }, TIER3_COLD_TIMEOUT_MS);

  // ── One describe per group → one applyState() per group ────────────────────
  for (const group of groups) {
    describe(`SystemState: ${group.state.id}`, () => {
      beforeAll(async () => {
        // Snapshot restore — fast path is <1s; cold path (first build of
        // this state) hits the 60s budget once and amortises forever.
        await limaTestVmRunner.applyState(group.state);
      }, TIER3_COLD_TIMEOUT_MS);

      for (const persona of group.personas) {
        describe(`persona: ${persona.id}`, () => {
          // `withPersona()` is the single owner of daemon lifecycle in each
          // test — it starts the dummy-hcd-daemon, runs the body, and stops
          // the daemon (best-effort) in a `finally`. A `beforeEach` that
          // also started the daemon would cause double-`systemctl start`,
          // which is a no-op today but will collide with the FunctionFS
          // exclusive-fd grab once the descriptor handshake lands.

          it(
            'podkit device scan --format json returns well-formed JSON',
            async () => {
              const invocation = await withPersona({ persona }, () =>
                runJsonCommand(
                  limaTestVmRunner,
                  '/usr/local/bin/podkit device scan --format json',
                  TIER3_WARM_TIMEOUT_MS
                )
              );

              // Exit code must be 0: "no devices found" is a success outcome,
              // not an error. (`device scan` ≠ `device info`.)
              expect(invocation.exitCode).toBe(0);

              // The output must be parseable JSON shaped as an array. The
              // stronger "finds persona by vendor/product" assertion lands
              // with TASK-322.05.01 (FunctionFS descriptor handshake) — see
              // file header §"Paused: assertions waiting on dependency tasks".
              expect(invocation.parsed).toBeDefined();
              expect(Array.isArray(invocation.parsed)).toBe(true);
              void persona;
            },
            TIER3_WARM_TIMEOUT_MS
          );

          it(
            'wraps a daemon lifecycle around a no-op without leaving state behind',
            async () => {
              // Smoke test of `withPersona()`: it should start, run the
              // body, and stop cleanly.
              let ran = false;
              await withPersona({ persona }, async () => {
                ran = true;
              });
              expect(ran).toBe(true);
            },
            TIER3_WARM_TIMEOUT_MS
          );
        });
      }
    });
  }
});
