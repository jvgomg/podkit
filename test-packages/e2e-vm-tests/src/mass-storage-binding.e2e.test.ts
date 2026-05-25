/**
 * VM smoke test: dummy-hcd daemon mass-storage gadget binding.
 *
 * Verifies the end-to-end path that's distinct from the FunctionFS-based
 * USB-inquiry path the baseline `personas-baseline.e2e.test.ts` exercises:
 *
 *   - Daemon starts with a `massStorageBackingFile` and no `sysInfoExtendedXml`
 *     (the mass-storage-only branch of `runWithGadget` in
 *     `test-packages/device-testing-daemon/src/main.ts`).
 *   - The kernel enumerates the gadget on `dummy_hcd` and produces both a
 *     `/sys/class/scsi_generic/sg<N>` node (gated by the `sg` module being
 *     loaded in the VM provisioning) and a matching `/dev/sd<N>` block device.
 *   - The FAT32 partition the test built into the backing file is mountable
 *     read+write.
 *   - On daemon stop, both kernel nodes go away and the configfs gadget tree
 *     is removed (no orphans under `/sys/kernel/config/usb_gadget/`).
 *
 * # Why this isn't part of `personas-baseline.e2e.test.ts`
 *
 * The baseline test iterates the starter personas with `withPersona()`, which
 * goes through the production systemd template + the runner-emitted shared
 * sidecar (`/var/device-testing/personas.json`). The starter personas today
 * all set `massStorageBackingFile: null`, so the baseline never exercises the
 * mass-storage branch of the daemon — a future persona migration onto
 * mass-storage backing is where the baseline starts covering it. This
 * file is the standalone tripwire that the daemon's mass-storage path itself
 * works, isolated from persona schema work.
 *
 * # Daemon startup approach
 *
 * The smoke test does NOT use the production systemd template
 * (`dummy-hcd-daemon@.service`): the template hard-codes
 * `--sidecar /var/device-testing/personas.json`, so injecting a synthetic
 * `smoke-test` persona would either overwrite or merge into the runner's
 * shared sidecar — both poison shared VM state. Instead the test writes its
 * own sidecar at `/tmp/smoke-sidecar.json` and runs the daemon directly via
 * `nohup sudo /usr/local/bin/dummy-hcd-daemon`. The daemon PID is rediscovered
 * via `ps -C dummy-hcd-daemon -o pid=` so we can SIGTERM the bun-compiled
 * process (not the sudo wrapper) on teardown.
 *
 * # Why we discover the PID via `ps -C`, not `pkill -f`
 *
 * `pkill -f <pattern>` matches against the full command line, which includes
 * the `sh -c "..."` argv that `limactl shell` synthesises around our command.
 * If the pattern appears in our own argv (as `dummy-hcd-daemon.*smoke-test`
 * does), `pkill` kills its own parent shell and `limactl shell` propagates
 * the resulting ssh disconnect as exit 255. `ps -C <name>` matches only the
 * executable basename, so it never matches its own shell wrapper.
 *
 * # Idempotency
 *
 * Both the per-test `try/finally` and a `beforeAll` purge handle the case
 * where a prior failed test left a daemon process or a configfs gadget tree
 * behind. The cleanup commands are all `|| true`-tolerant of "nothing to
 * clean up".
 *
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  resolveVmAvailability,
} from '@podkit/device-testing';

// ---------------------------------------------------------------------------
// Top-level availability gate (mirrors `personas-baseline.e2e.test.ts`)
// ---------------------------------------------------------------------------

const vmAvailable = await resolveVmAvailability();

// ---------------------------------------------------------------------------
// Smoke-test constants (deterministic so cleanup is targetable)
// ---------------------------------------------------------------------------

const PERSONA_ID = 'smoke-test';
const GADGET_NAME = 'smoke-test';
const VM_IMAGE_PATH = '/tmp/msc-smoke.img';
const VM_SIDECAR_PATH = '/tmp/smoke-sidecar.json';
const VM_DAEMON_LOG = '/tmp/smoke-daemon.log';
const VM_MOUNT_POINT = '/mnt/msc-smoke-test';
/**
 * The executable basename `ps -C` matches on. Matches by basename (not full
 * command line), so it never accidentally matches the test's own
 * `sh -c "..."` wrapper — see the module header for why this matters.
 */
const DAEMON_PROCESS_NAME = 'dummy-hcd-daemon';

/** Synthetic sidecar JSON the daemon will load. Pure mass-storage, no FFS. */
const SIDECAR_JSON = JSON.stringify(
  {
    schemaVersion: 1,
    personas: {
      [PERSONA_ID]: {
        id: PERSONA_ID,
        description: 'mass-storage smoke test (synthetic)',
        usbDescriptor: {
          vendorId: '0x05ac',
          productId: '0x1209',
          serial: 'SMOKE0001',
          manufacturer: 'podkit',
          product: 'smoke-test',
        },
        // Intentionally NO `sysInfoExtendedXml` — exercises the mass-storage-
        // only branch of `runWithGadget`.
        massStorageBackingFile: {
          vmPath: VM_IMAGE_PATH,
          resetStrategy: 'copy',
        },
      },
    },
  },
  null,
  2
);

// ---------------------------------------------------------------------------
// Helpers (shell out into the VM via `limaTestVmRunner.run`)
// ---------------------------------------------------------------------------

interface VmResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function vm(cmd: string, timeoutMs: number = VM_WARM_TIMEOUT_MS): Promise<VmResult> {
  return limaTestVmRunner.run(cmd, { timeoutMs });
}

/**
 * Best-effort cleanup of any lingering smoke-test state from a previous run.
 * Idempotent and tolerant of every kind of "nothing to clean" return.
 */
async function purgeLingeringState(): Promise<void> {
  // Stop any stale daemon process. `ps -C` returns 1 when no match (handled
  // by the `if` gate); the SIGTERM path is `|| true`-tolerant of races where
  // the process exits between the lookup and the kill.
  await vm(
    `if PIDS=$(ps -C ${DAEMON_PROCESS_NAME} -o pid=); then ` +
      `for p in $PIDS; do sudo kill -TERM "$p" 2>/dev/null || true; done; ` +
      `fi`
  );
  // Give the daemon's signal handler a moment to tear the gadget down.
  await vm('sleep 1');
  // Best-effort unmount in case a prior test mounted but never unmounted.
  await vm(`sudo umount ${VM_MOUNT_POINT} 2>/dev/null || true`);
  // Best-effort remove a stranded configfs tree (UDC unbind first so the
  // function dirs aren't EBUSY).
  await vm(
    [
      `if [ -d /sys/kernel/config/usb_gadget/${GADGET_NAME} ]; then`,
      `  sudo sh -c 'echo "" > /sys/kernel/config/usb_gadget/${GADGET_NAME}/UDC' 2>/dev/null || true;`,
      `  sudo rm -f /sys/kernel/config/usb_gadget/${GADGET_NAME}/configs/c.1/mass_storage.0 2>/dev/null || true;`,
      `  sudo rmdir /sys/kernel/config/usb_gadget/${GADGET_NAME}/configs/c.1/strings/0x409 2>/dev/null || true;`,
      `  sudo rmdir /sys/kernel/config/usb_gadget/${GADGET_NAME}/configs/c.1 2>/dev/null || true;`,
      `  sudo rmdir /sys/kernel/config/usb_gadget/${GADGET_NAME}/functions/mass_storage.0/lun.0 2>/dev/null || true;`,
      `  sudo rmdir /sys/kernel/config/usb_gadget/${GADGET_NAME}/functions/mass_storage.0 2>/dev/null || true;`,
      `  sudo rmdir /sys/kernel/config/usb_gadget/${GADGET_NAME}/strings/0x409 2>/dev/null || true;`,
      `  sudo rmdir /sys/kernel/config/usb_gadget/${GADGET_NAME} 2>/dev/null || true;`,
      `fi`,
    ].join(' ')
  );
  await vm(
    `sudo rm -f ${VM_IMAGE_PATH} ${VM_SIDECAR_PATH} ${VM_DAEMON_LOG} ${VM_IMAGE_PATH}.ref || true`
  );
}

/** POSIX single-quote a string for safe shell embedding. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Walk `/sys/class/scsi_generic/` looking for the sg node whose backing USB
 * device has matching `idVendor`/`idProduct`. Returns `{ sg, sd, usbPath }` on
 * a match, or `null` if no such device is currently enumerated.
 */
async function findScsiGenericForGadget(): Promise<{
  sg: string;
  sd: string;
  usbPath: string;
} | null> {
  const script = [
    'for sg in /sys/class/scsi_generic/sg*; do',
    '  [ -e "$sg" ] || continue;',
    '  name=$(basename "$sg");',
    '  usb=$(readlink -f "$sg/device/../../../..");',
    // If the kernel device tree ever gains/loses a level, the walk above will
    // resolve to a node without idVendor — surface that explicitly so a
    // future layout change is self-diagnosing instead of timing out.
    '  if [ ! -f "$usb/idVendor" ]; then echo "WARN: sysfs depth mismatch at $sg (resolved to $usb)" 1>&2; continue; fi;',
    '  vid=$(cat "$usb/idVendor" 2>/dev/null);',
    '  pid=$(cat "$usb/idProduct" 2>/dev/null);',
    '  if [ "$vid" = "05ac" ] && [ "$pid" = "1209" ]; then',
    '    blk=$(ls "$sg/device/block" 2>/dev/null | head -n1);',
    '    echo "$name|$blk|$usb";',
    '    exit 0;',
    '  fi;',
    'done;',
    'exit 1',
  ].join(' ');
  const result = await vm(`sh -c ${shQuote(script)}`);
  if (result.exitCode !== 0 || result.stdout.trim() === '') return null;
  const [sg, sd, usbPath] = result.stdout.trim().split('|');
  if (!sg || !sd || !usbPath) return null;
  return { sg, sd, usbPath };
}

/**
 * Poll `findScsiGenericForGadget` until it returns a match or `timeoutMs`
 * elapses. Returns the match, or throws with a descriptive message on timeout
 * (including the last daemon log content for debuggability).
 */
async function waitForScsiNodes(
  timeoutMs: number = 5000
): Promise<{ sg: string; sd: string; usbPath: string }> {
  const deadline = Date.now() + timeoutMs;
  let last: { sg: string; sd: string; usbPath: string } | null = null;
  while (Date.now() < deadline) {
    last = await findScsiGenericForGadget();
    if (last !== null) return last;
    await sleep(150);
  }
  const log = await vm(`cat ${VM_DAEMON_LOG} 2>/dev/null || true`);
  throw new Error(
    `waitForScsiNodes: timed out after ${timeoutMs}ms with no matching ` +
      `/sys/class/scsi_generic/* for vid=05ac pid=1209.\n` +
      `Daemon log:\n${log.stdout || '(empty)'}`
  );
}

/** Poll until both nodes are gone (cleanup verification). */
async function waitForScsiNodesGone(timeoutMs: number = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = await findScsiGenericForGadget();
    if (match === null) return;
    await sleep(150);
  }
  throw new Error(
    `waitForScsiNodesGone: a matching /sys/class/scsi_generic/* node is still ` +
      `present ${timeoutMs}ms after daemon teardown.`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!vmAvailable)('VM: dummy-hcd mass-storage smoke', () => {
  beforeAll(async () => {
    // Boot the VM, transfer the daemon binary, etc. The runner's prepare()
    // is idempotent.
    await limaTestVmRunner.prepare();
    // Defensive: scrub any leftover state from a prior failed run.
    await purgeLingeringState();
  }, VM_COLD_TIMEOUT_MS);

  afterAll(async () => {
    // Final scrub on the way out so we don't leave the VM in a half-bound
    // state for the next test session.
    await purgeLingeringState();
    await limaTestVmRunner.teardown();
  }, VM_COLD_TIMEOUT_MS);

  it(
    'binds a synthetic FAT32 mass-storage gadget, mounts r/w, then tears down cleanly',
    async () => {
      try {
        // 1. Build a 64MB FAT32 image inside the VM.
        const truncate = await vm(`truncate -s 64M ${VM_IMAGE_PATH}`);
        expect(truncate.exitCode).toBe(0);
        const mkfs = await vm(`sudo mkfs.vfat -F 32 -n SMOKE ${VM_IMAGE_PATH}`);
        expect(mkfs.exitCode).toBe(0);

        // 2. Write the synthetic sidecar JSON into the VM. /tmp is tmpfs, so
        //    a plain redirect works — no sudo needed.
        const writeSidecar = await vm(
          `cat > ${VM_SIDECAR_PATH} << '__SMOKE_SIDECAR_EOF__'\n${SIDECAR_JSON}\n__SMOKE_SIDECAR_EOF__`
        );
        expect(writeSidecar.exitCode).toBe(0);

        // 3. Start the daemon under `nohup sudo`. We don't capture the sudo
        //    PID — we re-discover the actual daemon PID via pgrep on teardown.
        const start = await vm(
          `sudo nohup /usr/local/bin/dummy-hcd-daemon ` +
            `--persona ${PERSONA_ID} ` +
            `--sidecar ${VM_SIDECAR_PATH} ` +
            `--gadget-name ${GADGET_NAME} ` +
            `> ${VM_DAEMON_LOG} 2>&1 & echo started`
        );
        expect(start.exitCode).toBe(0);

        // 4. Poll for the SCSI generic + block-device nodes. 5s is plenty for
        //    dummy_hcd enumeration on a warm VM; first-run may take longer
        //    while the kernel sets things up.
        const nodes = await waitForScsiNodes(5000);
        expect(nodes.sg).toMatch(/^sg\d+$/);
        expect(nodes.sd).toMatch(/^sd[a-z]+$/);

        // 5. Mount the FAT32 partition r/w and round-trip a byte.
        await vm(`sudo mkdir -p ${VM_MOUNT_POINT}`);
        const mount = await vm(`sudo mount -t vfat /dev/${nodes.sd} ${VM_MOUNT_POINT}`);
        expect(mount.exitCode).toBe(0);

        const write = await vm(`echo hello | sudo tee ${VM_MOUNT_POINT}/test.txt >/dev/null`);
        expect(write.exitCode).toBe(0);

        const read = await vm(`cat ${VM_MOUNT_POINT}/test.txt`);
        expect(read.exitCode).toBe(0);
        expect(read.stdout.trim()).toBe('hello');

        // Unmount before we kill the daemon — keeps the kernel's reference
        // count tidy and avoids racing with the daemon's unbind.
        const umount = await vm(`sudo umount ${VM_MOUNT_POINT}`);
        expect(umount.exitCode).toBe(0);

        // 6. Stop the daemon and wait for full cleanup. We SIGTERM the
        //    underlying bun-compiled process (not the sudo wrapper) so the
        //    daemon's signal handler fires. `ps -C <name>` matches by
        //    basename, so we never SIGTERM ourselves (see module header).
        const stop = await vm(
          `PID=$(ps -C ${DAEMON_PROCESS_NAME} -o pid= | tr -d ' '); ` +
            `if [ -n "$PID" ]; then sudo kill -TERM "$PID"; fi; echo "killed=$PID"`
        );
        expect(stop.exitCode).toBe(0);
        // Must have actually had a daemon running before this point.
        expect(stop.stdout.trim()).toMatch(/^killed=\d+$/);

        await waitForScsiNodesGone(5000);

        // Verify no orphan configfs entries.
        const orphan = await vm(
          `if [ -d /sys/kernel/config/usb_gadget/${GADGET_NAME} ]; then ` +
            `echo present; else echo absent; fi`
        );
        expect(orphan.exitCode).toBe(0);
        expect(orphan.stdout.trim()).toBe('absent');
      } finally {
        // Defensive cleanup — runs even on assertion failure so the next
        // test (or next session) sees a clean VM.
        await purgeLingeringState();
      }
    },
    // The test does its own polling, but give it a generous outer budget so
    // a slow VM doesn't surface as a Bun-level timeout (which would mask the
    // real failure).
    VM_WARM_TIMEOUT_MS * 3
  );
});
