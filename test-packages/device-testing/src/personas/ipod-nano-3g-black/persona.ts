/**
 * iPod nano 3G (8GB Black) persona — `IPOD`.
 *
 * Captured 2026-05-13 from physical hardware. Mac + Linux capture sessions
 * complete.
 *
 * USB-inquiry boundary device — nano 3G is the earliest iPod that answers
 * vendor control transfers (refines prior "iPod 5G+" research).
 *
 * Expected outputs (capabilities, readiness, doctor JSON) live in
 * `@podkit/e2e-vm-tests/src/expectations/ipod-nano-3g-black.ts` (schema v3).
 *
 * @see documents/test-devices.md §"iPod nano 3rd Generation (8GB Black)"
 * @see documents/sysinfo-captures/nano-3g-8gb-black.xml
 * @module
 */

import type { DevicePersona } from '../types.js';
import { asRawXmlText } from '../raw-text.js';
import sysInfoExtendedXmlRaw from './raw/sysinfo-extended.xml' with { type: 'text' };
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };
import lsblkJson from './raw/lsblk.json' with { type: 'json' };

const sysInfoExtendedXml = asRawXmlText(sysInfoExtendedXmlRaw);

export const ipodNano3gBlack: DevicePersona = {
  id: 'ipod-nano-3g-black',
  description:
    'iPod nano 3G 8GB Black (IPOD) — USB-inquiry boundary device, no per-read crypto blob.',
  schemaVersion: 3,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1262,
    deviceSerial: '000A27001BC8EED6',
    // Confirmed via Linux sysfs (2026-05-13): bDeviceClass/Subclass/Protocol
    // = 0/0/0 (composite-device convention; Mass Storage class lives on the
    // interface descriptor). Mac ioreg + Linux sysfs agree.
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // From `raw/sysfs-usb.txt`: bMaxPacketSize0=64, bcdDevice=0001,
    // bNumConfigurations=2. Linux sysfs reports the descriptor-table count
    // (2 configurations: bus-powered + self-powered); macOS ioreg shows only
    // the active config — descriptor-vs-active distinction, both correct.
    bMaxPacketSize0: 64,
    bcdUSB: 0x0200,
    bcdDevice: 0x0001,
    bNumConfigurations: 2,
    // Per-config interface details not explicitly captured. iPod
    // composite-device convention: Mass Storage class (0x08) /
    // SCSI transparent (0x06) / Bulk-Only Transport (0x50) with a bulk
    // endpoint pair per interface. Re-capture from `lsusb -v` if a
    // future test asserts on per-config interface differences.
    configurations: [
      {
        bConfigurationValue: 1,
        bNumInterfaces: 1,
        bmAttributes: 0x80, // bus-powered, no remote wakeup
        bMaxPower: 0xfa, // 500 mA
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
      {
        bConfigurationValue: 2,
        bNumInterfaces: 1,
        bmAttributes: 0xc0, // self-powered
        bMaxPower: 0x32, // 100 mA
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
    stringDescriptors: {
      1: 'Apple Inc.',
      2: 'iPod',
      3: '000A27001BC8EED6',
    },
  },

  sysInfoExtendedXml,

  lsblkJson,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // Single MBR partition at sector 63 (4096-byte sectors). ~252 KiB of
    // reserved space before the partition is MBR padding only — nano 3G
    // firmware lives in onboard NOR flash, not in a disk partition.
    luns: [
      {
        lun: 0,
        partitions: [{ index: 1, type: 'FAT32', sizeMiB: 7585, mountpoint: '/Volumes/IPOD' }],
      },
    ],
  },

  massStorageBackingFile: null,

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'physical-capture',
  },
};
