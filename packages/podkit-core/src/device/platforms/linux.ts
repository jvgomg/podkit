/**
 * Linux device manager implementation
 *
 * Uses lsblk for device enumeration and udisksctl/mount for
 * mounting and unmounting devices.
 *
 * Required: lsblk (from util-linux)
 * Optional: udisksctl (from udisks2) for unprivileged mount/eject
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  DeviceManager,
  PlatformDeviceInfo,
  EjectResult,
  MountResult,
  EjectOptions,
  MountOptions,
} from '../types.js';
import type { DeviceAssessment, UsbDeviceInfo } from '../assessment.js';
import { detectIFlash } from '../assessment.js';
import { lookupIpodModel } from '../ipod-models.js';

// ---------------------------------------------------------------------------
// Shell execution helper
// ---------------------------------------------------------------------------

function execCommand(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });

    proc.on('error', (err) => {
      resolve({ stdout, stderr: err.message, code: 1 });
    });
  });
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
 */
export function collectPartitions(devices: LsblkDevice[]): LsblkDevice[] {
  const partitions: LsblkDevice[] = [];

  for (const device of devices) {
    if (device.type === 'part') {
      partitions.push(device);
    }
    if (device.children) {
      partitions.push(...collectPartitions(device.children));
    }
  }

  return partitions;
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

  const partitions = collectPartitions(parsed.blockdevices);
  const devices: PlatformDeviceInfo[] = [];

  for (const part of partitions) {
    // Skip partitions without UUID (not user-formatted partitions)
    if (!part.uuid) {
      continue;
    }

    // Handle both old "mountpoint" (string) and new "mountpoints" (array) formats.
    // Newer kernels (5.14+ / util-linux 2.38+) use the array form.
    const rawMount =
      part.mountpoint ?? part.mountpoints?.find((m) => m != null && m !== '') ?? null;
    const isMounted = rawMount !== null && rawMount !== '';

    devices.push({
      identifier: part.name,
      volumeName: part.label ?? '',
      volumeUuid: part.uuid,
      size: part.size ?? 0,
      blockSizeBytes: part['phy-sec'] ?? undefined,
      isMounted,
      mountPoint: isMounted ? (rawMount ?? undefined) : undefined,
      mediaType: '',
    });
  }

  return devices;
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
function findUsbIdentity(blockDeviceName: string): UsbDeviceInfo | undefined {
  // Strip partition suffix to get the base device (sda1 → sda)
  const baseName = blockDeviceName.replace(/\d+$/, '');

  try {
    // Check /sys/block/<device>/device for a symlink to the USB device
    const deviceLink = `/sys/block/${baseName}/device`;
    if (!existsSync(deviceLink)) return undefined;

    // Walk up the sysfs tree to find the USB device with idVendor/idProduct
    let sysPath = resolve(`/sys/block/${baseName}/device`);

    // Walk up to 10 levels to find the USB device attributes
    for (let i = 0; i < 10; i++) {
      const vendorPath = join(sysPath, 'idVendor');
      const productPath = join(sysPath, 'idProduct');

      if (existsSync(vendorPath) && existsSync(productPath)) {
        const vendorId = `0x${readFileSync(vendorPath, 'utf-8').trim()}`;
        const productId = `0x${readFileSync(productPath, 'utf-8').trim()}`;

        return {
          productId,
          vendorId,
          modelName: lookupIpodModel(productId),
        };
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

  // Lazy-cached tool availability
  private _lsblkAvailable: boolean | null = null;
  private _udisksctlAvailable: boolean | null = null;

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

    const { code } = await execCommand('which', ['lsblk']);
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

    const { code } = await execCommand('which', ['udisksctl']);
    this._udisksctlAvailable = code === 0;
    return this._udisksctlAvailable;
  }

  // ------------------------------------------------------------------
  // Device enumeration
  // ------------------------------------------------------------------

  async listDevices(): Promise<PlatformDeviceInfo[]> {
    await this.requireLsblk();

    const { stdout, code } = await execCommand('lsblk', [
      '--json',
      '-b',
      '-o',
      'NAME,UUID,LABEL,MOUNTPOINT,FSTYPE,SIZE,PHY-SEC,TYPE',
    ]);

    if (code !== 0) {
      return [];
    }

    return parseLsblkJson(stdout);
  }

  async findByVolumeUuid(uuid: string): Promise<PlatformDeviceInfo | null> {
    const devices = await this.listDevices();
    const normalizedUuid = uuid.toUpperCase();

    for (const device of devices) {
      if (device.volumeUuid.toUpperCase() === normalizedUuid) {
        return device;
      }
    }

    return null;
  }

  // ------------------------------------------------------------------
  // iPod detection
  // ------------------------------------------------------------------

  async findIpodDevices(): Promise<PlatformDeviceInfo[]> {
    const devices = await this.listDevices();
    const ipods: PlatformDeviceInfo[] = [];

    for (const device of devices) {
      // Check USB identity — most reliable for unmounted devices
      const usb = findUsbIdentity(device.identifier);
      if (usb?.vendorId === '0x05ac' && usb.modelName) {
        ipods.push(device);
        continue;
      }

      // Check for iPod_Control directory (mounted devices)
      if (device.isMounted && device.mountPoint) {
        const ipodControlPath = join(device.mountPoint, 'iPod_Control');
        if (existsSync(ipodControlPath)) {
          ipods.push(device);
          continue;
        }
      }

      // Volume name heuristics (supplementary)
      const volumeName = device.volumeName.toUpperCase();
      if (volumeName.includes('IPOD') || volumeName.includes('POD') || volumeName === 'TERAPOD') {
        ipods.push(device);
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
    const devices = await this.listDevices();
    const device = devices.find((d) => d.identifier === baseName);

    // Already mounted — return existing mount point
    if (device?.isMounted && device.mountPoint) {
      return {
        success: true,
        device: deviceId,
        mountPoint: device.mountPoint,
      };
    }

    const mountTarget = options?.target ?? `/tmp/podkit-${device?.volumeName || 'ipod'}`;

    // Attempt 1: udisksctl (unprivileged)
    let udisksctlError: string | undefined;
    if (await this.hasUdisksctl()) {
      if (options?.dryRun) {
        return {
          success: true,
          device: deviceId,
          mountPoint: mountTarget,
          dryRunCommand: `udisksctl mount -b ${devicePath}`,
        };
      }

      const udResult = await execCommand('udisksctl', ['mount', '-b', devicePath]);
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

    const { stderr, code } = await execCommand('mount', ['-t', 'vfat', devicePath, mountTarget]);

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

    // Resolve device path from mount point for udisksctl
    // lsblk can tell us which device is mounted at this path
    let devicePath: string | undefined;
    try {
      await this.requireLsblk();
      const devices = await this.listDevices();
      const device = devices.find((d) => d.mountPoint === mountPoint);
      if (device) {
        devicePath = `/dev/${device.identifier}`;
      }
    } catch {
      // Fall through to umount if we can't resolve device
    }

    // Attempt 1: udisksctl (unprivileged)
    if (devicePath && (await this.hasUdisksctl())) {
      const unmountResult = await execCommand('udisksctl', ['unmount', '-b', devicePath]);
      if (unmountResult.code === 0) {
        // Also power off the device
        await execCommand('udisksctl', ['power-off', '-b', devicePath]);
        return {
          success: true,
          device: mountPoint,
          forced: false,
        };
      }
      // Fall through to umount
    }

    // Attempt 2: umount
    const umountArgs = force ? ['-l', mountPoint] : [mountPoint];
    const { stderr, code } = await execCommand('umount', umountArgs);

    if (code === 0) {
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

  async assessDevice(diskIdentifier: string): Promise<DeviceAssessment | null> {
    const baseName = diskIdentifier.replace('/dev/', '');

    // Get device info from lsblk
    let devices: PlatformDeviceInfo[];
    try {
      devices = await this.listDevices();
    } catch {
      return null;
    }

    const device = devices.find((d) => d.identifier === baseName);
    if (!device) return null;

    // Get USB identity from /sys
    const usb = findUsbIdentity(baseName);

    const iFlash = detectIFlash(device.size, device.blockSizeBytes ?? 512);

    return {
      diskIdentifier: baseName,
      volumeName: device.volumeName,
      volumeUuid: device.volumeUuid || undefined,
      sizeBytes: device.size,
      blockSizeBytes: device.blockSizeBytes ?? 512,
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
 */
export function createLinuxManager(): DeviceManager {
  return new LinuxDeviceManager();
}
