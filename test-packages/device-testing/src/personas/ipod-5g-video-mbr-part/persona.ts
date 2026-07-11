/**
 * iPod 5G Video (MBR-partitioned FAT32) persona — synthesised device-shape fixture.
 *
 * **Source:** synthesised. The USB identity mirrors the real
 * `ipod-video-5g-iflash-1tb` persona (same SIE XML, iPod 5G Video), so the
 * classifier accepts it as a fully-supported, syncable iPod. It differs from
 * that persona in exactly ONE respect: the mass-storage backing is
 * MBR-PARTITIONED (`synthesis.partitioned: true`) rather than whole-disk FAT32.
 *
 * # Why this persona exists
 *
 * A real MBR/FAT32 iPod (like the captured TERAPOD) presents on a host as a
 * disk (`/dev/sd<x>`) with a child data partition (`/dev/sd<x>1`, `type:
 * "part"`, vfat) — see the sibling's `partitionLayout`. The whole-disk-FAT
 * synthesis shortcut the sibling uses presents the gadget as a bare `disk`
 * instead, which does NOT exercise the daemon poller's PARTITION branch (nor
 * the CLI's partition-suffix stripping). This persona restores the realistic
 * partitioned shape so the Tier-5 daemon lsblk-lane test covers `type: "part"`
 * detection end-to-end through the shipped image.
 *
 * A distinct product id (`0x120a`) disambiguates its gadget from the whole-disk
 * sibling's (`0x1209`) when `resolvePersonaDeviceNodes` filters by PID — the two
 * are never bound at once (the harness runs personas serially), but a distinct
 * id keeps device-node resolution unambiguous and the intent legible.
 *
 * @see documents/test-devices.md §"iPod 5th Generation Video (iFlash 1TB mod)"
 * @see test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts (partitioned synthesis)
 * @module
 */

import type { DevicePersona } from '../types.js';
import sysInfoExtendedXml from '../ipod-video-5g-iflash-1tb/raw/sysinfo-extended.xml' with { type: 'text' };

export const ipod5gVideoMbrPart: DevicePersona = {
  id: 'ipod-5g-video-mbr-part',
  description:
    'iPod 5G Video (MBR-partitioned) — TERAPOD USB identity, FAT32 data volume inside an MBR partition (sd?1).',
  schemaVersion: 3,

  usbDescriptor: {
    // Same vendor as the real TERAPOD; distinct product id so the gadget's
    // /dev/sd<x> node is unambiguous vs. the whole-disk sibling (0x1209).
    vendorId: 0x05ac,
    productId: 0x120a,
    deviceSerial: 'MBR-PART-FIXTURE-001',
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // Mirrors the real `ipod-video-5g-iflash-1tb` USB descriptor hierarchy —
    // synthesised shape-variant, identity-equivalent for the classifier.
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
    stringDescriptors: { 1: 'Apple Inc.', 2: 'iPod', 3: 'MBR-PART-FIXTURE-001' },
  },

  // Same SIE XML as the real TERAPOD — identity resolves to the 5G Video, so the
  // device is syncable. Only the on-disk partition shape differs.
  sysInfoExtendedXml,

  // Host probes intentionally null — the test drives the daemon lsblk lane,
  // which reads the live gadget's lsblk/sysfs, not these captured probes.
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

  // VM only: a 256 MiB MBR-partitioned FAT32 backing synthesised in-VM by
  // `runners/lima-test-vm-backing-files.ts` (`partitioned: true` → sfdisk +
  // loop + mkfs.vfat --invariant on the partition node). The image is empty (no
  // iTunesDB); the daemon lsblk-lane test seeds the database via gpod-tool after
  // the daemon mounts the partition. Deterministic across runs.
  massStorageBackingFile: {
    synthesis: {
      sizeMiB: 256,
      filesystem: 'FAT32',
      label: 'IPOD_VIDEO',
      partitioned: true,
    },
    resetStrategy: 'copy',
  },

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'synthesised',
  },
};
