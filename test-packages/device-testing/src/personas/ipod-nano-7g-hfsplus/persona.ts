/**
 * iPod nano 7G HFS+ persona — synthesised refusal-scenario fixture.
 *
 * **Source:** synthesised. USB descriptor + SysInfoExtended XML are
 * imported verbatim from the FAT32 sibling (`ipod-nano-7g-space-gray`);
 * the only deltas are the volume serial, the partition `type`, and the
 * mass-storage backing recipe (`'HFS+'` synthesis instead of `'FAT32'`).
 *
 * Purpose: drive the HFS+-on-Linux refusal path end-to-end. On Linux,
 * podkit refuses to operate against HFS+ volumes (the kernel hfsplus
 * driver is RO on journaled volumes, blkid surfaces no UUID, udisks
 * mounts to a generic path). Refusal triggers off the `lsblk` fstype
 * string `"hfsplus"` — which the kernel reads from the on-disk volume
 * header magic regardless of whether `hfsprogs` userspace or the
 * `hfsplus.ko` kernel module are installed.
 *
 * The synthesised backing image therefore only needs to make `lsblk` /
 * `blkid` report `fstype: 'hfsplus'`. The runner builds it on the HOST
 * via a pure-TypeScript HFS+ Volume Header writer
 * (`runners/hfsplus-image-writer.ts`) and `limactl copy`'s it into the
 * VM — `hfsprogs` is unpackaged on arm64 in Debian bookworm, so an
 * in-VM `mkfs.hfsplus` path is impossible. No mount is required — and
 * no mount would succeed on a stock test VM kernel anyway.
 *
 * Expected outputs (capabilities, readiness, doctor JSON) live in
 * `@podkit/e2e-vm-tests/src/expectations/ipod-nano-7g-hfsplus.ts`
 * when the feature test grows expectation assertions (today's tests
 * pin against the refusal envelope shape directly).
 *
 * @see packages/podkit-core/src/device/filesystem-policy.ts
 * @see documents/architecture/testing/vm-testing.md
 * @module
 */

import type { DevicePersona } from '../types.js';
import sysInfoExtendedXml from '../ipod-nano-7g-space-gray/raw/sysinfo-extended.xml' with { type: 'text' };
import diskutilPlist from '../ipod-nano-7g-space-gray/raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from '../ipod-nano-7g-space-gray/raw/system-profiler.json' with { type: 'json' };

export const ipodNano7gHfsplus: DevicePersona = {
  id: 'ipod-nano-7g-hfsplus',
  description: 'iPod nano 7G HFS+/APM — Linux refusal scenario (synthesised).',
  schemaVersion: 3,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1267,
    // Synthesised serial — deliberately distinct from the FAT32 sibling
    // (`000A270024A23E9E`) so dual-iPod discovery scenarios can tell the
    // two apart by serial.
    deviceSerial: '000A270024A23EHF',
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
    stringDescriptors: { 1: 'Apple Inc.', 2: 'iPod', 3: '000A270024A23EHF' },
  },

  sysInfoExtendedXml,

  // Refusal happens before the host probe matters; we still surface the Mac
  // host probes for completeness with the FAT32 sibling. lsblk is left null —
  // the runner does not emulate a synthesised Linux probe payload.
  lsblkJson: null,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // Mirrors the FAT32 sibling's layout but the partition type is the
    // human-readable `'HFS+'` label. This field is documentation-level
    // only — the runtime refusal check reads `device.storage.filesystem`
    // (the lowercase `'hfsplus'` string that `lsblk -J --output FSTYPE`
    // emits). See `filesystem-policy.ts`.
    luns: [
      {
        lun: 0,
        partitions: [{ index: 1, type: 'HFS+', sizeMiB: 15065, mountpoint: '/Volumes/IPOD' }],
      },
    ],
  },

  // Backing image is built on the HOST via a pure-TS HFS+ volume-header
  // writer (`runners/hfsplus-image-writer.ts`) and limactl-copied into the
  // VM. `hfsprogs` is not packaged for arm64 in Debian bookworm, so an
  // in-VM `mkfs.hfsplus` path is impossible. 32 MiB sparse — only the
  // 512-byte volume header is on-disk; the rest is filesystem holes.
  // blkid identifies the image as `hfsplus` from the on-disk magic alone.
  massStorageBackingFile: {
    synthesis: {
      sizeMiB: 32,
      filesystem: 'HFS+',
      label: 'IPOD_HFS',
    },
    resetStrategy: 'copy',
  },

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'synthesised',
  },
};
