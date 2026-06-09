/**
 * VM baseline integration tests against the 3 starter personas.
 *
 * # VM vs unit/2
 *
 *   - unit — pure-TS unit tests with injectable transports.
 *   - native — native subprocess tests (`*.darwin.test.ts` / `*.linux.test.ts`).
 *   - VM — full inquiry stack against a synthetic USB device served by a
 *     FunctionFS daemon inside the `podkit-device-harness` Lima VM (this file).
 *
 * # Test grouping convention (standard for VM)
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
 * # Assertion families
 *
 *   - **device-scan-finds-persona** — `podkit device scan --json` must list the
 *     persona as a USB-only iPod with a matching `usbDescriptor.vendorId` /
 *     `usbDescriptor.productId`. The Linux USB-walk path surfaces vendor-only
 *     devices in the scan envelope, so no `lsusb -d` cross-check is required.
 *
 *   - **doctor-vs-state** — `podkit doctor --scope system --json` must agree
 *     with the `SystemState` fixture's `expectedExitCode` and overall-status.
 *     The per-check status comparison is deliberately soft:
 *     `expectedDoctorSystemOutput.checks` in the fixtures is currently
 *     hand-authored and is replaced with real-VM capture as a separate
 *     ticket — until that lands, the authoritative cross-check is the exit
 *     code + overall health.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import { limaTestVmRunner } from '../runners/lima-test-vm.js';
import {
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  groupPersonasByState,
  resolveStarterPersonas,
} from './vm-runtime-setup.js';
import { withPersona, runJsonCommand } from './persona-fixture.js';

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

// Personas + groups are computed eagerly so the registry's missing-id
// assertion fires at module load.
const starterPersonas = resolveStarterPersonas();
const groups = groupPersonasByState(starterPersonas);

describe('VM: starter personas', () => {
  beforeAll(async () => {
    // One-time setup: boot the VM, transfer binaries, emit sidecar. The
    // runner's prepare() is idempotent; running it from inside the test
    // suite means a fresh checkout's first invocation works without manual
    // setup. Cold-start budget: 60s.
    await limaTestVmRunner.prepare();
  }, VM_COLD_TIMEOUT_MS);

  afterAll(async () => {
    // Restore base-healthy on the way out; do not shut down the VM (boot
    // dominates per-test cost).
    await limaTestVmRunner.teardown();
  }, VM_COLD_TIMEOUT_MS);

  // ── One describe per group → one applyState() per group ────────────────────
  for (const group of groups) {
    describe(`SystemState: ${group.state.id}`, () => {
      beforeAll(async () => {
        // Snapshot restore — fast path is <1s; cold path (first build of
        // this state) hits the 60s budget once and amortises forever.
        await limaTestVmRunner.applyState(group.state);
      }, VM_COLD_TIMEOUT_MS);

      for (const persona of group.personas) {
        describe(`persona: ${persona.id}`, () => {
          // `withPersona()` is the single owner of daemon lifecycle in each
          // test — it starts the dummy-hcd-daemon, runs the body, and stops
          // the daemon (best-effort) in a `finally`. A `beforeEach` that
          // also started the daemon would cause double-`systemctl start`,
          // which is a no-op today but will collide with the FunctionFS
          // exclusive-fd grab once the descriptor handshake lands.

          it(
            'podkit device scan --json lists the synthesized persona',
            async () => {
              const invocation = await withPersona({ persona }, () =>
                runJsonCommand(
                  limaTestVmRunner,
                  '/usr/local/bin/podkit device scan --json',
                  VM_WARM_TIMEOUT_MS
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

              // Every starter persona exposes both a USB descriptor (via
              // dummy_hcd) AND a mass-storage LUN (via the daemon's
              // `mass_storage.0` function backed by a synthesised FAT32
              // image). For Apple-vendor personas the scan surfaces them
              // either reconciled or as USB-only — the USB walk in
              // `packages/podkit-core/src/device/platforms/linux.ts` filters
              // `findIpodDevices()` on `usb.vendorId === '05ac'`. Non-Apple
              // personas (echo-mini, vendor 0x071b) are not yet surfaced by
              // the device-scan pipeline — deferred: wiring mass-storage-
              // preset auto-detection into the scan. Until then, the scan
              // envelope is required to be well-formed JSON with no error,
              // but the persona is simply absent from `parsed.devices`.
              const vid = persona.usbDescriptor.vendorId.toString(16).padStart(4, '0');
              const pid = persona.usbDescriptor.productId.toString(16).padStart(4, '0');
              const matchingDevice = (parsed.devices ?? []).find(
                (d) =>
                  d.usbDescriptor?.vendorId?.toLowerCase() === vid &&
                  d.usbDescriptor?.productId?.toLowerCase() === pid
              );
              const isAppleVendor = vid === '05ac';
              if (isAppleVendor) {
                expect(matchingDevice).toBeDefined();
              } else {
                // Echo Mini and future non-Apple mass-storage personas: the
                // scan must still succeed (exit 0 + valid JSON), but the
                // persona is invisible to the device-scan layer until mass-
                // storage-preset auto-detection is wired into
                // `findIpodDevices()` on Linux. Asserted explicitly so a
                // future fix flips this branch rather than silently starting
                // to pass.
                expect(matchingDevice).toBeUndefined();
              }
            },
            VM_WARM_TIMEOUT_MS
          );

          it(
            'podkit doctor --scope system --json agrees with the SystemState fixture',
            async () => {
              // System-scope doctor reads the host environment only — no
              // device required. We restored the group's SystemState snapshot
              // in beforeAll, so the doctor output should match the
              // fixture's `expectedExitCode` and overall-health bit.
              //
              // Deliberately NOT wrapped in `withPersona` — attaching a
              // persona loads a USB mass-storage gadget on the synthesized
              // host controller, which causes the host's usb_storage +
              // scsi_generic kernel chain to spawn `/dev/sg*` nodes. The
              // inquiry-methods diagnostic then flips warn→pass because
              // SCSI generic devices ARE present, masking the harness's
              // baseline "no real SCSI hardware" state the fixture pins.
              const invocation = await runJsonCommand(
                limaTestVmRunner,
                '/usr/local/bin/podkit doctor --scope system --json',
                VM_WARM_TIMEOUT_MS
              );

              // The --scope system path emits {success, status, healthy,
              // scope: 'system', checks[]}; exit code reflects overall health.
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
            VM_WARM_TIMEOUT_MS
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
            VM_WARM_TIMEOUT_MS
          );
        });
      }
    });
  }
});
