/**
 * VM coverage — firmware inquiry USB-transport-down warn path.
 *
 * `inquiry-methods` (packages/podkit-core/src/diagnostics/checks/
 * inquiry-methods.ts) derives its status USB-first: it reports `pass`
 * whenever the `usb` npm package loads, even with no `/dev/sg*` nodes. The
 * single condition that makes it `warn` end-to-end is a USB transport that
 * cannot load — the exact production failure that motivated surfacing USB
 * availability honestly: a shipped binary whose bundled libusb prebuild
 * fails to dlopen `libudev.so.1` (e.g. Alpine without eudev-libs), which
 * previously degraded firmware inquiry silently (see the inquiry-methods
 * module TSDoc and `packages/ipod-firmware/src/inquiry/usb.ts` `loadUsb`).
 *
 * No SystemState fixture exercises this: every one leaves the VM's USB
 * stack intact, so inquiry-methods passes there (that is exactly why the
 * whole SystemState matrix collapses to the healthy baseline at system
 * scope). Rather than model a SystemState that persistently breaks
 * `libudev` — which would poison the shared snapshot for udevd, the
 * dummy-hcd gadget, and device scan — this test breaks USB loading for a
 * SINGLE doctor invocation by shadowing `libudev.so.1` with an empty decoy
 * on `LD_LIBRARY_PATH`. The decoy is inert for every other command: only
 * an invocation that opts in via the env prefix picks it up, so there is
 * no persistent VM mutation, no snapshot change, and no effect on other
 * tests' plain `podkit` calls.
 *
 * @see packages/podkit-core/src/diagnostics/checks/inquiry-methods.ts
 * @see packages/ipod-firmware/src/inquiry/usb.ts
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  runJsonCommand,
  healthy,
} from '@podkit/device-testing';

// Directory holding an empty file named `libudev.so.1`. Prepended to
// LD_LIBRARY_PATH, the dynamic linker finds this decoy before the real
// `/lib/.../libudev.so.1` and fails to load it (an empty file is not a
// valid ELF), so the usb prebuild's dlopen — and thus `await import('usb')`
// inside `loadUsb` — throws `libusb-not-loadable`.
const DECOY_DIR = '/tmp/podkit-usb-transport-down';
const DOCTOR_JSON = '/usr/local/bin/podkit doctor --scope system --json';
const DOCTOR_JSON_USB_DOWN = `LD_LIBRARY_PATH=${DECOY_DIR} ${DOCTOR_JSON}`;

interface SystemDoctorJson {
  healthy: boolean;
  checks: Array<{
    id: string;
    status: string;
    summary?: string;
    details?: { usb?: { available?: boolean; reason?: string } };
  }>;
}

function inquiryCheck(parsed: unknown): SystemDoctorJson['checks'][number] | undefined {
  return (parsed as SystemDoctorJson).checks.find((c) => c.id === 'inquiry-methods');
}

describe('VM: firmware inquiry — USB transport down', () => {
  beforeAll(async () => {
    await limaTestVmRunner.prepare();
    await limaTestVmRunner.applyState(healthy);
    // Plant the decoy AFTER the state is applied. `: > file` truncates to
    // zero bytes; a zero-byte `libudev.so.1` fails ELF validation at
    // dlopen, which is what we want.
    await limaTestVmRunner.run(`mkdir -p ${DECOY_DIR} && : > ${DECOY_DIR}/libudev.so.1`, {
      timeoutMs: VM_WARM_TIMEOUT_MS,
    });
  }, VM_COLD_TIMEOUT_MS);

  afterAll(async () => {
    await limaTestVmRunner
      .run(`rm -rf ${DECOY_DIR}`, { timeoutMs: VM_WARM_TIMEOUT_MS })
      .catch(() => {});
    await limaTestVmRunner.teardown();
  }, VM_COLD_TIMEOUT_MS);

  // Control: the same doctor command WITHOUT the LD_LIBRARY_PATH prefix
  // loads USB normally and passes USB-first (exit 0). This pins the
  // treatment below as caused by the decoy, not by some ambient USB
  // failure on the harness — if inquiry-methods were already warning for
  // an unrelated reason, this control would fail loudly.
  it(
    'control: with USB intact, inquiry-methods passes and doctor exits 0',
    async () => {
      const invocation = await runJsonCommand(limaTestVmRunner, DOCTOR_JSON, VM_WARM_TIMEOUT_MS);
      expect(invocation.parseError).toBeUndefined();
      expect(invocation.exitCode).toBe(0);
      expect(inquiryCheck(invocation.parsed)?.status).toBe('pass');
    },
    VM_WARM_TIMEOUT_MS
  );

  // Treatment: shadowing `libudev.so.1` makes the usb prebuild's dlopen
  // fail, so `loadUsb` throws, the probe reports USB unavailable, and
  // `deriveStatus` falls to `warn`. With no `/dev/sg*` on the harness the
  // SCSI fallback is also down, so the summary names both transports.
  it(
    'shadowing libudev.so.1 fails the USB load → inquiry-methods warns, doctor exits 2',
    async () => {
      const invocation = await runJsonCommand(
        limaTestVmRunner,
        DOCTOR_JSON_USB_DOWN,
        VM_WARM_TIMEOUT_MS
      );
      expect(invocation.parseError).toBeUndefined();

      const check = inquiryCheck(invocation.parsed);
      expect(check).toBeDefined();
      expect(check?.status).toBe('warn');

      // The USB failure reason is surfaced honestly in the check details —
      // the entire point of the check is that a silent USB loss becomes
      // visible rather than degrading firmware inquiry unnoticed.
      expect(check?.details?.usb?.available).toBe(false);
      expect(check?.details?.usb?.reason).toMatch(/libusb not loadable/i);
      // Summary names USB as unavailable (both transports down on the VM).
      expect(check?.summary).toMatch(/USB.*unavailable/i);

      // A warn check makes the system-scope report non-healthy → exit 2.
      expect((invocation.parsed as SystemDoctorJson).healthy).toBe(false);
      expect(invocation.exitCode).toBe(2);
    },
    VM_WARM_TIMEOUT_MS
  );
});
