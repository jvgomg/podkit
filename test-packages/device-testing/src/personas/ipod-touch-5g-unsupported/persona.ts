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
 * Expected outputs (capabilities, readiness, doctor JSON) live in
 * `@podkit/e2e-vm-tests/src/expectations/ipod-touch-5g-unsupported.ts` (schema v3).
 *
 * @see documents/test-devices.md §"iPod touch 5th Generation (iOS)"
 * @see packages/devices-ipod/src/tables/unsupported.ts (productId `12aa`)
 * @module
 */

import type { DevicePersona } from '../types.js';
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };

export const ipodTouch5gUnsupported: DevicePersona = {
  id: 'ipod-touch-5g-unsupported',
  description: 'iPod touch 5G — rejection case (iOS device, no disk mode, no SysInfoExtended).',
  schemaVersion: 3,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x12aa,
    deviceSerial: '637fea3cca37ff292e9cd4b26b1d411dfce06fd8',
    // Linux session reconciles these from /sys/.../bDeviceClass.
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // iOS device — proprietary Apple iAP protocol over USB; no disk mode.
    // The classifier rejects this device on USB PID alone before reading the
    // descriptor tree, so the hierarchy below is a minimal stand-in. Real
    // iOS USB descriptors expose Audio/HID/iAP composite interfaces (class
    // 0x01 / 0x03 / 0xFF) — re-capture from `lsusb -v` on Linux if a future
    // test asserts on interface details.
    bMaxPacketSize0: 64,
    bcdUSB: 0x0200,
    bcdDevice: 0x0001,
    bNumConfigurations: 1,
    configurations: [
      {
        bConfigurationValue: 1,
        bNumInterfaces: 1,
        bmAttributes: 0xc0,
        bMaxPower: 0xfa,
        interfaces: [
          {
            bInterfaceNumber: 0,
            bAlternateSetting: 0,
            // Vendor-specific (Apple Mobile Device Service / iAP).
            bInterfaceClass: 0xff,
            bInterfaceSubClass: 0xfe,
            bInterfaceProtocol: 0x02,
            endpoints: [
              { bEndpointAddress: 0x81, bmAttributes: 0x02, wMaxPacketSize: 512, bInterval: 0 },
              { bEndpointAddress: 0x02, bmAttributes: 0x02, wMaxPacketSize: 512, bInterval: 0 },
            ],
          },
        ],
      },
    ],
    stringDescriptors: {
      1: 'Apple Inc.',
      2: 'iPod',
      3: '637fea3cca37ff292e9cd4b26b1d411dfce06fd8',
    },
  },

  sysInfoExtendedXml: null,

  lsblkJson: null,
  systemProfilerJson,
  diskutilPlist: null,

  partitionLayout: {
    // iOS device — no disk mode. Empty layout.
    luns: [{ lun: 0, partitions: [] }],
  },

  massStorageBackingFile: null,

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'physical-capture',
  },
};
