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

  async eject(mountPoint: string, options?: EjectOptions): Promise<EjectResult> {
    const force = options?.force ?? false;
    const args = force ? ['unmount', 'force', mountPoint] : ['unmount', mountPoint];

    const { stdout, stderr, code } = await execCommand('diskutil', args);

    if (code === 0) {
      return {
        success: true,
        device: mountPoint,
        forced: force,
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
      forced: force,
    };
  }

  async mount(deviceId: string, options?: MountOptions): Promise<MountResult> {
    // Get device info to determine volume name
    const device = await this.getPlatformDeviceInfo(deviceId);
    if (!device) {
      return {
        success: false,
        device: deviceId,
        error: `Device not found: ${deviceId}`,
      };
    }

    // Determine mount point
    const mountPoint = options?.target ?? `/tmp/podkit-${device.volumeName || 'ipod'}`;

    // Build mount command
    const devicePath = deviceId.startsWith('/dev/') ? deviceId : `/dev/${deviceId}`;

    const mountCommand = `mount -t msdos ${devicePath} ${mountPoint}`;

    if (options?.dryRun) {
      return {
        success: true,
        device: deviceId,
        mountPoint,
        dryRunCommand: `sudo ${mountCommand}`,
      };
    }

    // Check if we're root
    if (process.getuid && process.getuid() !== 0) {
      return {
        success: false,
        device: deviceId,
        error: 'Mount requires elevated privileges.',
        requiresSudo: true,
        dryRunCommand: `sudo ${mountCommand}`,
      };
    }

    // Create mount point if it doesn't exist
    if (!existsSync(mountPoint)) {
      try {
        mkdirSync(mountPoint, { recursive: true });
      } catch (err) {
        return {
          success: false,
          device: deviceId,
          error: `Failed to create mount point: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    // Execute mount
    const { stderr, code } = await execCommand('mount', ['-t', 'msdos', devicePath, mountPoint]);

    if (code === 0) {
      return {
        success: true,
        device: deviceId,
        mountPoint,
      };
    }

    return {
      success: false,
      device: deviceId,
      error: stderr.trim() || 'Mount failed',
    };
  }

  async listDevices(): Promise<PlatformDeviceInfo[]> {
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

  requiresPrivileges(operation: 'mount' | 'eject'): boolean {
    if (operation === 'mount') {
      // Mount requires root on macOS
      return typeof process.getuid === 'function' && process.getuid() !== 0;
    }
    // Eject via diskutil doesn't require root
    return false;
  }

  getManualInstructions(operation: 'mount' | 'eject'): string {
    if (operation === 'eject') {
      return `To safely eject your iPod on macOS:

1. In Finder: Right-click the iPod in the sidebar and select "Eject"
2. Or drag the iPod icon to the Trash

Using command line:
  diskutil unmount /Volumes/YourIPod
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

    // Get media type
    const mediaType = info['Media Type'] || '';

    return {
      identifier: diskId,
      volumeName,
      volumeUuid,
      size,
      isMounted,
      mountPoint: isMounted ? mountPoint : undefined,
      mediaType,
    };
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
