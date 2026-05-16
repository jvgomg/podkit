/**
 * Pure formatter for the user-facing message produced when the firmware
 * inquiry orchestrator cannot read device identity.
 *
 * The orchestrator returns a list of per-transport attempts. This module
 * folds those attempts into a multi-line message that:
 *
 * 1. Names every transport that was attempted (in plan order: USB first, then SCSI).
 * 2. Surfaces the failure reason for each one on its own line. EACCES on a
 *    `/dev/sg*` or `/dev/bus/usb/...` node renders as
 *    `Permission denied accessing <path>`.
 * 3. Appends a remediation hint when the failure kind has one (today: EACCES
 *    on a SCSI generic or USB bus node points at `podkit doctor --repair udev-rule`).
 * 4. Appends a `(re-run with -vv for more detail)` footer when verbose is 0.
 *
 * `-vv` and `-vvv` add increasing transport-specific detail (libusb status
 * codes, ioctl syscalls). The default level (0) gives a regular user enough
 * to know what failed and what to do without re-running with a flag.
 *
 * The module is a pure function — no I/O, no `process.platform`, no logger
 * coupling — so it's exhaustively unit-testable.
 *
 * @module
 */

import type { UsbFingerprint } from '@podkit/device-types';
import type { InquiryAttempt } from '../inquiry/orchestrator.js';
import { ScsiError } from '../inquiry/scsi/errors.js';
import { UsbInquiryError } from '../inquiry/usb.js';

// ── Public types ─────────────────────────────────────────────────────────────

/** Options for {@link formatInquiryError}. */
export interface FormatInquiryErrorOptions {
  /**
   * Verbosity level matching the CLI's `-v` accumulator.
   *
   * - `0` (default) / `1` (`-v`): per-transport reasons + remediation hint +
   *   `(re-run with -vv for more detail)` footer. At `-v` the diagnostic
   *   logger (see {@link setLogger}) already streams orchestrator events to
   *   stderr; the formatter still surfaces the footer because the next
   *   actionable detail level is `-vv`.
   * - `2` (`-vv`): adds transport-specific detail to each reason line (libusb
   *   status, ioctl syscall site). Footer omitted.
   * - `3+` (`-vvv`): same as 2 today; reserved for raw payload dumps in a
   *   later iteration. Footer omitted.
   */
  verbose?: number;
  /**
   * USB fingerprint that the orchestrator was invoked with. Used to synthesise
   * the `/dev/bus/usb/...` path for libusb EACCES, which doesn't carry a
   * `devicePath` on the {@link UsbInquiryError} itself (libusb opens the node
   * internally on Linux).
   */
  fingerprint?: UsbFingerprint;
}

// ── EACCES detection ─────────────────────────────────────────────────────────

/**
 * Inspect a transport-error attempt and return its EACCES path if the failure
 * was a permission denial on a `/dev/sg*` or `/dev/bus/usb/...` node. Returns
 * `null` for any other error class.
 *
 * SCSI EACCES is carried as a structured `ScsiError({ kind: 'eacces' })` with
 * `devicePath` already set by the open() failure path in `scsi/linux.ts`.
 *
 * USB EACCES surfaces as a `UsbInquiryError` with `libusbStatus === -3`
 * (LIBUSB_ERROR_ACCESS) or with `kind === 'open-failed'` whose underlying
 * libusb message contains `LIBUSB_ERROR_ACCESS`. In that case we synthesise
 * the `/dev/bus/usb/<bus>/<devnum>` path from the fingerprint — libusb opens
 * that node directly on Linux, so it is the file the user lacks access to.
 */
function detectEaccesPath(error: Error, fingerprint: UsbFingerprint | undefined): string | null {
  if (error instanceof ScsiError && error.kind === 'eacces') {
    return error.devicePath ?? '/dev/sgN';
  }
  if (error instanceof UsbInquiryError) {
    // libusb: LIBUSB_ERROR_ACCESS == -3
    const isLibusbAccess =
      error.libusbStatus === -3 ||
      /LIBUSB_ERROR_ACCESS/i.test(error.message) ||
      /permission denied/i.test(error.message);
    if (isLibusbAccess && fingerprint?.bus !== undefined && fingerprint.devnum !== undefined) {
      const bus = String(fingerprint.bus).padStart(3, '0');
      const dev = String(fingerprint.devnum).padStart(3, '0');
      return `/dev/bus/usb/${bus}/${dev}`;
    }
    if (isLibusbAccess) {
      // No fingerprint to synthesise from — still tell the user it's a perm error.
      return '/dev/bus/usb/...';
    }
  }
  return null;
}

// ── Per-transport line construction ──────────────────────────────────────────

/**
 * Build the one-line reason text for a single attempt. The label (e.g. `USB:`
 * / `SCSI:`) is added by {@link formatInquiryError} so it can column-align.
 *
 * Verbose level 2+ appends transport-specific detail in parentheses.
 */
function buildReasonLine(
  attempt: Extract<InquiryAttempt, { outcome: 'transport-error' | 'parse-error' }>,
  fingerprint: UsbFingerprint | undefined,
  verbose: number
): string {
  if (attempt.outcome === 'parse-error') {
    return 'returned data but it could not be parsed';
  }
  const err = attempt.error;
  const eaccesPath = detectEaccesPath(err, fingerprint);
  if (eaccesPath) {
    let line = `Permission denied accessing ${eaccesPath}`;
    if (verbose >= 2) {
      if (err instanceof UsbInquiryError && err.libusbStatus !== undefined) {
        line += ` (libusb status ${err.libusbStatus})`;
      } else if (err instanceof ScsiError && err.syscall !== undefined) {
        line += ` (${err.syscall})`;
      }
    }
    return line;
  }
  // Non-EACCES errors: surface a concise reason.
  if (err instanceof ScsiError) {
    let line = err.message.split('\n')[0] ?? err.message;
    if (verbose >= 2) {
      const bits: string[] = [];
      if (err.kind) bits.push(`kind=${err.kind}`);
      if (err.errno !== undefined) bits.push(`errno=${err.errno}`);
      if (err.syscall !== undefined) bits.push(err.syscall);
      if (bits.length > 0) line += ` (${bits.join(', ')})`;
    }
    return line;
  }
  if (err instanceof UsbInquiryError) {
    let line = err.message.split('\n')[0] ?? err.message;
    if (verbose >= 2) {
      const bits: string[] = [];
      if (err.kind) bits.push(`kind=${err.kind}`);
      if (err.libusbStatus !== undefined) bits.push(`libusbStatus=${err.libusbStatus}`);
      if (bits.length > 0) line += ` (${bits.join(', ')})`;
    }
    return line;
  }
  // Plain Error — first line of the message is the safest single-line render.
  return (err.message.split('\n')[0] ?? err.message).trim() || err.name || 'unknown error';
}

// ── Remediation hint ─────────────────────────────────────────────────────────

/**
 * Decide which remediation hint to emit, if any.
 *
 * - At least one attempt EACCES on a `/dev/sg*` or `/dev/bus/usb/...` node →
 *   `podkit doctor --repair udev-rule`. The udev rule covers both subsystems
 *   after TASK-317.13.
 * - Otherwise → no hint (the per-transport reason lines are the message).
 */
function buildRemediationHint(
  attempts: InquiryAttempt[],
  fingerprint: UsbFingerprint | undefined
): string | null {
  const anyEacces = attempts.some(
    (a) => a.outcome === 'transport-error' && detectEaccesPath(a.error, fingerprint) !== null
  );
  if (!anyEacces) return null;
  return [
    'To grant access without sudo, run: podkit doctor --repair udev-rule',
    '(then unplug and replug your iPod)',
  ].join('\n');
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Format the inquiry-orchestrator failure into a user-facing multi-line
 * message that names every transport attempted, the per-transport reason,
 * and (when applicable) a remediation hint and verbose-footer.
 *
 * Pre-conditions: `attempts` must be the {@link InquiryAttempt} list produced
 * by a failed {@link inquireFirmwareDetailed} run. Successful attempts are
 * filtered out by the caller before invoking this formatter; if a success is
 * present we still render the failure context for the others, since the
 * formatter is only ever called on the failure path.
 *
 * Returns a single-line string when there are no attempts at all (no transport
 * available); otherwise returns a multi-line block.
 */
export function formatInquiryError(
  attempts: InquiryAttempt[],
  opts: FormatInquiryErrorOptions = {}
): string {
  const verbose = opts.verbose ?? 0;

  if (attempts.length === 0) {
    return 'Could not read device identity: no firmware inquiry transport is available on this system';
  }

  // Group attempts by transport, preserving first occurrence order so the
  // output reads USB before SCSI when the plan was `usb-then-scsi`.
  const seen = new Set<string>();
  const ordered: Array<Extract<InquiryAttempt, { outcome: 'transport-error' | 'parse-error' }>> =
    [];
  for (const a of attempts) {
    if (a.outcome === 'success') continue;
    if (seen.has(a.transport)) continue;
    seen.add(a.transport);
    ordered.push(a);
  }

  if (ordered.length === 0) {
    // Defensive: caller shouldn't invoke us on a pure-success run, but if they
    // do we still produce something rather than throwing.
    return 'Could not read device identity (no failing transports recorded)';
  }

  const transportNames = ordered.map((a) => a.transport.toUpperCase());
  const header = `Could not read device identity from ${transportNames.join(' or ')}:`;

  // Build "  USB:  reason" / "  SCSI: reason" lines, padding labels so the
  // reasons column-align (matches the example in the task spec).
  const labelWidth = Math.max(...transportNames.map((n) => n.length));
  const reasonLines = ordered.map((a) => {
    const label = a.transport.toUpperCase();
    const padding = ' '.repeat(labelWidth - label.length);
    const reason = buildReasonLine(a, opts.fingerprint, verbose);
    return `  ${label}:${padding} ${reason}`;
  });

  const sections: string[] = [header, '', ...reasonLines];

  const hint = buildRemediationHint(attempts, opts.fingerprint);
  if (hint) {
    sections.push('', hint);
  }

  if (verbose < 2) {
    sections.push('', '(re-run with -vv for more detail)');
  }

  return sections.join('\n');
}
