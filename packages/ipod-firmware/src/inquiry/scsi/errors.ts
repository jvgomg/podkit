/**
 * SCSI transport — discriminated error type.
 *
 * Every failure path in the SCSI transport surfaces as a `ScsiError`
 * with a `kind` discriminator. Higher layers (TASK-292.12 permission UX,
 * the orchestrator's USB-fallback logic, doctor checks) inspect `kind`
 * to render actionable messages or decide whether to retry.
 *
 * The error itself carries minimal text — full human-readable messages
 * live in TASK-292.12. Here we only ensure the structured fields needed
 * to render those messages are present.
 *
 * @module
 */

import type { ScsiSenseData } from './types.js';

/** Discriminator values for {@link ScsiError}. */
export type ScsiErrorKind =
  /** EACCES — permission denied opening the SCSI device. Linux. */
  | 'eacces'
  /** ENOENT — device path does not exist. Linux. */
  | 'enoent'
  /** EBUSY — another process holds an exclusive claim on the device. */
  | 'ebusy'
  /** EPERM — capability missing / kernel rejected SCSI passthrough. */
  | 'eperm'
  /** Generic Linux errno not covered by a more specific kind. */
  | 'errno'
  /** SCSI CHECK CONDITION — sense data parsed when available. */
  | 'sense-check-condition'
  /** SCSI command timed out. */
  | 'timeout'
  /** Response truncated and re-read also fell short — unrecoverable. */
  | 'short-read'
  /** Generic I/O error from the kernel (EIO) — no sense buffer available. */
  | 'io-error'
  /** macOS iPodDriver.kext not loaded — no matching IOService found. */
  | 'kext-missing'
  /** macOS IOKit returned a non-zero kern_return_t. */
  | 'iokit'
  /**
   * SCSITaskDeviceInterface vtable `version` field did not match the
   * value observed during the spike. Indicates Apple shipped an IOKit
   * change that may have re-laid-out the vtable.
   */
  | 'vtable-version-mismatch'
  /** Catch-all for unexpected conditions. */
  | 'other';

/** Structured fields carried by a {@link ScsiError}. */
export interface ScsiErrorFields {
  /** Discriminator for `instanceof`-free narrowing. */
  kind: ScsiErrorKind;
  /** Human-readable message (full UX text owned by 292.12). */
  message?: string;
  /** Linux errno value (for `eacces`, `enoent`, `ebusy`, `eperm`, `errno`). */
  errno?: number;
  /** Syscall name (e.g. `'ioctl(SG_IO)'`, `'open'`) for errno errors. */
  syscall?: string;
  /** Device path involved (e.g. `'/dev/sg3'`), if known. */
  devicePath?: string;
  /** VPD page being read when the failure occurred, if known. */
  page?: number;
  /** Parsed sense data for `sense-check-condition`. */
  sense?: ScsiSenseData;
  /** SCSI status byte for `sense-check-condition`. */
  status?: number;
  /** IOKit kern_return_t for `iokit` errors. */
  rc?: number;
  /** Operation site label for `iokit` errors. */
  where?: string;
  /** Observed vtable version for `vtable-version-mismatch`. */
  got?: number;
  /** Expected vtable version for `vtable-version-mismatch`. */
  expected?: number;
  /** Underlying error if one was wrapped. */
  cause?: unknown;
}

/**
 * Discriminated error class for the SCSI transport. Use `err.kind` to
 * narrow; do not parse `err.message` for branching.
 */
export class ScsiError extends Error {
  readonly kind: ScsiErrorKind;
  readonly errno?: number;
  readonly syscall?: string;
  readonly devicePath?: string;
  readonly page?: number;
  readonly sense?: ScsiSenseData;
  readonly status?: number;
  readonly rc?: number;
  readonly where?: string;
  readonly got?: number;
  readonly expected?: number;

  constructor(fields: ScsiErrorFields) {
    super(fields.message ?? defaultMessage(fields));
    this.name = 'ScsiError';
    this.kind = fields.kind;
    if (fields.errno !== undefined) this.errno = fields.errno;
    if (fields.syscall !== undefined) this.syscall = fields.syscall;
    if (fields.devicePath !== undefined) this.devicePath = fields.devicePath;
    if (fields.page !== undefined) this.page = fields.page;
    if (fields.sense !== undefined) this.sense = fields.sense;
    if (fields.status !== undefined) this.status = fields.status;
    if (fields.rc !== undefined) this.rc = fields.rc;
    if (fields.where !== undefined) this.where = fields.where;
    if (fields.got !== undefined) this.got = fields.got;
    if (fields.expected !== undefined) this.expected = fields.expected;
    if (fields.cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: fields.cause, enumerable: false });
    }
  }
}

function defaultMessage(f: ScsiErrorFields): string {
  switch (f.kind) {
    case 'eacces':
      return [
        `Permission denied accessing ${f.devicePath ?? 'SCSI device'}.`,
        '',
        'podkit needs SCSI access to read iPod device identity. To fix:',
        '',
        '  1. One-off: re-run with sudo.',
        '',
        '  2. Persistent: install the udev rule:',
        '       podkit doctor --repair udev-rule',
        '     (then unplug and replug your iPod)',
        '',
        'Details: https://podkit.dev/docs/troubleshooting#linux-scsi-permissions',
      ].join('\n');
    case 'enoent':
      return `${f.devicePath ?? 'SCSI device'} does not exist`;
    case 'ebusy':
      return `${f.devicePath ?? 'SCSI device'} is busy (another process holds it)`;
    case 'eperm':
      return `kernel rejected SCSI passthrough on ${f.devicePath ?? 'device'} (EPERM)`;
    case 'errno':
      return `${f.syscall ?? 'syscall'} failed with errno=${f.errno ?? '?'}`;
    case 'io-error':
      return `${f.syscall ?? 'syscall'} returned EIO on ${f.devicePath ?? 'device'} (kernel I/O error)`;
    case 'sense-check-condition':
      return (
        `SCSI CHECK CONDITION` +
        (f.page !== undefined ? ` on VPD page 0x${f.page.toString(16)}` : '') +
        (f.sense
          ? ` (key=0x${f.sense.senseKey.toString(16)} asc=0x${f.sense.asc
              .toString(16)
              .padStart(2, '0')} ascq=0x${f.sense.ascq.toString(16).padStart(2, '0')})`
          : '')
      );
    case 'timeout':
      return `SCSI command timed out${f.page !== undefined ? ` on VPD page 0x${f.page.toString(16)}` : ''}`;
    case 'short-read':
      return `SCSI VPD page 0x${f.page?.toString(16) ?? '??'} response truncated after re-read`;
    case 'kext-missing':
      return `iPodDriver.kext not loaded (no com_apple_driver_iPodSBCNub IOService matched)`;
    case 'iokit':
      return `IOKit ${f.where ?? 'call'} failed: rc=0x${(f.rc ?? 0).toString(16)}`;
    case 'vtable-version-mismatch':
      return `SCSITaskDeviceInterface vtable version mismatch: got ${f.got}, expected ${f.expected}`;
    case 'other':
      return f.message ?? 'unknown SCSI transport error';
  }
}

/**
 * Map a Linux errno value to a {@link ScsiErrorKind}. Used by `linux.ts`
 * to translate raw errno into actionable error categories before throwing.
 *
 * Mapping follows FINDINGS.md "Risks" item 3:
 * - EACCES (13) → 'eacces'      (install udev rule recommendation)
 * - EBUSY (16)  → 'ebusy'        (another process holds the device)
 * - ENOENT (2)  → 'enoent'
 * - EPERM (1)   → 'eperm'
 * - EIO (5)     → 'io-error'  (kernel I/O error, no sense buffer)
 * - other       → 'errno'
 */
export function errnoToKind(errno: number): ScsiErrorKind {
  switch (errno) {
    case 1:
      return 'eperm';
    case 2:
      return 'enoent';
    case 5:
      return 'io-error';
    case 13:
      return 'eacces';
    case 16:
      return 'ebusy';
    default:
      return 'errno';
  }
}
