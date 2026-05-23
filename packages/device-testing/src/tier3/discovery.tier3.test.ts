/**
 * Tier-3 coverage — USB-descriptor discovery + identification end-to-end.
 *
 * Supplements the existing baseline tests (`personas-baseline.tier3.test.ts`,
 * `discovery-reconciliation.tier3.test.ts`, `unsupported-cascade.tier3.test.ts`)
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
 *   - **Multiple iPods simultaneously**: DEFERRED. The dummy-hcd daemon uses a
 *     single hardcoded FunctionFS mount point (`/dev/ffs-podkit`); a second
 *     `systemctl start dummy-hcd-daemon@<id>.service` exits 4 with
 *     `mount: /dev/ffs-podkit: podkit-test already mounted`. The systemd
 *     template auto-restarts the second daemon forever, and the kernel never
 *     enumerates both. See `discovery-reconciliation.tier3.test.ts` for the
 *     long-form rationale, and `discovery-permutations.test.ts` for the
 *     unit-side coverage of the multi-iPod ordering path.
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
 *     NO_IPOD for empty bus) ARE covered by `unsupported-cascade.tier3.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import { limaTestVmRunner } from '../runners/lima-test-vm.js';
import {
  TIER3_COLD_TIMEOUT_MS,
  TIER3_WARM_TIMEOUT_MS,
  resolveTier3Availability,
} from './tier3-runtime-setup.js';
import { withPersona, runJsonCommand } from './persona-fixture.js';
import { healthy } from '../system-states/healthy.js';
import { ipodVideo5gIflash1tb } from '../personas/ipod-video-5g-iflash-1tb/persona.js';
import { echoMini } from '../personas/echo-mini/persona.js';

const tier3Available = await resolveTier3Availability();

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

describe.skipIf(!tier3Available)('Tier 3: discovery + identification', () => {
  beforeAll(async () => {
    await limaTestVmRunner.prepare();
  }, TIER3_COLD_TIMEOUT_MS);

  afterAll(async () => {
    await limaTestVmRunner.teardown();
  }, TIER3_COLD_TIMEOUT_MS);

  describe(`SystemState: ${healthy.id}`, () => {
    beforeAll(async () => {
      await limaTestVmRunner.applyState(healthy);
    }, TIER3_COLD_TIMEOUT_MS);

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
            TIER3_WARM_TIMEOUT_MS
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
      TIER3_WARM_TIMEOUT_MS
    );

    it(
      'scan envelope carries vendorId, productId, serialNumber, and model',
      async () => {
        const invocation = await withPersona({ persona: ipodVideo5gIflash1tb }, () =>
          runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit device scan --json',
            TIER3_WARM_TIMEOUT_MS
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
      TIER3_WARM_TIMEOUT_MS
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
            TIER3_WARM_TIMEOUT_MS
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
      TIER3_WARM_TIMEOUT_MS
    );
  });
});
