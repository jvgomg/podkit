/**
 * Firmware inquiry orchestrator
 *
 * Single deep entry point for iPod firmware inquiry. Attempts USB inquiry
 * first (via the libgpod-node shim) and falls back to SCSI if USB fails.
 * Both transports can be overridden for testing.
 *
 * @module
 */

import type { UsbFingerprint, ParsedFirmware } from '@podkit/device-types';

/** Options forwarded to a transport invocation. */
export interface TransportOptions {
  /** Per-call timeout override in milliseconds. */
  timeoutMs?: number;
}

/**
 * A transport function that performs SCSI inquiry and returns the raw
 * SysInfoExtended XML payload as bytes.
 */
export type ScsiTransport = (fp: UsbFingerprint, opts?: TransportOptions) => Promise<Uint8Array>;

/**
 * A transport function that performs USB inquiry and returns the raw
 * SysInfoExtended XML payload as bytes.
 */
export type UsbTransport = (fp: UsbFingerprint, opts?: TransportOptions) => Promise<Uint8Array>;

/** Options for `inquireFirmware`. */
export interface InquireOptions {
  /**
   * Override the default transports. Primarily useful for testing.
   * If omitted, the production transports are used (USB via libgpod-node,
   * SCSI via koffi/IOKit or SG_IO).
   */
  transports?: {
    scsi?: ScsiTransport;
    usb?: UsbTransport;
  };
  /** Per-transport timeout override in milliseconds. Forwarded to each transport. */
  timeoutMs?: number;
}

/**
 * Inquire the connected iPod's firmware capabilities via USB or SCSI.
 *
 * Attempts USB inquiry first. If USB inquiry fails or is unavailable,
 * falls back to SCSI inquiry. Returns `null` if both transports fail
 * or the device does not respond with a parseable SysInfoExtended payload.
 *
 * @param fp - USB fingerprint of the target device.
 * @param opts - Optional transport overrides.
 * @returns Parsed firmware data, or `null` on failure.
 */
export async function inquireFirmware(
  fp: UsbFingerprint,
  opts?: InquireOptions
): Promise<ParsedFirmware | null> {
  // TODO: implement in TASK-292.05 (inquiry orchestrator)
  void fp;
  void opts;
  throw new Error('not implemented in P1.1');
}
