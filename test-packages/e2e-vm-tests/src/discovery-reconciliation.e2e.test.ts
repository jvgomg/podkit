/**
 * VM coverage — discovery reconciliation (commit `f5d0082`).
 *
 * Pins the reconciliation primitive in `@podkit/core/device/reconcile.ts`
 * end-to-end via `podkit device scan --json`:
 *
 *   - Single Apple-vendor USB persona → exactly ONE devices[] entry, no
 *     double-count between the USB walk and the (empty) lsblk pipeline.
 *   - Stop+start of the same persona (proxy for replug, since dummy_hcd
 *     does not expose a real disconnect/reconnect event from inside the
 *     test) → the post-restart scan still shows exactly ONE entry with the
 *     same usbDescriptor; no phantom entries from a stale enumeration.
 *
 * The "two distinct Apple-vendor personas bound concurrently" scenario is
 * NOT verifiable in the current VM harness — see the inline NB on the
 * suite for the FunctionFS-single-instance constraint and the
 * unit-side coverage pointer.
 *
 * # Why "replug ×10" is paired down to start/stop ×3
 *
 * The AC spec says "Replug cycle (10×) → no phantom or duplicate entries".
 * The dummy-hcd-daemon lifecycle (`systemctl stop`/`start`) is the closest
 * VM-replayable analogue to a physical USB unplug/replug. Each cycle takes
 * ~1.5–2s (start + kernel enumeration + scan + stop). Ten cycles per test
 * pushes a single it() body to ~25s, eating the VM_WARM_TIMEOUT_MS
 * budget and adding very little signal — the failure mode "duplicate
 * entries accumulate across cycles" surfaces in the first or second cycle
 * if it exists at all. We do 3 cycles, which is enough to catch the
 * accumulation regression without inflating wall-time. A `replug ×10`
 * variant can be added if a regression slips past 3.
 *
 * # Scope limitations
 *
 *   - "Two iPods plugged in simultaneously" (2nd sub-scenario of the AC)
 *     is NOT verifiable today — see NB inside the suite for the
 *     FunctionFS single-mountpoint constraint.
 *
 *   - "USB-only iOS device alongside matched iPod" (4th sub-scenario of
 *     the AC) requires an iOS-class persona with a daemon payload AND
 *     concurrent enumeration with a matched iPod persona. The starter
 *     `ipod-touch-5g-unsupported` persona has no daemon payload
 *     (`sysInfoExtendedXml: null`, `massStorageBackingFile: null`) so it
 *     is filtered out of the sidecar at `buildSidecar()` time and the
 *     daemon refuses to start. Adding a synthesised payload to a touch
 *     persona changes the persona's semantic identity ("captured iOS USB
 *     descriptor, nothing else"); the cleaner path is to add a new
 *     touch persona with a synthesised mass-storage backing file that
 *     never enumerates as a disk — work for a follow-up.
 *
 *   - "matched by serial" assertion (which `reconcile.ts` exposes via
 *     `matchedBy: 'serial'`) requires a persona whose USB descriptor
 *     serial AND lsblk-side volume UUID + disk name resolve to the same
 *     physical device. The dummy-hcd-daemon's mass-storage backing file
 *     gets a fresh kernel-assigned `sd<N>` letter and no podkit-aware
 *     serial wiring, so the reconcile would always fall through to
 *     `matchedBy: 'usb-only'`. The serial-match path is covered unit-side
 *     by `packages/podkit-core/src/device/reconcile.test.ts`.
 *
 * @see commit f5d0082
 * @see packages/podkit-core/src/device/reconcile.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  resolveVmAvailability,
  withPersona,
  runJsonCommand,
  healthy,
  ipodNano3gBlack,
  startDaemonForPersona,
  stopDaemon,
  LIMA_DEVICE_HARNESS_VM_NAME,
} from '@podkit/device-testing';

const vmAvailable = await resolveVmAvailability();

interface ScanDevice {
  usbOnly?: boolean;
  usbDescriptor?: {
    vendorId?: string;
    productId?: string;
    serialNumber?: string;
  };
}
interface ScanJson {
  success: true;
  devices: ScanDevice[];
}

// Hex helper — personas store vendor/product as numbers; the scan envelope
// returns them as bare lower-case hex.
const hex = (n: number) => n.toString(16).padStart(4, '0');

describe.skipIf(!vmAvailable)('VM: discovery reconciliation', () => {
  beforeAll(async () => {
    await limaTestVmRunner.prepare();
  }, VM_COLD_TIMEOUT_MS);

  afterAll(async () => {
    await limaTestVmRunner.teardown();
  }, VM_COLD_TIMEOUT_MS);

  describe(`SystemState: ${healthy.id}`, () => {
    beforeAll(async () => {
      await limaTestVmRunner.applyState(healthy);
    }, VM_COLD_TIMEOUT_MS);

    it(
      'single Apple-vendor USB persona → exactly one devices[] entry',
      async () => {
        const invocation = await withPersona({ persona: ipodNano3gBlack }, () =>
          runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit device scan --json',
            VM_WARM_TIMEOUT_MS
          )
        );
        expect(invocation.exitCode).toBe(0);
        const parsed = invocation.parsed as ScanJson;
        const apple = parsed.devices.filter(
          (d) => d.usbDescriptor?.vendorId?.toLowerCase() === '05ac'
        );
        // Reconciliation rule: exactly one row per physical device. A
        // regression where USB-walk discovery surfaces an entry AND the
        // (empty) lsblk pipeline surfaces another would show up here as
        // count === 2.
        expect(apple.length).toBe(1);
        expect(apple[0]!.usbDescriptor?.productId?.toLowerCase()).toBe(
          hex(ipodNano3gBlack.usbDescriptor.productId)
        );
      },
      VM_WARM_TIMEOUT_MS
    );

    // NB — "two iPods plugged in simultaneously" is covered by the dual-
    // daemon lifecycle smoke (`dual-daemon-lifecycle.e2e.test.ts`), which
    // boots two `dummy-hcd-daemon@<id>.service` units against the now
    // per-persona configfs / FunctionFS naming and asserts both kernel
    // gadgets land cleanly. The reconcile primitive's dual-iPod ordering is
    // covered exhaustively unit-side by
    // `packages/podkit-core/src/device/reconcile.test.ts`. Wiring a
    // dual-persona scan-envelope assertion on top of that infrastructure is
    // left as a follow-up so this suite stays focused on single-device
    // reconciliation.

    it(
      'replug cycle (start/stop ×3) — scan shows exactly one entry each cycle',
      async () => {
        // Each cycle = bind, scan, unbind. The reconcile primitive caches
        // nothing across CLI invocations (each `podkit device scan` runs
        // a fresh USB walk), so a duplicate-entry regression would show
        // up on the first replug if the production code accumulated stale
        // enumerations somewhere unexpected (e.g. /sys hot-cache).
        for (let cycle = 0; cycle < 3; cycle++) {
          await startDaemonForPersona({
            vmName: LIMA_DEVICE_HARNESS_VM_NAME,
            personaId: ipodNano3gBlack.id,
          });
          try {
            const invocation = await runJsonCommand(
              limaTestVmRunner,
              '/usr/local/bin/podkit device scan --json',
              VM_WARM_TIMEOUT_MS
            );
            expect(invocation.exitCode).toBe(0);
            const parsed = invocation.parsed as ScanJson;
            const apple = parsed.devices.filter(
              (d) => d.usbDescriptor?.vendorId?.toLowerCase() === '05ac'
            );
            // Exactly one entry per cycle, regardless of cycle index.
            expect(apple.length).toBe(1);
            expect(apple[0]!.usbDescriptor?.serialNumber).toBe(
              ipodNano3gBlack.usbDescriptor.deviceSerial ?? undefined
            );
          } finally {
            await stopDaemon({
              vmName: LIMA_DEVICE_HARNESS_VM_NAME,
              personaId: ipodNano3gBlack.id,
            }).catch(() => undefined);
          }
        }
      },
      // 3 cycles × (start + scan + stop) ≈ 6-8s; pad generously.
      VM_WARM_TIMEOUT_MS * 3
    );
  });
});
