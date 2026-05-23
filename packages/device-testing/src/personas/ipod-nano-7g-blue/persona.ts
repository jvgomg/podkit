/**
 * iPod nano 7G #2 (16GB Blue) persona — `iPod` (lowercase).
 *
 * Captured 2026-05-13 from physical hardware. Mac + Linux capture sessions
 * complete.
 *
 * USB-inquiry path. hashAB checksum generation — `device add` currently
 * refuses unsupported generations (warn-but-allow change is backlog).
 *
 * `expectedCapabilities` + `expectedReadiness` are provisional — see
 * `provenance.md` § "Expected-* fields status".
 *
 * @see documents/test-devices.md §"iPod nano 7th Generation #2 (16GB Blue)"
 * @see documents/sysinfo-captures/nano-7g-16gb-blue-usb.xml
 * @module
 */

import type { DevicePersona } from '../types.js';
import sysInfoExtendedXml from './raw/sysinfo-extended.xml' with { type: 'text' };
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };
import lsblkJson from './raw/lsblk.json' with { type: 'json' };

export const ipodNano7gBlue: DevicePersona = {
  id: 'ipod-nano-7g-blue',
  description:
    'iPod nano 7G #2 16GB Blue (iPod) — HFS+/APM, USB-inquiry works, per-read crypto blob in SIE, hashAB checksum.',
  schemaVersion: 2,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1267,
    deviceSerial: '000A270024565D97',
    // Confirmed via Linux sysfs (2026-05-13): bDeviceClass/Subclass/Protocol
    // = 0/0/0 (composite-device convention).
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // From `raw/sysfs-usb.txt`: bMaxPacketSize0=64, bcdDevice=0001,
    // bNumConfigurations=2 (same shape as nano 3G + 4G).
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
    stringDescriptors: { 1: 'Apple Inc.', 2: 'iPod', 3: '000A270024565D97' },
  },

  sysInfoExtendedXml,

  lsblkJson,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // Apple Partition Map (not MBR). Linux capture confirms only two
    // partitions: APM header + HFS+ data. No hidden Apple_MDFW partition
    // (same finding as nano 4G — see provenance for both).
    luns: [
      {
        lun: 0,
        partitions: [
          { index: 1, type: 'apple_partition_map', sizeMiB: 1 },
          { index: 2, type: 'HFS+', sizeMiB: 15067, mountpoint: '/Volumes/iPod' },
        ],
      },
    ],
  },

  massStorageBackingFile: null,

  // Provisional — validate against production resolver in the compute-expected pass.
  expectedCapabilities: {
    artworkSources: ['embedded', 'database'],
    artworkMaxResolution: 240,
    supportedAudioCodecs: ['aac', 'alac', 'mp3', 'aiff', 'wav'],
    supportsVideo: false,
    audioNormalization: 'soundcheck',
    supportsAlbumArtistBrowsing: false,
  },

  // Provisional — validate against production resolver in the compute-expected pass.
  expectedReadiness: {
    level: 'ready',
    stages: [],
  },

  expectedDoctorOutput: {},

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'physical-capture',
  },
};
