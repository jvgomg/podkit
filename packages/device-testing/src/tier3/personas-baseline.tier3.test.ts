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
 * # Assertion families
 *
 *   - **device-scan-finds-persona** — `podkit device scan --format json`
 *     must list the persona as a USB-only iPod with a matching
 *     `usbDescriptor.vendorId` / `usbDescriptor.productId`. The Linux USB-walk
 *     path (TASK-334) surfaces vendor-only devices in the scan envelope, so
 *     no `lsusb -d` cross-check is required.
 *
 *   - **doctor-vs-state** — `podkit doctor --scope system --json` (TASK-333)
 *     must agree with the `SystemState` fixture's `expectedExitCode` and
 *     overall-status. The per-check status comparison is deliberately soft:
 *     `expectedDoctorSystemOutput.checks` in the fixtures is currently
 *     hand-authored (v0 in `system-states/README.md`) and is replaced with
 *     real-VM capture as a separate ticket — until that lands, the
 *     authoritative cross-check is the exit code + overall health.
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
            'podkit device scan --format json lists the synthesized persona',
            async () => {
              const invocation = await withPersona({ persona }, () =>
                runJsonCommand(
                  limaTestVmRunner,
                  '/usr/local/bin/podkit device scan --format json',
                  TIER3_WARM_TIMEOUT_MS
                )
              );

              // Exit code must be 0: scan is informational, never an error.
              expect(invocation.exitCode).toBe(0);

              // Envelope shape: { success: true, devices: [...], ... }.
              expect(invocation.parsed).toMatchObject({ success: true });
              const parsed = invocation.parsed as {
                success: true;
                devices?: Array<{
                  identifier?: string;
                  volumeName?: string;
                  usbOnly?: boolean;
                  usbDescriptor?: { vendorId?: string; productId?: string };
                }>;
              };
              expect(Array.isArray(parsed.devices)).toBe(true);

              // TASK-334: the Linux USB-walk path surfaces vendor-only personas
              // in the scan envelope. The three starter personas have
              // `massStorageBackingFile: null`, so they appear as USB-only
              // entries with `usbOnly: true` and a matching usbDescriptor.
              const vid = persona.usbDescriptor.vendorId.toString(16).padStart(4, '0');
              const pid = persona.usbDescriptor.productId.toString(16).padStart(4, '0');
              const matchingDevice = (parsed.devices ?? []).find(
                (d) =>
                  d.usbDescriptor?.vendorId?.toLowerCase() === vid &&
                  d.usbDescriptor?.productId?.toLowerCase() === pid
              );
              expect(matchingDevice).toBeDefined();
              expect(matchingDevice?.usbOnly).toBe(true);
            },
            TIER3_WARM_TIMEOUT_MS
          );

          it(
            'podkit doctor --scope system --json agrees with the SystemState fixture',
            async () => {
              // System-scope doctor reads the host environment only — no
              // device required. We restored the group's SystemState snapshot
              // in beforeAll, so the doctor output should match the
              // fixture's `expectedExitCode` and overall-health bit.
              const invocation = await withPersona({ persona }, () =>
                runJsonCommand(
                  limaTestVmRunner,
                  '/usr/local/bin/podkit doctor --scope system --json',
                  TIER3_WARM_TIMEOUT_MS
                )
              );

              // The new --scope system path emits {success, status, healthy,
              // scope: 'system', checks[]} and follows TASK-308 exit-code
              // semantics.
              expect(invocation.exitCode).toBe(group.state.expectedExitCode);
              expect(invocation.parsed).toMatchObject({
                success: true,
                scope: 'system',
              });
              const parsed = invocation.parsed as {
                success: true;
                scope: 'system';
                healthy: boolean;
                checks: Array<{ id: string; status: string }>;
              };
              const expectedHealthy =
                group.state.expectedDoctorSystemOutput.overallStatus === 'healthy';
              expect(parsed.healthy).toBe(expectedHealthy);
              expect(Array.isArray(parsed.checks)).toBe(true);
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
