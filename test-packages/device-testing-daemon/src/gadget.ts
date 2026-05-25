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

import type { SidecarPersona } from '@podkit/device-testing';

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
 *
 * "Available" means: not currently claimed by another configfs gadget. The
 * authoritative signal is whichever gadget under `/sys/kernel/config/
 * usb_gadget/<g>/UDC` names it — an empty UDC file means the gadget is not
 * bound. We deliberately do NOT read `/sys/class/udc/<n>/state`: on
 * dummy_hcd that field latches at `configured` once any gadget has bound
 * the UDC and never goes back to `not attached`, even after an unbind. The
 * UDC file in configfs IS reset to empty on unbind, so it is the only
 * reliable source.
 *
 * The walk lets `dummy-hcd-daemon@<persona>.service` units start
 * sequentially under a `dummy_hcd num=N` (N > 1) kernel module: each
 * daemon picks the lowest-numbered free UDC without colliding on
 * `dummy_udc.0`. The read-then-write is NOT atomic — two daemons racing
 * the window could both pick the same UDC. Callers must serialise their
 * `systemctl start` invocations (the runner awaits each one in turn) to
 * stay safe.
 */
export function attachUdc(gadgetPath: string): string {
  const udcList = readdirSync('/sys/class/udc').sort();
  if (udcList.length === 0) {
    throw new Error('attachUdc: no UDC available — is dummy_hcd loaded?');
  }
  const claimed = collectClaimedUdcs(gadgetPath);
  for (const candidate of udcList) {
    if (claimed.has(candidate)) continue;
    writeFileSync(`${gadgetPath}/UDC`, candidate);
    return candidate;
  }
  throw new Error(
    `attachUdc: every UDC is already bound (${udcList.join(', ')}; claimed: ${Array.from(
      claimed
    ).join(', ')}). Increase dummy_hcd num= or stop the conflicting gadget.`
  );
}

/**
 * Walk `/sys/kernel/config/usb_gadget/*\/UDC` and collect the set of UDC
 * names already claimed by some other configfs gadget. Our own gadget at
 * `selfGadgetPath` is excluded — its UDC file should always be empty
 * before we bind, but skipping it makes the function safe to call from
 * scenarios where it isn't (e.g. a re-bind after a partial teardown).
 *
 * Returns an empty set on any read error: the caller's "no free UDC"
 * error then surfaces with the directory listing, which is more
 * actionable than a sysfs-walk traceback.
 */
function collectClaimedUdcs(selfGadgetPath: string): Set<string> {
  const claimed = new Set<string>();
  let gadgets: string[];
  try {
    gadgets = readdirSync(CONFIGFS_ROOT);
  } catch {
    return claimed;
  }
  for (const g of gadgets) {
    const fullPath = `${CONFIGFS_ROOT}/${g}`;
    if (fullPath === selfGadgetPath) continue;
    try {
      const udc = readFileSync(`${fullPath}/UDC`, 'utf-8').trim();
      if (udc.length > 0) claimed.add(udc);
    } catch {
      // Missing UDC file → not a gadget we own; skip.
    }
  }
  return claimed;
}

/**
 * Unbind the gadget from its UDC without removing the configfs tree.
 *
 * Writes an empty string to `<gadgetPath>/UDC`. The kernel emits
 * `FUNCTIONFS_UNBIND` on ep0 in response, which is what unblocks the
 * FunctionFS read loop in `functionfs.ts`. Splitting this step out of
 * `destroyGadget` lets the daemon's signal handler unbind first (so the
 * read loop drains) and remove the configfs tree afterwards (when the
 * `functions/ffs.*` directory is no longer busy).
 */
export function unbindGadget(
  gadgetPath: string,
  onWarn: (message: string) => void = () => {}
): void {
  tryWrite(`${gadgetPath}/UDC`, '', onWarn);
}

/**
 * Best-effort removal of the configfs tree. Idempotent and never throws:
 * every step is wrapped in try/catch so a partial gadget never blocks the
 * daemon's exit path. Logs warnings via `onWarn` for visibility.
 *
 * Callers should `unbindGadget()` first — rmdir on `functions/ffs.<name>`
 * fails with EBUSY while FunctionFS is still mounted, so the teardown
 * sequence is: unbind UDC → close + umount FunctionFS → destroy tree.
 *
 * `mass_storage.0/lun.0` is intentionally NOT rmdir'd directly: the
 * `usb_f_mass_storage` driver pins the implicit lun.0 to its parent
 * function and rejects the rmdir with EPERM. The parent `mass_storage.0`
 * rmdir removes lun.0 as part of its own teardown — leaving lun.0 in
 * the explicit removal list would log a spurious warning every shutdown
 * and (historically) leak the tree when callers misread the EPERM as
 * a hard failure. We do clear `lun.0/file` first to release the
 * backing-file open count cleanly.
 */
export function destroyGadget(
  gadgetPath: string,
  ffsInstance: string,
  onWarn: (message: string) => void = () => {}
): void {
  // Write UDC='' is idempotent — fine to call again if unbindGadget already did.
  tryWrite(`${gadgetPath}/UDC`, '', onWarn);
  tryUnlink(`${gadgetPath}/configs/c.1/ffs.${ffsInstance}`, onWarn);
  tryUnlink(`${gadgetPath}/configs/c.1/mass_storage.0`, onWarn);
  // Only present on mass-storage-bearing gadgets. Skip cleanly otherwise so
  // FFS-only personas don't log a spurious "no such file" warning.
  const lunFile = `${gadgetPath}/functions/mass_storage.0/lun.0/file`;
  if (existsSync(lunFile)) tryWrite(lunFile, '', onWarn);

  const removeDirs = [
    `${gadgetPath}/configs/c.1/strings/0x409`,
    `${gadgetPath}/configs/c.1`,
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
