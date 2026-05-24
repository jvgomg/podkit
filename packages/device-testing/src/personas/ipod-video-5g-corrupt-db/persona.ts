/**
 * iPod 5G Video (corrupt iTunesDB) persona — synthesised parser error-path fixture.
 *
 * **Source:** synthesised. The USB identity mirrors the real `ipod-video-5g-iflash-1tb`
 * persona (`0x05ac:0x1209`, same SIE XML) — a fully-supported iPod 5G Video
 * that the classifier accepts and routes to the database parse step. The
 * `massStorageBackingFile.synthesis.initialContent` seeds the FAT32 image with
 * a deliberately-truncated iTunesDB: 4-byte `mhbd` magic header followed by
 * 508 zero bytes (512 total). The parser reads `headerLen = 0` (zero-filled
 * field) and throws "mhbd header too small" (< 32) — this is the
 * truncated-read failure path produced by an abrupt write abort or partial
 * flash update.
 *
 * **Why this corruption shape:**
 *   - `mhbd` magic present → `parseDatabase` enters `parseMhbd` correctly.
 *   - `headerLen = 0` (zero-filled) → `parseMhbd` throws "mhbd header too small".
 *   - Simpler than scrambling a checksum field (no real iTunesDB needed).
 *   - Tests the truncated-read failure surface: the first thing `parseMhbd`
 *     validates after the 4-byte magic is `headerLen`.
 *
 * `corruptItunesDb` is exported alongside the persona for Tier-1 tests that
 * feed the bytes directly to `parseDatabase` and assert it throws.
 *
 * @see packages/ipod-db/src/itunesdb/parser.ts (`parseDatabase`)
 * @see packages/ipod-db/src/itunesdb/records/mhbd.ts (`parseMhbd`)
 * @see documents/persona-capture-playbook.md §"Synthesised personas (no hardware)"
 * @module
 */

import type { DevicePersona } from '../types.js';
import sysInfoExtendedXml from '../ipod-video-5g-iflash-1tb/raw/sysinfo-extended.xml' with { type: 'text' };

/**
 * Deliberately-truncated iTunesDB binary.
 *
 * Synthesis recipe:
 *   - Bytes 0–3: `mhbd` magic (ASCII, LE order matches standard iTunesDB).
 *   - Bytes 4–511: all zeros. When `parseMhbd` reads `headerLen` from bytes
 *     4–7, it gets `0` — below the 32-byte minimum — and throws immediately.
 *
 * The corrupt record is 512 bytes total (one disk sector). The real TERAPOD
 * iTunesDB is several megabytes; any value < 4 bytes for `headerLen` causes
 * the same failure.
 */
export const corruptItunesDb: Uint8Array = new Uint8Array(512);
// Write 'mhbd' magic at offset 0 (LE: 'm', 'h', 'b', 'd').
corruptItunesDb[0] = 0x6d; // 'm'
corruptItunesDb[1] = 0x68; // 'h'
corruptItunesDb[2] = 0x62; // 'b'
corruptItunesDb[3] = 0x64; // 'd'
// Bytes 4–511 remain 0x00 — headerLen = 0 triggers "mhbd header too small".

export const ipodVideo5gCorruptDb: DevicePersona = {
  id: 'ipod-video-5g-corrupt-db',
  description:
    'iPod 5G Video (corrupt-db) — synthesised state-variant: same USB identity as TERAPOD, iTunesDB truncated to 512 bytes (mhbd magic + zeros). Parser throws "mhbd header too small".',
  schemaVersion: 2,

  usbDescriptor: {
    // Same vendor/product as `ipod-video-5g-iflash-1tb` — classifier accepts
    // this device as a supported iPod 5G Video and routes to the DB parse step.
    vendorId: 0x05ac,
    productId: 0x1209,
    deviceSerial: 'CORRUPT-DB-FIXTURE-001',
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // Mirrors the real `ipod-video-5g-iflash-1tb` USB descriptor hierarchy
    // — synthesised state-variant, identity-equivalent for the classifier.
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
    stringDescriptors: { 1: 'Apple Inc.', 2: 'iPod', 3: 'CORRUPT-DB-FIXTURE-001' },
  },

  // Same SIE XML as the real TERAPOD — the SIE parse step succeeds; only the
  // database parse step fails. This tests "device fully identified but DB
  // unreadable", distinct from malformed-sysinfo's "SIE parse fails".
  sysInfoExtendedXml,

  // Host probes intentionally null — the test exercises the DB-parse path,
  // not host probing. The classifier reads the USB descriptor directly.
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

  // Tier-3: 256 MiB FAT32 backing image SEEDED with the truncated iTunesDB
  // at the canonical iPod database path. `initialContent` is the seed
  // recipe; the runner (`lima-test-vm-backing-files.ts`) copies the fixture
  // into the FAT32 via mtools after `mkfs.vfat`. Tier-1 smoke test
  // (`corrupt-db.test.ts`) bypasses the image entirely by calling
  // `parseDatabase(corruptItunesDb)` directly on the exported Uint8Array.
  massStorageBackingFile: {
    synthesis: {
      sizeMiB: 256,
      filesystem: 'FAT32',
      label: 'CORRUPT5G',
      initialContent: [
        {
          path: 'iPod_Control/iTunes/iTunesDB',
          sourceFixture: './raw/iTunesDB',
        },
      ],
    },
    resetStrategy: 'copy',
  },

  // Nominal iPod 5G Video capabilities — USB PID unambiguously identifies the
  // generation regardless of DB state, so capabilities remain determinable.
  expectedCapabilities: {
    artworkSources: ['embedded', 'database'],
    artworkMaxResolution: 200,
    supportedAudioCodecs: ['aac', 'alac', 'mp3', 'aiff', 'wav'],
    supportsVideo: true,
    audioNormalization: 'soundcheck',
    supportsAlbumArtistBrowsing: false,
  },

  // The corrupt-db failure surfaces at the `database` readiness stage.
  // `determineLevel` maps a failed `database` stage to `needs-repair` —
  // same as malformed-sysinfo's `needs-repair` from a failed `sysinfo`
  // stage. The repair path is `podkit device repair itunes-db`.
  expectedReadiness: {
    level: 'needs-repair',
    stages: [
      {
        stage: 'database',
        status: 'fail',
        summary: 'iTunesDB is corrupt or unreadable (parser error)',
        details: {
          error: 'parseMhbd: mhbd header too small',
          dbBytes: 512,
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
