/**
 * Sony Walkman NW-HD5 (20GB HDD) persona — `NO NAME`.
 *
 * Captured 2026-05-13 from physical hardware. Mac capture complete;
 * Linux capture deferred (pattern confirmed by sibling personas — see
 * `provenance.md` § "Linux capture session").
 *
 * **Currently unsupported by podkit** — original "Network Walkman" line
 * (pre-NW-A rebrand). Same SonicStage-era OpenMG/ATRAC content constraints
 * as NW-A, plus additional MACLIST0 integrity records and separate-JPG
 * artwork in `20PXX/` directories. See `devices/sony-walkman-nw-hd-series.md`
 * for the family-level profile.
 *
 * Notable differences from the NW-A personas:
 *   - **USB descriptor `ATRAC HDD`** (vs NW-A's `HDD WALKMAN`) — different
 *     product-line branding.
 *   - **PID `0x0233`** — distinct from NW-A series (which uses 0x026a /
 *     0x0269).
 *   - **No `A_WM/`, `CONNECT/`, `30GRCT/`, `MEDIAGO/`** directories — those
 *     were introduced in the NW-A generation.
 *   - **`MACLIST0.DAT` + `MACLIST0.BAK`** at OMGAUDIO root — encrypted
 *     per-track MAC list for DRM integrity. Not seen on NW-A.
 *   - **`20PXX/` directories** hold separate JPG album-artwork files (not
 *     audio). NW-A embeds artwork in EA3 headers; NW-HD uses sidecar JPGs.
 *   - **Older `01TREE` numbering** (uses hex `0A`–`0F` ids that NW-A skips).
 *
 * @see devices/sony-walkman-nw-hd-series.md
 * @see documents/test-devices.md §"Sony Walkman NW-HD5 (20GB HDD)"
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

export const sonyNwHd5: DevicePersona = {
  id: 'sony-nw-hd5',
  description:
    'Sony Walkman NW-HD5 (20GB HDD, NO NAME) — original Network Walkman, pre-NW-A rebrand. ATRAC HDD descriptor; OpenMG v1.1 + MACLIST DRM + JPG sidecar artwork.',
  schemaVersion: 1,

  usbDescriptor: {
    vendorId: 0x054c,
    productId: 0x0233,
    deviceSerial: '',
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
  },

  sysInfoExtendedXml: null,

  lsblkJson: null,
  systemProfilerJson: systemProfilerJsonRaw,
  diskutilPlist: diskutilPlistRaw,

  partitionLayout: {
    // MBR FAT32-LBA (type 0x0C). 512-byte sectors. Single partition at
    // sector 63 — ~32 KiB MBR padding. No on-disk firmware region.
    partitions: [{ index: 1, type: 'FAT32', sizeMiB: 19074, mountpoint: '/Volumes/NO NAME' }],
  },

  massStorageBackingFile: null,

  expectedCapabilities: null,

  expectedReadiness: {
    level: 'unknown',
    stages: [
      {
        stage: 'usb',
        status: 'fail',
        summary: 'Device not supported',
        details: {
          unsupportedReason:
            'Sony NW-HD5 (Network Walkman, 2004–2005 pre-NW-A line) is not supported — OpenMG/ATRAC content requires SonicStage (Windows, discontinued). Additional MACLIST0 integrity records are not authorable from outside SonicStage. USB descriptor "ATRAC HDD" + PID 0x0233 distinguish from later NW-A "HDD WALKMAN" units.',
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
