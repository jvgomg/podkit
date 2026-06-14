/**
 * iPod 5G Video (stale FireWireGUID) persona — synthesised SIE-edit fixture.
 *
 * USB identity mirrors the real TERAPOD (`0x05ac:0x1209`, V9M-suffix
 * serial → generation `video_5_5g`). The FunctionFS daemon serves the
 * REAL SIE XML over USB (the persona's `sysInfoExtendedXml`). The FAT32
 * `initialContent` seeds a copy of that XML on disk with one field
 * mutated: `FireWireGUID` is `BAADBAADBAADBAAD` instead of the real
 * `000A27001605D1A0`. The on-disk classic SysInfo + iTunesDB are
 * bootstrapped at test time via `gpod-tool init`.
 *
 * This matches the canonical "stale SysInfoExtended" shape:
 *   - USB identity says GUID `000A27001605D1A0` (via FunctionFS-served SIE)
 *   - Filesystem SIE says GUID `BAADBAADBAADBAAD`
 *
 * Doctor's `sysinfo-consistency` check reads SIE from filesystem (Channel A,
 * see `packages/podkit-core/src/diagnostics/checks/sysinfo-consistency.ts:78`)
 * and compares against the live identity inferred from USB descriptor +
 * SIE-served-via-USB. It should `fail` with a FireWireGUID mismatch detail
 * and a `--repair sysinfo-extended` action.
 *
 * @see packages/podkit-core/src/diagnostics/checks/sysinfo-consistency.ts
 * @see test-packages/device-testing/src/personas/ipod-video-5g-iflash-1tb/persona.ts
 * @module
 */

import type { DevicePersona } from '../types.js';
import sysInfoExtendedXml from '../ipod-video-5g-iflash-1tb/raw/sysinfo-extended.xml' with { type: 'text' };

export const ipod5gStaleGuid: DevicePersona = {
  id: 'ipod-5g-stale-guid',
  description: 'iPod 5G Video — stale on-disk FireWireGUID.',
  schemaVersion: 3,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1209,
    deviceSerial: '000A27001605D1A0',
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    bMaxPacketSize0: 64,
    bcdUSB: 0x0200,
    bcdDevice: 0x0001,
    bNumConfigurations: 2,
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
              { bEndpointAddress: 0x81, bmAttributes: 0x02, wMaxPacketSize: 512, bInterval: 0 },
              { bEndpointAddress: 0x02, bmAttributes: 0x02, wMaxPacketSize: 512, bInterval: 0 },
            ],
          },
        ],
      },
      {
        bConfigurationValue: 2,
        bNumInterfaces: 1,
        bmAttributes: 0xc0,
        bMaxPower: 0x32,
        interfaces: [
          {
            bInterfaceNumber: 0,
            bAlternateSetting: 0,
            bInterfaceClass: 0x08,
            bInterfaceSubClass: 0x06,
            bInterfaceProtocol: 0x50,
            endpoints: [
              { bEndpointAddress: 0x81, bmAttributes: 0x02, wMaxPacketSize: 512, bInterval: 0 },
              { bEndpointAddress: 0x02, bmAttributes: 0x02, wMaxPacketSize: 512, bInterval: 0 },
            ],
          },
        ],
      },
    ],
    stringDescriptors: { 1: 'Apple Inc.', 2: 'iPod', 3: '000A27001605D1A0' },
  },

  // The daemon serves THIS XML (real GUID) over USB. The check compares
  // it against the on-disk overlay (stale GUID) — see initialContent.
  sysInfoExtendedXml,

  lsblkJson: null,
  systemProfilerJson: null,
  diskutilPlist: null,

  partitionLayout: {
    luns: [
      {
        lun: 0,
        partitions: [
          { index: 1, type: 'firmware', sizeMiB: 94 },
          { index: 2, type: 'FAT32', sizeMiB: 256 },
        ],
      },
    ],
  },

  massStorageBackingFile: {
    synthesis: {
      sizeMiB: 256,
      filesystem: 'FAT32',
      label: 'STALEGUID',
      initialContent: [
        // SIE with FireWireGUID mutated to BAAD...BAAD. The on-disk SIE
        // is what `sysinfo-consistency` reads; the daemon-served SIE
        // (above, real GUID) is what `--repair sysinfo-extended` writes
        // back from.
        {
          path: 'iPod_Control/Device/SysInfoExtended',
          sourceFixture: './raw/sysinfo-extended.xml',
        },
      ],
    },
    resetStrategy: 'copy',
  },

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'synthesised',
  },
};
