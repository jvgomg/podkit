/**
 * Sony Walkman NW-A1000 (6GB HDD) persona — `NO NAME`.
 *
 * Captured 2026-05-13 from physical hardware. Mac capture complete;
 * Linux capture deferred (pattern confirmed by sibling personas — see
 * `provenance.md` § "Linux capture session").
 *
 * **Currently unsupported by podkit** — NW-A1000 is a SonicStage-era HDD
 * Walkman. It enumerates as USB Mass Storage but accepts only OpenMG-encoded
 * `.OMA` content authored by SonicStage (Windows). Plain MP3 / FLAC dropped
 * onto the filesystem is not indexed by the device library.
 *
 * See `devices/sony-walkman-nw-a-series.md` for the full device profile and
 * the three realistic implementation paths (detect-and-reject vs Mass-Storage-Mode
 * preset vs full OpenMG writer).
 *
 * @see devices/sony-walkman-nw-a-series.md
 * @see documents/test-devices.md §"Sony Walkman NW-A1000 (6GB HDD)"
 * @module
 */

import type { DevicePersona } from '../types.js';
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };

export const sonyNwA1000: DevicePersona = {
  id: 'sony-nw-a1000',
  description:
    'Sony Walkman NW-A1000 (6GB HDD) — SonicStage/OpenMG/ATRAC. FAT32 mass storage, proprietary content.',
  schemaVersion: 3,

  usbDescriptor: {
    vendorId: 0x054c, // Sony Corporation
    productId: 0x026a,
    // No USB serial — `iSerialNumber = 0` in the descriptor (confirmed via
    // `raw/ioreg.txt`). v2 schema migrates from the v1 `''` workaround to
    // explicit `null`. Per-unit identification must use FAT32 volume UUID
    // (see `diskutilPlist`) or per-track CIDs in the OpenMG database.
    deviceSerial: null,
    // Mac-authoritative from `raw/ioreg.txt`. Composite-device convention:
    // device-level 0/0/0; Mass Storage class on interface descriptor.
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // From `raw/ioreg.txt`: bMaxPacketSize0=64, bcdDevice=256 (0x0100),
    // bcdUSB=512 (0x0200), bNumConfigurations=1, iSerialNumber=0 (absent).
    // UsbDeviceSignature tail `080650` confirms Mass Storage / SCSI /
    // Bulk-Only Transport interface.
    bMaxPacketSize0: 64,
    bcdUSB: 0x0200,
    bcdDevice: 0x0100,
    bNumConfigurations: 1,
    configurations: [
      {
        bConfigurationValue: 1,
        bNumInterfaces: 1,
        bmAttributes: 0x80,
        bMaxPower: 0xfa,
        interfaces: [
          {
            bInterfaceNumber: 0,
            bAlternateSetting: 0,
            bInterfaceClass: 0x08,
            bInterfaceSubClass: 0x06,
            bInterfaceProtocol: 0x50,
            endpoints: [
              { bEndpointAddress: 0x81, bmAttributes: 0x02, wMaxPacketSize: 512, bInterval: 0 },
              { bEndpointAddress: 0x02, bmAttributes: 0x02, wMaxPacketSize: 512, bInterval: 0 },
            ],
          },
        ],
      },
    ],
    // iManufacturer=1 → "Sony", iProduct=2 → "HDD WALKMAN". No serial
    // descriptor entry (iSerialNumber=0).
    stringDescriptors: { 1: 'Sony', 2: 'HDD WALKMAN' },
  },

  sysInfoExtendedXml: null,

  lsblkJson: null,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // MBR with FAT32-LBA (partition type 0x0C, not 0x0B used elsewhere in
    // this set). 512-byte sectors. Partition starts at sector 63, leaving
    // only ~32 KiB MBR padding before the user-visible filesystem. No
    // on-disk firmware region (NW-A1000 firmware lives in onboard flash,
    // not as a separate HDD partition).
    luns: [
      {
        lun: 0,
        partitions: [{ index: 1, type: 'FAT32', sizeMiB: 5705, mountpoint: '/Volumes/NO NAME' }],
      },
    ],
  },

  // Backing image dump not captured — 5.7 GB FAT32 far exceeds the 16 MiB
  // threshold and contains user music (DRM-bound OMA files plus an OpenMG
  // database with embedded ID3v2 metadata in cleartext). For VM USB
  // synthesis, use the `synthesis` recipe with the OpenMG marker files
  // listed in `devices/sony-walkman-nw-a-series.md` § "Detection".
  massStorageBackingFile: null,

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'physical-capture',
  },
};
