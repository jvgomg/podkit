/**
 * Device management types for podkit
 *
 * Provides cross-platform abstraction for mounting, ejecting, and
 * discovering iPod devices.
 */

import type { DeviceAssessment } from './assessment.js';

/**
 * Information about an attached disk device from the platform
 *
 * Represents physical disk/volume information from the operating system,
 * distinct from iPod-specific metadata.
 */
export interface PlatformDeviceInfo {
  /** Device identifier (e.g., "disk6s2" on macOS) */
  identifier: string;
  /** Volume name (e.g., "TERAPOD") */
  volumeName: string;
  /** Volume UUID for persistent identification */
  volumeUuid: string;
  /** Device size in bytes */
  size: number;
  /**
   * Physical block size in bytes as reported by the OS.
   * Standard iPod hard drives report 512. iFlash adapters report 2048.
   */
  blockSizeBytes?: number;
  /** Whether the device is currently mounted */
  isMounted: boolean;
  /** Current mount point if mounted (e.g., "/Volumes/TERAPOD") */
  mountPoint?: string;
  /** Media type if known (e.g., "iPod") */
  mediaType?: string;
}

/**
 * Result of an eject operation
 */
export interface EjectResult {
  /** Whether the eject succeeded */
  success: boolean;
  /** The device that was ejected */
  device: string;
  /** Error message if failed */
  error?: string;
  /** Whether force was required */
  forced?: boolean;
}

/**
 * Result of a mount operation
 */
export interface MountResult {
  /** Whether the mount succeeded */
  success: boolean;
  /** Device identifier that was mounted */
  device: string;
  /** Mount point path */
  mountPoint?: string;
  /** Error message if failed */
  error?: string;
  /** Whether sudo is required (for privilege elevation guidance) */
  requiresSudo?: boolean;
  /** Dry run - command that would be executed */
  dryRunCommand?: string;
  /** Device assessment when available (populated on sudo-required failures) */
  assessment?: DeviceAssessment;
}

/**
 * Options for eject operation
 */
export interface EjectOptions {
  /** Force unmount even if device is busy */
  force?: boolean;
}

/**
 * Options for mount operation
 */
export interface MountOptions {
  /** Target mount point (defaults to /tmp/podkit-{volumeName}) */
  target?: string;
  /** Show command without executing */
  dryRun?: boolean;
}

/**
 * Cross-platform device manager interface
 *
 * Platform-specific implementations provide concrete logic for
 * device operations. Unsupported platforms return helpful error
 * messages with manual instructions.
 */
export interface DeviceManager {
  /** Platform identifier (e.g., "darwin", "linux", "win32") */
  readonly platform: string;

  /** Whether this platform is supported for device operations */
  readonly isSupported: boolean;

  /**
   * Safely eject/unmount a device
   *
   * @param mountPoint - Path to the mounted device
   * @param options - Eject options
   * @returns Result with success status and any error message
   */
  eject(mountPoint: string, options?: EjectOptions): Promise<EjectResult>;

  /**
   * Mount a device to a specified path
   *
   * @param deviceId - Device identifier (e.g., "/dev/disk6s2")
   * @param options - Mount options
   * @returns Result with mount point or error
   */
  mount(deviceId: string, options?: MountOptions): Promise<MountResult>;

  /**
   * List all attached disk devices
   *
   * @returns Array of device information
   */
  listDevices(): Promise<PlatformDeviceInfo[]>;

  /**
   * Find iPod devices among attached disks
   *
   * Uses heuristics like media type "iPod", FAT32 filesystem
   * with iPod_Control directory, etc.
   *
   * @returns Array of iPod device information
   */
  findIpodDevices(): Promise<PlatformDeviceInfo[]>;

  /**
   * Find a device by its Volume UUID
   *
   * @param uuid - Volume UUID to search for
   * @returns Device info if found, null otherwise
   */
  findByVolumeUuid(uuid: string): Promise<PlatformDeviceInfo | null>;

  /**
   * Get manual instructions for unsupported operations
   *
   * Returns platform-specific guidance for manual device operations.
   */
  getManualInstructions(operation: 'mount' | 'eject'): string;

  /**
   * Check if an operation requires elevated privileges
   *
   * Allows early detection of privilege requirements before attempting
   * operations that would fail without proper permissions.
   *
   * @param operation - The operation to check
   * @returns true if elevated privileges are required but not available
   */
  requiresPrivileges(operation: 'mount' | 'eject'): boolean;

  /**
   * Assess a device's characteristics before mounting
   *
   * Gathers all available OS-level and USB-level information about a device
   * without requiring it to be mounted. Used to generate diagnostics for
   * devices that fail to automount and to identify iFlash adapters.
   *
   * @param diskIdentifier - Partition identifier (e.g., "disk5s2")
   * @returns Structured assessment, or null if the device cannot be found
   */
  assessDevice(diskIdentifier: string): Promise<DeviceAssessment | null>;
}

/**
 * Stored iPod identity for auto-detection
 *
 * Saved to config file to enable automatic device discovery
 * without requiring explicit device path.
 */
export interface IpodIdentity {
  /** Volume UUID for persistent identification across mounts */
  volumeUuid: string;
  /** Human-readable volume name */
  volumeName: string;
}
