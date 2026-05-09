/**
 * Firmware inquiry orchestrator
 *
 * Single deep entry point for iPod firmware inquiry. Probes available
 * transports, attempts USB inquiry first (richer data on 5G+ devices),
 * and falls back to SCSI if USB fails or is unavailable. Both transports
 * can be overridden for testing.
 *
 * ## Method-selection rules
 *
 * 1. USB is preferred when both transports are available — it returns more
 *    fields (full video codec list, `ImageSpecifications2`, etc.) than SCSI
 *    on iPod 5G and later.
 * 2. A USB transport _failure_ (transport throws) silently falls through to
 *    SCSI. The user only sees the final outcome.
 * 3. A USB transport _success_ that returns bytes which fail to parse does
 *    NOT trigger SCSI fallback. A device that returned bytes is reachable;
 *    the bytes failing to parse is a different problem (corrupt firmware,
 *    truncated transfer, encoding mismatch) than a transport failure, and
 *    silently re-querying via SCSI would hide the real issue. We return
 *    `null` instead.
 * 4. If both methods fail at the transport layer, return `null` — the
 *    orchestrator never throws. Callers branch on `null` for "could not
 *    inquire" and a populated `ParsedFirmware` for success.
 *
 * @module
 */

import type { UsbFingerprint, ParsedFirmware } from '@podkit/device-types';
import { emit } from '../logger.js';
import { extractFromPlist } from '../firmware/extract.js';
import { parsePlist } from '../plist/parser.js';
import {
  probeInquiryMethods,
  type InquiryMethodsAvailability,
  type ProbeOptions,
} from './probe.js';
import { scsiReadVpdPages } from './scsi/index.js';
import { readUsbInquiry } from './usb.js';
import { chooseTransports, type SelectionPlan } from './selection.js';

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
   * If omitted, the production transports are used (USB via libusb FFI,
   * SCSI via koffi/IOKit or SG_IO).
   */
  transports?: {
    scsi?: ScsiTransport;
    usb?: UsbTransport;
  };
  /** Per-transport timeout override in milliseconds. Forwarded to each transport. */
  timeoutMs?: number;
  /**
   * Override the probe step. If supplied, this exact availability snapshot is
   * used and `probeInquiryMethods()` is not called. Primarily useful for tests
   * that want deterministic plan dispatch without touching the FS or native
   * bindings.
   */
  availability?: InquiryMethodsAvailability;
  /**
   * Probe overrides used when {@link availability} is not supplied. Forwarded
   * directly to {@link probeInquiryMethods}. Primarily useful for tests.
   */
  probeOptions?: ProbeOptions;
}

// Default production transports — defined module-scoped so they can be replaced
// piecemeal by injection.
const defaultUsbTransport: UsbTransport = (fp, opts) =>
  readUsbInquiry(fp, opts ? { timeoutMs: opts.timeoutMs } : undefined);

const defaultScsiTransport: ScsiTransport = (fp, opts) =>
  scsiReadVpdPages(fp, opts ? { timeoutMs: opts.timeoutMs } : undefined);

/**
 * Parse raw inquiry bytes into a {@link ParsedFirmware}, returning `null`
 * on any failure. Wraps both decoding (UTF-8) and structured extraction —
 * a `null` return from this helper means the bytes were unusable, regardless
 * of whether the failure was at the codec, parser, or extractor stage.
 */
function parseAndExtract(bytes: Uint8Array): ParsedFirmware | null {
  let xml: string;
  try {
    xml = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  let plist;
  try {
    plist = parsePlist(xml);
  } catch {
    return null;
  }
  return extractFromPlist(plist, xml);
}

/**
 * Outcome of a single transport attempt within an orchestrated inquiry.
 *
 * - `success`: transport returned bytes that parsed into a `ParsedFirmware`.
 * - `transport-error`: transport itself threw (libusb error, SCSI vtable
 *   failure, ENOENT for /dev/sgN, etc.).
 * - `parse-error`: transport returned bytes but `parseAndExtract` could not
 *   produce a `ParsedFirmware` (decode/plist/extract failure).
 */
export type InquiryAttempt =
  | { transport: 'usb' | 'scsi'; outcome: 'success' }
  | { transport: 'usb' | 'scsi'; outcome: 'transport-error'; error: Error }
  | { transport: 'usb' | 'scsi'; outcome: 'parse-error' };

/**
 * Detailed inquiry result. `firmware` is `null` whenever no attempt produced
 * usable bytes; `plan` reports the plan the orchestrator dispatched (callers
 * use it to know which transports were even available); `attempts` lists the
 * transports actually invoked, in order, with per-attempt outcomes.
 */
export interface InquiryDetailedResult {
  firmware: ParsedFirmware | null;
  plan: SelectionPlan;
  attempts: InquiryAttempt[];
}

/**
 * Inquire the connected iPod's firmware capabilities via USB or SCSI.
 *
 * Probes which transports are available, then dispatches:
 *
 * - `usb-then-scsi`: USB attempted first; if it throws, SCSI is tried as a
 *   fallback. USB-success is returned immediately — SCSI is _not_ called when
 *   USB returns parseable bytes (acceptance criterion #4).
 * - `usb-only` / `scsi-only`: only the available transport is invoked.
 * - `none`: returns `null` without calling any transport.
 *
 * Returns `null` (never throws) on:
 * - both transports failing,
 * - the (sole or fallback) transport returning bytes that don't parse,
 * - bytes parsing as a plist but missing required identity fields.
 *
 * @param fp - USB fingerprint of the target device.
 * @param opts - Optional transport overrides, timeout, and probe overrides.
 * @returns Parsed firmware data, or `null` on failure.
 *
 * @example
 * ```typescript
 * import { inquireFirmware } from '@podkit/ipod-firmware';
 *
 * const fp = { vendorId: '05ac', productId: '1261', bus: 3, devnum: 4 };
 * const fw = await inquireFirmware(fp);
 * if (fw) {
 *   console.log(fw.serialNumber);            // "7K74HBYZRP2"
 *   console.log(fw.capabilities?.familyId);   // 120 (nano 4G)
 * }
 * ```
 */
export async function inquireFirmware(
  fp: UsbFingerprint,
  opts?: InquireOptions
): Promise<ParsedFirmware | null> {
  const detailed = await inquireFirmwareDetailed(fp, opts);
  return detailed.firmware;
}

/**
 * Same orchestration as {@link inquireFirmware} but returns plan + per-attempt
 * outcomes alongside the parsed firmware. Callers that need to surface
 * actionable diagnostics (e.g. "both USB and SCSI failed" vs "no transport
 * available") use this entry point. The simple `null`/`ParsedFirmware` callers
 * stay on {@link inquireFirmware}.
 */
export async function inquireFirmwareDetailed(
  fp: UsbFingerprint,
  opts?: InquireOptions
): Promise<InquiryDetailedResult> {
  const usbTransport = opts?.transports?.usb ?? defaultUsbTransport;
  const scsiTransport = opts?.transports?.scsi ?? defaultScsiTransport;
  const transportOpts: TransportOptions | undefined =
    opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : undefined;

  const availability = opts?.availability ?? (await probeInquiryMethods(opts?.probeOptions));
  const plan = chooseTransports(availability);
  const attempts: InquiryAttempt[] = [];

  const runTransport = async (
    transport: 'usb' | 'scsi',
    fn: UsbTransport | ScsiTransport
  ): Promise<ParsedFirmware | null> => {
    let bytes: Uint8Array;
    try {
      bytes = await fn(fp, transportOpts);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      attempts.push({ transport, outcome: 'transport-error', error });
      return null;
    }
    const parsed = parseAndExtract(bytes);
    attempts.push(
      parsed ? { transport, outcome: 'success' } : { transport, outcome: 'parse-error' }
    );
    return parsed;
  };

  switch (plan) {
    case 'none':
      return { firmware: null, plan, attempts };

    case 'usb-only': {
      const firmware = await runTransport('usb', usbTransport);
      return { firmware, plan, attempts };
    }

    case 'scsi-only': {
      const firmware = await runTransport('scsi', scsiTransport);
      return { firmware, plan, attempts };
    }

    case 'usb-then-scsi': {
      const usbResult = await runTransport('usb', usbTransport);
      const lastUsb = attempts[attempts.length - 1]!;
      // SCSI fallback only when USB threw at the transport layer. A successful
      // USB transport returning unparseable bytes does not trigger SCSI (see
      // module TSDoc rule 3).
      if (lastUsb.outcome === 'transport-error') {
        emit({
          level: 'debug',
          message: `USB inquiry failed, falling back to SCSI: ${lastUsb.error.name}: ${lastUsb.error.message}`,
        });
        const scsiResult = await runTransport('scsi', scsiTransport);
        return { firmware: scsiResult, plan, attempts };
      }
      return { firmware: usbResult, plan, attempts };
    }
  }
}
