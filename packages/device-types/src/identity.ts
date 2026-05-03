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
 */
export type UsbFingerprint = {
  /** USB vendor ID as a hex string, e.g. `"05ac"` (Apple) */
  vendorId: string;
  /** USB product ID as a hex string, e.g. `"1261"` (iPod nano 2G) */
  productId: string;
  /** USB serial number string, if reported by the device */
  serialNumber?: string;
  /** USB bus number */
  bus: number;
  /** Device number on the bus */
  devnum: number;
};

// =============================================================================
// Identity variants
// =============================================================================

/**
 * Identity for an iPod device identified via its USB descriptor and firmware.
 * The `firewireGuid` and `serialNumber` come from SysInfoExtended; `familyId`
 * identifies the iPod generation/model family.
 */
export type IpodIdentity = {
  kind: 'ipod';
  firewireGuid: string;
  serialNumber: string;
  familyId: number;
};

/**
 * Identity for a generic USB mass-storage device.
 * Either `volumeUuid` or `serialNumber` (or both) may be available depending
 * on the OS and device firmware.
 */
export type MassStorageIdentity = {
  kind: 'mass-storage';
  volumeUuid?: string;
  serialNumber?: string;
};

/**
 * Discriminated union of all device identity variants.
 * Use `identity.kind` to narrow to the specific type.
 */
export type DeviceIdentity = IpodIdentity | MassStorageIdentity;
