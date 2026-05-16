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
 *   - `expectedReadiness.level: 'needs-repair'` per
 *     `packages/podkit-core/src/device/readiness/determine-level.ts`:
 *     "SysInfo check failed" rule resolves to `needs-repair`.
 *
 * The `expectedCapabilities` snapshot is the iPod 5G's nominal capability
 * set — the test asserts that when the SIE parser fails, the persona's
 * expected snapshot still describes the device the USB descriptor
 * identifies, so a test using this persona can distinguish "parser failed
 * but device identity still recovered" from "parser failed and identity
 * lost".
 *
 * @see packages/ipod-firmware/src/plist/parser.ts (`parsePlist` — entry point under test)
 * @see documents/persona-capture-playbook.md §"Synthesised personas (no hardware)"
 * @module
 */

import type { DevicePersona } from '../types.js';
// Deliberately-truncated SIE XML. Source: first 500 bytes of
// `packages/device-testing/src/personas/ipod-video-5g-iflash-1tb/raw/sysinfo-extended.xml`.
// The cut lands mid-element (`<key>MaximumSampleRate<` — incomplete tag),
// which is the exact failure shape a partial USB read would produce on a
// flaky device.
import sysInfoExtendedXml from './raw/sysinfo-extended.xml' with { type: 'text' };

export const malformedSysinfo: DevicePersona = {
  id: 'malformed-sysinfo',
  description:
    'Synthesised SIE-parser error-path fixture — real iPod 5G USB identity (0x05ac:0x1209) with deliberately-truncated SysInfoExtended XML.',
  schemaVersion: 1,

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

  partitionLayout: { partitions: [] },

  massStorageBackingFile: null,

  // Nominal iPod 5G Video capability set — copied from
  // `ipod-video-5g-iflash-1tb/persona.ts`. The test can use this to assert
  // "if the parser had succeeded, this is what the capabilities would have
  // been" — distinct from a misclassification scenario.
  expectedCapabilities: {
    artworkSources: ['embedded', 'database'],
    artworkMaxResolution: 200,
    supportedAudioCodecs: ['aac', 'alac', 'mp3', 'aiff', 'wav'],
    supportsVideo: true,
    audioNormalization: 'soundcheck',
    supportsAlbumArtistBrowsing: false,
  },

  // `determineLevel`'s "SysInfo check failed" rule resolves a fail `sysinfo`
  // stage to `needs-repair` — the same level a non-malformed-but-absent
  // SIE produces, which is the right behaviour: the repair path
  // (`podkit device repair sysinfo-extended`) is the user-facing escape
  // hatch for both cases. See
  // `packages/podkit-core/src/device/readiness/determine-level.ts:88`.
  expectedReadiness: {
    level: 'needs-repair',
    stages: [
      {
        stage: 'sysinfo',
        status: 'fail',
        summary: 'SysInfoExtended XML is malformed (parser error)',
        details: {
          error: 'parsePlist: unexpected end of input',
          xmlBytes: 500,
          truncated: true,
        },
      },
    ],
  },

  expectedDoctorOutput: {},

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'synthesised',
  },
};
