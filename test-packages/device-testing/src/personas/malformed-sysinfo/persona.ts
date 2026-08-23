/**
 * Malformed SysInfoExtended persona — synthesised parser error-path fixture.
 *
 * **Source:** synthesised. The USB descriptor mirrors a real, supported
 * iPod 5G Video (`0x05ac:0x1209`); the on-disk SIE XML is the same
 * iPod 5G XML deliberately truncated at byte 500. This pins coverage of
 * the SIE parser's partial-read error path — the trickiest path to
 * exercise from production code, because real iPods produce well-formed
 * XML and you have to engineer a fault to hit it.
 *
 * **Why this shape:**
 *   - Real iPod identity (PID 0x1209, supported) so the upstream
 *     classifier accepts the device and routes to the SIE parser.
 *   - Truncated XML so `parsePlist` is the function that throws.
 *   - The expected readiness level is `'needs-repair'` per
 *     `packages/podkit-core/src/device/readiness/determine-level.ts`:
 *     "SysInfo check failed" rule resolves to `needs-repair`.
 *
 * Expected outputs (capabilities, readiness, doctor JSON) live in
 * `@podkit/e2e-vm-tests/src/expectations/malformed-sysinfo.ts` (schema v3) —
 * including the iPod 5G's nominal capability set so a test using this
 * persona can distinguish "parser failed but device identity still
 * recovered" from "parser failed and identity lost".
 *
 * @see packages/ipod-firmware/src/plist/parser.ts (`parsePlist` — entry point under test)
 * @see documents/persona-capture-playbook.md §"Synthesised personas (no hardware)"
 * @module
 */

import type { DevicePersona } from '../types.js';
// Deliberately-truncated SIE XML. Source: first 500 bytes of
// `test-packages/device-testing/src/personas/ipod-video-5g-iflash-1tb/raw/sysinfo-extended.xml`.
// The cut lands mid-element (`<key>MaximumSampleRate<` — incomplete tag),
// which is the exact failure shape a partial USB read would produce on a
// flaky device.
import { asRawXmlText } from '../raw-text.js';
import sysInfoExtendedXmlRaw from './raw/sysinfo-extended.xml' with { type: 'text' };

const sysInfoExtendedXml = asRawXmlText(sysInfoExtendedXmlRaw);

export const malformedSysinfo: DevicePersona = {
  id: 'malformed-sysinfo',
  description:
    'SIE-parser error fixture — iPod 5G USB identity (0x05ac:0x1209) with truncated SysInfoExtended XML.',
  schemaVersion: 3,

  usbDescriptor: {
    // Real iPod 5G Video — same PID as `ipod-video-5g-iflash-1tb`. The
    // upstream classifier accepts this as a supported iPod, so the SIE
    // parser is the next step in the pipeline — exactly where this
    // fixture should fail.
    vendorId: 0x05ac,
    productId: 0x1209,
    deviceSerial: 'MALFORMED-SYSINFO-FIXTURE-001',
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // Mirrors the iPod 5G hierarchy (shared PID 0x1209).
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
    stringDescriptors: { 1: 'Apple Inc.', 2: 'iPod', 3: 'MALFORMED-SYSINFO-FIXTURE-001' },
  },

  // The fault under test: 500-byte truncation. `parsePlist(xml)` throws on
  // this input — see `malformed-sysinfo.test.ts` for the assertion.
  sysInfoExtendedXml,

  // Host probes intentionally `null` — the test only exercises the SIE
  // parser. The classifier reads the USB descriptor directly, not via
  // these payloads, so leaving them null avoids implying they matter
  // here. (A future test that wants to exercise the full pipeline
  // including host probes can copy them in from `ipod-video-5g-iflash-1tb`.)
  lsblkJson: null,
  systemProfilerJson: null,
  diskutilPlist: null,

  partitionLayout: { luns: [{ lun: 0, partitions: [] }] },

  massStorageBackingFile: null,

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'synthesised',
  },
};
