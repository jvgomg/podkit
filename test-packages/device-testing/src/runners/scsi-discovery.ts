/**
 * Pure builders for the shell walk that maps a persona's USB descriptor to the
 * SCSI nodes its mass-storage gadget exposes inside a substrate.
 *
 * Every consumer needs the same question answered — *which* `/dev/sd<x>` is
 * this persona's? — and the only reliable answer walks
 * `/sys/class/scsi_generic/sg*` up to the owning USB device and compares
 * `idVendor`/`idProduct`. `ls /dev/sg*` cannot answer it: with two personas
 * bound, the first node is whichever gadget enumerated first.
 *
 * The walk is four levels up from the SCSI leaf
 * (`…/1-1/1-1:1.0/host0/target0:0:0/0:0:0:0` → `…/1-1`), which is why the
 * scripts read `"$sg/device/../../../.."` rather than a fixed depth from the
 * bus root.
 *
 * These live under `runners/` rather than beside their `vm/` callers because
 * the enumeration waits need the same walk, and the dependency direction is
 * one-way: `vm/` composes `runners/`, never the reverse.
 *
 * @module
 */

/**
 * The sysfs class directory holding SCSI generic nodes. Every builder takes
 * it as an overridable argument so the generated script can be pointed at a
 * synthetic tree: the walk depth is the part of these scripts most likely to
 * rot and the only part that cannot be checked by reading the string.
 */
export const SCSI_GENERIC_CLASS_DIR = '/sys/class/scsi_generic';

/** Lower-case 4-hex with no `0x` prefix — the form sysfs uses for USB ids. */
export function hex4(value: number): string {
  return value.toString(16).padStart(4, '0');
}

/**
 * Wrap `body` in the `sg*` → USB-parent walk, running it only for nodes whose
 * owning USB device matches `vendorId`/`productId`. `body` is responsible for
 * printing whatever it found and `exit 0`-ing; falling off the end of the loop
 * exits 1, so "no match" is an exit code rather than empty output a caller
 * might mistake for success.
 *
 * `$sg` (the class entry) and `$usb` (the matched USB device dir) are in scope
 * for `body`.
 */
function matchingScsiGenericWalk(
  vendorId: number,
  productId: number,
  body: readonly string[],
  sysfsClassDir: string = SCSI_GENERIC_CLASS_DIR
): string {
  return [
    `for sg in ${sysfsClassDir}/sg*; do`,
    '  [ -e "$sg" ] || continue;',
    '  usb=$(readlink -f "$sg/device/../../../..");',
    '  [ -f "$usb/idVendor" ] || continue;',
    '  vid=$(cat "$usb/idVendor");',
    '  pid=$(cat "$usb/idProduct");',
    `  if [ "$vid" = "${hex4(vendorId)}" ] && [ "$pid" = "${hex4(productId)}" ]; then`,
    ...body,
    '  fi;',
    'done;',
    'exit 1',
  ].join(' ');
}

/**
 * Build a shell script that prints the bare block-device name (e.g. `sdb`) of
 * the mass-storage LUN belonging to `vendorId`/`productId`, or exits 1.
 *
 * Requiring `$sg/device/block` to be populated is deliberate: an sg node
 * appears before the kernel finishes attaching the disk, and every caller
 * wants the disk. A match with no block entry is "not yet", not a match.
 *
 * Pure — returns a script string for the caller to run through `sh -c`.
 */
export function buildScsiSdDiscoveryScript(
  vendorId: number,
  productId: number,
  sysfsClassDir: string = SCSI_GENERIC_CLASS_DIR
): string {
  return matchingScsiGenericWalk(
    vendorId,
    productId,
    [
      '    blk=$(ls "$sg/device/block" 2>/dev/null | head -n1);',
      '    if [ -n "$blk" ]; then echo "$blk"; exit 0; fi;',
    ],
    sysfsClassDir
  );
}

/**
 * Build a shell script that prints BOTH device nodes for `vendorId`/`productId`
 * on two lines, or exits 1:
 *
 *   line 1: the block device, e.g. `/dev/sdb`
 *   line 2: the USB node,      e.g. `/dev/bus/usb/003/007`
 *
 * The USB node is derived from the matched parent's `busnum`/`devnum`,
 * zero-padded to the 3-digit `/dev/bus/usb/BBB/DDD` layout usbfs uses — the
 * exact path a container must be granted via `--device` for USB passthrough.
 *
 * Pure — returns a script string for the caller to run through `sh -c`.
 */
export function buildDeviceNodeDiscoveryScript(
  vendorId: number,
  productId: number,
  sysfsClassDir: string = SCSI_GENERIC_CLASS_DIR
): string {
  return matchingScsiGenericWalk(
    vendorId,
    productId,
    [
      '    blk=$(ls "$sg/device/block" 2>/dev/null | head -n1);',
      '    [ -n "$blk" ] || continue;',
      '    [ -f "$usb/busnum" ] && [ -f "$usb/devnum" ] || continue;',
      '    bus=$(printf "%03d" "$(cat "$usb/busnum")");',
      '    dev=$(printf "%03d" "$(cat "$usb/devnum")");',
      '    echo "/dev/$blk";',
      '    echo "/dev/bus/usb/$bus/$dev";',
      '    exit 0;',
    ],
    sysfsClassDir
  );
}
