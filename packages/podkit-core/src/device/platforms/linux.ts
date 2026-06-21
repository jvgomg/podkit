/**
 * Linux device manager implementation
 *
 * Uses lsblk for block-device enumeration and udisksctl/mount for
 * mounting and unmounting devices.
 *
 * Required: lsblk (from util-linux)
 * Optional: udisksctl (from udisks2) for unprivileged mount/eject
 *
 * ## USB-only devices
 *
 * `scan({ kinds: ['ipod'] })` returns only iPods that lsblk sees as mounted
 * block devices. The complementary USB-walk path that surfaces vendor-only
 * Apple devices (iPod 6G in restore mode, FunctionFS-synthesised VM-test
 * personas with `massStorageBackingFile: null`) lives in
 * `../usb-enumeration.ts` (`enumerateUsb`, which reads
 * `/sys/bus/usb/devices/` directly) and is composed with
 * `scan({ kinds: ['ipod'] })` by the `device scan` CLI runner. See TASK-334
 * for the rationale: the join
 * happens at the scan layer so the same composition works on macOS, where
 * the USB walk reads `system_profiler` output.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  DeviceManager,
  PlatformDeviceInfo,
  PartitionLayout,
  PartitionLayoutEntry,
  EjectResult,
  MountResult,
  EjectOptions,
  MountOptions,
} from '../types.js';
import type { DeviceAssessment } from '../assessment.js';
import { detectIFlash } from '../assessment.js';
import type { SubprocessRunner, UsbFingerprint } from '@podkit/device-types';
import { defaultSubprocessRunner } from '../../subprocess-runner.js';

// ---------------------------------------------------------------------------
// Shell execution helper
// ---------------------------------------------------------------------------

/**
 * Execute a command via the injected `SubprocessRunner` and normalise the
 * result into the historical `{ stdout, stderr, code }` shape so the rest
 * of the file is left untouched. Transport-level rejections from the runner
 * (e.g. binary not found) collapse into `code: 1` to preserve the legacy
 * behaviour of returning rather than throwing — every caller in this file
 * already inspects `code` to decide whether to act on `stdout`.
 */
async function execCommand(
  command: string,
  args: string[],
  subprocess: SubprocessRunner
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const result = await subprocess.run(command, args);
    return { stdout: result.stdout, stderr: result.stderr, code: result.exitCode };
  } catch (err) {
    return {
      stdout: '',
      stderr: err instanceof Error ? err.message : String(err),
      code: 1,
    };
  }
}

// ---------------------------------------------------------------------------
// lsblk JSON parser
// ---------------------------------------------------------------------------

/** Shape of a single device entry from lsblk --json -b output */
interface LsblkDevice {
  name: string;
  uuid: string | null;
  label: string | null;
  mountpoint: string | null;
  /** Newer kernels (5.14+ / util-linux 2.38+) use an array instead of a string */
  mountpoints?: (string | null)[];
  fstype: string | null;
  size: number | null;
  'phy-sec': number | null;
  type: string;
  children?: LsblkDevice[];
}

/** Top-level lsblk --json output */
interface LsblkOutput {
  blockdevices: LsblkDevice[];
}

/**
 * Recursively collect all block devices of type "part" from lsblk output.
 * lsblk nests partitions under their parent disk as children.
 *
 * Skips children of loop devices — their partitions (e.g. loop0p1) are
 * loop-mounted images, not real hardware. The virtual iPod server uses
 * private loop mounts for serving iPod filesystems; these must not appear
 * in device scans.
 */
export function collectPartitions(devices: LsblkDevice[]): LsblkDevice[] {
  const partitions: LsblkDevice[] = [];

  for (const device of devices) {
    if (device.type === 'part') {
      partitions.push(device);
    }
    if (device.children && device.type !== 'loop') {
      partitions.push(...collectPartitions(device.children));
    }
  }

  return partitions;
}

/**
 * Build a `PartitionLayout` payload describing every partition on a whole
 * disk. Includes partitions without a UUID (firmware, free space, etc.) so
 * the layout reflects the partition table as the kernel sees it. The
 * returned layout is intentionally a snapshot of the disk; sibling
 * `PlatformDeviceInfo` entries reference the same payload.
 */
function buildPartitionLayout(diskChildren: LsblkDevice[] | undefined): PartitionLayout {
  const partitions: PartitionLayoutEntry[] = [];
  let index = 1;
  for (const child of diskChildren ?? []) {
    if (child.type !== 'part') continue;
    const entry: PartitionLayoutEntry = {
      index,
      filesystem: child.fstype ?? null,
      sizeBytes: child.size ?? 0,
      identifier: child.name,
      ...(child.uuid ? { volumeUuid: child.uuid } : {}),
    };
    partitions.push(entry);
    index += 1;
  }
  return { partitionCount: partitions.length, partitions };
}

/**
 * Parse lsblk JSON output into PlatformDeviceInfo array.
 *
 * Exported for unit testing — this is a pure function with no I/O.
 *
 * @param jsonString - Raw stdout from `lsblk --json -b -o NAME,UUID,LABEL,MOUNTPOINT,FSTYPE,SIZE,PHY-SEC,TYPE`
 * @returns Array of device info for partitions with UUIDs
 */
export function parseLsblkJson(jsonString: string): PlatformDeviceInfo[] {
  let parsed: LsblkOutput;
  try {
    parsed = JSON.parse(jsonString) as LsblkOutput;
  } catch {
    return [];
  }

  if (!parsed.blockdevices) {
    return [];
  }

  const devices: PlatformDeviceInfo[] = [];

  /**
   * Build the discriminated mount-state union (TASK-340 schema v2). Returns
   * either `{ isMounted: true, mountPoint }` or `{ isMounted: false }` so
   * the caller cannot accidentally emit the mixed
   * `{ isMounted: true, mountPoint: undefined }` shape the old schema
   * allowed.
   */
  function mountState(part: LsblkDevice):
    | {
        isMounted: true;
        mountPoint: string;
      }
    | { isMounted: false } {
    const rawMount =
      part.mountpoint ??
      part.mountpoints?.find((m) => m !== null && m !== undefined && m !== '') ??
      null;
    if (rawMount !== null && rawMount !== '') {
      return { isMounted: true, mountPoint: rawMount };
    }
    return { isMounted: false };
  }

  // Walk disks so we can compute a per-disk partitionLayout payload once
  // and attach it to every emitted sibling partition. Loop-device children
  // are skipped here for the same reason `collectPartitions` skips them.
  function walk(nodes: LsblkDevice[]): void {
    for (const node of nodes) {
      if (node.type === 'disk' && node.children?.length) {
        const layout = buildPartitionLayout(node.children);
        for (const part of node.children) {
          if (part.type !== 'part') continue;
          // Skip partitions without UUID (not user-formatted partitions) —
          // they're still represented in `layout.partitions` so consumers
          // see the full partition table.
          if (!part.uuid) continue;

          devices.push({
            identifier: part.name,
            volumeName: part.label ?? '',
            volumeUuid: part.uuid,
            mediaType: '',
            storage: {
              sizeBytes: part.size ?? 0,
              ...(part['phy-sec'] !== null ? { blockSizeBytes: part['phy-sec'] } : {}),
              ...(part.fstype ? { filesystem: part.fstype } : {}),
              partitionLayout: layout,
            },
            ...mountState(part),
          });
        }
      } else if (node.type === 'part' && node.uuid) {
        // Top-level "part" entries (rare — lsblk normally nests under a disk).
        // Synthesise a single-partition layout so callers always have one.
        devices.push({
          identifier: node.name,
          volumeName: node.label ?? '',
          volumeUuid: node.uuid,
          mediaType: '',
          storage: {
            sizeBytes: node.size ?? 0,
            ...(node['phy-sec'] !== null ? { blockSizeBytes: node['phy-sec'] } : {}),
            ...(node.fstype ? { filesystem: node.fstype } : {}),
            partitionLayout: {
              partitionCount: 1,
              partitions: [
                {
                  index: 1,
                  filesystem: node.fstype ?? null,
                  sizeBytes: node.size ?? 0,
                  identifier: node.name,
                  ...(node.uuid ? { volumeUuid: node.uuid } : {}),
                },
              ],
            },
          },
          ...mountState(node),
        });
      }
      if (node.children && node.type !== 'loop' && node.type !== 'disk') {
        walk(node.children);
      }
    }
  }

  walk(parsed.blockdevices);
  return devices;
}

/**
 * Parse one line of `findmnt --pairs` output (`KEY="value" KEY="value" …`)
 * into a record. Values are double-quoted; embedded `\"` is unescaped. Empty
 * values (`UUID=""`) are preserved as empty strings so UUID-less mounts stay
 * distinguishable from absent columns.
 *
 * Exported for unit testing — pure, no I/O.
 */
export function parseFindmntPairs(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(\w+)="((?:[^"\\]|\\.)*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    out[match[1]!] = match[2]!.replace(/\\(.)/g, '$1');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Partition suffix stripping
// ---------------------------------------------------------------------------

/**
 * Strip partition suffix from a block device name to get the base disk name.
 *
 * Handles the three conventions encountered across the platforms podkit
 * targets — Linux block devices and macOS BSD names. Reconciliation between
 * the USB-inquiry pipeline (which carries macOS `bsd_name` from
 * `system_profiler`) and the block-device pipeline routes through here too,
 * which is why the macOS branch lives in this otherwise-Linux file.
 *
 * - macOS BSD: `disk2s1` → `disk2`, `disk5s2` → `disk5`
 * - Linux NVMe/Synology/eMMC (base ends in digit): `nvme0n1p2` → `nvme0n1`,
 *   `mmcblk0p1` → `mmcblk0`, `usb1p2` → `usb1`
 * - Linux SCSI/IDE/virtio (base ends in letter): `sdb1` → `sdb`,
 *   `vdb2` → `vdb`
 *
 * Bare disk names without a partition suffix pass through unchanged.
 */
export function stripPartitionSuffix(name: string): string {
  // macOS: `disk<N>s<M>` → `disk<N>`. Guard with `disk\d+` prefix to avoid
  // spurious matches against Linux names ending in `s\d+`.
  const macMatch = name.match(/^(.*?)s\d+$/);
  if (macMatch && macMatch[1] && /^disk\d+$/.test(macMatch[1])) {
    return macMatch[1];
  }

  // Convention 1: NVMe, eMMC, Synology USB, and similar devices where
  // the base disk name ends in a digit and partitions use a "p" separator.
  // Examples: nvme0n1p2 → nvme0n1, usb1p2 → usb1, mmcblk0p1 → mmcblk0
  const pSuffixMatch = name.match(/^(.+\d)p\d+$/);
  if (pSuffixMatch) {
    return pSuffixMatch[1]!;
  }

  // Convention 2: Standard SCSI/IDE/virtio devices (sd*, hd*, vd*, xvd*)
  // where the disk name ends in a letter and partitions append digits directly.
  // Examples: sda1 → sda, vdb2 → vdb, xvda1 → xvda
  //
  // We match specific known prefixes rather than any all-alpha name to avoid
  // stripping trailing digits from bare disk names like mmcblk0 or loop0.
  const standardMatch = name.match(/^((?:sd|hd|vd|xvd|dasd)[a-z])\d+$/);
  if (standardMatch) {
    return standardMatch[1]!;
  }

  // No partition suffix detected — return unchanged
  return name;
}

// ---------------------------------------------------------------------------
// USB identity from /sys
// ---------------------------------------------------------------------------

/**
 * Find USB device info for a block device by reading /sys.
 *
 * Walks /sys/bus/usb/devices/ looking for a USB device whose child block
 * device matches the given name (e.g., "sda"). Returns vendor/product IDs.
 */
function findUsbIdentity(blockDeviceName: string): UsbFingerprint | undefined {
  // Strip partition suffix to get the base device (sda1 → sda, nvme0n1p2 → nvme0n1)
  const baseName = stripPartitionSuffix(blockDeviceName);

  try {
    // Check /sys/block/<device>/device for a symlink to the USB device
    const deviceLink = `/sys/block/${baseName}/device`;
    if (!existsSync(deviceLink)) return undefined;

    // Resolve the symlink to the real sysfs path so `resolve(p, '..')` walks
    // up the REAL device chain (`/sys/devices/.../usb<N>/<port>`) rather
    // than the logical path (`/sys/block/<dev>`). Without realpathSync, the
    // walk would go `/sys/block/<dev>/device` → `/sys/block/<dev>` → `/sys`
    // and never reach the USB device's `idVendor` — silently dropping every
    // iPod that doesn't fast-track via the volume-name heuristic later.
    let sysPath: string;
    try {
      sysPath = realpathSync(deviceLink);
    } catch {
      return undefined;
    }

    // Walk up to 10 levels to find the USB device attributes
    for (let i = 0; i < 10; i++) {
      const vendorPath = join(sysPath, 'idVendor');
      const productPath = join(sysPath, 'idProduct');

      if (existsSync(vendorPath) && existsSync(productPath)) {
        // sysfs idVendor/idProduct are bare hex without 0x prefix (e.g. "05ac")
        const vendorId = readFileSync(vendorPath, 'utf-8').trim().toLowerCase();
        const productId = readFileSync(productPath, 'utf-8').trim().toLowerCase();

        const info: UsbFingerprint = {
          productId,
          vendorId,
        };

        // Read optional USB identity fields from the same sysfs node
        const serialPath = join(sysPath, 'serial');
        if (existsSync(serialPath)) {
          const serial = readFileSync(serialPath, 'utf-8').trim();
          if (serial.length > 0) info.serialNumber = serial;
        }

        const busnumPath = join(sysPath, 'busnum');
        if (existsSync(busnumPath)) {
          const busnum = parseInt(readFileSync(busnumPath, 'utf-8').trim(), 10);
          if (Number.isFinite(busnum)) info.bus = busnum;
        }

        const devnumPath = join(sysPath, 'devnum');
        if (existsSync(devnumPath)) {
          const devnum = parseInt(readFileSync(devnumPath, 'utf-8').trim(), 10);
          if (Number.isFinite(devnum)) info.devnum = devnum;
        }

        return info;
      }

      // Move up one directory
      const parent = resolve(sysPath, '..');
      if (parent === sysPath) break;
      sysPath = parent;
    }
  } catch {
    // /sys may not be available (e.g., in containers)
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// LinuxDeviceManager
// ---------------------------------------------------------------------------

export class LinuxDeviceManager implements DeviceManager {
  readonly platform = 'linux';
  readonly isSupported = true;

  /**
   * Injected `SubprocessRunner` used by every `lsblk` / `mount` / `umount` /
   * `udisksctl` / `which` invocation in this class. Defaults to the real
   * `execFile`-backed runner; tests construct the manager with a fake
   * `SubprocessRunner` (e.g. a hand-rolled stub returning canned stdout).
   */
  private readonly subprocess: SubprocessRunner;

  /**
   * Resolver for the `/sys` USB fingerprint of a block device, injectable so
   * tests can stand in an Apple-vendor descriptor without a real sysfs tree.
   * Defaults to the real `findUsbIdentity` (`/sys/bus/usb` walk).
   */
  private readonly usbIdentityResolver: (blockDeviceName: string) => UsbFingerprint | undefined;

  // Lazy-cached tool availability
  private _lsblkAvailable: boolean | null = null;
  private _udisksctlAvailable: boolean | null = null;

  constructor(
    opts: {
      subprocess?: SubprocessRunner;
      usbIdentityResolver?: (blockDeviceName: string) => UsbFingerprint | undefined;
    } = {}
  ) {
    this.subprocess = opts.subprocess ?? defaultSubprocessRunner;
    this.usbIdentityResolver = opts.usbIdentityResolver ?? findUsbIdentity;
  }

  // ------------------------------------------------------------------
  // Tool detection
  // ------------------------------------------------------------------

  /**
   * Check whether lsblk is available. Throws if not found since it's required.
   */
  async requireLsblk(): Promise<void> {
    if (this._lsblkAvailable === true) return;
    if (this._lsblkAvailable === false) {
      throw new Error(
        'lsblk is required but not found.\n\n' +
          'Install it:\n' +
          '  Debian/Ubuntu: sudo apt install util-linux\n' +
          '  Alpine:        apk add util-linux'
      );
    }

    const { code } = await execCommand('which', ['lsblk'], this.subprocess);
    this._lsblkAvailable = code === 0;

    if (!this._lsblkAvailable) {
      throw new Error(
        'lsblk is required but not found.\n\n' +
          'Install it:\n' +
          '  Debian/Ubuntu: sudo apt install util-linux\n' +
          '  Alpine:        apk add util-linux'
      );
    }
  }

  /**
   * Check whether udisksctl is available (optional, used for unprivileged mount/eject).
   */
  async hasUdisksctl(): Promise<boolean> {
    if (this._udisksctlAvailable !== null) return this._udisksctlAvailable;

    const { code } = await execCommand('which', ['udisksctl'], this.subprocess);
    this._udisksctlAvailable = code === 0;
    return this._udisksctlAvailable;
  }

  // ------------------------------------------------------------------
  // Device enumeration
  // ------------------------------------------------------------------

  /**
   * Enumerate every attached partition (the legacy `listDevices` body),
   * shared by `scan()` and the internal device-lookup helpers.
   */
  private async enumerateDevices(): Promise<PlatformDeviceInfo[]> {
    await this.requireLsblk();

    const { stdout, code } = await execCommand(
      'lsblk',
      ['--json', '-b', '-o', 'NAME,UUID,LABEL,MOUNTPOINT,FSTYPE,SIZE,PHY-SEC,TYPE'],
      this.subprocess
    );

    if (code !== 0) {
      return [];
    }

    return parseLsblkJson(stdout);
  }

  async scan(options?: {
    kinds?: ReadonlyArray<'ipod' | 'mass-storage'>;
  }): Promise<PlatformDeviceInfo[]> {
    const devices = await this.enumerateDevices();
    // Only the `ipod` filter is implemented at this layer; `mass-storage`
    // filtering needs preset matching that lives above the manager. Any
    // `kinds` not including `'ipod'` (including `['mass-storage']`) returns the
    // full enumerate. The iPod path additionally attaches the /sys USB
    // fingerprint (the reconciler depends on it); plain `scan()` does not.
    if (!options?.kinds?.includes('ipod')) {
      return devices;
    }
    return this.filterIpods(devices);
  }

  async locate(
    target: { volumeUuid: string } | { path: string }
  ): Promise<PlatformDeviceInfo | null> {
    return 'volumeUuid' in target
      ? this.locateByVolumeUuid(target.volumeUuid)
      : this.locateByPath(target.path);
  }

  /**
   * Resolve a Volume UUID directly to its device node, then run a single
   * `lsblk` on that node — avoids enumerating every attached device.
   * Prefers `/dev/disk/by-uuid/<uuid>` (realpath) and falls back to
   * `blkid -U <uuid>`. Returns `null` when the UUID resolves to nothing or
   * when the probe binary is missing (non-zero exit → degrade, not throw).
   */
  private async locateByVolumeUuid(uuid: string): Promise<PlatformDeviceInfo | null> {
    let nodePath: string | null = null;

    const byUuidLink = `/dev/disk/by-uuid/${uuid}`;
    try {
      if (existsSync(byUuidLink)) {
        nodePath = realpathSync(byUuidLink);
      }
    } catch {
      nodePath = null;
    }

    if (!nodePath) {
      const { stdout, code } = await execCommand('blkid', ['-U', uuid], this.subprocess);
      if (code !== 0) return null;
      const resolved = stdout.trim();
      if (!resolved) return null;
      nodePath = resolved;
    }

    // Intentionally no `requireLsblk()` here (unlike enumerate/mount/eject):
    // `locate` degrades to null on a missing binary rather than throwing.
    const { stdout, code } = await execCommand(
      'lsblk',
      ['--json', '-b', '-o', 'NAME,UUID,LABEL,MOUNTPOINT,FSTYPE,SIZE,PHY-SEC,TYPE', nodePath],
      this.subprocess
    );
    if (code !== 0) return null;

    const devices = parseLsblkJson(stdout);
    const normalizedUuid = uuid.toUpperCase();
    return devices.find((d) => d.volumeUuid.toUpperCase() === normalizedUuid) ?? null;
  }

  /**
   * Resolve a path to the volume mounted at (or containing) it via a single
   * `findmnt`, then synthesise a `PlatformDeviceInfo` from its source / UUID /
   * label / fstype. UUID-less but mounted volumes (tmpfs / Docker bind /
   * FunctionFS) return a record with `volumeUuid: ''` and a valid mount point
   * so path-mode resolution can proceed. Returns `null` when nothing is
   * mounted at the target or the binary is missing.
   */
  private async locateByPath(path: string): Promise<PlatformDeviceInfo | null> {
    // One findmnt resolves the path to its enclosing mount. `--pairs` emits
    // `KEY="value"` so empty fields (UUID-less tmpfs / FunctionFS) stay
    // unambiguous — positional splitting on whitespace would collapse them.
    // This keeps `locate({ path })` to exactly one direct OS call.
    const { stdout, code } = await execCommand(
      'findmnt',
      ['--pairs', '-o', 'SOURCE,UUID,LABEL,FSTYPE,TARGET', '--target', path],
      this.subprocess
    );
    if (code !== 0) return null;

    const line = stdout.split('\n').find((l) => l.trim() !== '');
    if (!line) return null;

    const pairs = parseFindmntPairs(line);
    const source = pairs['SOURCE'] ?? '';
    const uuid = pairs['UUID'] ?? '';
    const label = pairs['LABEL'] ?? '';
    const fstype = pairs['FSTYPE'] ?? '';
    const target = pairs['TARGET'] || path;

    // A bare findmnt --target that resolves nothing still exits 0 with empty
    // output; guard against a row that carries no mount target.
    if (!source && !target) return null;

    // Derive a kernel identifier (sda1) from the device-node source.
    const identifier = source.startsWith('/dev/') ? source.slice('/dev/'.length) : source;

    return {
      identifier,
      volumeName: label,
      volumeUuid: uuid,
      mediaType: '',
      storage: { sizeBytes: 0, ...(fstype ? { filesystem: fstype } : {}) },
      isMounted: true,
      mountPoint: target,
    };
  }

  // ------------------------------------------------------------------
  // iPod detection
  // ------------------------------------------------------------------

  /**
   * Classify enumerated partitions down to iPods, attaching the `/sys` USB
   * fingerprint (`findUsbIdentity`) so the discovery reconciler can fold each
   * iPod with its USB-inquiry record by serial number.
   */
  private filterIpods(devices: PlatformDeviceInfo[]): PlatformDeviceInfo[] {
    const ipods: PlatformDeviceInfo[] = [];

    for (const device of devices) {
      // Check USB identity — most reliable for unmounted devices.
      // Carry the fingerprint forward on the device record so the discovery
      // reconciliation step (`reconcileDiscoveredDevices`) can fold this entry
      // with the matching USB-inquiry record by serial number.
      const usb = this.usbIdentityResolver(device.identifier);
      if (usb?.vendorId === '05ac') {
        ipods.push({ ...device, usb });
        continue;
      }

      // Check for iPod_Control directory (mounted devices). Type narrowing
      // on `isMounted` guarantees `mountPoint` is present without a
      // defensive `&& device.mountPoint` guard.
      if (device.isMounted) {
        const ipodControlPath = join(device.mountPoint, 'iPod_Control');
        if (existsSync(ipodControlPath)) {
          ipods.push(usb ? { ...device, usb } : device);
          continue;
        }
      }

      // Volume name heuristics (supplementary)
      const volumeName = device.volumeName.toUpperCase();
      if (volumeName.includes('IPOD') || volumeName.includes('POD') || volumeName === 'TERAPOD') {
        ipods.push(usb ? { ...device, usb } : device);
      }
    }

    return ipods;
  }

  // ------------------------------------------------------------------
  // Mount
  // ------------------------------------------------------------------

  async mount(deviceId: string, options?: MountOptions): Promise<MountResult> {
    await this.requireLsblk();

    const devicePath = deviceId.startsWith('/dev/') ? deviceId : `/dev/${deviceId}`;
    const baseName = deviceId.replace('/dev/', '');

    // Get device info to check current state and volume name
    const devices = await this.enumerateDevices();
    const device = devices.find((d) => d.identifier === baseName);

    // Already mounted — return existing mount point.
    // Type narrowing on `isMounted` makes `mountPoint` non-nullable.
    if (device?.isMounted) {
      if (options?.target && device.mountPoint !== options.target) {
        return {
          success: false,
          device: deviceId,
          mountPoint: device.mountPoint,
          error: `Device is already mounted at ${device.mountPoint} (requested target: ${options.target}). Unmount first to remount at a different path.`,
        };
      }
      return {
        success: true,
        device: deviceId,
        mountPoint: device.mountPoint,
      };
    }

    const mountTarget = options?.target ?? `/tmp/podkit-${device?.volumeName || 'ipod'}`;
    const hasExplicitTarget = !!options?.target;

    // Attempt 1: udisksctl (unprivileged)
    // Skip udisksctl when an explicit target is specified — udisksctl picks its
    // own mount point (/media/user/LABEL) and doesn't support a custom target.
    let udisksctlError: string | undefined;
    if (!hasExplicitTarget && (await this.hasUdisksctl())) {
      if (options?.dryRun) {
        return {
          success: true,
          device: deviceId,
          mountPoint: mountTarget,
          dryRunCommand: `udisksctl mount -b ${devicePath}`,
        };
      }

      const udResult = await execCommand('udisksctl', ['mount', '-b', devicePath], this.subprocess);
      if (udResult.code === 0) {
        // Parse mount point from udisksctl output: "Mounted /dev/sda1 at /media/user/LABEL."
        const mountMatch = udResult.stdout.match(/at (.+?)\.?\s*$/m);
        const actualMountPoint = mountMatch?.[1] ?? mountTarget;
        return {
          success: true,
          device: deviceId,
          mountPoint: actualMountPoint,
        };
      }
      // Capture udisksctl error for diagnostics if manual mount also fails
      udisksctlError = udResult.stderr.trim();
      // Fall through to manual mount if udisksctl fails
    }

    // Attempt 2: mount -t vfat (may require root)
    // When an explicit target is specified, this is the only path taken.
    const mountCommand = `mount -t vfat ${devicePath} ${mountTarget}`;

    if (options?.dryRun) {
      return {
        success: true,
        device: deviceId,
        mountPoint: mountTarget,
        dryRunCommand: `sudo ${mountCommand}`,
      };
    }

    // Check if we're root
    if (process.getuid && process.getuid() !== 0) {
      const assessment = await this.assessDevice(baseName);
      const errorParts = ['Mount requires elevated privileges.'];
      if (udisksctlError) {
        errorParts.push(`udisksctl failed: ${udisksctlError}`);
      }
      return {
        success: false,
        device: deviceId,
        error: errorParts.join('\n'),
        requiresSudo: true,
        dryRunCommand: `sudo ${mountCommand}`,
        assessment: assessment ?? undefined,
      };
    }

    // Create mount point if needed
    if (!existsSync(mountTarget)) {
      try {
        mkdirSync(mountTarget, { recursive: true });
      } catch (err) {
        return {
          success: false,
          device: deviceId,
          error: `Failed to create mount point: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    const { stderr, code } = await execCommand(
      'mount',
      ['-t', 'vfat', devicePath, mountTarget],
      this.subprocess
    );

    if (code === 0) {
      return {
        success: true,
        device: deviceId,
        mountPoint: mountTarget,
      };
    }

    return {
      success: false,
      device: deviceId,
      error: stderr.trim() || 'Mount failed',
    };
  }

  // ------------------------------------------------------------------
  // Eject
  // ------------------------------------------------------------------

  async eject(mountPoint: string, options?: EjectOptions): Promise<EjectResult> {
    const force = options?.force ?? false;

    // Resolve device path from mount point for udisksctl and power-off
    // lsblk can tell us which device is mounted at this path
    let devicePath: string | undefined;
    let wholeDiskPath: string | undefined;
    try {
      await this.requireLsblk();
      const devices = await this.enumerateDevices();
      const device = devices.find((d) => d.mountPoint === mountPoint);
      if (device) {
        devicePath = `/dev/${device.identifier}`;
        // Derive whole-disk path for power-off (sda1 → sda, nvme0n1p2 → nvme0n1)
        wholeDiskPath = `/dev/${stripPartitionSuffix(device.identifier)}`;
      }
    } catch {
      // Fall through to umount if we can't resolve device
    }

    // Attempt 1: udisksctl (unprivileged)
    if (devicePath && (await this.hasUdisksctl())) {
      const unmountResult = await execCommand(
        'udisksctl',
        ['unmount', '-b', devicePath],
        this.subprocess
      );
      if (unmountResult.code === 0) {
        // Power off using the whole-disk device so the USB device fully detaches
        const powerOffTarget = wholeDiskPath ?? devicePath;
        await execCommand('udisksctl', ['power-off', '-b', powerOffTarget], this.subprocess);
        return {
          success: true,
          device: mountPoint,
          forced: false,
        };
      }
      // If the device is busy, return the error so the retry wrapper can handle it
      // rather than falling through to umount (which will also fail with busy)
      const udisksErr = unmountResult.stderr.trim();
      if (udisksErr.includes('busy') || udisksErr.includes('target is busy')) {
        return {
          success: false,
          device: mountPoint,
          error: udisksErr,
          forced: false,
        };
      }
      // Fall through to umount for other errors (e.g., permission issues)
    }

    // Attempt 2: umount
    const umountArgs = force ? ['-l', mountPoint] : [mountPoint];
    const { stderr, code } = await execCommand('umount', umountArgs, this.subprocess);

    if (code === 0) {
      // After successful umount, try to power off the USB device so it fully detaches.
      // Use udisksctl if available (doesn't require root for power-off after umount).
      if (wholeDiskPath && (await this.hasUdisksctl())) {
        await execCommand('udisksctl', ['power-off', '-b', wholeDiskPath], this.subprocess);
      }
      return {
        success: true,
        device: mountPoint,
        forced: force,
      };
    }

    let errorMessage = stderr.trim();

    if (errorMessage.includes('busy') || errorMessage.includes('target is busy')) {
      errorMessage = `Device is in use. Close applications using the device or use --force.\n${errorMessage}`;
    } else if (errorMessage.includes('not mounted') || errorMessage.includes('not found')) {
      errorMessage = `Device not found at ${mountPoint}. Make sure the iPod is connected and mounted.`;
    } else if (
      errorMessage.includes('permission') ||
      errorMessage.includes('Operation not permitted')
    ) {
      return {
        success: false,
        device: mountPoint,
        error: `Eject requires elevated privileges. Try: sudo podkit eject`,
        forced: force,
      };
    }

    return {
      success: false,
      device: mountPoint,
      error: errorMessage || 'Eject failed',
      forced: force,
    };
  }

  // ------------------------------------------------------------------
  // Device assessment
  // ------------------------------------------------------------------

  /**
   * Linux currently has no devices in the inventory that expose multiple LUNs
   * to the OS as separate sibling volumes. Echo Mini's dual-LUN behaviour
   * surfaces only on macOS (the kernel/driver presents the LUNs differently).
   *
   * This stub returns an empty list so the cross-platform `DeviceManager`
   * contract is unified. If a future Linux device requires sibling-volume
   * discovery (e.g., via `/sys/block` walks or `lsblk -J`), revisit here.
   */
  async getSiblingVolumes(_mountPoint: string): Promise<string[]> {
    return [];
  }

  async assessDevice(diskIdentifier: string): Promise<DeviceAssessment | null> {
    const baseName = diskIdentifier.replace('/dev/', '');

    // Get device info from lsblk
    let devices: PlatformDeviceInfo[];
    try {
      devices = await this.enumerateDevices();
    } catch {
      return null;
    }

    const device = devices.find((d) => d.identifier === baseName);
    if (!device) return null;

    // Get USB identity from /sys
    const usb = this.usbIdentityResolver(baseName);

    const iFlash = detectIFlash(device.storage.sizeBytes, device.storage.blockSizeBytes ?? 512);

    return {
      diskIdentifier: baseName,
      volumeName: device.volumeName,
      volumeUuid: device.volumeUuid || undefined,
      sizeBytes: device.storage.sizeBytes,
      blockSizeBytes: device.storage.blockSizeBytes ?? 512,
      isMounted: device.isMounted,
      mountPoint: device.mountPoint,
      usb,
      iFlash,
    };
  }

  // ------------------------------------------------------------------
  // Instructions and privileges
  // ------------------------------------------------------------------

  requiresPrivileges(_operation: 'mount' | 'eject'): boolean {
    // We try unprivileged approaches first (udisksctl), falling back
    // to privileged commands only when needed.
    return false;
  }

  getManualInstructions(operation: 'mount' | 'eject'): string {
    if (operation === 'eject') {
      return `To safely eject your iPod on Linux:

Using udisks2 (no root required):
  udisksctl unmount -b /dev/sdX1
  udisksctl power-off -b /dev/sdX

Using mount commands (requires root):
  sudo umount /media/ipod
  sudo umount -l /media/ipod  # If busy (lazy unmount)`;
    }

    return `To mount your iPod on Linux:

1. Find your device:
  lsblk -o NAME,UUID,LABEL,FSTYPE,SIZE,MOUNTPOINT

Using udisks2 (no root required):
  udisksctl mount -b /dev/sdX1

Using mount commands (requires root):
  sudo mkdir -p /tmp/podkit-ipod
  sudo mount -t vfat /dev/sdX1 /tmp/podkit-ipod

Replace sdX1 with your actual device identifier.`;
  }
}

/**
 * Create a Linux device manager instance
 *
 * @param opts.subprocess - Injectable subprocess runner. Defaults to the
 *   real `execFile`-backed runner; tests inject a fake `SubprocessRunner`
 *   (e.g. a hand-rolled stub returning canned stdout).
 */
export function createLinuxManager(opts: { subprocess?: SubprocessRunner } = {}): DeviceManager {
  return new LinuxDeviceManager(opts);
}
