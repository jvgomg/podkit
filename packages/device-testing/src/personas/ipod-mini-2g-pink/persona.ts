/**
 * iPod mini 2G (4GB Pink) persona — `SALLYS IPOD`.
 *
 * Captured 2026-05-13 from physical hardware. Mac capture complete;
 * Linux capture deferred (pattern confirmed by sibling personas — see
 * `provenance.md` § "Linux capture session").
 *
 * `expectedCapabilities` + `expectedReadiness` are provisional — see
 * `provenance.md` § "Expected-* fields status".
 *
 * @see documents/test-devices.md §"iPod mini 2nd Generation (4GB Pink)"
 * @see documents/sysinfo-captures/mini-2g.xml
 * @module
 */

import type { DevicePersona } from '../types.js';
import sysInfoExtendedXml from './raw/sysinfo-extended.xml' with { type: 'text' };
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };

export const ipodMini2gPink: DevicePersona = {
  id: 'ipod-mini-2g-pink',
  description:
    'iPod mini 2G 4GB Pink (SALLYS IPOD) — pre-2006 SysInfo, SCSI-fallback inquiry, no artwork/video.',
  schemaVersion: 2,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1205,
    deviceSerial: '000A270014198517',
    // Mac system_profiler doesn't expose bDeviceClass/Subclass/Protocol.
    // Linux capture session reconciles these from /sys/.../bDeviceClass.
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // Synthesised from the iPod composite-mass-storage convention shared by
    // every captured iPod sibling (nano 3G/4G/7G). Linux capture deferred —
    // flagged for follow-up in `provenance.md`; re-capture from sysfs +
    // `lsusb -v` to confirm.
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
    stringDescriptors: { 1: 'Apple Inc.', 2: 'iPod', 3: '000A270014198517' },
  },

  sysInfoExtendedXml,

  lsblkJson: null,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // MBR has a single FAT32 entry starting at sector 80325. Sectors 0..80324
    // (~39 MiB) are unallocated reserved space holding the iPod firmware —
    // mini 2G firmware lives in this gap, not in a separate MBR partition.
    luns: [
      {
        lun: 0,
        partitions: [
          { index: 1, type: 'firmware', sizeMiB: 39 },
          { index: 2, type: 'FAT32', sizeMiB: 3859, mountpoint: '/Volumes/SALLYS IPOD' },
        ],
      },
    ],
  },

  massStorageBackingFile: null,

  // Provisional — validate against production resolver in the compute-expected pass.
  expectedCapabilities: {
    artworkSources: [],
    artworkMaxResolution: null,
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
