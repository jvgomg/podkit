/**
 * Sony Walkman NW-A1000 (6GB HDD) persona — `NO NAME`.
 *
 * Captured 2026-05-13 from physical hardware. Mac capture complete;
 * Linux capture deferred (pattern confirmed by sibling personas — see
 * `provenance.md` § "Linux capture session").
 *
 * **Currently unsupported by podkit** — NW-A1000 is a SonicStage-era HDD
 * Walkman. It enumerates as USB Mass Storage but accepts only OpenMG-encoded
 * `.OMA` content authored by SonicStage (Windows). Plain MP3 / FLAC dropped
 * onto the filesystem is not indexed by the device library.
 *
 * See `devices/sony-walkman-nw-a-series.md` for the full device profile and
 * the three realistic implementation paths (detect-and-reject vs Mass-Storage-Mode
 * preset vs full OpenMG writer).
 *
 * @see devices/sony-walkman-nw-a-series.md
 * @see documents/test-devices.md §"Sony Walkman NW-A1000 (6GB HDD)"
 * @module
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { DevicePersona } from '../types.js';

const here = dirname(fileURLToPath(import.meta.url));
const diskutilPlistRaw = readFileSync(join(here, 'raw/diskutil.plist'), 'utf8');
const systemProfilerJsonRaw = JSON.parse(
  readFileSync(join(here, 'raw/system-profiler.json'), 'utf8')
) as object;

export const sonyNwA1000: DevicePersona = {
  id: 'sony-nw-a1000',
  description:
    'Sony Walkman NW-A1000 (6GB HDD, NO NAME) — SonicStage-era OpenMG/ATRAC device. Enumerates as FAT32 mass storage but content layer is proprietary.',
  schemaVersion: 1,

  usbDescriptor: {
    vendorId: 0x054c, // Sony Corporation
    productId: 0x026a,
    // No USB serial — `iSerialNumber = 0` in the descriptor (confirmed via
    // `raw/ioreg.txt`). Per-unit identification must use FAT32 volume UUID
    // (see `diskutilPlist`) or per-track CIDs in the OpenMG database.
    deviceSerial: '',
    // Mac-authoritative from `raw/ioreg.txt`. Composite-device convention:
    // device-level 0/0/0; Mass Storage class on interface descriptor.
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
  },

  sysInfoExtendedXml: null,

  lsblkJson: null,
  systemProfilerJson: systemProfilerJsonRaw,
  diskutilPlist: diskutilPlistRaw,

  partitionLayout: {
    // MBR with FAT32-LBA (partition type 0x0C, not 0x0B used elsewhere in
    // this set). 512-byte sectors. Partition starts at sector 63, leaving
    // only ~32 KiB MBR padding before the user-visible filesystem. No
    // on-disk firmware region (NW-A1000 firmware lives in onboard flash,
    // not as a separate HDD partition).
    partitions: [{ index: 1, type: 'FAT32', sizeMiB: 5705, mountpoint: '/Volumes/NO NAME' }],
  },

  // Backing image dump not captured — 5.7 GB FAT32 far exceeds the 16 MiB
  // threshold and contains user music (DRM-bound OMA files plus an OpenMG
  // database with embedded ID3v2 metadata in cleartext). For Tier 3 USB
  // synthesis, use the `synthesis` recipe with the OpenMG marker files
  // listed in `devices/sony-walkman-nw-a-series.md` § "Detection".
  massStorageBackingFile: null,

  // Currently unsupported — no preset, no implementation. When/if a
  // detect-and-reject path lands (option 1 in the device profile), this
  // becomes the canonical rejection fixture. When/if a MSM-mode preset is
  // added (option 2), `expectedCapabilities` shifts to the MP3/folder-only
  // shape.
  expectedCapabilities: null,

  // Provisional rejection-pattern stub — same shape as sony-nwz-e384 and ipod-touch-5g.
  // `ReadinessLevel` has no 'unsupported' value; using 'unknown' until the
  // schema gap is resolved.
  expectedReadiness: {
    level: 'unknown',
    stages: [
      {
        stage: 'usb',
        status: 'fail',
        summary: 'Device not supported',
        details: {
          unsupportedReason:
            'Sony NW-A1000 (SonicStage-era HDD Walkman) is not supported — content layer requires OpenMG/ATRAC encoding authored by SonicStage. Switch device to USB Mass Storage Mode (firmware v2.0+) for folder-browser sync.',
        },
      },
    ],
  },

  expectedDoctorOutput: {},

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'physical-capture',
  },
};
