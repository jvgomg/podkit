/**
 * DevicePersona — a typed fixture describing a single device under test.
 *
 * Schema mirrors ADR-017 §"DevicePersona schema". Consumed in two places:
 *
 * - **Tier 1 unit tests** import the TypeScript object directly and feed
 *   its fields into injectable fakes (`FakeUsbBinding`, `ReplaySubprocessRunner`).
 * - **Tier 3 VM tests** receive a JSON serialisation of the same object via
 *   the lima-test-vm runner; the FunctionFS daemon then replays the USB
 *   descriptors, VPD payload, and partition layout.
 *
 * @see adr/adr-017-device-persona-fixtures.md
 * @module
 */

import type { DeviceCapabilities } from '@podkit/device-types';
import type { ReadinessResult } from '@podkit/core';

/**
 * Placeholder for the `podkit doctor` JSON shape.
 *
 * TODO: tighten once `DoctorOutput` is exported. Currently defined as the
 * private interface `DoctorOutput` in `packages/podkit-cli/src/commands/doctor.ts:85`
 * and not part of any public surface. Tightening this requires either
 * promoting the type to `@podkit/core` or exporting it from the CLI.
 */
export type DoctorOutput = object;

/**
 * Stable, registry-keyed fixture describing one device under test.
 */
export interface DevicePersona {
  /** Stable identifier used in test assertions and the daemon's --persona flag. */
  id: string;
  /** Human-readable label for error messages and logs. */
  description: string;
  /** Schema version; bump on any breaking field change. */
  schemaVersion: number;

  // --- USB layer -------------------------------------------------------------

  usbDescriptor: {
    /** USB vendor ID (e.g. `0x05ac` for Apple). */
    vendorId: number;
    /** USB product ID (e.g. `0x1261` for iPod classic 7G). */
    productId: number;
    /** Device serial number as reported by USB descriptor. */
    deviceSerial: string;
    /** USB device class code. */
    deviceClass: number;
    /** USB device subclass code. */
    deviceSubclass: number;
    /** USB device protocol code. */
    deviceProtocol: number;
  };

  // --- SCSI / firmware layer -------------------------------------------------

  /** Raw XML payload returned by SCSI VPD page 0xC0 (SysInfoExtended). `null` for devices that don't answer VPD 0xC0. */
  sysInfoExtendedXml: string | null;

  // --- Host OS probe layer ---------------------------------------------------

  /** Canned output of `lsblk -J` for this device (Linux). */
  lsblkJson: object | null;
  /** Canned output of `system_profiler SPUSBDataType -json` (macOS). */
  systemProfilerJson: object | null;
  /** Canned output of `diskutil list -plist` (macOS). */
  diskutilPlist: string | null;

  // --- Filesystem ------------------------------------------------------------

  /** MBR partition table describing the device layout. */
  partitionLayout: {
    partitions: Array<{
      index: number;
      /** Partition type label, e.g. `"FAT32"`, `"HFS+"`, `"empty"`. */
      type: string;
      sizeMiB: number;
      mountpoint?: string;
    }>;
  };

  // --- Mass storage backing file (optional) ----------------------------------

  /**
   * Describes the FAT32 backing file for mass-storage personas.
   *
   * When set, the lima-test-vm runner stages this image as the
   * `usb_f_mass_storage` backing file. `null` for iPod personas (which use
   * FunctionFS vendor control transfers instead).
   */
  massStorageBackingFile: {
    /** Path to a pre-built FAT32 image file relative to this persona's directory. */
    imagePath?: string;
    /** Synthesis recipe (used when no pre-built image is committed). */
    synthesis?: {
      sizeMiB: number;
      filesystem: 'FAT32' | 'FAT16';
      initialContent?: Array<{ path: string; sourceFixture: string }>;
    };
    /** Reset strategy between tests: `copy` (re-copy from reference) or `swap` (atomic rename). */
    resetStrategy: 'copy' | 'swap';
  } | null;

  // --- Expected outcomes (for assertion) -------------------------------------

  /** What `resolveCapabilities()` must return for this persona. `null` for unsupported/rejected devices. */
  expectedCapabilities: DeviceCapabilities | null;
  /** What `checkReadiness()` must return. */
  expectedReadiness: ReadinessResult;
  /** Snapshot of doctor JSON output; used for golden-file assertions. */
  expectedDoctorOutput: DoctorOutput;

  // --- Provenance ------------------------------------------------------------

  provenance: {
    /** Path to provenance.md that links capture session and hardware serial. */
    provenanceDoc: string;
    /** Whether this persona was captured from physical hardware or synthesised. */
    source: 'physical-capture' | 'synthesised';
  };
}
