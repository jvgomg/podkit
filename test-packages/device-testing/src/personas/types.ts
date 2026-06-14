/**
 * DevicePersona — a typed fixture describing a single device under test.
 *
 * Schema mirrors ADR-017 §"DevicePersona schema". Consumed in two places:
 *
 * - **Unit tests** import the TypeScript object directly and feed
 *   its fields into injectable fakes (`FakeUsbBinding`, hand-rolled `SubprocessRunner` stubs).
 * - **VM tests** receive a JSON serialisation of the same object via
 *   the lima-test-vm runner; the FunctionFS daemon then replays the USB
 *   descriptors, VPD payload, and partition layout.
 *
 * # Schema version 3 (2026-05-25)
 *
 * Removed three expectation fields — `expectedCapabilities`,
 * `expectedReadiness`, `expectedDoctorOutput` — from the persona schema.
 * Expectations now live in
 * `@podkit/e2e-vm-tests/src/expectations/<persona-id>.ts`, keyed by persona
 * id. A persona is now purely "the inputs the harness presents to podkit";
 * what podkit should produce in response is a test-side concern.
 *
 * Migration: every persona dropped the three fields. Tests previously
 * asserting against `persona.expected*` now import the expectation map.
 *
 * See `adr/adr-017-device-persona-fixtures.md` §"Schema v3 — May 2026".
 *
 * # Schema version 2 (2026-05-23)
 *
 * Three coordinated changes versus v1. See
 * `adr/adr-017-device-persona-fixtures.md` §"Schema v2 — May 2026".
 *
 *   1. `usbDescriptor` extended from a flat device-level record to the full
 *      USB descriptor tree: device descriptor + configurations[] + interfaces[]
 *      + endpoints[] + stringDescriptors. The flat-only schema could describe
 *      "a device exists" but could not drive a FunctionFS daemon to synthesise
 *      a believable gadget (Mass Storage class `0x08` lives on the
 *      **interface** descriptor, not the device descriptor — every iPod and
 *      every Sony Walkman exposes `deviceClass=0` because they are composite
 *      devices).
 *   2. `partitionLayout` reshaped from a flat `partitions[]` array to
 *      `{ luns: Array<{ lun, partitions[] }> }`. Echo Mini is a dual-LUN
 *      device (internal FAT32 firmware + SD-card ExFAT slot); v1 flattened
 *      both into one array with an apologetic comment. Future multi-LUN
 *      devices (Sony Walkman variants, SD-plus-internal DAPs) hit the same
 *      issue.
 *   3. `usbDescriptor.deviceSerial` is now `string | null`. Sony NW-HD5
 *      advertises `iSerialNumber = 0` (no serial-descriptor index). v1 used
 *      `''` as a workaround; `null` makes the absence semantically explicit
 *      and avoids the `if (persona.deviceSerial)` empty-string-as-falsy
 *      footgun.
 *
 * Per ADR-017 §"Schema versioning", schema bumps are coordinated commits
 * across the whole registry as a single coordinated commit.
 *
 * @see adr/adr-017-device-persona-fixtures.md
 * @module
 */

/**
 * USB endpoint descriptor — `struct usb_endpoint_descriptor` (USB 2.0 §9.6.6).
 *
 * Captures the fields the FunctionFS daemon and the inquiry pipeline need to
 * reason about transfer direction, type, and packet sizing. Bulk endpoints
 * dominate the iPod / mass-storage population; control transfers on ep0 are
 * implicit and not modelled here.
 */
export interface UsbEndpointDescriptor {
  /**
   * Endpoint address byte. Bit 7 = direction (1 = IN, 0 = OUT); bits 3-0 =
   * endpoint number. Example: `0x81` = IN, endpoint 1.
   */
  bEndpointAddress: number;
  /**
   * Endpoint attributes byte. Bits 1-0 = transfer type
   * (0 = control, 1 = isochronous, 2 = bulk, 3 = interrupt). Mass Storage
   * uses bulk (`0x02`).
   */
  bmAttributes: number;
  /** Maximum packet size in bytes (USB 2.0 hi-speed bulk = `512`, full-speed = `64`). */
  wMaxPacketSize: number;
  /** Polling interval in frames (bulk endpoints typically `0`). */
  bInterval: number;
}

/**
 * USB interface descriptor — `struct usb_interface_descriptor` (USB 2.0 §9.6.5).
 *
 * For composite devices like the iPod and Echo Mini, the device-level class
 * fields are all `0` and the actual functional class (e.g. Mass Storage `0x08`)
 * lives on this descriptor. Devices that expose multiple functions (mass
 * storage + iAP for iPods, mass storage + UAC for the Echo Mini headphone
 * out) ship one interface descriptor per function.
 */
export interface UsbInterfaceDescriptor {
  /** Interface number within the configuration (0-based). */
  bInterfaceNumber: number;
  /** Alternate setting index (almost always `0`; isochronous bandwidth-switching uses non-zero). */
  bAlternateSetting: number;
  /** USB class code (`0x08` = Mass Storage, `0x01` = Audio, `0xFF` = vendor). */
  bInterfaceClass: number;
  /** Subclass code (Mass Storage: `0x06` = SCSI transparent). */
  bInterfaceSubClass: number;
  /** Protocol code (Mass Storage: `0x50` = Bulk-Only Transport). */
  bInterfaceProtocol: number;
  /** Endpoint descriptors for this interface. */
  endpoints: UsbEndpointDescriptor[];
}

/**
 * USB configuration descriptor — `struct usb_config_descriptor` (USB 2.0 §9.6.3).
 *
 * Most devices ship a single configuration; iPods historically expose two
 * (one bus-powered, one self-powered) although the host only ever activates
 * one at a time. macOS `ioreg` shows the active configuration; Linux sysfs
 * `bNumConfigurations` shows the descriptor-table count.
 */
export interface UsbConfigurationDescriptor {
  /** Configuration value the host writes to `SET_CONFIGURATION` to activate this configuration. */
  bConfigurationValue: number;
  /** Number of interfaces in this configuration. Must equal `interfaces.length`. */
  bNumInterfaces: number;
  /**
   * Configuration attributes byte. Bit 6 = self-powered, bit 5 = remote
   * wakeup. Bit 7 is reserved and always 1 (legacy).
   */
  bmAttributes: number;
  /** Maximum bus current in 2 mA units (`0xFA` = 500 mA, USB 2.0 limit). */
  bMaxPower: number;
  /** Interface descriptors for this configuration. */
  interfaces: UsbInterfaceDescriptor[];
}

/**
 * USB device descriptor + descriptor hierarchy.
 *
 * Replaces the v1 flat shape, which only held device-level fields. The full
 * hierarchy is required to drive the FunctionFS daemon and to make
 * interface-class assertions (Mass Storage vs Audio vs vendor) correct.
 *
 * Captured from `cat /sys/bus/usb/devices/<n>/...` on Linux and from
 * `ioreg -p IOUSB -l` on macOS. The `provenance.md` next to each persona
 * records which fields came from which source.
 */
export interface UsbDescriptor {
  // --- Device descriptor (USB 2.0 §9.6.1) ---

  /** USB vendor ID (e.g. `0x05ac` for Apple). */
  vendorId: number;
  /** USB product ID (e.g. `0x1261` for iPod classic 7G). */
  productId: number;
  /**
   * Device serial number as reported by the USB serial-number string
   * descriptor. `null` when `iSerialNumber = 0` in the device descriptor —
   * i.e. the device declares no serial. Empty strings are NOT used as a
   * sentinel (the `if (persona.deviceSerial)` footgun).
   *
   * Examples of `null`-serial devices: Sony NW-HD5 (iSerialNumber = 0).
   */
  deviceSerial: string | null;
  /**
   * USB device class code. `0` for composite devices — the actual class
   * lives on the interface descriptor in {@link UsbConfigurationDescriptor.interfaces}.
   */
  deviceClass: number;
  /** USB device subclass code (typically `0` on composite devices). */
  deviceSubclass: number;
  /** USB device protocol code (typically `0` on composite devices). */
  deviceProtocol: number;
  /**
   * Maximum packet size for endpoint 0 (control endpoint). `8`, `16`,
   * `32`, or `64` per USB 2.0; high-speed devices always `64`.
   */
  bMaxPacketSize0: number;
  /** USB release number in BCD (`0x0200` = USB 2.0, `0x0210` = USB 2.1). */
  bcdUSB: number;
  /** Device release number in BCD, vendor-defined. */
  bcdDevice: number;
  /**
   * Number of configurations in the descriptor table. Must equal
   * `configurations.length`. iPod nano 3G reports `2` (Linux sysfs); macOS
   * `ioreg` shows only the active config and reports `1`. Both are
   * correct — descriptor count vs active-config count.
   */
  bNumConfigurations: number;

  // --- Configuration / interface / endpoint tree ---

  /** Configuration descriptors. Length must equal `bNumConfigurations`. */
  configurations: UsbConfigurationDescriptor[];

  /**
   * String descriptor table keyed by descriptor index. Index `0` is the
   * language-id descriptor (omitted here); indices `1`+ are UTF-16
   * application strings (manufacturer, product, serial, configuration
   * names, interface names). When a string is not captured, omit the
   * index rather than emitting an empty string.
   */
  stringDescriptors: Record<number, string>;
}

/**
 * One partition within a LUN. v2 carries the same fields v1 did — only the
 * containing shape changed.
 */
export interface PartitionEntry {
  /** 1-based partition index within the LUN's partition table. */
  index: number;
  /**
   * Partition type label, e.g. `"FAT32"`, `"HFS+"`, `"firmware"`, `"empty"`.
   * Human-readable label preferred over the raw filesystem identifier
   * (`Apple_HFS`, `DOS_FAT_32`, etc.); document any non-obvious mapping
   * in the persona's `provenance.md`.
   */
  type: string;
  /** Partition size in MiB. */
  sizeMiB: number;
  /** Mountpoint as observed during capture, when the OS auto-mounted the partition. */
  mountpoint?: string;
}

/**
 * Partitions hosted on a single mass-storage LUN. Single-LUN devices (every
 * iPod, every Sony Walkman) expose `{ lun: 0, partitions: [...] }`; multi-LUN
 * devices (Echo Mini, SD-card-plus-internal DAPs) expose one entry per LUN.
 *
 * **LUN numbering:** matches what the device advertises (typically 0-based
 * sequential). The runner uses this index to address the right
 * `usb_f_mass_storage` LUN when staging backing files in VM tests.
 */
export interface LunPartitionLayout {
  /** 0-based LUN index. Single-LUN devices use `0`. */
  lun: number;
  /** Partition table on this LUN. Empty for devices that expose no partition table. */
  partitions: PartitionEntry[];
}

/**
 * Synthesis recipe for a mass-storage backing file.
 *
 * Used when no pre-built image is committed (e.g. echo-mini's real LUN 0 is
 * 7.5 GB — far too large to commit as a fixture). The runner builds the
 * image inside the VM via `truncate` + `mkfs.vfat --invariant`, which is
 * byte-deterministic across runs against the same `(sizeMiB, label,
 * initialContent)` triple.
 *
 * # HFS+ synthesis (`filesystem: 'HFS+'`)
 *
 * Used by the HFS+-on-Linux refusal scenario. The image is built on the
 * HOST via a pure-TypeScript HFS+ Volume Header writer
 * (`runners/hfsplus-image-writer.ts`) and `limactl copy`'d into the VM —
 * `hfsprogs` is unpackaged on arm64 in Debian bookworm, so an in-VM
 * `mkfs.hfsplus` path is impossible. Output is a sparse file (~4 KiB
 * on-disk for a declared 32 MiB image); the only on-disk content is the
 * 512-byte Volume Header at offset 1024. blkid identifies it as
 * `hfsplus` from the on-disk magic alone — no mount, no userspace tool,
 * no kernel module. `initialContent` is rejected for HFS+ (the only
 * consumer reads the volume header, never the data area); the `label`
 * field is accepted for schema-symmetry with FAT32 but is unused — the
 * HFS+ writer does not embed a volume name.
 *
 * See `test-packages/device-testing/scripts/build-backing-file.ts`.
 */
export interface MassStorageBackingFileRecipe {
  sizeMiB: number;
  filesystem: 'FAT32' | 'FAT16' | 'HFS+';
  /**
   * Volume label.
   *
   * - FAT32 / FAT16: up to 11 chars, ASCII, uppercase. Passed to
   *   `mkfs.vfat -n <label>` during synthesis. Required because the label
   *   is part of what makes the image byte-deterministic.
   * - HFS+: accepted for schema symmetry but UNUSED. The host-side TS
   *   writer only writes the HFS+ Volume Header; the volume name lives in
   *   the catalog file, which we don't synthesise. The validator does NOT
   *   enforce FAT label rules on HFS+ personas — any label (including
   *   spaces / Unicode / longer strings) is accepted.
   */
  label: string;
  initialContent?: Array<{ path: string; sourceFixture: string }>;
}

/**
 * Mass-storage backing file metadata.
 *
 * Exactly one of `imagePath` or `synthesis` is required:
 *
 *   - `imagePath`  — host-relative path to a pre-built image (committed
 *     binary). The runner `limactl copy`s it into the VM.
 *   - `synthesis`  — recipe the runner uses to build the image in-VM via
 *     `truncate` + `mkfs.vfat --invariant`. No host binary needed.
 *
 * The "exactly one" constraint is enforced by runtime callers
 * (`runners/lima-test-vm-backing-files.ts`); the type allows both as
 * optional so existing callers can test `if (backing.synthesis)` /
 * `if (backing.imagePath)` directly. A future cleanup may tighten this into
 * a proper discriminated union once the runner is fully migrated.
 *
 * `null` for personas that do not use the `usb_f_mass_storage` function
 * (iPod personas use FunctionFS vendor control transfers instead).
 */
export interface MassStorageBackingFile {
  /** Path to a pre-built FAT32 image file relative to this persona's directory. */
  imagePath?: string;
  /** Synthesis recipe (used when no pre-built image is committed). */
  synthesis?: MassStorageBackingFileRecipe;
  /** Reset strategy between tests: `copy` (re-copy from reference) or `swap` (atomic rename). */
  resetStrategy: 'copy' | 'swap';
}

/**
 * Stable, registry-keyed fixture describing one device under test.
 */
export interface DevicePersona {
  /** Stable identifier used in test assertions and the daemon's --persona flag. */
  id: string;
  /** Human-readable label for error messages and logs. */
  description: string;
  /**
   * Schema version. Current: `3` (see module-level TSDoc for the v2 → v3
   * migration notes — expectations lifted to `@podkit/e2e-vm-tests`). Bump
   * on any breaking field change and update every persona in the same
   * commit per ADR-017 §"Schema versioning".
   */
  schemaVersion: 3;

  // --- USB layer -------------------------------------------------------------

  /** USB device descriptor + the full configuration/interface/endpoint hierarchy. */
  usbDescriptor: UsbDescriptor;

  // --- SCSI / firmware layer -------------------------------------------------

  /** Raw XML payload returned by SCSI VPD page 0xC0 (SysInfoExtended). `null` for devices that don't answer VPD 0xC0. */
  sysInfoExtendedXml: string | null;

  // --- Host OS probe layer ---------------------------------------------------

  /** Canned output of `lsblk -J` for this device (Linux). */
  lsblkJson: object | null;
  /** Canned output of `system_profiler SPUSBDataType -json` (macOS). */
  systemProfilerJson: object | null;
  /** Canned output of `diskutil list -plist` (macOS). */
  diskutilPlist: string | null;

  // --- Filesystem ------------------------------------------------------------

  /**
   * Partition tables for each mass-storage LUN the device exposes.
   *
   * Single-LUN devices (every iPod, every Sony Walkman) ship one entry with
   * `lun: 0`. Multi-LUN devices (Echo Mini: internal FAT32 + SD-card ExFAT)
   * ship one entry per LUN. The runner uses LUN indices to address the
   * matching `usb_f_mass_storage` LUN in VM tests.
   */
  partitionLayout: {
    luns: LunPartitionLayout[];
  };

  // --- Mass storage backing file (optional) ----------------------------------

  /**
   * Describes the FAT32 backing file for mass-storage personas.
   *
   * When set, the lima-test-vm runner stages this image as the
   * `usb_f_mass_storage` backing file. `null` for iPod personas (which use
   * FunctionFS vendor control transfers instead).
   *
   * Either `imagePath` (committed binary image) or `synthesis` (in-VM
   * recipe) — see {@link MassStorageBackingFile} for the discriminated union.
   */
  massStorageBackingFile: MassStorageBackingFile | null;

  // --- Provenance ------------------------------------------------------------

  provenance: {
    /** Path to provenance.md that links capture session and hardware serial. */
    provenanceDoc: string;
    /** Whether this persona was captured from physical hardware or synthesised. */
    source: 'physical-capture' | 'synthesised';
  };
}
