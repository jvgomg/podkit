/**
 * macOS device manager implementation
 *
 * Uses diskutil for device enumeration and ejection,
 * and mount command for mounting devices.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * Execute a command and return stdout
 */
function execCommand(
  command: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
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

/**
 * Parse diskutil info output into key-value pairs
 */
function parseDiskutilInfo(output: string): Record<string, string> {
  const info: Record<string, string> = {};

  for (const line of output.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      info[key] = value;
    }
  }

  return info;
}

/**
 * Parse size string to bytes
 *
 * Examples: "1.0 TB", "120 GB", "4.0 MB"
 */
function parseSize(sizeStr: string): number {
  const match = sizeStr.match(/^([\d.]+)\s*(TB|GB|MB|KB|B)/i);
  if (!match || !match[1] || !match[2]) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2].toUpperCase();

  const multipliers: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 * 1024,
    GB: 1024 * 1024 * 1024,
    TB: 1024 * 1024 * 1024 * 1024,
  };

  return Math.round(value * (multipliers[unit] ?? 1));
}

/**
 * macOS device manager using diskutil
 */
export class MacOSDeviceManager implements DeviceManager {
  readonly platform = 'darwin';
  readonly isSupported = true;

  // Cache listDevices() results for 1s so multiple calls within a single
  // command invocation (e.g. device info: UUID lookup + readiness check)
  // don't each pay the full diskutil cost.
  private _listDevicesCache: { result: PlatformDeviceInfo[]; expiresAt: number } | null = null;

  async eject(mountPoint: string, options?: EjectOptions): Promise<EjectResult> {
    const force = options?.force ?? false;

    // Resolve the whole-disk identifier so we can fully detach the USB device.
    // diskutil eject on a whole disk (e.g., disk5) sends the "safe to remove"
    // signal and makes the device disappear from Disk Utility.
    const wholeDisk = await this.resolveWholeDisk(mountPoint);

    if (force) {
      // Force: unmount the specific volume first, then eject the whole disk
      const unmountResult = await execCommand('diskutil', ['unmount', 'force', mountPoint]);
      if (unmountResult.code !== 0) {
        const errorMessage = unmountResult.stderr.trim() || unmountResult.stdout.trim();
        return {
          success: false,
          device: mountPoint,
          error: errorMessage,
          forced: true,
        };
      }

      // Now eject the whole disk to fully detach the USB device
      if (wholeDisk) {
        await execCommand('diskutil', ['eject', wholeDisk]);
      }

      return {
        success: true,
        device: mountPoint,
        forced: true,
      };
    }

    // Normal mode: eject the whole disk (unmounts all volumes + detaches device)
    const target = wholeDisk ?? mountPoint;
    const { stdout, stderr, code } = await execCommand('diskutil', ['eject', target]);

    if (code === 0) {
      return {
        success: true,
        device: mountPoint,
        forced: false,
      };
    }

    // Parse common error cases
    let errorMessage = stderr.trim() || stdout.trim();

    if (errorMessage.includes('resource busy')) {
      errorMessage = `Device is in use. Close applications using the device or use --force.\n${errorMessage}`;
    } else if (errorMessage.includes('not found')) {
      errorMessage = `Device not found at ${mountPoint}. Make sure the iPod is connected and mounted.`;
    }

    return {
      success: false,
      device: mountPoint,
      error: errorMessage,
      forced: false,
    };
  }

  /**
   * Resolve a mount point to its whole-disk identifier (e.g., "disk5").
   *
   * Uses `diskutil info` to find the partition identifier (e.g., "disk5s2"),
   * then strips the partition suffix to get the whole disk. Ejecting the
   * whole disk ensures the USB device is fully detached and disappears
   * from Disk Utility.
   */
  private async resolveWholeDisk(mountPoint: string): Promise<string | null> {
    const { stdout, code } = await execCommand('diskutil', ['info', mountPoint]);
    if (code !== 0) return null;

    const info = parseDiskutilInfo(stdout);
    const deviceId = info['Device Identifier'];
    if (!deviceId) return null;

    // Strip partition suffix: disk5s2 → disk5
    const wholeDisk = deviceId.replace(/s\d+$/, '');

    // Only return if we actually stripped something (i.e., it was a partition)
    return wholeDisk !== deviceId ? wholeDisk : deviceId;
  }

  async mount(deviceId: string, options?: MountOptions): Promise<MountResult> {
    const diskId = deviceId.replace('/dev/', '');

    // Get device info to determine volume name and current state
    const device = await this.getPlatformDeviceInfo(diskId);
    if (!device) {
      return {
        success: false,
        device: deviceId,
        error: `Device not found: ${deviceId}`,
      };
    }

    // Already mounted — return existing mount point
    // If an explicit target was requested but the device is already mounted elsewhere, warn
    if (device.isMounted && device.mountPoint) {
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

    const devicePath = `/dev/${diskId}`;
    const sudoMountPoint = options?.target ?? `/tmp/podkit-${device.volumeName || 'ipod'}`;
    const sudoMountCommand = `mount -t msdos ${devicePath} ${sudoMountPoint}`;

    if (options?.dryRun) {
      // When a target is provided, show the diskutil mount with -mountPoint;
      // otherwise show the sudo mount command (for iFlash / large FAT32 fallback)
      const dryRunCommand = options?.target
        ? `diskutil mount -mountPoint ${sudoMountPoint} ${diskId}`
        : `sudo ${sudoMountCommand}`;
      return {
        success: true,
        device: deviceId,
        mountPoint: sudoMountPoint,
        dryRunCommand,
      };
    }

    // Attempt 1: diskutil mount — works without elevated privileges for volumes
    // that macOS is willing to mount (standard-size FAT32 volumes, etc.)
    // When a target path is specified, use -mountPoint to direct diskutil.
    const diskutilArgs = options?.target
      ? ['mount', '-mountPoint', sudoMountPoint, diskId]
      : ['mount', diskId];
    const diskutilResult = await execCommand('diskutil', diskutilArgs);
    if (diskutilResult.code === 0) {
      if (options?.target) {
        return {
          success: true,
          device: deviceId,
          mountPoint: sudoMountPoint,
        };
      }
      // Re-fetch to get the actual mount point assigned by diskutil
      const mounted = await this.getPlatformDeviceInfo(diskId);
      return {
        success: true,
        device: deviceId,
        mountPoint: mounted?.mountPoint,
      };
    }

    // Attempt 2: mount -t msdos — required for large FAT32 volumes (iFlash)
    // that macOS refuses to mount through its normal mechanisms. Requires root.
    if (process.getuid && process.getuid() !== 0) {
      // Assess device to provide diagnostics (iFlash detection, capacity, etc.)
      const assessment = await this.assessDevice(diskId);
      return {
        success: false,
        device: deviceId,
        error: 'Mount requires elevated privileges.',
        requiresSudo: true,
        dryRunCommand: `sudo ${sudoMountCommand}`,
        assessment: assessment ?? undefined,
      };
    }

    // Create mount point if it doesn't exist
    if (!existsSync(sudoMountPoint)) {
      try {
        mkdirSync(sudoMountPoint, { recursive: true });
      } catch (err) {
        return {
          success: false,
          device: deviceId,
          error: `Failed to create mount point: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    const { stderr, code } = await execCommand('mount', [
      '-t',
      'msdos',
      devicePath,
      sudoMountPoint,
    ]);

    if (code === 0) {
      return {
        success: true,
        device: deviceId,
        mountPoint: sudoMountPoint,
      };
    }

    return {
      success: false,
      device: deviceId,
      error: stderr.trim() || 'Mount failed',
    };
  }

  async listDevices(): Promise<PlatformDeviceInfo[]> {
    const now = Date.now();
    if (this._listDevicesCache && this._listDevicesCache.expiresAt > now) {
      return this._listDevicesCache.result;
    }

    const { stdout, code } = await execCommand('diskutil', ['list', '-plist']);

    if (code !== 0) {
      return [];
    }

    // Parse plist output to get disk identifiers
    const diskIds = this.parseDiskIdentifiers(stdout);

    // Get detailed info for each disk
    const devices: PlatformDeviceInfo[] = [];

    for (const diskId of diskIds) {
      const device = await this.getPlatformDeviceInfo(diskId);
      if (device) {
        devices.push(device);
      }
    }

    this._listDevicesCache = { result: devices, expiresAt: now + 1000 };
    return devices;
  }

  async findIpodDevices(): Promise<PlatformDeviceInfo[]> {
    const devices = await this.listDevices();
    const ipods: PlatformDeviceInfo[] = [];

    for (const device of devices) {
      // Check if media type is iPod
      if (device.mediaType === 'iPod') {
        ipods.push(device);
        continue;
      }

      // Check if it has iPod_Control directory (for mounted devices)
      if (device.isMounted && device.mountPoint) {
        const ipodControlPath = join(device.mountPoint, 'iPod_Control');
        if (existsSync(ipodControlPath)) {
          ipods.push(device);
          continue;
        }
      }

      // Check volume name patterns commonly used for iPods
      const volumeName = device.volumeName.toUpperCase();
      if (volumeName.includes('IPOD') || volumeName.includes('POD') || volumeName === 'TERAPOD') {
        ipods.push(device);
      }
    }

    return ipods;
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

  requiresPrivileges(_operation: 'mount' | 'eject'): boolean {
    // Mount attempts diskutil first (no privileges needed), only falling back
    // to mount -t msdos (which needs root) for large FAT32 volumes.
    // Eject via diskutil doesn't require root either.
    return false;
  }

  getManualInstructions(operation: 'mount' | 'eject'): string {
    if (operation === 'eject') {
      return `To safely eject your iPod on macOS:

1. In Finder: Right-click the iPod in the sidebar and select "Eject"
2. Or drag the iPod icon to the Trash

Using command line:
  diskutil eject /Volumes/YourIPod
  diskutil unmount force /Volumes/YourIPod  # If busy`;
    }

    return `To mount your iPod on macOS:

1. The iPod should mount automatically when connected

If it doesn't appear:
  # List disks to find your iPod
  diskutil list

  # Mount manually
  sudo mkdir -p /tmp/podkit-ipod
  sudo mount -t msdos /dev/diskXsY /tmp/podkit-ipod

Replace diskXsY with your actual device identifier`;
  }

  /**
   * Get detailed information about a specific device
   */
  private async getPlatformDeviceInfo(identifier: string): Promise<PlatformDeviceInfo | null> {
    // Normalize identifier
    const diskId = identifier.replace('/dev/', '');

    const { stdout, code } = await execCommand('diskutil', ['info', diskId]);

    if (code !== 0) {
      return null;
    }

    const info = parseDiskutilInfo(stdout);

    // Skip whole disks (we want partitions)
    if (info['Whole'] === 'Yes' && !info['Volume Name']) {
      return null;
    }

    // Skip if no volume UUID (likely not a user partition)
    const volumeUuid = info['Volume UUID'] || info['Disk / Partition UUID'] || '';
    if (!volumeUuid) {
      return null;
    }

    const volumeName = info['Volume Name'] || '';
    const mountPoint = info['Mount Point'] || '';
    const isMounted = mountPoint !== '' && mountPoint !== '(not mounted)';

    // Parse size
    const sizeStr = info['Disk Size'] || info['Total Size'] || '0';
    const size = parseSize(sizeStr);

    // Parse block size (512 = standard HDD, 2048 = iFlash adapter)
    const blockSizeStr = info['Device Block Size'] || '';
    const blockSizeMatch = blockSizeStr.match(/^(\d+)/);
    const blockSizeBytes = blockSizeMatch ? parseInt(blockSizeMatch[1]!, 10) : undefined;

    // Get media type
    const mediaType = info['Media Type'] || '';

    return {
      identifier: diskId,
      volumeName,
      volumeUuid,
      size,
      blockSizeBytes,
      isMounted,
      mountPoint: isMounted ? mountPoint : undefined,
      mediaType,
    };
  }

  async getUuidForMountPoint(mountPoint: string): Promise<string | null> {
    const devices = await this.listDevices();
    const normalized = mountPoint.replace(/\/+$/, '');

    for (const device of devices) {
      if (device.isMounted && device.mountPoint) {
        const deviceNormalized = device.mountPoint.replace(/\/+$/, '');
        if (deviceNormalized === normalized) {
          return device.volumeUuid || null;
        }
      }
    }

    return null;
  }

  async getSiblingVolumes(mountPoint: string): Promise<string[]> {
    // Resolve the mount point to a whole-disk identifier
    const wholeDisk = await this.resolveWholeDisk(mountPoint);
    if (!wholeDisk) return [];

    // Query the USB tree for all BSD names belonging to the same USB device
    const siblingDisks = await this.findSiblingDisks(wholeDisk);
    if (siblingDisks.length === 0) return [];

    // For each sibling disk, find its mounted partitions
    const siblings: string[] = [];
    for (const disk of siblingDisks) {
      // List partitions of this whole disk (diskN → diskNs1, diskNs2, etc.)
      const { stdout, code } = await execCommand('diskutil', ['list', '-plist', disk]);
      if (code !== 0) continue;

      const partitionIds = this.parseDiskIdentifiers(stdout);
      // Also check the whole disk itself (some devices have no partition table)
      const allIds = partitionIds.length > 0 ? partitionIds : [disk];

      for (const partId of allIds) {
        const info = await this.getPlatformDeviceInfo(partId);
        if (info?.isMounted && info.mountPoint && info.mountPoint !== mountPoint) {
          siblings.push(info.mountPoint);
        }
      }
    }

    return siblings;
  }

  /**
   * Find other whole-disk identifiers that share the same physical USB device.
   *
   * For dual-LUN devices like the Echo Mini, a single USB connection presents
   * multiple disks (e.g., disk7 for internal, disk8 for SD card). This method
   * queries system_profiler to find all BSD names under the same USB device node,
   * then returns those that differ from the given whole disk.
   */
  private async findSiblingDisks(wholeDisk: string): Promise<string[]> {
    const { stdout, code } = await execCommand('system_profiler', ['SPUSBDataType', '-json']);
    if (code !== 0 || !stdout) return [];

    let profilerData: unknown;
    try {
      profilerData = JSON.parse(stdout);
    } catch {
      return [];
    }

    const allBsdNames = this.findAllBsdNamesForDevice(profilerData, wholeDisk);
    // Return sibling disks (exclude the primary)
    return allBsdNames.filter((name) => name !== wholeDisk);
  }

  /**
   * Find the USB device node that owns the given whole-disk BSD name,
   * then collect ALL BSD names from that node's subtree.
   *
   * This handles dual-LUN devices where a single USB device has multiple
   * disks (e.g., internal storage + SD card).
   */
  private findAllBsdNamesForDevice(node: unknown, targetDisk: string): string[] {
    if (!node || typeof node !== 'object') return [];

    if (Array.isArray(node)) {
      for (const item of node) {
        const result = this.findAllBsdNamesForDevice(item, targetDisk);
        if (result.length > 0) return result;
      }
      return [];
    }

    const record = node as Record<string, unknown>;

    // A USB device node has a product_id. If it contains our target BSD name,
    // collect ALL BSD names from its entire subtree.
    if (
      typeof record['product_id'] === 'string' &&
      this.subtreeContainsBsdName(record, targetDisk)
    ) {
      return this.collectAllBsdNames(record);
    }

    // Recurse into child values
    for (const value of Object.values(record)) {
      const result = this.findAllBsdNamesForDevice(value, targetDisk);
      if (result.length > 0) return result;
    }

    return [];
  }

  /**
   * Collect all bsd_name values from a subtree.
   */
  private collectAllBsdNames(node: unknown): string[] {
    if (!node || typeof node !== 'object') return [];

    if (Array.isArray(node)) {
      return node.flatMap((item) => this.collectAllBsdNames(item));
    }

    const record = node as Record<string, unknown>;
    const names: string[] = [];

    if (typeof record['bsd_name'] === 'string') {
      names.push(record['bsd_name']);
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') {
        names.push(...this.collectAllBsdNames(value));
      }
    }

    return names;
  }

  async assessDevice(diskIdentifier: string): Promise<DeviceAssessment | null> {
    const diskId = diskIdentifier.replace('/dev/', '');
    const device = await this.getPlatformDeviceInfo(diskId);
    if (!device) return null;

    // Derive the whole-disk identifier (disk5s2 → disk5) for USB lookup
    const wholeDisk = diskId.replace(/s\d+$/, '');
    const usb = await this.queryUsbInfo(wholeDisk);

    const iFlash = detectIFlash(device.size, device.blockSizeBytes ?? 512);

    return {
      diskIdentifier: diskId,
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

  /**
   * Query USB subsystem for device identity matching a whole-disk BSD name.
   *
   * Parses system_profiler SPUSBDataType JSON output and searches the USB
   * device tree for an entry whose bsd_name matches the given whole-disk
   * identifier (e.g., "disk5"). Returns USB product/vendor IDs and a
   * resolved model name if the product ID is in the lookup table.
   */
  private async queryUsbInfo(wholeDisk: string): Promise<UsbDeviceInfo | undefined> {
    const { stdout, code } = await execCommand('system_profiler', ['SPUSBDataType', '-json']);
    if (code !== 0 || !stdout) return undefined;

    let profilerData: unknown;
    try {
      profilerData = JSON.parse(stdout);
    } catch {
      return undefined;
    }

    return this.findUsbDeviceByBsdName(profilerData, wholeDisk);
  }

  /**
   * Recursively search a system_profiler data structure for a USB device entry
   * that owns the given whole-disk BSD name.
   *
   * The product_id lives on the USB device node, while bsd_name is nested
   * inside its Media sub-array. We search for a node that has a product_id
   * and contains the target bsd_name anywhere in its subtree.
   */
  private findUsbDeviceByBsdName(node: unknown, wholeDisk: string): UsbDeviceInfo | undefined {
    if (!node || typeof node !== 'object') return undefined;

    if (Array.isArray(node)) {
      for (const item of node) {
        const result = this.findUsbDeviceByBsdName(item, wholeDisk);
        if (result) return result;
      }
      return undefined;
    }

    const record = node as Record<string, unknown>;

    // If this node has a product_id and the target bsd_name appears anywhere
    // in its subtree, this is the USB device entry we want.
    if (
      typeof record['product_id'] === 'string' &&
      this.subtreeContainsBsdName(record, wholeDisk)
    ) {
      const productId = record['product_id'];
      const rawVendorId = typeof record['vendor_id'] === 'string' ? record['vendor_id'] : '';

      // vendor_id may be the string "apple_vendor_id" or "0x05ac (Apple Inc.)"
      const vendorId =
        rawVendorId === 'apple_vendor_id' ? '0x05ac' : (rawVendorId.split(' ')[0] ?? '');

      return {
        productId,
        vendorId,
        modelName: lookupIpodModel(productId),
      };
    }

    // Recurse into all child values to find a matching USB device deeper in the tree
    for (const value of Object.values(record)) {
      const result = this.findUsbDeviceByBsdName(value, wholeDisk);
      if (result) return result;
    }

    return undefined;
  }

  /**
   * Return true if any node in the subtree has bsd_name equal to the target.
   */
  private subtreeContainsBsdName(node: unknown, target: string): boolean {
    if (!node || typeof node !== 'object') return false;

    if (Array.isArray(node)) {
      return node.some((item) => this.subtreeContainsBsdName(item, target));
    }

    const record = node as Record<string, unknown>;

    if (record['bsd_name'] === target) return true;

    return Object.values(record).some((v) => this.subtreeContainsBsdName(v, target));
  }

  /**
   * Parse disk identifiers from diskutil list -plist output
   *
   * The plist format has:
   *   <key>DeviceIdentifier</key>
   *   <string>disk6s2</string>
   */
  private parseDiskIdentifiers(plistOutput: string): string[] {
    const identifiers: string[] = [];

    // Match <key>DeviceIdentifier</key> followed by <string>...</string>
    // The [\s\S]*? allows for whitespace/newlines between tags
    const matches = plistOutput.matchAll(
      /<key>DeviceIdentifier<\/key>\s*<string>([^<]+)<\/string>/g
    );
    for (const match of matches) {
      const captured = match[1];
      if (!captured) continue;
      const id = captured.trim();
      // Only include partition identifiers (diskXsY), not whole disks (diskX)
      if (/^disk\d+s\d+$/.test(id)) {
        identifiers.push(id);
      }
    }

    return identifiers;
  }
}

/**
 * Create a macOS device manager instance
 */
export function createMacOSManager(): DeviceManager {
  return new MacOSDeviceManager();
}
