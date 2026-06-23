/**
 * Device management types for podkit
 *
 * Provides cross-platform abstraction for mounting, ejecting, and
 * discovering iPod devices.
 */

import type { UsbFingerprint } from '@podkit/device-types';
import type { DeviceAssessment } from './assessment.js';

/**
 * Information about an attached disk device from the platform.
 *
 * Represents physical disk/volume information from the operating system,
 * distinct from iPod-specific metadata. PDI is always a block-device record —
 * USB-only entries (e.g. iPod 6G in restore mode, FunctionFS-synthesised
 * VM-test personas with no backing image) flow through `IpodClassification`
 * separately and never become PDI values.
 *
 * **Schema v2 (TASK-340).** PDI is a sub-object record with a discriminated
 * mount state. Each cohesive group lives under its own sub-object so the
 * type system enforces co-presence:
 *
 * - **Identity** (`identifier` / `volumeName` / `volumeUuid`) — always present.
 * - **Mount** (`{ isMounted: true; mountPoint: string } | { isMounted: false }`) —
 *   discriminated union. Consumers do `if (info.isMounted) { info.mountPoint }`
 *   without a defensive `&& info.mountPoint` guard; the type narrowing
 *   guarantees the path is present.
 * - **Storage** (`storage.sizeBytes` / `storage.blockSizeBytes` / `storage.filesystem` /
 *   `storage.partitionLayout`) — `storage` is always present; the inner fields
 *   stay optional because not every probe surfaces them.
 * - **USB** (`usb?: UsbFingerprint`) — present on Linux (sysfs walk attached
 *   in `scan({ kinds: ['ipod'] })`). Absent on macOS, which reconciles via
 *   `diskIdentifier` against the USB-inquiry stream in
 *   `reconcileDiscoveredDevices`.
 * - **Media type** (`mediaType?: string`) — top-level; populated by macOS only.
 *
 * **Migration note (v1 → v2, TASK-340).** Pre-v2 PDI had flat fields:
 *   - `size: number` → `storage.sizeBytes: number`
 *   - `blockSizeBytes?: number` → `storage.blockSizeBytes?: number`
 *   - `filesystem?: string` → `storage.filesystem?: string`
 *   - `partitionLayout?: PartitionLayout` → `storage.partitionLayout?: PartitionLayout`
 *   - `usbFingerprint?: UsbFingerprint` → `usb?: UsbFingerprint`
 *   - `mountPoint?: string` + `isMounted: boolean` → discriminated mount-state union
 *     (`{ isMounted: true; mountPoint: string }` | `{ isMounted: false }`)
 *
 * Renamed in one commit because `@podkit/core` is an internal workspace
 * package, not a published API.
 */
export type PlatformDeviceInfo = PlatformDeviceIdentity &
  PlatformDeviceMountState & {
    /** Media type if known (e.g., "iPod"). macOS-only; from `diskutil info`. */
    mediaType?: string;
    /** Storage characteristics (always present; inner fields stay optional). */
    storage: PlatformDeviceStorage;
    /**
     * USB fingerprint for the underlying physical device, when the platform
     * surfaces it cheaply during enumeration.
     *
     * Populated by the Linux device manager (read from sysfs alongside the
     * partition info that produces this record). Absent on macOS, which
     * relies on `diskIdentifier` matching against the USB enumeration
     * stream for reconciliation. Used by `reconcileDiscoveredDevices` to fold
     * a single physical iPod's block-device + USB-inquiry records into one
     * entry.
     */
    usb?: UsbFingerprint;
  };

/**
 * Identity fields — always present on every block-device record.
 *
 * Three strings the OS hands us before we know anything about the device.
 * `identifier` is the kernel name (`disk6s2` / `sda1`); `volumeName` is the
 * user-visible label; `volumeUuid` is the cross-replug-stable identifier.
 */
export interface PlatformDeviceIdentity {
  /** Device identifier (e.g., "disk6s2" on macOS, "sda1" on Linux). */
  identifier: string;
  /** Volume name (e.g., "TERAPOD"). Empty string when no label set. */
  volumeName: string;
  /** Volume UUID for persistent identification across mounts/replugs. */
  volumeUuid: string;
}

/**
 * Discriminated mount-state union.
 *
 * When `isMounted` is `true`, `mountPoint` is **always** a non-empty string.
 * When `isMounted` is `false`, `mountPoint` is **always** absent. Type
 * narrowing replaces the historical `if (info.isMounted && info.mountPoint)`
 * pair-check that scattered across every consumer pre-v2.
 *
 * Producers (`linux.ts`, `macos.ts`) and synthesisers
 * (`synthesizePathModeDeviceInfo`) must emit one of the two variants — the
 * union refuses the mixed shape `{ isMounted: true, mountPoint: undefined }`
 * that previously slipped through.
 */
export type PlatformDeviceMountState =
  | { isMounted: true; mountPoint: string }
  | { isMounted: false; mountPoint?: undefined };

/**
 * Storage characteristics for a partition's whole-disk context.
 *
 * `sizeBytes` is always populated (`0` when unknown). The remaining fields
 * stay optional because the underlying probes don't always surface them —
 * `partitionLayout` is captured during enumeration but synthesised callers
 * (`synthesizePathModeDeviceInfo`) skip it; `filesystem` lower bound depends
 * on the probe (Linux always carries `fstype`, macOS may report empty);
 * `blockSizeBytes` is OS-reported and absent on synthesised records.
 */
export interface PlatformDeviceStorage {
  /** Device size in bytes. `0` when unknown (synthesised records). */
  sizeBytes: number;
  /**
   * Physical block size in bytes as reported by the OS.
   * Standard iPod hard drives report 512. iFlash adapters report 2048.
   */
  blockSizeBytes?: number;
  /**
   * Filesystem type for this partition as reported by the platform probe.
   * Linux: `fstype` from `lsblk` (e.g. `"vfat"`, `"hfsplus"`). macOS:
   * "File System Personality" / "Type (Bundle)" from `diskutil info` (e.g.
   * `"MS-DOS FAT32"`, `"Apple_HFS"`). Treat as opaque and lower-case for
   * comparison.
   */
  filesystem?: string;
  /**
   * Partition layout of the whole disk this partition belongs to. Surfaced
   * from `lsblk -J` on Linux and `diskutil list -plist` on macOS during
   * device enumeration. Used by the readiness pipeline's partition-stage
   * details to make single- vs dual-partition iPod layouts observable
   * (TASK-338).
   *
   * Cross-platform asymmetry: Linux populates `filesystem` from `fstype`;
   * macOS populates it from diskutil's "File System Personality". Consumers
   * should treat the string as opaque and lower-case for comparison.
   */
  partitionLayout?: PartitionLayout;
}

/**
 * Whole-disk partition layout, attached to each partition-scoped
 * `PlatformDeviceInfo` in `partitionLayout`. Every sibling partition on the
 * same physical disk shares the same `PartitionLayout` payload — consumers
 * locate their own partition via `partitions[].identifier`.
 */
export interface PartitionLayout {
  /** Number of partitions found on the whole disk. */
  partitionCount: number;
  /** Per-partition info. Order matches the partition table. */
  partitions: PartitionLayoutEntry[];
}

/**
 * One row in `PartitionLayout.partitions`. Mirrors the persona shape in
 * `@podkit/device-testing` (`DevicePersona.partitionLayout`) but uses the
 * field names of the underlying OS probe (`filesystem`, `sizeBytes`)
 * rather than the persona's higher-level labels (`type`, `sizeMiB`).
 */
export interface PartitionLayoutEntry {
  /** 1-based partition index in the partition table. */
  index: number;
  /**
   * Filesystem type string as reported by the platform probe. Linux:
   * `fstype` from `lsblk` (e.g. `"vfat"`, `"hfsplus"`). macOS: "File System
   * Personality" / "Type (Bundle)" from `diskutil info` (e.g.
   * `"MS-DOS FAT32"`, `"Apple_HFS"`). `null` when the partition has no
   * recognised filesystem (e.g. firmware partition, free space).
   */
  filesystem: string | null;
  /** Partition size in bytes. */
  sizeBytes: number;
  /** Partition identifier, e.g. `"sda1"` (Linux) or `"disk5s2"` (macOS). */
  identifier?: string;
  /** Volume UUID, when present in the partition table. */
  volumeUuid?: string;
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
  /** Number of attempts made (1 = succeeded first try) */
  attempts?: number;
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
   * Enumerate attached disk devices.
   *
   * With no options, returns every attached block-device partition the
   * platform surfaces (the legacy `listDevices` behaviour). When
   * `options.kinds` includes `'ipod'`, the result is narrowed to devices
   * classified as iPods (media type "iPod", `iPod_Control` directory, `IPOD`
   * volume label, Apple USB vendor id, etc.) and — on Linux — each iPod entry
   * carries the `/sys` USB fingerprint in `usb` so the discovery reconciler
   * can fold it with the matching USB-inquiry record by serial number.
   *
   * NOTE: only the `'ipod'` filter is implemented. `'mass-storage'` filtering
   * needs preset matching that lives above the manager, so a `kinds` that does
   * not include `'ipod'` (including `['mass-storage']`) currently returns the
   * full enumerate. No caller relies on mass-storage-only filtering yet.
   *
   * @param options.kinds - Device kinds to include. Omit for all devices.
   * @returns Array of device information
   */
  scan(options?: { kinds?: ReadonlyArray<'ipod' | 'mass-storage'> }): Promise<PlatformDeviceInfo[]>;

  /**
   * Locate a single device by Volume UUID or by mount path.
   *
   * Issues a direct OS query for the target rather than enumerating every
   * attached device and filtering — `{ volumeUuid }` resolves the UUID to a
   * device node, `{ path }` resolves the volume mounted at (or containing)
   * the path. Returns `null` when the OS cannot resolve the target, or when
   * the underlying probe binary is unavailable (degrades rather than throws).
   *
   * For UUID-less but mounted volumes (tmpfs / Docker bind / FunctionFS),
   * `locate({ path })` returns a record with `volumeUuid: ''` and a valid
   * `mountPoint` / `identifier` so path-mode resolution can proceed.
   *
   * @param target - `{ volumeUuid }` or `{ path }`
   * @returns Device info if found, null otherwise
   */
  locate(target: { volumeUuid: string } | { path: string }): Promise<PlatformDeviceInfo | null>;

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

  /**
   * Find other mounted volumes belonging to the same physical USB device.
   *
   * Dual-LUN devices (e.g., Echo Mini) present multiple volumes from a single
   * USB connection. When ejecting, all sibling volumes should be ejected so the
   * user can safely disconnect.
   *
   * @param mountPoint - Mount point of the primary volume
   * @returns Mount points of sibling volumes (excluding the primary), or empty array
   */
  getSiblingVolumes(mountPoint: string): Promise<string[]>;

  /**
   * Report the filesystem type of the volume mounted at (or containing) the
   * given path. macOS reads `diskutil info`'s "File System Personality" /
   * "Type (Bundle)"; Linux reads `findmnt`'s `FSTYPE`. Returns `null` when the
   * path cannot be resolved or the probe binary is missing (degrades rather
   * than throws). The string is opaque OS terminology — use
   * `classifyVolumeFilesystem` to map it onto a label-rule family.
   *
   * @param path - Mount path of the volume
   * @returns The filesystem string, or `null` if unresolved
   */
  detectFilesystem(path: string): Promise<string | null>;

  /**
   * Set the on-disk volume label, selecting the correct OS tool for the
   * platform and filesystem.
   *
   * - **macOS**: `diskutil rename <path> <label>` — works while mounted and
   *   MOVES the mountpoint (e.g. `/Volumes/OLD` → `/Volumes/NEW`).
   * - **Linux FAT**: `fatlabel <device> <label>` (dosfstools).
   * - **Linux HFS+**: the hfsplus relabel tool.
   *
   * Throws a {@link VolumeLabelError} on failure. The caller is responsible for
   * re-resolving the mountpoint afterward (the relabel may move it).
   *
   * @param path - Mount path of the volume to relabel
   * @param label - The new volume label (already derived via `labelFromName`)
   */
  setVolumeLabel(path: string, label: string): Promise<void>;
}

/**
 * Thrown when an OS-level volume relabel fails. Carries a `code` for
 * programmatic handling; the CLI surfaces the `message` to the user.
 */
export class VolumeLabelError extends Error {
  readonly code:
    | 'UNSUPPORTED_FILESYSTEM'
    | 'UNSUPPORTED_PLATFORM'
    | 'RELABEL_FAILED'
    | 'FILESYSTEM_UNRESOLVED';

  constructor(
    message: string,
    code:
      | 'UNSUPPORTED_FILESYSTEM'
      | 'UNSUPPORTED_PLATFORM'
      | 'RELABEL_FAILED'
      | 'FILESYSTEM_UNRESOLVED'
  ) {
    super(message);
    this.name = 'VolumeLabelError';
    this.code = code;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, VolumeLabelError);
    }
  }
}

/**
 * Stored iPod link for auto-detection
 *
 * Saved to config file to enable automatic device discovery
 * without requiring explicit device path.
 *
 * This represents the config-side stored device link (how to relocate
 * the device by Volume UUID). Distinct from the live device identity
 * in @podkit/device-types which carries firmware-level fields
 * (firewireGuid, serialNumber, familyId).
 */
export interface StoredIpodLink {
  /** Volume UUID for persistent identification across mounts */
  volumeUuid: string;
  /** Human-readable volume name */
  volumeName: string;
}

/**
 * Progress events emitted during eject with retry
 */
export type EjectProgressEvent =
  | { phase: 'sync'; message: string }
  | { phase: 'eject'; attempt: number; maxAttempts: number; message: string }
  | { phase: 'waiting'; attempt: number; delayMs: number; message: string }
  | { phase: 'eject-sibling'; mountPoint: string; message: string }
  | { phase: 'success'; message: string; forced: boolean }
  | { phase: 'failed'; message: string };

/**
 * Options for eject-with-retry wrapper
 */
export interface EjectWithRetryOptions {
  /** Force unmount — bypasses retry, goes straight to force unmount */
  force?: boolean;
  /** Maximum number of attempts (default: 3) */
  maxAttempts?: number;
  /** Delay between retries in milliseconds (default: 2000) */
  retryDelayMs?: number;
  /** Device label for progress messages (default: 'iPod') */
  deviceLabel?: string;
  /** Progress callback for CLI output */
  onProgress?: (event: EjectProgressEvent) => void;
  /**
   * Additional mount points to eject after the primary volume.
   *
   * For dual-LUN devices (e.g., Echo Mini) that present multiple volumes from
   * a single USB connection. These are ejected after the primary succeeds,
   * with failures logged but not treated as fatal.
   */
  additionalMountPoints?: string[];
}
