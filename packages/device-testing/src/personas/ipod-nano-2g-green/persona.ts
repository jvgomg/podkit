/**
 * iPod nano 2G (4GB Green) persona — `PARTY IPOD`.
 *
 * Captured 2026-05-13 from physical hardware. Mac capture complete;
 * Linux capture deferred (pattern confirmed by sibling personas — see
 * `provenance.md` § "Linux capture session").
 *
 * SCSI-fallback inquiry path (USB inquiry fails on nano 2G).
 *
 * `expectedCapabilities` + `expectedReadiness` are provisional — see
 * `provenance.md` § "Expected-* fields status".
 *
 * @see documents/test-devices.md §"iPod nano 2nd Generation (4GB Green)"
 * @see documents/sysinfo-captures/nano-2g-4gb-green.xml
 * @module
 */

import type { DevicePersona } from '../types.js';
import sysInfoExtendedXml from './raw/sysinfo-extended.xml' with { type: 'text' };
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };

export const ipodNano2gGreen: DevicePersona = {
  id: 'ipod-nano-2g-green',
  description: 'iPod nano 2G 4GB Green (PARTY IPOD) — SCSI-fallback path, no artwork, no video.',
  schemaVersion: 1,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1260,
    deviceSerial: '000A27001A0647CB',
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
    // MBR (2048-byte sectors). FAT32 starts at sector 48195. Sectors
    // 0..48194 (~94 MiB) are unallocated reserved space holding the iPod
    // firmware — same pattern as mini 2G and iPod 5G Video.
    partitions: [
      { index: 1, type: 'firmware', sizeMiB: 94 },
      { index: 2, type: 'FAT32', sizeMiB: 3778, mountpoint: '/Volumes/PARTY IPOD' },
    ],
  },

  massStorageBackingFile: null,

  // Provisional — validate against production resolver in the compute-expected pass.
  expectedCapabilities: {
    artworkSources: ['embedded', 'database'],
    artworkMaxResolution: 176,
    supportedAudioCodecs: ['aac', 'mp3', 'aiff', 'wav'],
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
