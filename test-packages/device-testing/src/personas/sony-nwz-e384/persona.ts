/**
 * Sony Walkman NWZ-E384 (8GB) persona — `WALKMAN`.
 *
 * Captured 2026-05-13 from physical hardware. Mac capture complete;
 * Linux capture deferred (pattern confirmed by sibling personas — see
 * `provenance.md` § "Linux capture session").
 *
 * **Currently unsupported by podkit** — Sony Walkman has no preset in
 * `packages/devices-mass-storage/src/presets/built-in.ts` and no entry in
 * `usb-hints.ts`. This persona exists as the canonical fixture for the
 * (eventual) Sony preset implementation; see `devices/sony-walkman-nwz-e380.md`
 * for the full device profile.
 *
 * Expected outputs (capabilities, readiness, doctor JSON) live in
 * `@podkit/e2e-vm-tests/src/expectations/sony-nwz-e384.ts` (schema v3).
 *
 * @see devices/sony-walkman-nwz-e380.md
 * @see documents/test-devices.md §"Sony Walkman NWZ-E384 (8GB)"
 * @module
 */

import type { DevicePersona } from '../types.js';
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };

export const sonyNwzE384: DevicePersona = {
  id: 'sony-nwz-e384',
  description:
    'Sony Walkman NWZ-E384 (8GB, WALKMAN) — mass-storage DAP, FAT32/MBR, currently unsupported (no podkit preset).',
  schemaVersion: 3,

  usbDescriptor: {
    vendorId: 0x054c, // Sony Corporation
    productId: 0x0882,
    deviceSerial: '10431991572055',
    // Mac-authoritative from `raw/ioreg.txt`. Composite-device convention:
    // device-level class/subclass/protocol are 0; the Mass Storage class
    // (0x08) lives on the interface descriptor. Linux session will
    // sanity-check from sysfs.
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // From `raw/ioreg.txt`: bMaxPacketSize0=64, bcdDevice=1 (0x0001),
    // bcdUSB=512 (0x0200), bNumConfigurations=1, iSerialNumber=5,
    // iManufacturer=1, iProduct=2. UsbDeviceSignature tail `080650`
    // confirms Mass Storage / SCSI / Bulk-Only Transport interface.
    bMaxPacketSize0: 64,
    bcdUSB: 0x0200,
    bcdDevice: 0x0001,
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
    // iManufacturer=1 → "Sony", iProduct=2 → "WALKMAN", iSerialNumber=5
    // → the device serial string (from `kUSBSerialNumberString`).
    stringDescriptors: { 1: 'Sony', 2: 'WALKMAN', 5: '10431991572055' },
  },

  sysInfoExtendedXml: null,

  lsblkJson: null,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // MBR (2048-byte sectors). FAT32 starts at sector 5 — only 10 KiB
    // reserved before, just enough for MBR. Sony Walkman firmware lives on
    // a separate internal NAND area, not in a disk-visible firmware region.
    // No synthetic firmware entry needed.
    luns: [
      {
        lun: 0,
        partitions: [{ index: 1, type: 'FAT32', sizeMiB: 7357, mountpoint: '/Volumes/WALKMAN' }],
      },
    ],
  },

  // Backing image dump not captured — 7.3 GB FAT32 far exceeds the playbook's
  // 16 MiB threshold. For VM USB synthesis, use a synthesised FAT32 with
  // the marker files documented in `provenance.md` (the `.E380` files +
  // capability XMLs + DeviceInfo.txt + empty STDB* placeholders).
  massStorageBackingFile: null,

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'physical-capture',
  },
};
