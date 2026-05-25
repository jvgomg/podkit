/**
 * Generic non-Apple USB flash drive persona — synthesised rejection case.
 *
 * **Source:** synthesised (no hardware). Canonical "wrong USB stick plugged
 * into `podkit sync`" stand-in: SanDisk Cruzer Blade `0x0781:0x5567`.
 * Pins the mass-storage classifier's vendor-recognised-but-no-preset
 * rejection path against a non-music-player vendor.
 *
 * This persona pairs with the SanDisk entry added to
 * `UNSUPPORTED_VENDORS` in `packages/devices-mass-storage/src/unsupported.ts`.
 * Together they verify that podkit refuses to operate on a generic USB
 * stick with a clear rejection reason rather than silently probing an
 * unrelated filesystem.
 *
 * Unlike the `ipod-shuffle-not-supported` persona — where no host probe is
 * reachable — the non-Apple rejection happens at the mass-storage
 * classifier *after* `system_profiler` / `lsblk` have populated the
 * platform device info. So this persona ships full (synthesised) probe
 * payloads, exercising the entire discovery pipeline up to the moment
 * the classifier rejects the vendor.
 *
 * @see packages/devices-mass-storage/src/unsupported.ts (SanDisk entry)
 * @module
 */

import type { DevicePersona } from '../types.js';
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };
import lsblkJson from './raw/lsblk.json' with { type: 'json' };

export const nonIpodUsbDisk: DevicePersona = {
  id: 'non-ipod-usb-disk',
  description:
    'Generic non-Apple USB flash drive (SanDisk Cruzer Blade, 0x0781:0x5567) — synthesised rejection case for the no-preset vendor path.',
  schemaVersion: 3,

  usbDescriptor: {
    vendorId: 0x0781, // SanDisk Corp.
    productId: 0x5567, // Cruzer Blade — most common Cruzer-family PID per linux-usb.org usb.ids
    deviceSerial: '4C530001071224119242', // representative Cruzer serial format (20 hex chars)
    // Composite mass-storage flash drive — device-level fields are 0; mass
    // storage class 0x08 lives on the interface descriptor. Same convention
    // as every Sony persona in this registry.
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // Synthesised Cruzer Blade descriptor — single config, single
    // Mass-Storage Bulk-Only interface. Representative of the typical
    // USB-2.0 flash drive layout; re-capture from `lsusb -v` if a future
    // test asserts on specific descriptor values.
    bMaxPacketSize0: 64,
    bcdUSB: 0x0200,
    bcdDevice: 0x0100,
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
    stringDescriptors: { 1: 'SanDisk', 2: 'Cruzer Blade', 3: '4C530001071224119242' },
  },

  sysInfoExtendedXml: null,

  lsblkJson,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // Single MBR/FAT32 partition — the typical out-of-box layout for a
    // 16 GB Cruzer Blade. Filesystem detail is irrelevant once the
    // classifier rejects the vendor, but recorded for symmetry with the
    // host probes.
    luns: [
      {
        lun: 0,
        partitions: [{ index: 1, type: 'FAT32', sizeMiB: 14732, mountpoint: '/Volumes/CRUZER' }],
      },
    ],
  },

  massStorageBackingFile: null,

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'synthesised',
  },
};
