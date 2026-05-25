/**
 * Unit tests for the wire-level vendor-control-transfer protocol.
 *
 * Tests are pure — no kernel modules, no filesystem. They emit synthetic
 * SETUP packets that mirror what the host (libgpod) sends and assert the
 * daemon's response bytes are correct.
 *
 * Coverage:
 *
 *   - SETUP-packet decoding (length validation, little-endian fields)
 *   - Request classification (matching/non-matching headers)
 *   - Paging: full-page, short-page-on-boundary, empty-payload, exact-multiple
 *   - Reconstructing the original XML by walking `pageSequence` matches
 *     the iteration the client does in `usb.ts`.
 */

import { describe, it, expect } from 'bun:test';

import {
  BM_REQUEST_TYPE,
  B_REQUEST,
  W_VALUE,
  PAGE_SIZE,
  classifyRequest,
  getPagePayload,
  pageSequence,
  parseSetupPacket,
} from '../protocol.js';

function makeSetupBuffer(
  bmRequestType: number,
  bRequest: number,
  wValue: number,
  wIndex: number,
  wLength: number
): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint8(0, bmRequestType);
  view.setUint8(1, bRequest);
  view.setUint16(2, wValue, true);
  view.setUint16(4, wIndex, true);
  view.setUint16(6, wLength, true);
  return buf;
}

describe('parseSetupPacket', () => {
  it('decodes the iPod vendor read SETUP packet', () => {
    const buf = makeSetupBuffer(BM_REQUEST_TYPE, B_REQUEST, W_VALUE, 3, PAGE_SIZE);
    const parsed = parseSetupPacket(buf);
    expect(parsed).toEqual({
      bmRequestType: 0xc0,
      bRequest: 0x40,
      wValue: 0x02,
      wIndex: 3,
      wLength: PAGE_SIZE,
    });
  });

  it('rejects buffers of the wrong length', () => {
    expect(() => parseSetupPacket(new Uint8Array(7))).toThrow();
    expect(() => parseSetupPacket(new Uint8Array(9))).toThrow();
  });
});

describe('classifyRequest', () => {
  it('matches the iPod vendor read', () => {
    const result = classifyRequest({
      bmRequestType: BM_REQUEST_TYPE,
      bRequest: B_REQUEST,
      wValue: W_VALUE,
      wIndex: 0,
      wLength: PAGE_SIZE,
    });
    expect(result).toEqual({ kind: 'sysinfo-extended', page: 0, maxLength: PAGE_SIZE });
  });

  it('rejects a mismatched bmRequestType', () => {
    const result = classifyRequest({
      bmRequestType: 0x80,
      bRequest: B_REQUEST,
      wValue: W_VALUE,
      wIndex: 0,
      wLength: PAGE_SIZE,
    });
    expect(result.kind).toBe('unknown');
  });

  it('rejects a mismatched bRequest', () => {
    const result = classifyRequest({
      bmRequestType: BM_REQUEST_TYPE,
      bRequest: 0x06, // GET_DESCRIPTOR
      wValue: W_VALUE,
      wIndex: 0,
      wLength: PAGE_SIZE,
    });
    expect(result.kind).toBe('unknown');
  });

  it('rejects a mismatched wValue', () => {
    const result = classifyRequest({
      bmRequestType: BM_REQUEST_TYPE,
      bRequest: B_REQUEST,
      wValue: 0x01,
      wIndex: 0,
      wLength: PAGE_SIZE,
    });
    expect(result.kind).toBe('unknown');
  });

  it('carries the page index in `wIndex`', () => {
    const result = classifyRequest({
      bmRequestType: BM_REQUEST_TYPE,
      bRequest: B_REQUEST,
      wValue: W_VALUE,
      wIndex: 42,
      wLength: PAGE_SIZE,
    });
    if (result.kind !== 'sysinfo-extended') throw new Error('expected match');
    expect(result.page).toBe(42);
  });
});

describe('getPagePayload', () => {
  it('returns full pages for a multi-page payload', () => {
    const xml = 'A'.repeat(PAGE_SIZE * 2 + 17);
    const { bytes: p0, isTerminator: t0 } = getPagePayload(xml, 0);
    expect(p0.byteLength).toBe(PAGE_SIZE);
    expect(t0).toBe(false);

    const { bytes: p1, isTerminator: t1 } = getPagePayload(xml, 1);
    expect(p1.byteLength).toBe(PAGE_SIZE);
    expect(t1).toBe(false);

    const { bytes: p2, isTerminator: t2 } = getPagePayload(xml, 2);
    expect(p2.byteLength).toBe(17);
    expect(t2).toBe(true);
  });

  it('honours a smaller maxLength', () => {
    const xml = 'A'.repeat(PAGE_SIZE);
    const { bytes, isTerminator } = getPagePayload(xml, 0, 128);
    expect(bytes.byteLength).toBe(128);
    expect(isTerminator).toBe(true); // short read < PAGE_SIZE
  });

  it('returns an empty terminator beyond the last page', () => {
    const xml = 'A'.repeat(10);
    const { bytes, isTerminator } = getPagePayload(xml, 5);
    expect(bytes.byteLength).toBe(0);
    expect(isTerminator).toBe(true);
  });

  it('rejects negative pages', () => {
    expect(() => getPagePayload('x', -1)).toThrow();
  });

  it('treats maxLength=0 as PAGE_SIZE — does not return an empty page', () => {
    // wLength=0 is a valid USB control transfer "how much data is available"
    // query. A naive Math.min(PAGE_SIZE, 0) would return an empty page that
    // the client would misread as a short-read terminator. Guard against this.
    const xml = 'A'.repeat(2048);
    const { bytes, isTerminator } = getPagePayload(xml, 0, 0);
    expect(bytes.byteLength).toBe(2048);
    expect(isTerminator).toBe(true);
  });

  it('returns a full page when maxLength=0 and remaining >= PAGE_SIZE', () => {
    const xml = 'A'.repeat(PAGE_SIZE * 2);
    const { bytes, isTerminator } = getPagePayload(xml, 0, 0);
    expect(bytes.byteLength).toBe(PAGE_SIZE);
    expect(isTerminator).toBe(false);
  });
});

describe('pageSequence', () => {
  it('reconstructs the original payload byte-for-byte', () => {
    const xml = makeRandomXml(PAGE_SIZE * 3 + 137);
    const pages = [...pageSequence(xml)];
    // Last page is the short terminator.
    expect(pages.at(-1)!.isTerminator).toBe(true);
    // Concatenate everything and compare.
    const joined = concat(pages.map((p) => p.bytes));
    expect(joined).toEqual(new TextEncoder().encode(xml));
  });

  it('emits an empty terminator for exact-multiple payloads', () => {
    const xml = 'A'.repeat(PAGE_SIZE);
    const pages = [...pageSequence(xml)];
    expect(pages.length).toBe(2);
    expect(pages[0]!.bytes.byteLength).toBe(PAGE_SIZE);
    expect(pages[0]!.isTerminator).toBe(false);
    expect(pages[1]!.bytes.byteLength).toBe(0);
    expect(pages[1]!.isTerminator).toBe(true);
  });

  it('emits a single empty page for an empty payload', () => {
    const pages = [...pageSequence('')];
    expect(pages).toEqual([{ page: 0, bytes: new Uint8Array(0), isTerminator: true }]);
  });

  it('terminates on the only page when payload < PAGE_SIZE', () => {
    const pages = [...pageSequence('hello')];
    expect(pages.length).toBe(1);
    expect(pages[0]!.bytes).toEqual(new TextEncoder().encode('hello'));
    expect(pages[0]!.isTerminator).toBe(true);
  });

  it('mirrors the client iteration in usb.ts', () => {
    // Simulates the loop in packages/ipod-firmware/src/inquiry/usb.ts:
    //   for (i = 0..MAX_PAGES) { chunk = controlTransfer(...); if (chunk.length !== PAGE_SIZE) break; }
    const xml = makeRandomXml(PAGE_SIZE * 2 + 1);
    const chunks: Uint8Array[] = [];
    let page = 0;
    while (true) {
      const { bytes } = getPagePayload(xml, page);
      chunks.push(bytes);
      if (bytes.byteLength !== PAGE_SIZE) break;
      page++;
    }
    const joined = concat(chunks);
    expect(joined).toEqual(new TextEncoder().encode(xml));
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRandomXml(length: number): string {
  // Deterministic pseudo-random ASCII so the test is reproducible.
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  let seed = 1234567;
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out += alphabet[seed % alphabet.length]!;
  }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}
