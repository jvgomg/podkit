/**
 * @deprecated SysInfoExtended file I/O moved to `@podkit/ipod-firmware/sysinfo`
 * in P4 (TASK-295.01). New code should import from `@podkit/ipod-firmware`
 * directly. This shim is retained for back-compat and will be removed at the
 * m-8 milestone alongside the other libgpod-coupled bridge code.
 *
 * This shim also injects the `resolveModel` callback automatically so callers
 * continue to receive a populated `result.model` without updating their import
 * paths. `@podkit/ipod-firmware` itself cannot call `resolveIpodModel` directly
 * (it would create a circular package dependency — `@podkit/devices-ipod`
 * depends on `@podkit/ipod-firmware`), so model resolution is injected here.
 */

import { resolveIpodModel } from '@podkit/devices-ipod';
import {
  readSysInfoExtended as _readSysInfoExtended,
  ensureSysInfoExtended as _ensureSysInfoExtended,
} from '@podkit/ipod-firmware';

// Re-export types directly — these now originate in @podkit/device-types (for
// IpodModel) and @podkit/ipod-firmware (for the sysinfo-specific shapes).
export type { SysInfoExtendedResult, UsbDeviceAddress, ReadFromUsbFn } from '@podkit/ipod-firmware';

// Build the model resolver once — calls resolveIpodModel from @podkit/devices-ipod.
function defaultResolveModel(serialNumber: string) {
  return resolveIpodModel({ from: 'serial', serialNumber }) ?? undefined;
}

/**
 * Read and parse an existing SysInfoExtended file from an iPod.
 * Returns null if file doesn't exist or is empty.
 *
 * Wraps `@podkit/ipod-firmware` `readSysInfoExtended` and injects model
 * resolution so `result.model` is populated when the serial number is known.
 */
export function readSysInfoExtended(mountPoint: string): ReturnType<typeof _readSysInfoExtended> {
  return _readSysInfoExtended(mountPoint, defaultResolveModel);
}

/**
 * Ensure SysInfoExtended is present on an iPod's filesystem.
 *
 * Wraps `@podkit/ipod-firmware` `ensureSysInfoExtended` and injects model
 * resolution so `result.model` is populated when the serial number is known.
 *
 * @param mountPoint - iPod mount point (e.g., "/Volumes/iPod")
 * @param usbAddress - USB bus number and device address
 * @param readFromUsb - Optional USB reader function (for testing)
 */
export async function ensureSysInfoExtended(
  mountPoint: string,
  usbAddress: import('@podkit/ipod-firmware').UsbDeviceAddress,
  readFromUsb?: import('@podkit/ipod-firmware').ReadFromUsbFn
): Promise<import('@podkit/ipod-firmware').SysInfoExtendedResult> {
  return _ensureSysInfoExtended(mountPoint, usbAddress, readFromUsb, defaultResolveModel);
}

// writeSysInfoExtended is also available from ipod-firmware for callers that
// need direct write access (no wrapping needed — it's a pure file write).
export { writeSysInfoExtended } from '@podkit/ipod-firmware';
