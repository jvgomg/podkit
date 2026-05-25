/**
 * iPod nano 7G #1 (16GB Space Gray) persona — `IPOD`.
 *
 * Captured 2026-05-13 from physical hardware. Mac capture complete;
 * Linux capture deferred (pattern confirmed by sibling personas — see
 * `provenance.md` § "Linux capture session").
 *
 * USB-inquiry path. FAT32/MBR (contrast nano 7G #2 Blue which is HFS+/APM).
 *
 * `expectedCapabilities` + `expectedReadiness` are provisional — see
 * `provenance.md` § "Expected-* fields status".
 *
 * @see documents/test-devices.md §"iPod nano 7th Generation (16GB)"
 * @see documents/sysinfo-captures/nano-7g-16gb-usb.xml
 * @module
 */

import type { DevicePersona } from '../types.js';
import sysInfoExtendedXml from './raw/sysinfo-extended.xml' with { type: 'text' };
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };

export const ipodNano7gSpaceGray: DevicePersona = {
  id: 'ipod-nano-7g-space-gray',
  description:
    'iPod nano 7G #1 16GB Space Gray (IPOD) — FAT32/MBR, USB-inquiry works, per-read crypto blob in SIE, hashAB checksum.',
  schemaVersion: 2,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1267,
    deviceSerial: '000A270024A23E9E',
    // Same family as `ipod-nano-7g-blue` (shared PID 0x1267). Linux capture
    // of the Blue sibling confirms 0/0/0 + bNumConfigurations=2; this
    // persona inherits that shape pending its own Linux capture.
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // Inherited from the Blue sibling's sysfs capture (shared PID 0x1267).
    // Flagged for follow-up Linux capture in `provenance.md`.
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
    stringDescriptors: { 1: 'Apple Inc.', 2: 'iPod', 3: '000A270024A23E9E' },
  },

  sysInfoExtendedXml,

  lsblkJson: null,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // Single MBR partition at sector 63 (4096-byte sectors). Only ~252 KiB
    // of reserved space before — MBR padding only, no on-disk firmware
    // partition (firmware in NOR flash). Same pattern as nano 3G.
    luns: [
      {
        lun: 0,
        partitions: [{ index: 1, type: 'FAT32', sizeMiB: 15065, mountpoint: '/Volumes/IPOD' }],
      },
    ],
  },

  // VM only: 128 MiB FAT32 backing file synthesised inside the test VM
  // by `runners/lima-test-vm-backing-files.ts`. The image is empty (no
  // iTunesDB, no media files). The recipe
  // is the source of truth; re-running mkfs.vfat --invariant against the
  // same (sizeMiB, label) pair is byte-identical. Real device is 16 GB;
  // 128 MiB is a VM-only stand-in that the inquiry path doesn't care
  // about.
  massStorageBackingFile: {
    synthesis: {
      sizeMiB: 128,
      filesystem: 'FAT32',
      label: 'IPOD_NANO',
    },
    resetStrategy: 'copy',
  },

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
