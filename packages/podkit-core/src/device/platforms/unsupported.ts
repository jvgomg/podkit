/**
 * Unsupported platform device manager
 *
 * Provides helpful error messages and manual instructions
 * for platforms where automated device management is not implemented.
 */

import type {
  DeviceManager,
  PlatformDeviceInfo,
  EjectResult,
  MountResult,
  EjectOptions,
  MountOptions,
} from '../types.js';
import type { DeviceAssessment } from '../assessment.js';

/**
 * Device manager for unsupported platforms
 *
 * Returns clear error messages with manual instructions
 * rather than failing silently.
 */
export class UnsupportedDeviceManager implements DeviceManager {
  readonly platform: string;
  readonly isSupported = false;

  constructor(platform: string) {
    this.platform = platform;
  }

  async eject(mountPoint: string, _options?: EjectOptions): Promise<EjectResult> {
    return {
      success: false,
      device: mountPoint,
      error: `Device ejection is not supported on ${this.platform}.\n\n${this.getManualInstructions('eject')}`,
    };
  }

  async mount(deviceId: string, _options?: MountOptions): Promise<MountResult> {
    return {
      success: false,
      device: deviceId,
      error: `Device mounting is not supported on ${this.platform}.\n\n${this.getManualInstructions('mount')}`,
    };
  }

  async listDevices(): Promise<PlatformDeviceInfo[]> {
    return [];
  }

  async findIpodDevices(): Promise<PlatformDeviceInfo[]> {
    return [];
  }

  async findByVolumeUuid(_uuid: string): Promise<PlatformDeviceInfo | null> {
    return null;
  }

  requiresPrivileges(_operation: 'mount' | 'eject'): boolean {
    // Unknown for unsupported platforms - operation will fail anyway
    return false;
  }

  async getUuidForMountPoint(_mountPoint: string): Promise<string | null> {
    return null;
  }

  async assessDevice(_diskIdentifier: string): Promise<DeviceAssessment | null> {
    return null;
  }

  async getSiblingVolumes(_mountPoint: string): Promise<string[]> {
    return [];
  }

  getManualInstructions(operation: 'mount' | 'eject'): string {
    const platformName = this.getPlatformDisplayName();

    if (operation === 'eject') {
      return this.getEjectInstructions(platformName);
    }
    return this.getMountInstructions(platformName);
  }

  private getPlatformDisplayName(): string {
    switch (this.platform) {
      case 'linux':
        return 'Linux';
      case 'win32':
        return 'Windows';
      case 'freebsd':
        return 'FreeBSD';
      default:
        return this.platform;
    }
  }

  private getEjectInstructions(platformName: string): string {
    switch (this.platform) {
      case 'linux':
        return `To safely eject your iPod on ${platformName}:

1. Using file manager: Right-click the iPod in your file manager and select "Eject" or "Safely Remove"

2. Using command line:
   sync                           # Flush pending writes
   udisksctl unmount -b /dev/sdX  # Unmount the partition
   udisksctl power-off -b /dev/sdX # Power off the device

   Replace /dev/sdX with your actual device (check with 'lsblk')`;

      case 'win32':
        return `To safely eject your iPod on ${platformName}:

1. Click the "Safely Remove Hardware" icon in the system tray
2. Select your iPod from the list
3. Wait for the "Safe to Remove" notification

Or in File Explorer: Right-click the iPod drive and select "Eject"`;

      default:
        return `Please use your operating system's built-in tools to safely eject the device.`;
    }
  }

  private getMountInstructions(platformName: string): string {
    switch (this.platform) {
      case 'linux':
        return `To mount your iPod on ${platformName}:

1. Most desktop environments auto-mount when connected

2. Using command line:
   # Find your device
   lsblk

   # Create mount point and mount
   sudo mkdir -p /mnt/ipod
   sudo mount /dev/sdX1 /mnt/ipod

   Replace /dev/sdX1 with your actual partition`;

      case 'win32':
        return `To mount your iPod on ${platformName}:

Windows should automatically assign a drive letter when the iPod is connected.

If the iPod doesn't appear:
1. Open Disk Management (diskmgmt.msc)
2. Find the iPod disk
3. Right-click the partition and select "Change Drive Letter and Paths"
4. Assign an available drive letter`;

      default:
        return `Please use your operating system's built-in tools to mount the device.`;
    }
  }
}

/**
 * Create an unsupported device manager instance
 */
export function createUnsupportedManager(platform: string): DeviceManager {
  return new UnsupportedDeviceManager(platform);
}
