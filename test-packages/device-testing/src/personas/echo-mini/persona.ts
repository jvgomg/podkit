/**
 * FiiO Snowsky Echo Mini persona — mass-storage DAP.
 *
 * Captured 2026-05-13 from physical hardware. Mac + Linux capture sessions
 * complete.
 *
 * Not an iPod. Exercises podkit's mass-storage preset framework — auto-detect
 * resolves to the built-in `echo-mini` preset via USB vendor/product (see
 * `packages/devices-mass-storage/src/presets/built-in.ts`).
 *
 * The device exposes **two USB Mass Storage LUNs**, presented to the host as
 * two distinct disks:
 *   - LUN 0 (`/dev/disk4` on macOS, `/dev/sdc` on Linux): internal flash,
 *     FAT32 `ECHO MINI` (~7.5 GB).
 *   - LUN 1 (`/dev/disk5` on macOS, `/dev/sdd` on Linux): inserted SD card,
 *     ExFAT `Echo SD` (~126 GB / 117.8 GiB).
 *
 * Only LUN 1 is the sync target. LUN 0 (firmware/internal) is exposed but
 * not used by podkit.
 *
 * `expectedCapabilities` + `expectedReadiness` are provisional — see
 * `provenance.md` § "Expected-* fields status".
 *
 * @see documents/test-devices.md §"FiiO Snowsky Echo Mini (mass-storage DAP)"
 * @module
 */

import type { DevicePersona } from '../types.js';
import diskutilPlist from './raw/diskutil.plist' with { type: 'text' };
import systemProfilerJson from './raw/system-profiler.json' with { type: 'json' };
import lsblkLun0 from './raw/lsblk-lun0.json' with { type: 'json' };

export const echoMini: DevicePersona = {
  id: 'echo-mini',
  description:
    'FiiO Snowsky Echo Mini — mass-storage DAP, two LUNs (ECHO MINI firmware FAT32 + Echo SD card ExFAT).',
  schemaVersion: 2,

  usbDescriptor: {
    vendorId: 0x071b,
    productId: 0x3203,
    deviceSerial: 'USBV1.00',
    // Mac + Linux both report 0/0/0 at the device level (composite-device
    // convention; Mass Storage class lives on the interface descriptor).
    // Source: `raw/ioreg.txt` (Mac) + `raw/sysfs-usb.txt` (Linux).
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    // `raw/sysfs-usb.txt`: bMaxPacketSize0=64, bcdDevice=0200, bNumConfigurations=1.
    // `raw/ioreg.txt`: bcdUSB=512 (= 0x0200).
    bMaxPacketSize0: 64,
    bcdUSB: 0x0200,
    bcdDevice: 0x0200,
    bNumConfigurations: 1,
    configurations: [
      {
        bConfigurationValue: 1,
        bNumInterfaces: 1,
        // Bus-powered, no remote wakeup. Bit 7 reserved-must-be-1 (legacy).
        bmAttributes: 0x80,
        bMaxPower: 0xfa, // 500 mA
        interfaces: [
          {
            bInterfaceNumber: 0,
            bAlternateSetting: 0,
            // Mass Storage class (0x08) / SCSI transparent (0x06) /
            // Bulk-Only Transport (0x50). Source: `raw/udev.txt`
            // `ID_USB_INTERFACES=:080650:` + ioreg `UsbDeviceSignature`
            // tail `...080650`.
            bInterfaceClass: 0x08,
            bInterfaceSubClass: 0x06,
            bInterfaceProtocol: 0x50,
            // Endpoints not explicitly captured; standard Bulk-Only
            // Transport endpoint pair (one IN, one OUT, high-speed bulk
            // wMaxPacketSize 512 each, bInterval 0). Synthesised from
            // the BBB protocol contract — re-capture from `lsusb -v` if
            // a future test asserts on these values.
            endpoints: [
              {
                bEndpointAddress: 0x81,
                bmAttributes: 0x02,
                wMaxPacketSize: 512,
                bInterval: 0,
              },
              {
                bEndpointAddress: 0x02,
                bmAttributes: 0x02,
                wMaxPacketSize: 512,
                bInterval: 0,
              },
            ],
          },
        ],
      },
    ],
    // From `raw/ioreg.txt`: iManufacturer=1, iProduct=2, iSerialNumber=3.
    stringDescriptors: {
      1: 'ECHO MINI',
      2: 'ECHO MINI',
      3: 'USBV1.00',
    },
  },

  sysInfoExtendedXml: null,

  lsblkJson: lsblkLun0,
  systemProfilerJson,
  diskutilPlist,

  partitionLayout: {
    // Dual-LUN device: LUN 0 internal flash (ECHO MINI FAT32) + LUN 1 SD
    // card slot (Echo SD ExFAT). Each LUN has its own partition table. v2
    // schema models this distinctly — v1 flattened both into one
    // `partitions[]` with an apologetic comment.
    //
    // LUN 0 source: `raw/diskutil.plist` + `raw/lsblk-lun0.json`.
    // LUN 1 source: `raw/diskutil-disk5.plist` + `raw/lsblk-lun1.json`.
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

  // VM only: 64 MiB FAT32 backing file synthesised inside the test VM
  // by `runners/lima-test-vm-backing-files.ts`. The real LUN 0 is 7.53 GB —
  // far too large to dump as a fixture — but the VM inquiry path only
  // needs a kernel-visible mass-storage LUN with a mountable FAT32. An
  // empty 64 MiB image satisfies that without representing the real device
  // verbatim. The starter content policy is empty filesystems; future
  // variants may seed marker files. LUN 1 (Echo SD card, ExFAT) is modelled
  // in `partitionLayout.luns[1]` but not in the backing-file synthesis — the
  // current `usb_f_mass_storage` runner stages a single LUN. Multi-LUN
  // gadget staging is a follow-up.
  // Synthesis label uses an underscore (`ECHO_MINI`) where the real device's
  // FAT volume label has a space (`ECHO MINI`, as reflected in
  // `stringDescriptors[1,2]` and `partitionLayout.luns[0].partitions[1].mountpoint`).
  // The deviation is intentional: keeps the synthesis recipe shell-quoting
  // simple and avoids assertion churn in `lima-test-vm-backing-files.test.ts`.
  // VM tests don't currently assert on the FAT volume label of the
  // synthesised gadget, so the divergence is invisible to consumers. If a
  // future test reads `lsblk -o LABEL` and pins the value, flip to `'ECHO MINI'`
  // and update the affected assertions.
  massStorageBackingFile: {
    synthesis: {
      sizeMiB: 64,
      filesystem: 'FAT32',
      label: 'ECHO_MINI',
    },
    resetStrategy: 'copy',
  },

  // Provisional — mirrors the built-in `echo-mini` preset capability shape.
  // Validate against production resolver / preset lookup in the compute-
  // expected pass.
  expectedCapabilities: {
    artworkSources: ['embedded'],
    artworkMaxResolution: 127,
    supportedAudioCodecs: ['aac', 'alac', 'mp3', 'flac', 'vorbis', 'wav'],
    supportsVideo: false,
    audioNormalization: 'none',
    supportsAlbumArtistBrowsing: true,
  },

  // Provisional — validate against production resolver in the compute-expected pass.
  expectedReadiness: {
    level: 'ready',
    stages: [],
  },

  expectedDoctorOutput: {},

  provenance: {
    provenanceDoc: './provenance.md',
    source: 'physical-capture',
  },
};
