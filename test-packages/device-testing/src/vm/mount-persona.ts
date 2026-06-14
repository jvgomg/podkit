/**
 * Per-persona FAT32 mount + daemon lifecycle for doctor / sync VM tests.
 *
 * Encapsulates the boilerplate shared across every Tier-3 test that needs
 * the production `podkit` CLI to act against a real FAT32 backing file
 * (instead of just consuming the USB-descriptor side of the persona):
 *
 *   1. start `dummy-hcd-daemon@<personaId>.service`
 *   2. wait for `/dev/sg*` enumeration
 *   3. find the matching `/dev/sd<x>` block device by vendor/product ID
 *   4. mount it with `uid=$(id -u),gid=$(id -g)` so podkit's
 *      writable-device readiness gate passes (the FAT mount-as-root
 *      default makes the filesystem read-only to the user running podkit)
 *
 * The teardown helper undoes the same steps in reverse, best-effort.
 *
 * # Why this lives here
 *
 * `withPersona()` already wraps the daemon-only lifecycle (no mount). It
 * works for FunctionFS-only tests where the device is examined through
 * the USB descriptor / SCSI inquiry surface. As soon as a test needs to
 * read or write the FAT32 backing — which every doctor / sync / repair
 * test does — the mount-and-uid plumbing is necessary. Until this
 * helper, each test file rebuilt the same ~50 lines of shell. Each
 * rebuild was an opportunity to forget the `uid=$(id -u),gid=$(id -g)`
 * option, which silently breaks doctor's writable-device gate and makes
 * device-bound checks vanish from the JSON envelope with no error.
 *
 * # Limitations
 *
 *   - Single-LUN personas only. The shell script walks
 *     `/sys/class/scsi_generic/sg*` and returns the first match; a
 *     persona with two LUNs at the same vendor/product would need a more
 *     specific filter.
 *   - The mount fallback retries `/dev/sd<x>1` if `/dev/sd<x>` fails —
 *     this covers the partitioned-vs-bare-FAT split the synthesised
 *     backing files use today. A future persona shape (e.g. GPT) would
 *     need a different probe.
 *   - The user is whoever invoked `limactl shell` (Lima maps the host
 *     user). If a future test runs podkit as root via sudo, the
 *     `uid/gid` mount option becomes incorrect but harmless — root can
 *     write either way.
 *
 * @module
 */

import {
  LIMA_DEVICE_HARNESS_VM_NAME,
  startDaemonForPersona,
  stopDaemon,
  limaTestVmRunner,
} from '../runners/lima-test-vm.js';
import { waitForScsiGenericEnumeration } from './persona-fixture.js';
import { VM_WARM_TIMEOUT_MS } from './vm-runtime-setup.js';

// ---------------------------------------------------------------------------
// SCSI-generic discovery
// ---------------------------------------------------------------------------

/**
 * Build a shell script that walks `/sys/class/scsi_generic/sg*` and prints
 * the first `/dev/sd<x>` whose USB parent matches `vendorId`/`productId`.
 *
 * Pure — returns a script string. Caller runs it via `limactl shell`.
 *
 * @internal exported for tests + advanced callers; most tests should
 * use {@link mountPersona} which composes this helper.
 */
export function buildScsiSdDiscoveryScript(vendorId: number, productId: number): string {
  const vidHex = vendorId.toString(16).padStart(4, '0');
  const pidHex = productId.toString(16).padStart(4, '0');
  return [
    'for sg in /sys/class/scsi_generic/sg*; do',
    '  [ -e "$sg" ] || continue;',
    '  usb=$(readlink -f "$sg/device/../../../..");',
    '  [ -f "$usb/idVendor" ] || continue;',
    '  vid=$(cat "$usb/idVendor");',
    '  pid=$(cat "$usb/idProduct");',
    `  if [ "$vid" = "${vidHex}" ] && [ "$pid" = "${pidHex}" ]; then`,
    '    blk=$(ls "$sg/device/block" 2>/dev/null | head -n1);',
    '    if [ -n "$blk" ]; then echo "$blk"; exit 0; fi;',
    '  fi;',
    'done;',
    'exit 1',
  ].join(' ');
}

// ---------------------------------------------------------------------------
// mountPersona / unmountAndStop
// ---------------------------------------------------------------------------

/** Options for {@link mountPersona}. */
export interface MountPersonaOpts {
  /** Persona id — used as the systemd instance specifier. */
  personaId: string;
  /** Persona's USB vendor ID, used to disambiguate the `/dev/sd<x>` node. */
  vendorId: number;
  /** Persona's USB product ID, used to disambiguate the `/dev/sd<x>` node. */
  productId: number;
  /** Absolute path inside the VM where the FAT32 backing will be mounted. */
  mountPoint: string;
  /** Lima instance name. Defaults to {@link LIMA_DEVICE_HARNESS_VM_NAME}. */
  vmName?: string;
}

/**
 * Start the daemon for `opts.personaId`, find its `/dev/sd<x>` node, and
 * mount the FAT32 backing at `opts.mountPoint` with `uid/gid` set to the
 * current Lima user. After this returns, podkit invocations targeting
 * `-d <opts.mountPoint>` see a `ready`-readiness iPod backing file.
 *
 * Throws if the daemon can't find a matching `/dev/sd<x>` within the
 * polling window, or if both the bare-device and `sdN1` mount attempts
 * fail. On any throw, the caller is responsible for `unmountAndStop` —
 * this function does NOT roll back partial state, to keep the
 * diagnostic message clean.
 */
export async function mountPersona(opts: MountPersonaOpts): Promise<void> {
  const vmName = opts.vmName ?? LIMA_DEVICE_HARNESS_VM_NAME;
  await startDaemonForPersona({ vmName, personaId: opts.personaId });
  await waitForScsiGenericEnumeration({
    vmName,
    personaId: opts.personaId,
    timeoutMs: 5_000,
  });

  const findScript = buildScsiSdDiscoveryScript(opts.vendorId, opts.productId);
  const find = await limaTestVmRunner.run(`sh -c '${findScript.replace(/'/g, `'\\''`)}'`, {
    timeoutMs: VM_WARM_TIMEOUT_MS,
  });
  if (find.exitCode !== 0 || !find.stdout.trim()) {
    throw new Error(
      `mountPersona: failed to find ${opts.personaId} /dev/sd* node ` +
        `(exit=${find.exitCode}, stdout="${find.stdout}")`
    );
  }
  const scsiSd = find.stdout.trim();

  await limaTestVmRunner.run(`sudo mkdir -p ${opts.mountPoint}`, {
    timeoutMs: VM_WARM_TIMEOUT_MS,
  });
  const mount = await limaTestVmRunner.run(
    `sudo mount -t vfat -o uid=$(id -u),gid=$(id -g) /dev/${scsiSd} ${opts.mountPoint}`,
    { timeoutMs: VM_WARM_TIMEOUT_MS }
  );
  if (mount.exitCode !== 0) {
    const mountP1 = await limaTestVmRunner.run(
      `sudo mount -t vfat -o uid=$(id -u),gid=$(id -g) /dev/${scsiSd}1 ${opts.mountPoint}`,
      { timeoutMs: VM_WARM_TIMEOUT_MS }
    );
    if (mountP1.exitCode !== 0) {
      throw new Error(
        `mountPersona: failed to mount /dev/${scsiSd} OR /dev/${scsiSd}1 at ${opts.mountPoint}: ` +
          `${mount.stderr.trim()} | ${mountP1.stderr.trim()}`
      );
    }
  }
}

/** Options for {@link unmountAndStop}. */
export interface UnmountAndStopOpts {
  personaId: string;
  mountPoint: string;
  vmName?: string;
}

/**
 * Unmount `mountPoint`, remove the mount dir, and stop the persona
 * daemon. Best-effort: every step swallows its own failure so partial
 * teardown still completes (e.g. stop the daemon even if the umount
 * raced a kernel reference). Intended for `afterAll`.
 */
export async function unmountAndStop(opts: UnmountAndStopOpts): Promise<void> {
  const vmName = opts.vmName ?? LIMA_DEVICE_HARNESS_VM_NAME;
  await limaTestVmRunner
    .run(`sudo umount ${opts.mountPoint} 2>/dev/null || true`, {
      timeoutMs: VM_WARM_TIMEOUT_MS,
    })
    .catch(() => {});
  await limaTestVmRunner
    .run(`sudo rmdir ${opts.mountPoint} 2>/dev/null || true`, {
      timeoutMs: VM_WARM_TIMEOUT_MS,
    })
    .catch(() => {});
  await stopDaemon({ vmName, personaId: opts.personaId }).catch(() => {});
}
