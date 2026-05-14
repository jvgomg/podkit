/**
 * Wire-level vendor control transfer protocol served by the daemon.
 *
 * Mirrors `libgpod 0.8.3`'s `itdb_read_sysinfo_extended_from_usb`. The client
 * side lives in `packages/ipod-firmware/src/inquiry/usb.ts`; this module is
 * the matching server side, kept deliberately pure (no I/O, no kernel) so it
 * can be unit-tested on macOS without any USB stack at all.
 *
 * The full setup-packet handling chain is:
 *
 *   1. The kernel hands the daemon a SETUP packet on ep0.
 *   2. `parseSetupPacket(buf)` decodes the 8-byte structure.
 *   3. `classifyRequest(setup)` decides whether we recognise the request.
 *   4. For recognised vendor reads, `getPagePayload(xml, page)` returns the
 *      bytes to write back into the data endpoint.
 *
 * Short-read semantics: the iteration terminates when a page returns FEWER
 * than `PAGE_SIZE` bytes. The daemon must therefore:
 *
 *   - serve full 4096-byte pages until the data is exhausted,
 *   - serve **one short page** (possibly empty) on the page that lands on
 *     the boundary, signalling end-of-stream to the client.
 *
 * @see packages/ipod-firmware/src/inquiry/usb.ts
 * @module
 */

// ---------------------------------------------------------------------------
// Constants — must match `packages/ipod-firmware/src/inquiry/usb.ts`
// ---------------------------------------------------------------------------

/** `bmRequestType` for the iPod vendor read: device→host, vendor, device. */
export const BM_REQUEST_TYPE = 0xc0;
/** `bRequest` for the iPod vendor read. */
export const B_REQUEST = 0x40;
/** `wValue` for the iPod vendor read (SysInfoExtended selector). */
export const W_VALUE = 0x02;
/** Per-page transfer size — matches libgpod's 4096. */
export const PAGE_SIZE = 0x1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parsed USB SETUP packet (8 bytes on the wire). */
export interface SetupPacket {
  bmRequestType: number;
  bRequest: number;
  wValue: number;
  wIndex: number;
  wLength: number;
}

/**
 * Result of classifying a SETUP packet. We only recognise the SysInfoExtended
 * read; everything else is `'unknown'` and the daemon STALLs the endpoint.
 */
export type ClassifiedRequest =
  | { kind: 'sysinfo-extended'; page: number; maxLength: number }
  | { kind: 'unknown'; reason: string };

// ---------------------------------------------------------------------------
// SETUP packet decoding
// ---------------------------------------------------------------------------

/**
 * Decode a USB SETUP packet from an 8-byte little-endian buffer.
 *
 * Throws if the buffer is the wrong length — callers should treat that as a
 * fatal kernel protocol violation.
 */
export function parseSetupPacket(buf: Uint8Array): SetupPacket {
  if (buf.byteLength !== 8) {
    throw new Error(`parseSetupPacket: expected 8 bytes, got ${buf.byteLength}`);
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    bmRequestType: view.getUint8(0),
    bRequest: view.getUint8(1),
    wValue: view.getUint16(2, true),
    wIndex: view.getUint16(4, true),
    wLength: view.getUint16(6, true),
  };
}

/**
 * Decide whether a SETUP packet matches the iPod SysInfoExtended vendor read
 * the daemon serves. Anything else is unrecognised — the daemon will STALL.
 */
export function classifyRequest(setup: SetupPacket): ClassifiedRequest {
  if (setup.bmRequestType !== BM_REQUEST_TYPE) {
    return {
      kind: 'unknown',
      reason: `bmRequestType=0x${setup.bmRequestType.toString(16)} (expected 0x${BM_REQUEST_TYPE.toString(16)})`,
    };
  }
  if (setup.bRequest !== B_REQUEST) {
    return {
      kind: 'unknown',
      reason: `bRequest=0x${setup.bRequest.toString(16)} (expected 0x${B_REQUEST.toString(16)})`,
    };
  }
  if (setup.wValue !== W_VALUE) {
    return {
      kind: 'unknown',
      reason: `wValue=0x${setup.wValue.toString(16)} (expected 0x${W_VALUE.toString(16)})`,
    };
  }
  return { kind: 'sysinfo-extended', page: setup.wIndex, maxLength: setup.wLength };
}

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------

/**
 * Return the bytes the daemon should serve for the requested page.
 *
 * Mirrors the client-side iteration in `usb.ts`:
 *
 * - Pages `0..N-1` return up to `PAGE_SIZE` bytes from the XML.
 * - The "terminator page" returns fewer than `PAGE_SIZE` bytes (possibly 0),
 *   signalling end-of-stream to the client. The client then stops paging.
 * - Pages beyond the terminator return an empty buffer (the daemon should
 *   STALL or otherwise indicate "no more data" — the client will not ask
 *   past the short page in practice).
 *
 * `maxLength` is the `wLength` the host requested. The daemon must never
 * write more than `maxLength` bytes back. The host always requests `PAGE_SIZE`
 * in the libgpod protocol, but we honour smaller requests defensively.
 *
 * @returns the byte slice to write, plus a flag indicating whether this is
 *   the short page that ends the stream.
 */
export function getPagePayload(
  xml: string | Uint8Array,
  page: number,
  maxLength: number = PAGE_SIZE
): { bytes: Uint8Array; isTerminator: boolean } {
  if (page < 0 || !Number.isInteger(page)) {
    throw new Error(`getPagePayload: page must be a non-negative integer, got ${page}`);
  }
  const data = typeof xml === 'string' ? encodeUtf8(xml) : xml;
  const offset = page * PAGE_SIZE;
  if (offset >= data.byteLength) {
    // Already past the last byte. Return an empty terminator page. In
    // practice, the daemon serves a terminator earlier (see below) and
    // the client never asks for this page.
    return { bytes: new Uint8Array(0), isTerminator: true };
  }
  const remaining = data.byteLength - offset;
  // `wLength=0` is technically a valid USB control transfer ("how much
  // data is available") but the libgpod client always sends 4096. Treat 0
  // as PAGE_SIZE rather than returning an empty page, which the client
  // would misread as a short-read terminator.
  const effectiveMax = maxLength > 0 ? maxLength : PAGE_SIZE;
  const allowed = Math.min(PAGE_SIZE, effectiveMax);
  const sliceLen = Math.min(remaining, allowed);
  const bytes = data.subarray(offset, offset + sliceLen);
  // A short read terminates the stream. This page is the terminator if it
  // is shorter than PAGE_SIZE *or* if it consumes the rest of the buffer
  // exactly on a boundary (sliceLen === PAGE_SIZE and remaining === PAGE_SIZE
  // means the *next* page would be empty — but that empty page is itself
  // the terminator). The client iterates until it sees a short read; if
  // the payload size is an exact multiple of PAGE_SIZE, the daemon serves
  // a full page then an empty page on the following request.
  const isTerminator = sliceLen < PAGE_SIZE;
  return { bytes, isTerminator };
}

/**
 * Generate the full sequence of pages the daemon would serve for a complete
 * read of `xml`. Pure helper used by snapshot tests to assert the iteration
 * is well-formed without running the real ep0 loop.
 *
 * Always emits at least one page. If the payload is an exact multiple of
 * `PAGE_SIZE`, an empty terminator page is appended.
 */
export function* pageSequence(
  xml: string | Uint8Array
): Generator<{ page: number; bytes: Uint8Array; isTerminator: boolean }> {
  const data = typeof xml === 'string' ? encodeUtf8(xml) : xml;
  if (data.byteLength === 0) {
    yield { page: 0, bytes: new Uint8Array(0), isTerminator: true };
    return;
  }
  let page = 0;
  for (let offset = 0; offset < data.byteLength; offset += PAGE_SIZE) {
    const sliceLen = Math.min(PAGE_SIZE, data.byteLength - offset);
    const bytes = data.subarray(offset, offset + sliceLen);
    const isTerminator = sliceLen < PAGE_SIZE;
    yield { page, bytes, isTerminator };
    page++;
    if (isTerminator) return;
  }
  // Exact-multiple case: emit an empty terminator page.
  yield { page, bytes: new Uint8Array(0), isTerminator: true };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function encodeUtf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
