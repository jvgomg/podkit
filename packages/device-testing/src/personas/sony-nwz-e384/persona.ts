/**
 * Sony Walkman NWZ-E384 (8GB) persona — `WALKMAN`.
 *
 * Captured 2026-05-13 from physical hardware. Mac capture complete;
 * Linux capture deferred (pattern confirmed by sibling personas — see
 * `provenance.md` § "Linux capture session").
 *
 * **Currently unsupported by podkit** — Sony Walkman has no preset in
 * `packages/devices-mass-storage/src/presets/built-in.ts` and no entry in
 * `usb-hints.ts`. This persona exists as the canonical fixture for the
 * (eventual) Sony preset implementation; see `devices/sony-walkman-nwz-e380.md`
 * for the full device profile.
 *
 * `expectedCapabilities: null` reflects today's behaviour (no preset match).
 * When a Sony preset lands, update this persona and the related provenance
 * fields.
 *
 * @see devices/sony-walkman-nwz-e380.md
 * @see documents/test-devices.md §"Sony Walkman NWZ-E384 (8GB)"
 * @module
 */

import type { DevicePersona } from '../types.js';
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };

export const sonyNwzE384: DevicePersona = {
  id: 'sony-nwz-e384',
  description:
    'Sony Walkman NWZ-E384 (8GB, WALKMAN) — mass-storage DAP, FAT32/MBR, currently unsupported (no podkit preset).',
  schemaVersion: 1,

  usbDescriptor: {
    vendorId: 0x054c, // Sony Corporation
    productId: 0x0882,
    deviceSerial: '10431991572055',
    // Mac-authoritative from `raw/ioreg.txt`. Composite-device convention:
    // device-level class/subclass/protocol are 0; the Mass Storage class
    // (0x08) lives on the interface descriptor. Linux session will
    // sanity-check from sysfs.
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
  },

  sysInfoExtendedXml: null,

  lsblkJson: null,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // MBR (2048-byte sectors). FAT32 starts at sector 5 — only 10 KiB
    // reserved before, just enough for MBR. Sony Walkman firmware lives on
    // a separate internal NAND area, not in a disk-visible firmware region.
    // No synthetic firmware entry needed.
    partitions: [{ index: 1, type: 'FAT32', sizeMiB: 7357, mountpoint: '/Volumes/WALKMAN' }],
  },

  // Backing image dump not captured — 7.3 GB FAT32 far exceeds the playbook's
  // 16 MiB threshold. For Tier 3 USB synthesis, use a synthesised FAT32 with
  // the marker files documented in `provenance.md` (the `.E380` files +
  // capability XMLs + DeviceInfo.txt + empty STDB* placeholders).
  massStorageBackingFile: null,

  // Currently unsupported — no Sony preset in built-in presets. When a
  // preset lands, populate this with the real capabilities (audio: mp3, aac,
  // wav; video: false unless WMV transcoding is added; artwork: 160x128 max,
  // embedded only).
  expectedCapabilities: null,

  // TASK-331 added `'unsupported'` to ReadinessLevel + threaded a structured
  // payload from the mass-storage classifier's vendor-recognised-but-no-preset
  // table (`packages/devices-mass-storage/src/unsupported.ts`). The headline
  // comes from the Sony entry's `reason(vendorId, productId)` template — keep
  // it in sync with that table.
  expectedReadiness: {
    level: 'unsupported',
    unsupported: {
      kind: 'unsupported-preset',
      headline:
        'Sony Walkman is not yet supported by podkit — no preset registered for USB 0x054c:0x0882.',
    },
    stages: [
      {
        stage: 'usb',
        status: 'fail',
        summary: 'Device not supported',
        details: {
          unsupported: {
            kind: 'unsupported-preset',
            headline:
              'Sony Walkman is not yet supported by podkit — no preset registered for USB 0x054c:0x0882.',
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
