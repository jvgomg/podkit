/**
 * SCSI transport — shared types and constants.
 *
 * Constants and small types used by both the Linux (SG_IO) and macOS
 * (IOKit SCSITaskUserClient) SCSI transports. The wire-format details of
 * the VPD INQUIRY CDB are identical across platforms; only the syscall
 * differs.
 *
 * @module
 */

// =============================================================================
// SCSI command + page identifiers
// =============================================================================

/** SCSI INQUIRY opcode. */
export const SCSI_INQUIRY_OPCODE = 0x12;

/** EVPD bit in INQUIRY CDB byte 1 — request a vital-product-data page. */
export const SCSI_INQUIRY_EVPD = 0x01;

/**
 * iPod-specific VPD page that returns an index of subpage IDs whose
 * concatenated data fields form the SysInfoExtended XML.
 */
export const VPD_PAGE_INDEX = 0xc0;

/**
 * Standard short read budget used by libgpod and the spike. Most subpages
 * fit comfortably under 252 bytes; a larger one triggers a re-read using
 * the page-length field from the VPD response header.
 */
export const DEFAULT_VPD_ALLOC_LEN = 252;

/**
 * Larger ceiling for VPD re-reads when the page-length field reports more
 * than `DEFAULT_VPD_ALLOC_LEN - VPD_HEADER_BYTES` payload bytes. 64 KiB is
 * comfortably above the largest captured SysInfoExtended subpage seen in
 * `documents/sysinfo-captures/`.
 */
export const MAX_VPD_ALLOC_LEN = 65535;

/**
 * Bytes of header in a standard VPD INQUIRY response:
 * `[device_type, page_code, len_msb, len_lsb, ...payload]`.
 *
 * Payload starts at offset 4, so `pageLength = (buf[2] << 8) | buf[3]` and
 * the total response length is `VPD_HEADER_BYTES + pageLength`.
 */
export const VPD_HEADER_BYTES = 4;

/** Default per-VPD-read timeout in milliseconds. Matches the spike. */
export const DEFAULT_TIMEOUT_MS = 5000;

// =============================================================================
// SCSI status + sense
// =============================================================================

/** SCSI status byte values relevant to VPD INQUIRY. */
export const SCSI_STATUS_GOOD = 0x00;
export const SCSI_STATUS_CHECK_CONDITION = 0x02;

/**
 * Parsed SCSI sense data (descriptor or fixed format, common fields).
 * Populated by `parseSenseData` when a CHECK CONDITION is reported.
 */
export interface ScsiSenseData {
  /** Sense key (4 low bits of byte 2 in fixed format, byte 1 in descriptor format). */
  senseKey: number;
  /** Additional sense code. */
  asc: number;
  /** Additional sense code qualifier. */
  ascq: number;
  /**
   * Whether the sense buffer was in descriptor format (byte 0 = 0x72/0x73)
   * or fixed format (byte 0 = 0x70/0x71). Useful for diagnostics only.
   */
  format: 'descriptor' | 'fixed' | 'unknown';
}

/**
 * Parse a SCSI sense buffer. Handles both fixed (0x70/0x71) and descriptor
 * (0x72/0x73) sense formats. Returns null if the buffer is empty or the
 * response code is not recognised.
 */
export function parseSenseData(buf: Uint8Array): ScsiSenseData | null {
  if (buf.length < 4) return null;
  const responseCode = buf[0]! & 0x7f;
  if (responseCode === 0x70 || responseCode === 0x71) {
    if (buf.length < 14) return null;
    return {
      senseKey: buf[2]! & 0x0f,
      asc: buf[12]!,
      ascq: buf[13]!,
      format: 'fixed',
    };
  }
  if (responseCode === 0x72 || responseCode === 0x73) {
    return {
      senseKey: buf[1]! & 0x0f,
      asc: buf[2]!,
      ascq: buf[3]!,
      format: 'descriptor',
    };
  }
  return null;
}

// =============================================================================
// CDB construction
// =============================================================================

/**
 * Build a 6-byte INQUIRY CDB requesting a VPD page of up to `allocLen`
 * bytes. Layout matches SPC-3 §6.4.
 */
export function buildVpdCdb(page: number, allocLen: number): Uint8Array {
  return new Uint8Array([
    SCSI_INQUIRY_OPCODE,
    SCSI_INQUIRY_EVPD,
    page & 0xff,
    (allocLen >> 8) & 0xff,
    allocLen & 0xff,
    0x00,
  ]);
}

/**
 * Read the 16-bit page-length field from a VPD INQUIRY response header.
 * Returns the number of payload bytes that should follow the 4-byte header.
 */
export function readVpdPageLength(buf: Uint8Array): number {
  if (buf.length < VPD_HEADER_BYTES) return 0;
  return (buf[2]! << 8) | buf[3]!;
}

// =============================================================================
// Transport boundary (testability)
// =============================================================================

/**
 * Outcome of a single VPD INQUIRY syscall — the platform-specific layer
 * narrows the OS errno / ScsiTaskInterface return code into one of these
 * shapes before the transport-shared loop runs.
 *
 * The transport-shared loop in {@link readAllVpdSubpages} uses this shape
 * to make decisions (short-read re-read, sense parsing, error mapping)
 * without needing to know the syscall details. Tests inject a fake
 * `ScsiSyscall` to drive the loop without any FFI.
 */
export type ScsiSyscallResult =
  | { ok: true; data: Uint8Array }
  | {
      ok: false;
      kind: 'check-condition';
      sense: Uint8Array;
      status: number;
    }
  | { ok: false; kind: 'timeout' }
  | { ok: false; kind: 'errno'; errno: number; syscall: string }
  | { ok: false; kind: 'iokit'; rc: number; where: string }
  | { ok: false; kind: 'other'; message: string };

/**
 * The platform-injectable single-VPD-read function. Implementations
 * (`linux.ts`, `macos.ts`, and the test fakes) all conform to this.
 */
export type ScsiSyscall = (page: number, allocLen: number) => ScsiSyscallResult;
