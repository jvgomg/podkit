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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { DevicePersona } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
const sysInfoExtendedXml = readFileSync(join(here, 'raw/sysinfo-extended.xml'), 'utf8');
const diskutilPlistRaw = readFileSync(join(here, 'raw/diskutil.plist'), 'utf8');
const systemProfilerJsonRaw = JSON.parse(
  readFileSync(join(here, 'raw/system-profiler.json'), 'utf8')
) as object;
const lsblkJsonRaw = JSON.parse(readFileSync(join(here, 'raw/lsblk.json'), 'utf8')) as object;

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

  lsblkJson: lsblkJsonRaw,
  systemProfilerJson: systemProfilerJsonRaw,
  diskutilPlist: diskutilPlistRaw,

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
