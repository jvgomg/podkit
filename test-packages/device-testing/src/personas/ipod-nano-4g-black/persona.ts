/**
 * iPod nano 4G (8GB Black) persona — `James' iPod`.
 *
 * Captured 2026-05-13 from physical hardware. Mac + Linux capture sessions
 * complete.
 *
 * USB-inquiry works. HFS+ formatted with Apple Partition Map scheme — the
 * first persona in this set with APM rather than MBR. Linux capture
 * conclusively resolved the Mac-session "hidden Apple_MDFW" hypothesis:
 * no such partition exists.
 *
 * Expected outputs (capabilities, readiness, doctor JSON) live in
 * `@podkit/e2e-vm-tests/src/expectations/ipod-nano-4g-black.ts` (schema v3).
 *
 * @see documents/test-devices.md §"iPod nano 4th Generation (8GB Black)"
 * @see documents/sysinfo-captures/nano-4g-8gb-black.xml
 * @module
 */

import type { DevicePersona } from '../types.js';
import { asRawXmlText } from '../raw-text.js';
import sysInfoExtendedXmlRaw from './raw/sysinfo-extended.xml' with { type: 'text' };
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };
import lsblkJson from './raw/lsblk.json' with { type: 'json' };

const sysInfoExtendedXml = asRawXmlText(sysInfoExtendedXmlRaw);

export const ipodNano4gBlack: DevicePersona = {
  id: 'ipod-nano-4g-black',
  description:
    "iPod nano 4G 8GB Black (James' iPod) — HFS+ / Apple Partition Map, USB-inquiry works, per-read crypto blob in SIE.",
  schemaVersion: 3,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1263,
    deviceSerial: '000A27001DCECFB5',
    // Confirmed via Linux sysfs (2026-05-13): bDeviceClass/Subclass/Protocol
    // = 0/0/0 (composite-device convention).
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // From `raw/sysfs-usb.txt`: bMaxPacketSize0=64, bcdDevice=0001,
    // bNumConfigurations=2 (same shape as nano 3G).
    bMaxPacketSize0: 64,
    bcdUSB: 0x0200,
    bcdDevice: 0x0001,
    bNumConfigurations: 2,
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
      {
        bConfigurationValue: 2,
        bNumInterfaces: 1,
        bmAttributes: 0xc0,
        bMaxPower: 0x32,
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
    stringDescriptors: { 1: 'Apple Inc.', 2: 'iPod', 3: '000A27001DCECFB5' },
  },

  sysInfoExtendedXml,

  lsblkJson,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // Apple Partition Map (not MBR). Linux capture confirms only two
    // partitions: APM header + HFS+ data. There is no hidden `Apple_MDFW`
    // firmware partition on this unit — diskutil's view was complete.
    // Both partitions visible in `raw/lsblk.json` with `pttype: "mac"`.
    luns: [
      {
        lun: 0,
        partitions: [
          { index: 1, type: 'apple_partition_map', sizeMiB: 1 },
          { index: 2, type: 'HFS+', sizeMiB: 7601, mountpoint: "/Volumes/James' iPod" },
        ],
      },
    ],
  },

  massStorageBackingFile: null,

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'physical-capture',
  },
};
