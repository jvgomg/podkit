/**
 * SCSI VPD inquiry transport — platform dispatch entry point.
 *
 * Reads VPD page {@link VPD_PAGE_INDEX} from an iPod via SCSI INQUIRY,
 * then iterates the listed subpages and concatenates each subpage's
 * payload to reconstruct the SysInfoExtended XML.
 *
 * Dispatches to `linux.ts` (SG_IO ioctl via koffi) on Linux and `macos.ts`
 * (IOKit SCSITaskUserClient via koffi) on Darwin. Other platforms throw
 * `ScsiError({ kind: 'other' })` with a clear message.
 *
 * @module
 */

import type { UsbFingerprint } from '@podkit/device-types';
import { ScsiError, errnoToKind } from './errors.js';
import {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_VPD_ALLOC_LEN,
  MAX_VPD_ALLOC_LEN,
  VPD_HEADER_BYTES,
  VPD_PAGE_INDEX,
  parseSenseData,
  readVpdPageLength,
  type ScsiSyscall,
  type ScsiSyscallResult,
} from './types.js';

/** Options accepted by {@link scsiReadVpdPages}. */
export interface ScsiReadOptions {
  /** Override default timeout per-VPD-read in milliseconds. Default 5000. */
  timeoutMs?: number;
}

/**
 * Read VPD page 0xC0 + all subpages from an iPod via SCSI INQUIRY.
 *
 * Dispatches to the platform-appropriate transport:
 *
 * - **Linux:** opens `/dev/sgN` matching the {@link UsbFingerprint.bus}/
 *   {@link UsbFingerprint.devnum} pair and issues SG_IO ioctls.
 * - **macOS:** locates the IOService matching `com_apple_driver_iPodSBCNub`
 *   for the device with the given {@link UsbFingerprint.vendorId},
 *   {@link UsbFingerprint.productId}, and {@link UsbFingerprint.serialNumber};
 *   drives the IOKit SCSITaskUserClient via vtable dispatch.
 *
 * The returned bytes are the **concatenation of every subpage payload**
 * — i.e. the SysInfoExtended XML. The 4-byte VPD header is stripped from
 * each subpage before concatenation.
 *
 * Caveats:
 * - The XML returned contains a per-read crypto blob that differs between
 *   reads of the same device. Callers parsing the XML must not rely on
 *   byte-stability across calls; semantic content (FireWireGUID,
 *   SerialNumber, FamilyID, etc.) **is** stable.
 * - On Linux without the podkit udev rule the error surfaces as
 *   `ScsiError({ kind: 'eacces' })`; the CLI renders the user-facing message.
 *
 * @param fp - USB fingerprint identifying the device. Uses bus/devnum on
 *             Linux, vendorId/productId/serialNumber on macOS.
 * @param opts - Optional overrides (timeout).
 * @returns Concatenated subpage data — the full SysInfoExtended XML payload.
 * @throws {ScsiError} on permission, transport, sense, timeout, or vtable
 *                     issues. Inspect `err.kind` for branching.
 */
export async function scsiReadVpdPages(
  fp: UsbFingerprint,
  opts?: ScsiReadOptions
): Promise<Uint8Array> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (process.platform === 'linux') {
    const { openLinuxScsiSyscall } = await import('./linux.js');
    const session = await openLinuxScsiSyscall(fp, { timeoutMs });
    try {
      return readAllVpdSubpages(session.syscall);
    } finally {
      session.close();
    }
  }
  if (process.platform === 'darwin') {
    const { openMacosScsiSyscall } = await import('./macos.js');
    const session = await openMacosScsiSyscall(fp, { timeoutMs });
    try {
      return readAllVpdSubpages(session.syscall);
    } finally {
      session.close();
    }
  }
  throw new ScsiError({
    kind: 'other',
    message: `SCSI VPD inquiry is not supported on platform '${process.platform}'`,
  });
}

// =============================================================================
// Shared transport loop — platform-agnostic, fully testable.
// =============================================================================

/**
 * Drive a {@link ScsiSyscall} through the page-0xC0 index → per-subpage
 * read → concatenation flow.
 *
 * Exposed for unit tests — production callers use {@link scsiReadVpdPages}.
 *
 * Closes risks 1, 2, 3 from the P0 spike findings:
 * - sense-data inspection (CHECK CONDITION → parsed sense in ScsiError)
 * - short-read re-read (page-length field drives a second request)
 * - errno → kind translation (delegated to platform layer's syscall result)
 *
 * @param syscall - Platform-supplied single-VPD-read function. Inject a fake
 *   here in tests to drive the loop without any FFI.
 * @returns Concatenated subpage data forming the full SysInfoExtended XML payload.
 * @throws {ScsiError} When any VPD read fails or the page-0xC0 index is empty.
 */
export function readAllVpdSubpages(syscall: ScsiSyscall): Uint8Array {
  const indexBuf = readOneVpdPageWithRetry(syscall, VPD_PAGE_INDEX);
  const indexLen = readVpdPageLength(indexBuf);
  if (indexLen === 0) {
    throw new ScsiError({
      kind: 'short-read',
      page: VPD_PAGE_INDEX,
      message: 'VPD page 0xC0 returned empty payload',
    });
  }
  const subpages = Array.from(indexBuf.subarray(VPD_HEADER_BYTES, VPD_HEADER_BYTES + indexLen));

  // Concatenate each subpage's payload.
  let total = 0;
  const chunks: Uint8Array[] = [];
  for (const page of subpages) {
    const buf = readOneVpdPageWithRetry(syscall, page);
    const len = readVpdPageLength(buf);
    const payload = buf.subarray(VPD_HEADER_BYTES, VPD_HEADER_BYTES + len);
    chunks.push(payload);
    total += payload.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Read one VPD page, transparently re-issuing the read with the correct
 * allocation length when the page-length field reports the first read
 * was truncated. Closes risk 2 (hardcoded 252 allocation).
 *
 * Also closes risk 1: a CHECK CONDITION result has its sense buffer
 * parsed and surfaced as `ScsiError({ kind: 'sense-check-condition', ... })`.
 */
function readOneVpdPageWithRetry(syscall: ScsiSyscall, page: number): Uint8Array {
  const first = syscall(page, DEFAULT_VPD_ALLOC_LEN);
  const buf = unwrapResult(first, page);

  const declared = readVpdPageLength(buf);
  const requiredTotal = VPD_HEADER_BYTES + declared;
  // If the device reports more bytes than we allocated, re-read with the
  // correct length so we don't silently truncate.
  if (requiredTotal > DEFAULT_VPD_ALLOC_LEN) {
    const allocLen = Math.min(requiredTotal, MAX_VPD_ALLOC_LEN);
    const second = syscall(page, allocLen);
    const buf2 = unwrapResult(second, page);
    const declared2 = readVpdPageLength(buf2);
    const total2 = VPD_HEADER_BYTES + declared2;
    if (total2 > buf2.length) {
      throw new ScsiError({
        kind: 'short-read',
        page,
        message:
          `VPD page 0x${page.toString(16)} response still truncated after re-read ` +
          `(declared=${declared2} got=${buf2.length - VPD_HEADER_BYTES})`,
      });
    }
    return buf2;
  }
  return buf;
}

/**
 * Translate a {@link ScsiSyscallResult} into either bytes or a thrown
 * {@link ScsiError}. Centralises the result-to-error mapping so platform
 * code stays focused on talking to the kernel.
 */
function unwrapResult(result: ScsiSyscallResult, page: number): Uint8Array {
  if (result.ok) return result.data;
  switch (result.kind) {
    case 'check-condition': {
      const sense = parseSenseData(result.sense);
      throw new ScsiError({
        kind: 'sense-check-condition',
        page,
        status: result.status,
        ...(sense ? { sense } : {}),
      });
    }
    case 'timeout':
      throw new ScsiError({ kind: 'timeout', page });
    case 'errno':
      // The platform layer (linux.ts) already knows the errno → kind mapping
      // via errnoToKind; for symmetry tests can also feed raw errno through.
      throw new ScsiError({
        kind: errnoToKind(result.errno),
        errno: result.errno,
        syscall: result.syscall,
        page,
      });
    case 'iokit':
      throw new ScsiError({ kind: 'iokit', rc: result.rc, where: result.where, page });
    case 'other':
      throw new ScsiError({ kind: 'other', message: result.message, page });
  }
}
