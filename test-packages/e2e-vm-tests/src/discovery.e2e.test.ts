/**
 * VM coverage — USB-descriptor discovery + identification end-to-end.
 *
 * Supplements the existing baseline tests (`personas-baseline.e2e.test.ts`,
 * `discovery-reconciliation.e2e.test.ts`, `unsupported-cascade.e2e.test.ts`)
 * with explicit assertions on the scan envelope shape.
 *
 * # Scenarios
 *
 *   - `podkit device scan --json` against the iPod 5G persona surfaces an
 *     entry with model.generationId === 'video_5g', `supported: true`, no
 *     `unsupportedReason`. Confirms the production scan envelope ports the
 *     cascade-resolved model fields end-to-end.
 *
 *   - `podkit device scan --json` succeeds (exit 0, valid JSON) when only a
 *     non-Apple mass-storage persona (Echo Mini) is bound. The persona MUST NOT
 *     appear under the Apple-vendor filter applied by the scan pipeline's USB
 *     walk (`findIpodDevices` on Linux at
 *     `packages/podkit-core/src/device/platforms/linux.ts` filters on
 *     `usb.vendorId === '05ac'`). Echo Mini's `0x071b` vendor lands in the
 *     mass-storage classifier today, which the device-scan layer does not yet
 *     surface — the scan envelope is required to be well-formed but the persona
 *     is invisible. This documents the current contract (deferred: wiring mass-
 *     storage-preset auto-detection into `findIpodDevices()`).
 *
 *   - `podkit device scan --json` for a supported iPod persona emits an entry
 *     carrying the full `usbDescriptor` (vendorId, productId, serialNumber) AND
 *     model metadata. Negative control on the descriptor fingerprint side.
 *
 * # Scope limitations (deferred)
 *
 *   - **Multiple iPods simultaneously via this suite**: deferred here for
 *     scope, not for infrastructure: the dummy-hcd daemon now derives both
 *     the configfs gadget name and the FunctionFS mountpoint from the
 *     persona id (`podkit-<id>` + `/dev/ffs-podkit-<id>`), so two
 *     `dummy-hcd-daemon@<id>.service` units co-exist cleanly. The dual-daemon
 *     lifecycle is covered standalone by `dual-daemon-lifecycle.e2e.test.ts`;
 *     unit-side reconcile ordering is covered by `discovery-permutations.test.ts`.
 *     Layering an end-to-end multi-iPod scan envelope assertion on top of
 *     that infrastructure is a follow-up.
 *
 *   - **`podkit device info` matches identify()**: DEFERRED. Info requires a
 *     configured `-d <name>` device, which requires a successful `device add`
 *     against a mounted iPod-formatted volume. The dummy-hcd persona's mass-
 *     storage backing file is FAT32 with no iPod_Control tree, so `device add`
 *     would either prompt for init (interactive — not stdin-pipeable through
 *     `limactl shell`) or fail with `INIT_FAILED` (no libgpod-node in the test
 *     VM). Covered unit-side by `device-info-runner.unit.test.ts`.
 *
 *   - **`device add` against the iPod 5G persona**: DEFERRED for the same
 *     reason — no libgpod-node in the test VM, no iPod_Control tree on the
 *     backing image. The failure paths (UNSUPPORTED_DEVICE for hashAB nano,
 *     NO_IPOD for empty bus) ARE covered by `unsupported-cascade.e2e.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  withPersona,
  runJsonCommand,
  healthy,
  ipodVideo5gIflash1tb,
  echoMini,
} from '@podkit/device-testing';

// ---------------------------------------------------------------------------
// Scan envelope helpers (subset of the device-scan JSON shape we assert on)
// ---------------------------------------------------------------------------

interface ScanDevice {
  usbOnly?: boolean;
  usbDescriptor?: {
    vendorId?: string;
    productId?: string;
    serialNumber?: string;
  };
  model?: {
    displayName?: string;
    generationId?: string;
  };
  unsupportedReason?: { kind?: string; headline?: string };
  readiness?: { level: string };
}
interface ScanJson {
  success: true;
  devices: ScanDevice[];
}

const hex = (n: number) => n.toString(16).padStart(4, '0');

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('VM: discovery + identification', () => {
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

    // ────────────────────────────────────────────────────────────────────────
    // iPod 5G discovery + scan envelope shape
    // ────────────────────────────────────────────────────────────────────────

    it(
      'device scan resolves video_5g identity for the iPod 5G persona',
      async () => {
        const invocation = await withPersona({ persona: ipodVideo5gIflash1tb }, () =>
          runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit device scan --json',
            VM_WARM_TIMEOUT_MS
          )
        );
        expect(invocation.exitCode).toBe(0);
        expect(invocation.parseError).toBeUndefined();
        const parsed = invocation.parsed as ScanJson;
        const expectedVid = hex(ipodVideo5gIflash1tb.usbDescriptor.vendorId);
        const expectedPid = hex(ipodVideo5gIflash1tb.usbDescriptor.productId);

        const entry = parsed.devices.find(
          (d) =>
            d.usbDescriptor?.vendorId?.toLowerCase() === expectedVid &&
            d.usbDescriptor?.productId?.toLowerCase() === expectedPid
        );
        expect(entry).toBeDefined();

        // Model fields are cascade-resolved from the USB PID (no SysInfo
        // disk read needed). The 5G PID 0x1209 maps to generation 'video_5g'
        // in IPOD_USB_IDS.
        expect(entry!.model?.generationId).toBe('video_5g');
        expect(entry!.model?.displayName).toMatch(/iPod.*5th generation/i);

        // Supported device — no unsupportedReason, no `'unsupported'`
        // readiness level.
        expect(entry!.unsupportedReason).toBeUndefined();
        expect(entry!.readiness?.level).not.toBe('unsupported');
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      'scan envelope carries vendorId, productId, serialNumber, and model',
      async () => {
        const invocation = await withPersona({ persona: ipodVideo5gIflash1tb }, () =>
          runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit device scan --json',
            VM_WARM_TIMEOUT_MS
          )
        );
        expect(invocation.exitCode).toBe(0);
        const parsed = invocation.parsed as ScanJson;
        const expectedVid = hex(ipodVideo5gIflash1tb.usbDescriptor.vendorId);
        const expectedPid = hex(ipodVideo5gIflash1tb.usbDescriptor.productId);
        const entry = parsed.devices.find(
          (d) =>
            d.usbDescriptor?.vendorId?.toLowerCase() === expectedVid &&
            d.usbDescriptor?.productId?.toLowerCase() === expectedPid
        );
        expect(entry).toBeDefined();

        // usbDescriptor — bare-hex lowercase per UsbFingerprint canonical form.
        expect(entry!.usbDescriptor?.vendorId?.toLowerCase()).toBe(expectedVid);
        expect(entry!.usbDescriptor?.productId?.toLowerCase()).toBe(expectedPid);

        // serialNumber — the persona's deviceSerial threaded through dummy_hcd
        // → kernel sysfs → podkit USB walk. The exact serial is the persona's
        // configured value (not '' / not undefined).
        expect(entry!.usbDescriptor?.serialNumber).toBeDefined();
        expect(typeof entry!.usbDescriptor?.serialNumber).toBe('string');
        expect(entry!.usbDescriptor!.serialNumber!.length).toBeGreaterThan(0);

        // Model — at minimum the displayName, set from the cascade.
        expect(entry!.model?.displayName).toBeDefined();
      },
      VM_WARM_TIMEOUT_MS
    );

    // ────────────────────────────────────────────────────────────────────────
    // Non-Apple vendor: scan envelope well-formed, persona NOT in Apple-vendor
    // view today (deferred: wiring mass-storage auto-detection into scan).
    // ────────────────────────────────────────────────────────────────────────

    it(
      'device scan against Echo Mini (non-Apple vendor 0x071b) emits a well-formed envelope with no Apple-vendor entry for it',
      async () => {
        const invocation = await withPersona({ persona: echoMini }, () =>
          runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit device scan --json',
            VM_WARM_TIMEOUT_MS
          )
        );
        // Scan is informational and never errors on "device unrecognised".
        expect(invocation.exitCode).toBe(0);
        expect(invocation.parseError).toBeUndefined();
        const parsed = invocation.parsed as ScanJson;
        expect(Array.isArray(parsed.devices)).toBe(true);

        // The Echo Mini's USB descriptor (0x071b:0x3203) is NOT Apple-vendor;
        // the USB walk in `linux.ts` filters `findIpodDevices()` on
        // `usb.vendorId === '05ac'`. The persona is therefore absent from
        // the scan envelope today — pinned as the current contract so a
        // future fix (wiring mass-storage-preset auto-detection into
        // `findIpodDevices()`) flips the assertion explicitly.
        const echoMiniVid = hex(echoMini.usbDescriptor.vendorId);
        const echoMiniEntry = parsed.devices.find(
          (d) => d.usbDescriptor?.vendorId?.toLowerCase() === echoMiniVid
        );
        expect(echoMiniEntry).toBeUndefined();

        // Importantly: no false-positive Apple-vendor entry that misidentifies
        // the Echo Mini.
        const applePhantom = parsed.devices.find(
          (d) =>
            d.usbDescriptor?.vendorId?.toLowerCase() === '05ac' &&
            d.usbDescriptor?.productId?.toLowerCase() === hex(echoMini.usbDescriptor.productId)
        );
        expect(applePhantom).toBeUndefined();
      },
      VM_WARM_TIMEOUT_MS
    );
  });
});
