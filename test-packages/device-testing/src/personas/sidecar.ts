/**
 * Persona sidecar — JSON serialisation of the persona registry consumed by
 * the FunctionFS daemon (`test-packages/device-testing-daemon/`).
 *
 * The `lima-test-vm` runner produces this sidecar during `prepare()` at a
 * known path inside the test VM (e.g. `/var/device-testing/personas.json`).
 * The daemon loads the file at startup, looks up the persona named on its
 * `--persona <id>` flag, and configures the USB gadget accordingly.
 *
 * The sidecar is intentionally **a strict subset** of the in-memory
 * `DevicePersona` schema. The daemon only needs three pieces of data:
 *
 *   1. The USB descriptor fields (vendor id, product id, strings) needed to
 *      bind the gadget via configfs.
 *   2. The SysInfoExtended XML payload to serve over the vendor control
 *      transfer (`bmRequestType=0xC0`, `bRequest=0x40`, `wValue=0x02`).
 *   3. The mass-storage backing-file path the runner has already staged.
 *
 * The fixture-only fields (`expectedCapabilities`, `expectedDoctorOutput`,
 * `provenance`, raw lsblk/system-profiler dumps, etc.) are deliberately
 * excluded — they belong to the host-side TypeScript layer and have no place
 * in the daemon binary.
 *
 * # Why this file has no `DevicePersona` import
 *
 * The dummy-hcd daemon (`test-packages/device-testing-daemon/`) consumes only
 * the sidecar schema; keeping this file dependency-free of the broader
 * `@podkit/device-testing` surface lets `bun build --compile` produce a
 * tight self-contained daemon binary. The producer-side helpers that
 * project a `DevicePersona` into a `SidecarPersona` live in `sidecar-build.ts`,
 * which is host-side only.
 *
 * @see adr/adr-017-device-persona-fixtures.md
 * @see test-packages/device-testing-daemon/README.md
 * @module
 */

/** Current sidecar schema version. Bump on every breaking change. */
export const SIDECAR_SCHEMA_VERSION = 1;

/** Top-level sidecar payload. */
export interface PersonaSidecarV1 {
  schemaVersion: 1;
  /**
   * Personas keyed by `DevicePersona.id`. The daemon receives the id via
   * `--persona <id>` and looks the entry up here.
   */
  personas: Record<string, SidecarPersona>;
}

/** A single persona entry in the sidecar — daemon-relevant fields only. */
export interface SidecarPersona {
  /** Same identifier as the TypeScript persona; allows reverse lookup. */
  id: string;
  /** Human-readable label (for daemon log lines + systemd journal). */
  description: string;
  /** USB descriptor written into configfs at gadget setup. */
  usbDescriptor: SidecarUsbDescriptor;
  /**
   * SysInfoExtended XML served over the vendor control transfer. Omitted
   * for personas that do not answer VPD 0xC0 (e.g. mass-storage DAPs).
   */
  sysInfoExtendedXml?: string;
  /**
   * Mass-storage backing file. When present, the daemon configures the
   * `usb_f_mass_storage` function with `lun0/file = vmPath`. Lifecycle
   * (staging the file, resetting between tests) is owned by the runner.
   */
  massStorageBackingFile?: SidecarMassStorageBackingFile;
}

/**
 * USB descriptor fields written into the gadget configfs tree.
 *
 * `vendorId` and `productId` are serialised as `"0xNNNN"` strings — configfs
 * accepts hex with the `0x` prefix and round-trips faithfully in JSON
 * without floating-point ambiguity. The other string fields are optional;
 * sensible defaults are applied by the daemon when omitted.
 */
export interface SidecarUsbDescriptor {
  /** USB vendor id as a hex string, e.g. `"0x05ac"`. */
  vendorId: string;
  /** USB product id as a hex string, e.g. `"0x1209"`. */
  productId: string;
  /** USB serial number string. */
  serial?: string;
  /** USB manufacturer string. */
  manufacturer?: string;
  /** USB product string. */
  product?: string;
  /** USB device class code (default `0`). */
  deviceClass?: number;
  /** USB device subclass code (default `0`). */
  deviceSubclass?: number;
  /** USB device protocol code (default `0`). */
  deviceProtocol?: number;
}

/** Mass-storage backing-file metadata. */
export interface SidecarMassStorageBackingFile {
  /** Absolute path inside the VM where the runner staged the FAT32 image. */
  vmPath: string;
  /** Reset strategy the runner uses between tests. The daemon only reads it for logging. */
  resetStrategy: 'copy' | 'swap';
}

// ---------------------------------------------------------------------------
// Serialise / parse — pure-data helpers usable from both sides of the seam.
// ---------------------------------------------------------------------------

/** Serialise a sidecar payload to a stable JSON string (pretty-printed). */
export function serializeSidecar(sidecar: PersonaSidecarV1): string {
  return JSON.stringify(sidecar, null, 2) + '\n';
}

/**
 * Parse a sidecar JSON string. Throws a descriptive `Error` if the payload
 * is malformed or the schema version does not match.
 */
export function parseSidecar(json: string): PersonaSidecarV1 {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new Error(`parseSidecar: invalid JSON (${cause})`);
  }
  if (!isRecord(raw)) {
    throw new Error('parseSidecar: expected a JSON object at top level');
  }
  if (raw.schemaVersion !== SIDECAR_SCHEMA_VERSION) {
    throw new Error(
      `parseSidecar: schemaVersion ${String(raw.schemaVersion)} is not supported (expected ${SIDECAR_SCHEMA_VERSION})`
    );
  }
  if (!isRecord(raw.personas)) {
    throw new Error('parseSidecar: `personas` must be an object keyed by persona id');
  }
  const personas: Record<string, SidecarPersona> = {};
  for (const [id, entry] of Object.entries(raw.personas)) {
    personas[id] = validateSidecarPersona(id, entry);
  }
  return { schemaVersion: SIDECAR_SCHEMA_VERSION, personas };
}

/** Parse a hex string (`"0x05ac"`) into a number. Throws on malformed input. */
export function parseHexId(value: string): number {
  if (!isHexString(value)) {
    throw new Error(`parseHexId: not a hex string: ${value}`);
  }
  return parseInt(value.slice(2), 16);
}

/** Format a number as a four-digit, zero-padded, lowercase hex string. */
export function toHex16(n: number): string {
  return `0x${n.toString(16).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Internal helpers (exported for sidecar-build.ts's reuse)
// ---------------------------------------------------------------------------

function validateSidecarPersona(id: string, raw: unknown): SidecarPersona {
  if (!isRecord(raw)) {
    throw new Error(`parseSidecar: persona "${id}" is not an object`);
  }
  if (typeof raw.id !== 'string' || raw.id !== id) {
    throw new Error(`parseSidecar: persona "${id}" has mismatched id field`);
  }
  if (typeof raw.description !== 'string') {
    throw new Error(`parseSidecar: persona "${id}" has missing/invalid description`);
  }
  if (!isRecord(raw.usbDescriptor)) {
    throw new Error(`parseSidecar: persona "${id}" has missing/invalid usbDescriptor`);
  }
  const usb = raw.usbDescriptor;
  if (typeof usb.vendorId !== 'string' || !isHexString(usb.vendorId)) {
    throw new Error(`parseSidecar: persona "${id}" usbDescriptor.vendorId is not a hex string`);
  }
  if (typeof usb.productId !== 'string' || !isHexString(usb.productId)) {
    throw new Error(`parseSidecar: persona "${id}" usbDescriptor.productId is not a hex string`);
  }
  const out: SidecarPersona = {
    id,
    description: raw.description,
    usbDescriptor: {
      vendorId: usb.vendorId,
      productId: usb.productId,
    },
  };
  if (typeof usb.serial === 'string') out.usbDescriptor.serial = usb.serial;
  if (typeof usb.manufacturer === 'string') out.usbDescriptor.manufacturer = usb.manufacturer;
  if (typeof usb.product === 'string') out.usbDescriptor.product = usb.product;
  if (typeof usb.deviceClass === 'number') out.usbDescriptor.deviceClass = usb.deviceClass;
  if (typeof usb.deviceSubclass === 'number') out.usbDescriptor.deviceSubclass = usb.deviceSubclass;
  if (typeof usb.deviceProtocol === 'number') out.usbDescriptor.deviceProtocol = usb.deviceProtocol;

  if (typeof raw.sysInfoExtendedXml === 'string') {
    out.sysInfoExtendedXml = raw.sysInfoExtendedXml;
  }
  if (isRecord(raw.massStorageBackingFile)) {
    const mb = raw.massStorageBackingFile;
    if (typeof mb.vmPath !== 'string') {
      throw new Error(`parseSidecar: persona "${id}" massStorageBackingFile.vmPath missing`);
    }
    if (mb.resetStrategy !== 'copy' && mb.resetStrategy !== 'swap') {
      throw new Error(
        `parseSidecar: persona "${id}" massStorageBackingFile.resetStrategy must be 'copy' or 'swap'`
      );
    }
    out.massStorageBackingFile = { vmPath: mb.vmPath, resetStrategy: mb.resetStrategy };
  }
  return out;
}

function isHexString(s: string): boolean {
  return /^0x[0-9a-fA-F]+$/.test(s);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
