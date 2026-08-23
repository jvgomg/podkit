/**
 * iPod 5G Video (ModelNum mismatch) persona — synthesised SysInfo edit-path fixture.
 *
 * **Source:** synthesised. USB identity mirrors the real
 * `ipod-video-5g-iflash-1tb` persona (`0x05ac:0x1209`, same SIE XML with
 * `V9M` serial suffix → firmware generation `video_5_5g`). The
 * `massStorageBackingFile.synthesis.initialContent` seeds the FAT32 image
 * with a classic-SysInfo file whose `ModelNumStr` line points at the
 * *original* 5G (`MA147` → `video_5g`) instead of the firmware-derived
 * 5G Enhanced (`MA446` → `video_5_5g`). This is the canonical
 * "user copied SysInfo from another iPod / firmware update left it stale"
 * shape that the `sysinfo-modelnum-mismatch` check exists to detect.
 *
 * Unit tests at
 * `packages/podkit-core/src/diagnostics/checks/sysinfo-modelnum-mismatch.test.ts`
 * pin the byte-level repair semantics (backup file, ModelNumStr rewrite,
 * edge cases). This persona supports a Tier-3 VM test that pins the
 * end-to-end CLI contract (detect → repair → re-detect passes).
 *
 * @see packages/podkit-core/src/diagnostics/checks/sysinfo-modelnum-mismatch.ts
 * @see test-packages/device-testing/src/personas/ipod-video-5g-iflash-1tb/persona.ts
 * @module
 */

import type { DevicePersona } from '../types.js';
import { asRawXmlText } from '../raw-text.js';
import sysInfoExtendedXmlRaw from '../ipod-video-5g-iflash-1tb/raw/sysinfo-extended.xml' with { type: 'text' };

const sysInfoExtendedXml = asRawXmlText(sysInfoExtendedXmlRaw);

export const ipod5gModelnumMismatch: DevicePersona = {
  id: 'ipod-5g-modelnum-mismatch',
  description: 'iPod 5G Video — ModelNum mismatch (MA147 vs video_5_5g).',
  schemaVersion: 3,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1209,
    deviceSerial: 'MODELNUM-MISMATCH-001',
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
    stringDescriptors: { 1: 'Apple Inc.', 2: 'iPod', 3: 'MODELNUM-MISMATCH-001' },
  },

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
      label: 'MISMATCH5G',
      // SIE XML is seeded statically so it survives the test-time
      // `gpod-tool init` step (which writes SysInfo + iTunesDB but
      // doesn't touch SIE). The test then overwrites
      // `iPod_Control/Device/SysInfo` with `ModelNumStr: MA147` to
      // produce the stale state the check exists to detect.
      initialContent: [
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
