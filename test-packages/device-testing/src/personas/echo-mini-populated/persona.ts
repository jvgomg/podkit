/**
 * FiiO Snowsky Echo Mini (populated) persona — synthesised state-variant.
 *
 * **Source:** synthesised. Sibling of `echo-mini` (empty FAT32 backing). This
 * variant seeds the FAT32 image with five small synthetic track files
 * (`track-01.mp3` through `track-05.mp3`) in a `Music/` directory, exercising
 * the "populated device" path — i.e., `massStorageBackingFile` with real
 * content present.
 *
 * The same USB identity as `echo-mini` is used (`0x071b:0x3203`). The content
 * files are **not real audio** — they are small text-byte blobs (64 bytes
 * each) that happen to have `.mp3` extensions. They are sufficient for testing
 * sync-target detection, file-count assertions, and directory traversal; they
 * are not sufficient for audio playback.
 *
 * **Determinism:** `mkfs.vfat --invariant` + fixed synthetic content produces
 * a byte-stable FAT32 image across runs. Each track file is 64 bytes of
 * `0xAA` sentinel bytes — chosen to be distinct from zero so `truncate`
 * sparse-holes don't silently swallow them, and to be clearly synthetic (not
 * a valid MP3 frame header).
 *
 * @see test-packages/device-testing/src/personas/echo-mini/persona.ts (empty sibling)
 * @see documents/persona-capture-playbook.md §"Synthesised personas (no hardware)"
 * @module
 */

import type { DevicePersona } from '../types.js';
import diskutilPlist from '../echo-mini/raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from '../echo-mini/raw/system-profiler.json' with { type: 'json' };
import lsblkJson from '../echo-mini/raw/lsblk-lun0.json' with { type: 'json' };

export const echoMiniPopulated: DevicePersona = {
  id: 'echo-mini-populated',
  description:
    'FiiO Snowsky Echo Mini (populated) — synthesised state-variant with 5 synthetic track files in Music/. Sibling of echo-mini (empty state).',
  schemaVersion: 3,

  usbDescriptor: {
    // Same vendor/product + full descriptor hierarchy as `echo-mini` — the
    // preset resolver maps `0x071b:0x3203` to the `echo-mini` preset
    // regardless of content state. Keep in lockstep with the empty sibling.
    vendorId: 0x071b,
    productId: 0x3203,
    deviceSerial: 'USBV1.00',
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    bMaxPacketSize0: 64,
    bcdUSB: 0x0200,
    bcdDevice: 0x0200,
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
              { bEndpointAddress: 0x81, bmAttributes: 0x02, wMaxPacketSize: 512, bInterval: 0 },
              { bEndpointAddress: 0x02, bmAttributes: 0x02, wMaxPacketSize: 512, bInterval: 0 },
            ],
          },
        ],
      },
    ],
    stringDescriptors: { 1: 'ECHO MINI', 2: 'ECHO MINI', 3: 'USBV1.00' },
  },

  sysInfoExtendedXml: null,

  // Reuse the real Echo Mini's host-probe payloads — they describe the device
  // USB + disk topology, not filesystem content. Content differs between the
  // empty and populated variants only at the FAT layer (inside the image).
  lsblkJson,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // Same logical layout as the empty `echo-mini` persona — dual-LUN.
    luns: [
      {
        lun: 0,
        partitions: [{ index: 1, type: 'FAT32', sizeMiB: 7184, mountpoint: '/Volumes/ECHO MINI' }],
      },
      {
        lun: 1,
        partitions: [{ index: 1, type: 'ExFAT', sizeMiB: 120564, mountpoint: '/Volumes/Echo SD' }],
      },
    ],
  },

  // VM: 64 MiB FAT32 backing image, same size as the empty `echo-mini`
  // persona, but seeded with 5 synthetic track files via `initialContent`.
  // Each `track-0N.mp3` is a 64-byte sentinel blob — not real audio, but
  // sufficient to exercise the sync-target detection and file-count paths.
  // Label differs from `ECHO_MINI` to make images distinguishable in VM tests.
  massStorageBackingFile: {
    synthesis: {
      sizeMiB: 64,
      filesystem: 'FAT32',
      label: 'ECHO_POPU',
      initialContent: [
        { path: 'Music/track-01.mp3', sourceFixture: './raw/track-01.mp3' },
        { path: 'Music/track-02.mp3', sourceFixture: './raw/track-02.mp3' },
        { path: 'Music/track-03.mp3', sourceFixture: './raw/track-03.mp3' },
        { path: 'Music/track-04.mp3', sourceFixture: './raw/track-04.mp3' },
        { path: 'Music/track-05.mp3', sourceFixture: './raw/track-05.mp3' },
      ],
    },
    resetStrategy: 'copy',
  },

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'synthesised',
  },
};
