/**
 * USB inquiry shim — transitional P1 implementation
 *
 * Delegates to `@podkit/libgpod-node`'s `readSysInfoExtendedFromUsb` binding.
 * The external interface is stable: the P2 FFI implementation (TypeScript-native
 * libusb via koffi) will satisfy the same signature without changes to callers.
 *
 * @module
 */

import type { UsbFingerprint } from '@podkit/device-types';

// ---------------------------------------------------------------------------
// Dependency-injection interface
// ---------------------------------------------------------------------------

/**
 * The subset of `@podkit/libgpod-node` used by this module.
 * Expressed as a named interface so tests can supply a mock without
 * importing the native binding (which requires a compiled `.node` file).
 */
export interface LibgpodReader {
  /**
   * Read SysInfoExtended XML from an iPod via USB vendor control transfer.
   *
   * @param busNumber - USB bus number.
   * @param deviceAddress - USB device address on the bus.
   * @returns XML string, or `null` if the read fails.
   */
  readSysInfoExtendedFromUsb(busNumber: number, deviceAddress: number): string | null;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface UsbReadOptions {
  /**
   * Override default timeout in milliseconds.
   *
   * Currently ignored — libgpod-node's libusb binding does not expose a
   * timeout parameter. This option will be honored in the P2 FFI
   * implementation when the USB inquiry is rewritten as TypeScript-native
   * koffi/libusb code.
   */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Production reader (lazy-loaded to avoid hard dep on native bindings)
// ---------------------------------------------------------------------------

/**
 * Lazily resolve the production `LibgpodReader` from `@podkit/libgpod-node`.
 * Returns `null` when native bindings are unavailable (CI without `.node`
 * file, non-libusb platforms, etc.).
 */
async function getDefaultReader(): Promise<LibgpodReader | null> {
  try {
    const libgpod = await import('@podkit/libgpod-node');
    if (typeof libgpod.isNativeAvailable === 'function' && !libgpod.isNativeAvailable()) {
      return null;
    }
    if (typeof libgpod.readSysInfoExtendedFromUsb === 'function') {
      return libgpod as LibgpodReader;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read SysInfoExtended XML from an iPod via USB inquiry (libusb path).
 *
 * Transitional implementation in P1 — delegates to libgpod-node. P2 will
 * replace the binding with a TypeScript-native libusb FFI implementation;
 * the function signature stays stable across the swap.
 *
 * @param fp - USB fingerprint of the target device.
 * @param opts - Optional read options (see {@link UsbReadOptions}).
 * @param _reader - Injectable `LibgpodReader` (defaults to libgpod-node).
 *   Pass a mock here in tests to avoid loading the native binding.
 * @returns Raw bytes of the SysInfoExtended XML payload.
 * @throws Error from libgpod-node bubbled with original message preserved.
 */
export async function readUsbInquiry(
  fp: UsbFingerprint,
  opts?: UsbReadOptions,
  _reader?: LibgpodReader
): Promise<Uint8Array> {
  // opts.timeoutMs is accepted for interface stability but not forwarded in P1.
  void opts;

  const reader = _reader ?? (await getDefaultReader());

  if (!reader) {
    throw new Error('USB inquiry unavailable: native libgpod-node bindings could not be loaded.');
  }

  // Errors from readSysInfoExtendedFromUsb propagate unchanged — no wrapping.
  const result = reader.readSysInfoExtendedFromUsb(fp.bus, fp.devnum);

  if (result === null) {
    throw new Error(`USB inquiry returned null for device at bus=${fp.bus} devnum=${fp.devnum}`);
  }

  return new TextEncoder().encode(result);
}
