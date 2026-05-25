/**
 * Persona sidecar builder — host-side projection of in-memory `DevicePersona`
 * objects into the wire-shape consumed by the FunctionFS daemon.
 *
 * This module is intentionally separated from `sidecar.ts`:
 *
 *   - `sidecar.ts` is the pure schema + parser/serialiser. It has no
 *     `DevicePersona` import and is therefore safe to compile from outside
 *     the `@podkit/device-testing` workspace (the dummy-hcd daemon does
 *     exactly this).
 *   - `sidecar-build.ts` (this file) imports `DevicePersona` and projects
 *     instances into `SidecarPersona`. Used only by the `lima-test-vm`
 *     runner during `prepare()` and by unit tests inside this package.
 *
 * @module
 */

import type { DevicePersona } from './types.js';
import {
  SIDECAR_SCHEMA_VERSION,
  toHex16,
  type PersonaSidecarV1,
  type SidecarPersona,
} from './sidecar.js';

/**
 * Build a sidecar payload from a registry of in-memory `DevicePersona`s.
 *
 * Personas missing **both** `sysInfoExtendedXml` and `massStorageBackingFile`
 * are silently skipped — the daemon has no role to play for them. The runner
 * receives a smaller payload as a result.
 *
 * The optional `backingFilePath` map supplies the VM-side path the runner
 * staged the FAT32 image to (the in-memory persona only knows about the
 * host-relative `imagePath`). Personas with a `massStorageBackingFile` but
 * no entry in `backingFilePath` are emitted without the backing-file block.
 */
export function buildSidecar(
  personas: Iterable<DevicePersona>,
  backingFilePath: Map<string, string> = new Map()
): PersonaSidecarV1 {
  const out: PersonaSidecarV1 = {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    personas: {},
  };
  for (const persona of personas) {
    const entry = toSidecarPersona(persona, backingFilePath.get(persona.id));
    if (entry === null) continue;
    out.personas[persona.id] = entry;
  }
  return out;
}

/**
 * Project a single in-memory `DevicePersona` to its sidecar form. Returns
 * `null` for personas the daemon has nothing to do with.
 */
export function toSidecarPersona(
  persona: DevicePersona,
  backingFileVmPath?: string
): SidecarPersona | null {
  const hasXml =
    typeof persona.sysInfoExtendedXml === 'string' && persona.sysInfoExtendedXml.length > 0;
  const hasBacking = persona.massStorageBackingFile !== null && backingFileVmPath !== undefined;
  if (!hasXml && !hasBacking) return null;

  const out: SidecarPersona = {
    id: persona.id,
    description: persona.description,
    usbDescriptor: {
      vendorId: toHex16(persona.usbDescriptor.vendorId),
      productId: toHex16(persona.usbDescriptor.productId),
      deviceClass: persona.usbDescriptor.deviceClass,
      deviceSubclass: persona.usbDescriptor.deviceSubclass,
      deviceProtocol: persona.usbDescriptor.deviceProtocol,
    },
  };
  // `deviceSerial` is nullable (v2 schema). Four Sony personas (NW-HD5,
  // NW-A1000, NW-A1200, NW-A3000) advertise `iSerialNumber = 0` and
  // currently set this to `null`. The sidecar's `serial` field is
  // optional — omit it entirely rather than serialising `null` so the
  // daemon's optional-string semantics (apply a default of
  // `'000000000001'`) take effect.
  if (persona.usbDescriptor.deviceSerial !== null) {
    out.usbDescriptor.serial = persona.usbDescriptor.deviceSerial;
  }
  if (hasXml) {
    out.sysInfoExtendedXml = persona.sysInfoExtendedXml as string;
  }
  if (hasBacking) {
    out.massStorageBackingFile = {
      vmPath: backingFileVmPath as string,
      resetStrategy: persona.massStorageBackingFile!.resetStrategy,
    };
  }
  return out;
}
