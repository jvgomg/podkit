/**
 * iPod 5G Video (iFlash 1TB mod) persona — `TERAPOD`.
 *
 * Captured 2026-05-13 from physical hardware. Mac capture complete;
 * Linux capture deferred (pattern confirmed by sibling personas — see
 * `provenance.md` § "Linux capture session").
 *
 * SCSI-fallback inquiry path. Original HDD replaced by iFlash 1 TB flash
 * adapter; firmware identity (via SCSI) unaffected by the storage mod.
 *
 * `expectedCapabilities` + `expectedReadiness` are provisional — see
 * `provenance.md` § "Expected-* fields status".
 *
 * @see documents/test-devices.md §"iPod 5th Generation Video (iFlash 1TB mod)"
 * @see documents/sysinfo-captures/ipod-5g-video-iflash-1tb.xml
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

export const ipodVideo5gIflash1tb: DevicePersona = {
  id: 'ipod-video-5g-iflash-1tb',
  description:
    'iPod 5G Video iFlash 1TB mod (TERAPOD) — SCSI-fallback path, FAT32/MBR, firmware in 94 MiB MBR gap, requires manual mount.',
  schemaVersion: 1,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1209,
    deviceSerial: '000A27001605D1A0',
    // Linux session reconciles these from /sys/.../bDeviceClass.
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
  },

  sysInfoExtendedXml,

  lsblkJson: null,
  systemProfilerJson: systemProfilerJsonRaw,
  diskutilPlist: diskutilPlistRaw,

  partitionLayout: {
    // MBR (2048-byte sectors). FAT32 starts at sector 48195. Sectors
    // 0..48194 (~94 MiB) hold iPod 5G firmware — same pattern as nano 2G
    // and mini 2G. iFlash adapter does not change the firmware partition
    // size (firmware is rewritten from the device's NOR flash to disk on
    // each boot, independent of underlying storage).
    partitions: [
      { index: 1, type: 'firmware', sizeMiB: 94 },
      // No mountpoint — volume requires manual mount (see provenance).
      { index: 2, type: 'FAT32', sizeMiB: 956704 },
    ],
  },

  massStorageBackingFile: null,

  // Provisional — validate against production resolver in the compute-expected pass.
  expectedCapabilities: {
    artworkSources: ['embedded', 'database'],
    artworkMaxResolution: 200,
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
