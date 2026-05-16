/**
 * iPod nano 3G (8GB Black) persona — `IPOD`.
 *
 * Captured 2026-05-13 from physical hardware. Mac + Linux capture sessions
 * complete.
 *
 * USB-inquiry boundary device — nano 3G is the earliest iPod that answers
 * vendor control transfers (refines prior "iPod 5G+" research).
 *
 * `expectedCapabilities` + `expectedReadiness` are provisional — derived
 * from generation-table defaults. Validate against the production resolvers
 * (`resolveCapabilities`, `checkReadiness`) during the compute-expected
 * pass per TASK-321.02 acceptance criteria.
 *
 * @see documents/test-devices.md §"iPod nano 3rd Generation (8GB Black)"
 * @see documents/sysinfo-captures/nano-3g-8gb-black.xml
 * @module
 */

import type { DevicePersona } from '../types.js';
import sysInfoExtendedXml from './raw/sysinfo-extended.xml' with { type: 'text' };
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };
import lsblkJson from './raw/lsblk.json' with { type: 'json' };

export const ipodNano3gBlack: DevicePersona = {
  id: 'ipod-nano-3g-black',
  description:
    'iPod nano 3G 8GB Black (IPOD) — USB-inquiry boundary device, no per-read crypto blob.',
  schemaVersion: 1,

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
  },

  sysInfoExtendedXml,

  lsblkJson,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // Single MBR partition at sector 63 (4096-byte sectors). ~252 KiB of
    // reserved space before the partition is MBR padding only — nano 3G
    // firmware lives in onboard NOR flash, not in a disk partition.
    partitions: [{ index: 1, type: 'FAT32', sizeMiB: 7585, mountpoint: '/Volumes/IPOD' }],
  },

  massStorageBackingFile: null,

  // Provisional — validate against production resolver in the compute-expected pass.
  expectedCapabilities: {
    artworkSources: ['embedded', 'database'],
    artworkMaxResolution: 320,
    supportedAudioCodecs: ['aac', 'alac', 'mp3', 'aiff', 'wav'],
    supportsVideo: true,
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
