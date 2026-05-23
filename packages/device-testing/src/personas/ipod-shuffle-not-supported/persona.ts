/**
 * iPod shuffle 3G persona — synthesised rejection case.
 *
 * **Source:** synthesised (no hardware). The user does not own an iPod
 * shuffle; this persona exists to pin coverage of the Apple unsupported-PID
 * rejection path for the shuffle 3G/4G family, which libgpod recognises but
 * cannot sync without iTunes authentication.
 *
 * USB product ID `0x1302` (shuffle 3G) is the canonical pick — it is the
 * first entry in `packages/devices-ipod/src/tables/unsupported.ts` and the
 * matching `SHUFFLE_REASON` text is reused verbatim here so the fixture
 * tracks the table.
 *
 * All host-probe fields (`lsblkJson`, `systemProfilerJson`, `diskutilPlist`)
 * are `null`: an unsupported-PID device never gets past the USB-rejection
 * short-circuit in `determineLevel`, so the readiness pipeline never reads
 * a single host-probe.
 *
 * @see packages/devices-ipod/src/tables/unsupported.ts (`'1302': SHUFFLE_REASON`)
 * @see packages/podkit-core/src/device/readiness/determine-level.ts (unsupported short-circuit)
 * @module
 */

import type { DevicePersona } from '../types.js';

const unsupportedHeadline =
  'iPod shuffle 3rd/4th gen requires iTunes authentication; not supported by libgpod.';
const unsupported = {
  kind: 'unsupported-device',
  headline: unsupportedHeadline,
} as const;

export const ipodShuffleNotSupported: DevicePersona = {
  id: 'ipod-shuffle-not-supported',
  description:
    'iPod shuffle 3G — synthesised rejection case (USB PID 0x1302, libgpod recognises it but iTunes auth is required).',
  schemaVersion: 2,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1302,
    // Synthesised serial — clearly marked as fixture data, not a real device.
    deviceSerial: 'SHUFFLE-SYNTHESISED-001',
    // Composite-device convention: device-level class/subclass/protocol are 0;
    // mass-storage class lives on the interface descriptor for the shuffle's
    // USB-DAC composite gadget. Matches the pattern documented on every other
    // iPod persona where Linux sysfs hasn't been consulted.
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // Synthesised — shuffle 3G/4G never gets past the USB-PID classifier
    // rejection, so this hierarchy is a placeholder. Re-capture from
    // `lsusb -v` on a real shuffle if a future test asserts on descriptor
    // details.
    bMaxPacketSize0: 8,
    bcdUSB: 0x0200,
    bcdDevice: 0x0001,
    bNumConfigurations: 1,
    configurations: [
      {
        bConfigurationValue: 1,
        bNumInterfaces: 1,
        bmAttributes: 0x80,
        bMaxPower: 0xfa,
        interfaces: [
          {
            bInterfaceNumber: 0,
            bAlternateSetting: 0,
            bInterfaceClass: 0x08,
            bInterfaceSubClass: 0x06,
            bInterfaceProtocol: 0x50,
            endpoints: [
              { bEndpointAddress: 0x81, bmAttributes: 0x02, wMaxPacketSize: 64, bInterval: 0 },
              { bEndpointAddress: 0x02, bmAttributes: 0x02, wMaxPacketSize: 64, bInterval: 0 },
            ],
          },
        ],
      },
    ],
    stringDescriptors: { 1: 'Apple Inc.', 2: 'iPod', 3: 'SHUFFLE-SYNTHESISED-001' },
  },

  sysInfoExtendedXml: null,

  // Unsupported-PID devices short-circuit before any host probe runs.
  lsblkJson: null,
  systemProfilerJson: null,
  diskutilPlist: null,

  partitionLayout: { luns: [{ lun: 0, partitions: [] }] },

  massStorageBackingFile: null,

  expectedCapabilities: null,

  // TASK-331: `level: 'unsupported'` carries the structured rejection payload on
  // both the top-level `unsupported` field and the `usb` stage's
  // `details.unsupported`. Keep the headline identical to
  // `SHUFFLE_REASON` in `tables/unsupported.ts`.
  expectedReadiness: {
    level: 'unsupported',
    unsupported,
    stages: [
      {
        stage: 'usb',
        status: 'fail',
        summary: 'Device not supported',
        details: { unsupported },
      },
    ],
  },

  expectedDoctorOutput: {},

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'synthesised',
  },
};
