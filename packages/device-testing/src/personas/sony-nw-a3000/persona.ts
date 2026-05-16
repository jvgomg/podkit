/**
 * Sony Walkman NW-A3000 (20GB HDD) persona — `NO NAME`.
 *
 * Captured 2026-05-13 from physical hardware. Mac capture complete;
 * Linux capture deferred (pattern confirmed by sibling personas — see
 * `provenance.md` § "Linux capture session").
 *
 * **Currently unsupported by podkit** — same content-layer constraints as
 * NW-A1000 (SonicStage-era OpenMG/ATRAC). See `devices/sony-walkman-nw-a-series.md`
 * for the family-level profile.
 *
 * Notable differences from `sony-nw-a1000`:
 *   - Distinct PID `0x0269` (vs A1000's `0x026a`) — PIDs are NOT shared
 *     across the NW-A HDD series; the prior assumption in the device
 *     profile has been corrected.
 *   - OpenMG database version is **2.0** (`GTLT/GTIF/CNIF/...` magic bytes
 *     carry the version word `02 00 00 00` vs A1000's `01 01 00 00`).
 *   - Filesystem includes additional artefacts not present on A1000:
 *     `0001001D.DAT` / `00010021.DAT` (EKB — Encrypted Key Blocks for
 *     OpenMG DRM keys), `SRCIDLST.DAT` + `SRCIDLST.BAK` (Source ID List
 *     tracking content origin), `30GRCT/` directory (empty here),
 *     `A_WM/ARDETECT.DAT` (DRM challenge file, factory-dated 2006-01-28).
 *   - Hard drive: 20 GB (vs A1000's 6 GB).
 *
 * @see devices/sony-walkman-nw-a-series.md
 * @see documents/test-devices.md §"Sony Walkman NW-A3000 (20GB HDD)"
 * @module
 */

import type { DevicePersona } from '../types.js';
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };

export const sonyNwA3000: DevicePersona = {
  id: 'sony-nw-a3000',
  description:
    'Sony Walkman NW-A3000 (20GB HDD, NO NAME) — SonicStage-era OpenMG v2.0 database. Sibling of NW-A1000 with newer DB format + DRM artefacts.',
  schemaVersion: 1,

  usbDescriptor: {
    vendorId: 0x054c, // Sony Corporation
    productId: 0x0269,
    // No USB serial — `iSerialNumber = 0` (same as A1000). Per-unit
    // identification via FAT32 volume UUID.
    deviceSerial: '',
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
  },

  sysInfoExtendedXml: null,

  lsblkJson: null,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // MBR FAT32-LBA (type 0x0C). 512-byte sectors. Single partition at
    // sector 63 — only ~32 KiB MBR padding before. No on-disk firmware
    // region. Identical layout shape to NW-A1000, just larger.
    partitions: [{ index: 1, type: 'FAT32', sizeMiB: 18641, mountpoint: '/Volumes/NO NAME' }],
  },

  // Backing image dump not captured — 18.6 GiB FAT32 with DRM-bound user
  // content. Tier 3 synthesis should use the OpenMG marker scaffold listed
  // in `devices/sony-walkman-nw-a-series.md`.
  massStorageBackingFile: null,

  // Currently unsupported — same rationale as sony-nw-a1000. When/if a
  // detect-and-reject path lands, this becomes a second rejection fixture
  // (distinct PID, same family).
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
            'Sony NW-A3000 (SonicStage-era HDD Walkman) is not supported — OpenMG/ATRAC content layer requires SonicStage (Windows, discontinued 2008). Distinct PID from NW-A1000 (0x0269 vs 0x026a) — per-model support needed.',
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
