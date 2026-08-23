/**
 * iPod 5G Video (iFlash 1TB mod) persona — `TERAPOD`.
 *
 * Captured 2026-05-13 from physical hardware. Mac capture complete;
 * Linux capture deferred (pattern confirmed by sibling personas — see
 * `provenance.md` § "Linux capture session").
 *
 * SCSI-fallback inquiry path. Original HDD replaced by iFlash 1 TB flash
 * adapter; firmware identity (via SCSI) unaffected by the storage mod.
 *
 * Expected outputs (capabilities, readiness, doctor JSON) live in
 * `@podkit/e2e-vm-tests/src/expectations/ipod-video-5g-iflash-1tb.ts` (schema v3).
 *
 * @see documents/test-devices.md §"iPod 5th Generation Video (iFlash 1TB mod)"
 * @see documents/sysinfo-captures/ipod-5g-video-iflash-1tb.xml
 * @module
 */

import type { DevicePersona } from '../types.js';
import { asRawXmlText } from '../raw-text.js';
import sysInfoExtendedXmlRaw from './raw/sysinfo-extended.xml' with { type: 'text' };
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };

const sysInfoExtendedXml = asRawXmlText(sysInfoExtendedXmlRaw);

export const ipodVideo5gIflash1tb: DevicePersona = {
  id: 'ipod-video-5g-iflash-1tb',
  description:
    'iPod 5G Video iFlash 1TB mod (TERAPOD) — SCSI-fallback path, FAT32/MBR, firmware in 94 MiB MBR gap, requires manual mount.',
  schemaVersion: 3,

  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1209,
    deviceSerial: '000A27001605D1A0',
    // Linux session reconciles these from /sys/.../bDeviceClass.
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // Synthesised from the iPod composite-mass-storage convention shared by
    // every captured iPod sibling. Linux capture deferred — flagged for
    // follow-up in `provenance.md`.
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

  sysInfoExtendedXml,

  lsblkJson: null,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // MBR (2048-byte sectors). FAT32 starts at sector 48195. Sectors
    // 0..48194 (~94 MiB) hold iPod 5G firmware — same pattern as nano 2G
    // and mini 2G. iFlash adapter does not change the firmware partition
    // size (firmware is rewritten from the device's NOR flash to disk on
    // each boot, independent of underlying storage).
    luns: [
      {
        lun: 0,
        partitions: [
          { index: 1, type: 'firmware', sizeMiB: 94 },
          // No mountpoint — volume requires manual mount (see provenance).
          { index: 2, type: 'FAT32', sizeMiB: 956704 },
        ],
      },
    ],
  },

  // VM only: 256 MiB FAT32 backing file synthesised inside the test VM
  // by `runners/lima-test-vm-backing-files.ts`. The image is empty (no
  // iTunesDB, no media files). The recipe
  // is the source of truth; re-running mkfs.vfat --invariant against the
  // same (sizeMiB, label) pair is byte-identical. Real 1 TB iFlash storage
  // is irrelevant to the inquiry-methods code path the daemon exercises;
  // 256 MiB models a plausible 5G partition layout cheaply.
  massStorageBackingFile: {
    synthesis: {
      sizeMiB: 256,
      filesystem: 'FAT32',
      label: 'IPOD_VIDEO',
    },
    resetStrategy: 'copy',
  },

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'physical-capture',
  },
};
