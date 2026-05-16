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
  schemaVersion: 1,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1267,
    deviceSerial: '000A270024565D97',
    // Confirmed via Linux sysfs (2026-05-13): bDeviceClass/Subclass/Protocol
    // = 0/0/0 (composite-device convention).
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
  },

  sysInfoExtendedXml,

  lsblkJson,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // Apple Partition Map (not MBR). Linux capture confirms only two
    // partitions: APM header + HFS+ data. No hidden Apple_MDFW partition
    // (same finding as nano 4G — see provenance for both).
    partitions: [
      { index: 1, type: 'apple_partition_map', sizeMiB: 1 },
      { index: 2, type: 'HFS+', sizeMiB: 15067, mountpoint: '/Volumes/iPod' },
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
