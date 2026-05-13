/**
 * FiiO Snowsky Echo Mini persona — mass-storage DAP.
 *
 * Captured 2026-05-13 from physical hardware. Mac + Linux capture sessions
 * complete.
 *
 * Not an iPod. Exercises podkit's mass-storage preset framework — auto-detect
 * resolves to the built-in `echo-mini` preset via USB vendor/product (see
 * `packages/devices-mass-storage/src/presets/built-in.ts`).
 *
 * The device exposes **two USB Mass Storage LUNs**, presented to the host as
 * two distinct disks:
 *   - LUN 0 (`/dev/disk4` on macOS, `/dev/sdc` on Linux): internal flash,
 *     FAT32 `ECHO MINI` (~7.5 GB).
 *   - LUN 1 (`/dev/disk5` on macOS, `/dev/sdd` on Linux): inserted SD card,
 *     ExFAT `Echo SD` (~126 GB / 117.8 GiB).
 *
 * Only LUN 1 is the sync target. LUN 0 (firmware/internal) is exposed but
 * not used by podkit.
 *
 * `expectedCapabilities` + `expectedReadiness` are provisional — see
 * `provenance.md` § "Expected-* fields status".
 *
 * @see documents/test-devices.md §"FiiO Snowsky Echo Mini (mass-storage DAP)"
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
// LUN 0 (ECHO MINI firmware FAT32). LUN 1 (Echo SD exFAT) is captured in
// `raw/lsblk-lun1.json` — referenced in provenance, not in this field because
// the schema is single-LUN-flat. See provenance "Schema followups".
const lsblkJsonRaw = JSON.parse(readFileSync(join(here, 'raw/lsblk-lun0.json'), 'utf8')) as object;

export const echoMini: DevicePersona = {
  id: 'echo-mini',
  description:
    'FiiO Snowsky Echo Mini — mass-storage DAP, two LUNs (ECHO MINI firmware FAT32 + Echo SD card ExFAT).',
  schemaVersion: 1,

  usbDescriptor: {
    vendorId: 0x071b,
    productId: 0x3203,
    deviceSerial: 'USBV1.00',
    // Mac-authoritative from `raw/ioreg.txt`. Composite-device convention:
    // device-level class/subclass/protocol are 0; the Mass Storage class
    // (0x08) lives on the interface descriptor. Linux session will
    // sanity-check these from sysfs.
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
  },

  sysInfoExtendedXml: null,

  lsblkJson: lsblkJsonRaw,
  systemProfilerJson: systemProfilerJsonRaw,
  diskutilPlist: diskutilPlistRaw,

  partitionLayout: {
    // Schema's `partitions` array doesn't have a LUN field; entries here are
    // flattened across both LUNs. LUN 0 = entry 1, LUN 1 = entry 2.
    // `raw/diskutil.plist` covers LUN 0; `raw/diskutil-disk5.plist` covers
    // LUN 1.
    partitions: [
      { index: 1, type: 'FAT32', sizeMiB: 7184, mountpoint: '/Volumes/ECHO MINI' },
      { index: 2, type: 'ExFAT', sizeMiB: 120564, mountpoint: '/Volumes/Echo SD' },
    ],
  },

  // Backing image dump skipped — actual LUN 0 (`ECHO MINI`) is 7.53 GB,
  // exceeding the playbook's 16 MiB threshold. If Tier 3 USB synthesis needs
  // a backing file, switch to the `synthesis` recipe with a small FAT32
  // image and seed only the marker files needed by the test.
  massStorageBackingFile: null,

  // Provisional — mirrors the built-in `echo-mini` preset capability shape.
  // Validate against production resolver / preset lookup in the compute-
  // expected pass.
  expectedCapabilities: {
    artworkSources: ['embedded'],
    artworkMaxResolution: 127,
    supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'vorbis', 'wav'],
    supportsVideo: false,
    audioNormalization: 'none',
    supportsAlbumArtistBrowsing: true,
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
