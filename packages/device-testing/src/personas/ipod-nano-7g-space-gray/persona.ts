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
  schemaVersion: 1,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1267,
    deviceSerial: '000A270024A23E9E',
    // Linux session reconciles these from /sys/.../bDeviceClass.
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
  },

  sysInfoExtendedXml,

  lsblkJson: null,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // Single MBR partition at sector 63 (4096-byte sectors). Only ~252 KiB
    // of reserved space before — MBR padding only, no on-disk firmware
    // partition (firmware in NOR flash). Same pattern as nano 3G.
    partitions: [{ index: 1, type: 'FAT32', sizeMiB: 15065, mountpoint: '/Volumes/IPOD' }],
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
