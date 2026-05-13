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
 * `expectedCapabilities` + `expectedReadiness` are provisional — see
 * `provenance.md` § "Expected-* fields status".
 *
 * @see documents/test-devices.md §"iPod nano 4th Generation (8GB Black)"
 * @see documents/sysinfo-captures/nano-4g-8gb-black.xml
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

export const ipodNano4gBlack: DevicePersona = {
  id: 'ipod-nano-4g-black',
  description:
    "iPod nano 4G 8GB Black (James' iPod) — HFS+ / Apple Partition Map, USB-inquiry works, per-read crypto blob in SIE.",
  schemaVersion: 1,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1263,
    deviceSerial: '000A27001DCECFB5',
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
    // partitions: APM header + HFS+ data. There is no hidden `Apple_MDFW`
    // firmware partition on this unit — diskutil's view was complete.
    // Both partitions visible in `raw/lsblk.json` with `pttype: "mac"`.
    partitions: [
      { index: 1, type: 'apple_partition_map', sizeMiB: 1 },
      { index: 2, type: 'HFS+', sizeMiB: 7601, mountpoint: "/Volumes/James' iPod" },
    ],
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
