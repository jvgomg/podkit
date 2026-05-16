/**
 * iPod touch 5G persona — rejection case.
 *
 * Captured 2026-05-13 from physical hardware (USB descriptor only — iOS
 * devices do not expose disk mode). No SysInfoExtended, no partition layout,
 * no `diskutil` plist.
 *
 * Linux capture is not applicable — iOS device with no disk mode; `lsblk` /
 * `lsblkJson` permanently `null`. Mac ioreg is the authoritative USB
 * descriptor source. See `provenance.md` § "Linux capture session".
 *
 * `expectedReadiness` is provisional — see `provenance.md` § "Expected-*
 * fields status".
 *
 * @see documents/test-devices.md §"iPod touch 5th Generation (iOS)"
 * @see packages/devices-ipod/src/tables/unsupported.ts (productId `12aa`)
 * @module
 */

import type { DevicePersona } from '../types.js';
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };

const unsupportedReason =
  "iPod touch (5th generation) uses Apple's proprietary sync protocol; podkit only supports iPod disk mode.";

export const ipodTouch5gUnsupported: DevicePersona = {
  id: 'ipod-touch-5g-unsupported',
  description: 'iPod touch 5G — rejection case (iOS device, no disk mode, no SysInfoExtended).',
  schemaVersion: 1,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x12aa,
    deviceSerial: '637fea3cca37ff292e9cd4b26b1d411dfce06fd8',
    // Linux session reconciles these from /sys/.../bDeviceClass.
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
  },

  sysInfoExtendedXml: null,

  lsblkJson: null,
  systemProfilerJson,
  diskutilPlist: null,

  partitionLayout: { partitions: [] },

  massStorageBackingFile: null,

  expectedCapabilities: null,

  // TASK-331 added `'unsupported'` to ReadinessLevel + exposed the canonical
  // reason text as a top-level field on the result. The fail `usb` stage
  // mirrors what `checkReadiness({ unsupportedReason })` emits for an
  // unsupported-PID device, so this fixture is the byte-for-byte expected
  // result the determineLevel cascade produces today.
  expectedReadiness: {
    level: 'unsupported',
    unsupportedReason,
    stages: [
      {
        stage: 'usb',
        status: 'fail',
        summary: 'Device not supported',
        details: { unsupportedReason },
      },
    ],
  },

  expectedDoctorOutput: {},

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'physical-capture',
  },
};
