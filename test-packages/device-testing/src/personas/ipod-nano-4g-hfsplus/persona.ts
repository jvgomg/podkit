/**
 * iPod nano 4G HFS+ persona — synthesised refusal-scenario fixture.
 *
 * **Source:** synthesised. USB descriptor + SysInfoExtended XML are
 * imported verbatim from the FAT32-shaped sibling
 * (`ipod-nano-4g-black`); the only deltas are the volume serial, the
 * partition `type`, and the mass-storage backing recipe (`'HFS+'`
 * synthesis with an MBR-wrapped image).
 *
 * Purpose: drive the HFS+-on-Linux refusal path end-to-end. On Linux,
 * podkit refuses to operate against HFS+ volumes (the kernel hfsplus
 * driver is RO on journaled volumes, blkid surfaces no UUID by default,
 * udisks mounts to a generic path). Refusal triggers off the `lsblk`
 * fstype string `"hfsplus"` — which the kernel reads from the on-disk
 * Volume Header magic regardless of whether `hfsprogs` userspace or the
 * `hfsplus.ko` kernel module are installed.
 *
 * # Why nano 4G (PID 0x1263) and not nano 7G (PID 0x1267)?
 *
 * The USB-side classifier in `packages/devices-ipod/` resolves nano 7G
 * PID `0x1267` to the `hashAB` variant by default, which the
 * unsupported-cascade flags as "unsupported-device". That classification
 * short-circuits readiness at stage 1 (USB) — the filesystem stage where
 * the HFS+ refusal lives never runs. nano 4G PID `0x1263` is a
 * `hash58`/supported PID (the same PID the unsupported-cascade Tier-3
 * test uses as its regression control), so the USB stage passes and
 * readiness reaches the filesystem stage.
 *
 * # On-disk backing
 *
 * The synthesised backing image is an MBR-wrapped HFS+ image: a 512-byte
 * MBR with a single partition (type 0xAF, HFS) starting at LBA 2048, and
 * an HFS+ Volume Header at the partition's offset 1024 with a non-zero
 * `finderInfo[6..7]` UUID seed. blkid synthesises a UUID from the seed;
 * without it, the Linux platform's `findIpodDevices` filter drops the
 * partition and the refusal never fires. The runner builds the image on
 * the HOST via `runners/hfsplus-image-writer.ts` (`hfsprogs` is
 * unpackaged on arm64 in Debian bookworm, so an in-VM `mkfs.hfsplus`
 * path is impossible) and `limactl copy`'s it into the VM. See the
 * architecture doc `documents/architecture/testing/vm-testing.md` §5.6.
 *
 * @see packages/podkit-core/src/device/filesystem-policy.ts
 * @see documents/architecture/testing/vm-testing.md
 * @module
 */

import type { DevicePersona } from '../types.js';
import { ipodMacosPlatformInfo } from '../builders.js';
import { asRawXmlText } from '../raw-text.js';
import sysInfoExtendedXmlRaw from '../ipod-nano-4g-black/raw/sysinfo-extended.xml' with { type: 'text' };
import diskutilPlist from '../ipod-nano-4g-black/raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from '../ipod-nano-4g-black/raw/system-profiler.json' with { type: 'json' };

const sysInfoExtendedXml = asRawXmlText(sysInfoExtendedXmlRaw);

export const ipodNano4gHfsplus: DevicePersona = {
  id: 'ipod-nano-4g-hfsplus',
  description: 'iPod nano 4G HFS+/APM — Linux refusal scenario (synthesised).',
  schemaVersion: 3,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1263,
    // Synthesised serial — distinct from the sibling (`000A27001DCECFB5`) so
    // dual-iPod discovery scenarios can address the HFS+ variant by serial.
    deviceSerial: '000A27001DCECFHF',
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
    stringDescriptors: { 1: 'Apple Inc.', 2: 'iPod', 3: '000A27001DCECFHF' },
  },

  sysInfoExtendedXml,

  // Refusal happens before the host probe matters; we still surface the Mac
  // host probes for completeness with the sibling. lsblk is left null — the
  // runner does not emulate a synthesised Linux probe payload.
  lsblkJson: null,
  systemProfilerJson,
  diskutilPlist,

  // macOS supports HFS+ iPods (only Linux refuses them). Records what the
  // macOS findIpodDevices pipeline would surface for the synthesised HFS+
  // partition; placeholder UUID/identifier — tighten when a later AC pins
  // the parsed-plist comparison.
  platformDeviceInfoDarwin: [
    ipodMacosPlatformInfo({
      identifier: 'disk3s2',
      volumeName: 'IPOD',
      volumeUuid: '11111111-2222-3333-4444-555555555555',
      mountPoint: '/Volumes/IPOD',
      sizeMiB: 7601,
      filesystem: 'Apple_HFS',
    }),
  ],

  partitionLayout: {
    // Mirrors the FAT32-shaped sibling's layout. `partitions[].type` is
    // documentation-level metadata — the runtime refusal check reads
    // `device.storage.filesystem` (the lowercase `'hfsplus'` string that
    // `lsblk -J --output FSTYPE` emits). See `filesystem-policy.ts`.
    luns: [
      {
        lun: 0,
        partitions: [
          { index: 1, type: 'apple_partition_map', sizeMiB: 1 },
          { index: 2, type: 'HFS+', sizeMiB: 7601, mountpoint: '/Volumes/IPOD' },
        ],
      },
    ],
  },

  // Backing image is built on the HOST via the pure-TS MBR-wrapped HFS+
  // Volume Header writer (`runners/hfsplus-image-writer.ts`) and
  // limactl-copied into the VM. 32 MiB sparse — only the 512-byte MBR +
  // the 512-byte HFS+ Volume Header are on-disk; the rest is filesystem
  // holes. blkid identifies the partition as `hfsplus` from the on-disk
  // magic and synthesises a UUID from the volume header's
  // `finderInfo[6..7]` seed.
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
