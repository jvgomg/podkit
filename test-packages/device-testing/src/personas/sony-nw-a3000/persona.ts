/**
 * Sony Walkman NW-A3000 (20GB HDD) persona — `NO NAME`.
 *
 * Captured 2026-05-13 from physical hardware. Mac capture complete;
 * Linux capture deferred (pattern confirmed by sibling personas — see
 * `provenance.md` § "Linux capture session").
 *
 * **Currently unsupported by podkit** — same content-layer constraints as
 * NW-A1000 (SonicStage-era OpenMG/ATRAC). See `devices/sony-walkman-nw-a-series.md`
 * for the family-level profile.
 *
 * Notable differences from `sony-nw-a1000`:
 *   - Distinct PID `0x0269` (vs A1000's `0x026a`) — PIDs are NOT shared
 *     across the NW-A HDD series; the prior assumption in the device
 *     profile has been corrected.
 *   - OpenMG database version is **2.0** (`GTLT/GTIF/CNIF/...` magic bytes
 *     carry the version word `02 00 00 00` vs A1000's `01 01 00 00`).
 *   - Filesystem includes additional artefacts not present on A1000:
 *     `0001001D.DAT` / `00010021.DAT` (EKB — Encrypted Key Blocks for
 *     OpenMG DRM keys), `SRCIDLST.DAT` + `SRCIDLST.BAK` (Source ID List
 *     tracking content origin), `30GRCT/` directory (empty here),
 *     `A_WM/ARDETECT.DAT` (DRM challenge file, factory-dated 2006-01-28).
 *   - Hard drive: 20 GB (vs A1000's 6 GB).
 *
 * @see devices/sony-walkman-nw-a-series.md
 * @see documents/test-devices.md §"Sony Walkman NW-A3000 (20GB HDD)"
 * @module
 */

import type { DevicePersona } from '../types.js';
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };

export const sonyNwA3000: DevicePersona = {
  id: 'sony-nw-a3000',
  description:
    'Sony Walkman NW-A3000 (20GB HDD) — SonicStage/OpenMG v2.0. NW-A1000 sibling with newer DB + DRM.',
  schemaVersion: 3,

  usbDescriptor: {
    vendorId: 0x054c, // Sony Corporation
    productId: 0x0269,
    // No USB serial — `iSerialNumber = 0` (same as A1000). v2 schema
    // migrates from v1's `''` to explicit `null`. Per-unit identification
    // via FAT32 volume UUID.
    deviceSerial: null,
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // From `raw/ioreg.txt`: bMaxPacketSize0=64, bcdDevice=256 (0x0100),
    // bcdUSB=512 (0x0200), bNumConfigurations=1. UsbDeviceSignature tail
    // `080650` confirms the Mass Storage / SCSI / Bulk-Only interface.
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
    stringDescriptors: { 1: 'Sony', 2: 'HDD WALKMAN' },
  },

  sysInfoExtendedXml: null,

  lsblkJson: null,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // MBR FAT32-LBA (type 0x0C). 512-byte sectors. Single partition at
    // sector 63 — only ~32 KiB MBR padding before. No on-disk firmware
    // region. Identical layout shape to NW-A1000, just larger.
    luns: [
      {
        lun: 0,
        partitions: [{ index: 1, type: 'FAT32', sizeMiB: 18641, mountpoint: '/Volumes/NO NAME' }],
      },
    ],
  },

  // Backing image dump not captured — 18.6 GiB FAT32 with DRM-bound user
  // content. VM synthesis should use the OpenMG marker scaffold listed
  // in `devices/sony-walkman-nw-a-series.md`.
  massStorageBackingFile: null,

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'physical-capture',
  },
};
