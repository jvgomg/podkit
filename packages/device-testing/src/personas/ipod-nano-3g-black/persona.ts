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

  lsblkJson: lsblkJsonRaw,
  systemProfilerJson: systemProfilerJsonRaw,
  diskutilPlist: diskutilPlistRaw,

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
