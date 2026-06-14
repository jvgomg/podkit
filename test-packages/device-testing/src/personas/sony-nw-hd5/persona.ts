/**
 * Sony Walkman NW-HD5 (20GB HDD) persona — `NO NAME`.
 *
 * Captured 2026-05-13 from physical hardware. Mac capture complete;
 * Linux capture deferred (pattern confirmed by sibling personas — see
 * `provenance.md` § "Linux capture session").
 *
 * **Currently unsupported by podkit** — original "Network Walkman" line
 * (pre-NW-A rebrand). Same SonicStage-era OpenMG/ATRAC content constraints
 * as NW-A, plus additional MACLIST0 integrity records and separate-JPG
 * artwork in `20PXX/` directories. See `devices/sony-walkman-nw-hd-series.md`
 * for the family-level profile.
 *
 * Notable differences from the NW-A personas:
 *   - **USB descriptor `ATRAC HDD`** (vs NW-A's `HDD WALKMAN`) — different
 *     product-line branding.
 *   - **PID `0x0233`** — distinct from NW-A series (which uses 0x026a /
 *     0x0269).
 *   - **No `A_WM/`, `CONNECT/`, `30GRCT/`, `MEDIAGO/`** directories — those
 *     were introduced in the NW-A generation.
 *   - **`MACLIST0.DAT` + `MACLIST0.BAK`** at OMGAUDIO root — encrypted
 *     per-track MAC list for DRM integrity. Not seen on NW-A.
 *   - **`20PXX/` directories** hold separate JPG album-artwork files (not
 *     audio). NW-A embeds artwork in EA3 headers; NW-HD uses sidecar JPGs.
 *   - **Older `01TREE` numbering** (uses hex `0A`–`0F` ids that NW-A skips).
 *
 * @see devices/sony-walkman-nw-hd-series.md
 * @see documents/test-devices.md §"Sony Walkman NW-HD5 (20GB HDD)"
 * @module
 */

import type { DevicePersona } from '../types.js';
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };

export const sonyNwHd5: DevicePersona = {
  id: 'sony-nw-hd5',
  description:
    'Sony Walkman NW-HD5 (20GB HDD) — pre-NW-A Network Walkman. ATRAC HDD, OpenMG v1.1 + MACLIST + JPG art.',
  schemaVersion: 3,

  usbDescriptor: {
    vendorId: 0x054c,
    productId: 0x0233,
    // No USB serial — `iSerialNumber = 0` (confirmed via `raw/ioreg.txt`).
    // v2 schema migrates from the v1 `''` workaround to explicit `null` —
    // NW-HD5 is the canonical example for the nullable-serial gap Gap 3
    // in TASK-332.
    deviceSerial: null,
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // From `raw/ioreg.txt`: bMaxPacketSize0=64, bcdDevice=256 (0x0100),
    // bcdUSB=512 (0x0200), bNumConfigurations=1. UsbDeviceSignature tail
    // `080650` confirms Mass Storage / SCSI / Bulk-Only Transport interface.
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
    // iManufacturer=1 → "Sony", iProduct=2 → "ATRAC HDD" (note: different
    // product string vs the later NW-A "HDD WALKMAN" — distinct product
    // line). No serial entry (iSerialNumber=0).
    stringDescriptors: { 1: 'Sony', 2: 'ATRAC HDD' },
  },

  sysInfoExtendedXml: null,

  lsblkJson: null,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // MBR FAT32-LBA (type 0x0C). 512-byte sectors. Single partition at
    // sector 63 — ~32 KiB MBR padding. No on-disk firmware region.
    luns: [
      {
        lun: 0,
        partitions: [{ index: 1, type: 'FAT32', sizeMiB: 19074, mountpoint: '/Volumes/NO NAME' }],
      },
    ],
  },

  massStorageBackingFile: null,

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'physical-capture',
  },
};
