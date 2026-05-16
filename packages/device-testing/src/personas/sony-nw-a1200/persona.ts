/**
 * Sony Walkman NW-A1200 (8GB HDD) persona — `NO NAME`.
 *
 * Captured 2026-05-13 from physical hardware. Mac capture complete;
 * Linux capture deferred (pattern confirmed by sibling personas — see
 * `provenance.md` § "Linux capture session").
 *
 * **Currently unsupported by podkit** — same OpenMG/ATRAC content-layer as
 * NW-A1000 / NW-A3000. See `devices/sony-walkman-nw-a-series.md` for the
 * family-level profile.
 *
 * Hardware-level: **identical to NW-A1000** except for HDD capacity (8 GB
 * vs 6 GB). Same USB descriptor, same firmware version, same chassis.
 * Whatever preset supports A1000 supports A1200 without modification.
 *
 * Filesystem-level state differs only because this unit was last synced
 * with newer software on a Windows host:
 *   - **OpenMG database v2.0** (vs A1000's v1.1) — reflects last-sync
 *     software version, not hardware.
 *   - **`MEDIAGO/MediaGo.xml`** present — Media Go (SonicStage successor)
 *     touched this unit.
 *   - **`System Volume Information/`** — Windows host artefact.
 *
 * NW-A3000 is the only sibling that's actually a different hardware
 * platform (distinct PID `0x0269`, 20 GB HDD).
 *
 * @see devices/sony-walkman-nw-a-series.md
 * @see documents/test-devices.md §"Sony Walkman NW-A1200 (8GB HDD)"
 * @module
 */

import type { DevicePersona } from '../types.js';
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };

export const sonyNwA1200: DevicePersona = {
  id: 'sony-nw-a1200',
  description:
    'Sony Walkman NW-A1200 (8GB HDD, NO NAME) — identical hardware to NW-A1000 except HDD capacity. This unit synced via Media Go on Windows, so carries DB v2.0 + MEDIAGO/ + Windows artefacts.',
  schemaVersion: 1,

  usbDescriptor: {
    vendorId: 0x054c,
    productId: 0x026a, // shared with NW-A1000
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
    // sector 63 — ~32 KiB MBR padding before. Same shape as A1000 / A3000.
    partitions: [{ index: 1, type: 'FAT32', sizeMiB: 7475, mountpoint: '/Volumes/NO NAME' }],
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
          unsupported: {
            kind: 'unsupported-preset',
            headline:
              'Sony NW-A1200 (SonicStage/Media Go-era HDD Walkman) is not supported — OpenMG/ATRAC content layer requires SonicStage or Media Go (Windows, discontinued). Same hardware as NW-A1000 (shared USB PID, differs only by HDD capacity); distinct platform from NW-A3000.',
          },
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
