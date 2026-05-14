/**
 * configfs USB-gadget choreography for the dummy-hcd daemon.
 *
 * Mirrors the same configfs sequence as `packages/virtual-ipod-server/
 * src/gadget.ts` but is otherwise independent — the user-facing virtual-
 * ipod-server is off-limits per AGENTS.md and ADR-016. The shape of the
 * configfs tree we build is:
 *
 *   /sys/kernel/config/usb_gadget/<gadgetName>/
 *     idVendor                = "0x05ac"
 *     idProduct               = "0x1209"
 *     bcdDevice               = "0x0001"
 *     bcdUSB                  = "0x0200"
 *     strings/0x409/serialnumber  = "<persona.serial>"
 *     strings/0x409/manufacturer  = "Apple Inc."  (or persona override)
 *     strings/0x409/product       = "iPod"        (or persona override)
 *     configs/c.1/
 *       strings/0x409/configuration = "<persona.description>"
 *       MaxPower                    = "500"
 *     functions/
 *       ffs.<gadgetName>/         (bound to FunctionFS via mount)
 *       mass_storage.0/lun.0/file = "<vmPath>"        (mass-storage only)
 *     configs/c.1/ffs.<gadgetName>           → symlink
 *     configs/c.1/mass_storage.0             → symlink (mass-storage only)
 *     UDC                       = "<first UDC>"      (bind)
 *
 * Operations are kept synchronous; configfs writes are local kernel
 * round-trips that block briefly and never spin.
 *
 * Read-only on macOS: every call shells out via `node:fs`, so importing
 * this module is safe at unit-test time. Only `bindGadget` and
 * `unbindGadget` actually touch the kernel.
 *
 * @see packages/virtual-ipod-server/src/gadget.ts (reference, not copied)
 * @module
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

import type { SidecarPersona } from '../../../../packages/device-testing/src/personas/sidecar.js';

/** Root of the configfs USB gadget tree on Linux. */
export const CONFIGFS_ROOT = '/sys/kernel/config/usb_gadget';

/** Inputs required to bind a gadget. */
export interface GadgetBindOpts {
  /** configfs directory name under `CONFIGFS_ROOT`. */
  name: string;
  /** Persona to bind from. */
  persona: SidecarPersona;
  /**
   * Whether to bind the FunctionFS function (`ffs.<name>`). Typically
   * `true` whenever the persona has `sysInfoExtendedXml`. Even mass-storage
   * personas can have FFS enabled simultaneously (e.g. for compound
   * iPod-style devices) — keep them as independent flags.
   */
  bindFfs: boolean;
  /**
   * Whether to bind the mass-storage function. Typically `true` whenever
   * the persona has `massStorageBackingFile` and the runner has staged the
   * image to its `vmPath`.
   */
  bindMassStorage: boolean;
}

/**
 * Materialise the configfs gadget directory tree for `opts.persona`. Does
 * NOT bind to a UDC — call `attachUdc` after the FunctionFS endpoints are
 * set up and `ep0` is ready.
 *
 * Idempotent: re-running on an existing gadget directory updates the leaves
 * and leaves the existing tree intact.
 */
export function createGadget(opts: GadgetBindOpts): { gadgetPath: string; ffsInstance: string } {
  const gadgetPath = `${CONFIGFS_ROOT}/${opts.name}`;
  const ffsInstance = opts.name;
  const { persona, bindFfs, bindMassStorage } = opts;

  mkdirSync(gadgetPath, { recursive: true });

  writeFileSync(`${gadgetPath}/idVendor`, persona.usbDescriptor.vendorId);
  writeFileSync(`${gadgetPath}/idProduct`, persona.usbDescriptor.productId);
  // bcdDevice / bcdUSB defaults match the Apple-iPod convention. The kernel
  // accepts decimal too but we mirror what the user-facing virtual-ipod-server
  // uses for parity.
  writeFileSync(`${gadgetPath}/bcdDevice`, '0x0001');
  writeFileSync(`${gadgetPath}/bcdUSB`, '0x0200');

  mkdirSync(`${gadgetPath}/strings/0x409`, { recursive: true });
  writeFileSync(
    `${gadgetPath}/strings/0x409/serialnumber`,
    persona.usbDescriptor.serial ?? '000000000001'
  );
  writeFileSync(
    `${gadgetPath}/strings/0x409/manufacturer`,
    persona.usbDescriptor.manufacturer ?? 'Apple Inc.'
  );
  writeFileSync(`${gadgetPath}/strings/0x409/product`, persona.usbDescriptor.product ?? 'iPod');

  mkdirSync(`${gadgetPath}/configs/c.1/strings/0x409`, { recursive: true });
  writeFileSync(`${gadgetPath}/configs/c.1/strings/0x409/configuration`, persona.description);
  writeFileSync(`${gadgetPath}/configs/c.1/MaxPower`, '500');

  if (bindFfs) {
    mkdirSync(`${gadgetPath}/functions/ffs.${ffsInstance}`, { recursive: true });
    ensureSymlink(
      `${gadgetPath}/functions/ffs.${ffsInstance}`,
      `${gadgetPath}/configs/c.1/ffs.${ffsInstance}`
    );
  }

  if (bindMassStorage) {
    const backing = persona.massStorageBackingFile;
    if (!backing) {
      throw new Error(
        `createGadget: persona "${persona.id}" has no massStorageBackingFile but bindMassStorage=true`
      );
    }
    mkdirSync(`${gadgetPath}/functions/mass_storage.0/lun.0`, { recursive: true });
    writeFileSync(`${gadgetPath}/functions/mass_storage.0/lun.0/file`, backing.vmPath);
    writeFileSync(`${gadgetPath}/functions/mass_storage.0/lun.0/removable`, '0');
    ensureSymlink(
      `${gadgetPath}/functions/mass_storage.0`,
      `${gadgetPath}/configs/c.1/mass_storage.0`
    );
  }

  return { gadgetPath, ffsInstance };
}

/**
 * Bind the gadget to the first available UDC, exposing the synthesised USB
 * device to the kernel's USB stack. Must be called AFTER the FunctionFS
 * descriptor handshake completes on ep0; binding before the descriptors are
 * written causes the kernel to STALL on enumeration.
 */
export function attachUdc(gadgetPath: string): string {
  const udcList = readdirSync('/sys/class/udc');
  const udc = udcList[0];
  if (!udc) throw new Error('attachUdc: no UDC available — is dummy_hcd loaded?');
  writeFileSync(`${gadgetPath}/UDC`, udc);
  return udc;
}

/**
 * Best-effort teardown of the configfs tree. Designed for signal handlers:
 * every step is wrapped in try/catch so a partial gadget never blocks the
 * daemon's exit path. Logs warnings via `onWarn` for visibility.
 */
export function destroyGadget(
  gadgetPath: string,
  ffsInstance: string,
  onWarn: (message: string) => void = () => {}
): void {
  tryWrite(`${gadgetPath}/UDC`, '', onWarn);
  tryUnlink(`${gadgetPath}/configs/c.1/ffs.${ffsInstance}`, onWarn);
  tryUnlink(`${gadgetPath}/configs/c.1/mass_storage.0`, onWarn);

  const removeDirs = [
    `${gadgetPath}/configs/c.1/strings/0x409`,
    `${gadgetPath}/configs/c.1`,
    `${gadgetPath}/functions/mass_storage.0/lun.0`,
    `${gadgetPath}/functions/mass_storage.0`,
    `${gadgetPath}/functions/ffs.${ffsInstance}`,
    `${gadgetPath}/strings/0x409`,
    gadgetPath,
  ];
  for (const dir of removeDirs) {
    tryRmdir(dir, onWarn);
  }
}

/** Inspect whether the gadget is currently bound to a UDC. */
export function isBound(gadgetPath: string): boolean {
  try {
    const udc = readFileSync(`${gadgetPath}/UDC`, 'utf-8').trim();
    return udc.length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function ensureSymlink(target: string, linkPath: string): void {
  if (existsSync(linkPath)) return;
  symlinkSync(target, linkPath);
}

function tryWrite(path: string, value: string, onWarn: (m: string) => void): void {
  try {
    writeFileSync(path, value);
  } catch (err) {
    onWarn(`destroyGadget: write ${path} failed: ${describe(err)}`);
  }
}

function tryUnlink(path: string, onWarn: (m: string) => void): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch (err) {
    onWarn(`destroyGadget: unlink ${path} failed: ${describe(err)}`);
  }
}

function tryRmdir(path: string, onWarn: (m: string) => void): void {
  try {
    if (existsSync(path)) rmdirSync(path);
  } catch (err) {
    onWarn(`destroyGadget: rmdir ${path} failed: ${describe(err)}`);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
