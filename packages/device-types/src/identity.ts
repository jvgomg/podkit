/**
 * Device identity types
 *
 * Discriminated union covering all device identity variants podkit can
 * encounter. A `DeviceProvider` resolves a `UsbFingerprint` to one of
 * these identities, or returns `null` when the device is not recognised.
 *
 * @module
 */

// =============================================================================
// USB fingerprint
// =============================================================================

/**
 * Low-level USB descriptor fields that uniquely identify a connected device.
 * Obtained from the OS USB layer before any higher-level protocol is attempted.
 *
 * `bus` and `devnum` are optional because some discovery contexts (e.g.
 * macOS system_profiler when location_id is absent, or early-discovery paths
 * that have not yet resolved bus addressing) may not provide them.
 * Providers and transports that require bus addressing must guard against
 * undefined values before use.
 */
export type UsbFingerprint = {
  /** USB vendor ID as bare hex string, lowercase, e.g. `"05ac"` (Apple) */
  vendorId: string;
  /** USB product ID as bare hex string, lowercase, e.g. `"1261"` (iPod nano 2G) */
  productId: string;
  /** USB serial number string, if reported by the device */
  serialNumber?: string;
  /** USB bus number — optional; may be absent in some discovery contexts */
  bus?: number;
  /** Device number on the bus — optional; may be absent in some discovery contexts */
  devnum?: number;
};

// =============================================================================
// Identity variants
// =============================================================================

/**
 * Identity for an iPod device identified via its USB descriptor and firmware.
 * The `firewireGuid` and `serialNumber` come from SysInfoExtended; `familyId`
 * identifies the iPod generation/model family.
 *
 * When `notSupportedReason` is set, the device was identified as an iPod but
 * is not supported by podkit (libgpod limitation, iTunes-only auth, etc.).
 * Other identity fields may be empty placeholders in that case.
 * Callers should surface the reason and stop the add flow.
 */
export type IpodIdentity = {
  kind: 'ipod';
  firewireGuid: string;
  serialNumber: string;
  familyId: number;
  /**
   * If set, the device is a known iPod but cannot be synced by podkit.
   * Callers should surface this reason to the user and abort the add flow.
   */
  notSupportedReason?: string;
};

/**
 * Identity for a generic USB mass-storage device.
 * Either `volumeUuid` or `serialNumber` (or both) may be available depending
 * on the OS and device firmware.
 *
 * `presetId` is set by the mass-storage provider when a USB VID/PID hint
 * matched a known preset (e.g. `'echo-mini'`). Absent when the device was
 * matched as a generic mass-storage device.
 */
export type MassStorageIdentity = {
  kind: 'mass-storage';
  volumeUuid?: string;
  serialNumber?: string;
  /** Preset id matched via USB VID/PID hint table, if any */
  presetId?: string;
};

/**
 * Discriminated union of all device identity variants.
 * Use `identity.kind` to narrow to the specific type.
 */
export type DeviceIdentity = IpodIdentity | MassStorageIdentity;
