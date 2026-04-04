import { describe, expect, it } from 'bun:test';
import { BufferReader } from './reader.js';
import { ParseError } from './errors.js';

// ── Helpers ─────────────────────────────────────────────────────────

/** Create a Uint8Array from raw byte values. */
function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

/** Write a uint32 LE into a Uint8Array at the given offset. */
function writeU32LE(buf: Uint8Array, offset: number, value: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, value, true);
}

/** Write a uint32 BE into a Uint8Array at the given offset. */
function writeU32BE(buf: Uint8Array, offset: number, value: number): void {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(offset, value, false);
}

/** Encode a string as UTF-16LE bytes. */
function utf16le(str: string): Uint8Array {
  return new TextEncoder().encode(
    // TextEncoder only does UTF-8; use manual encoding
    ''
  ).byteLength === 0
    ? encodeUtf16(str, true)
    : encodeUtf16(str, true);
}

/** Encode a string as UTF-16BE bytes. */
function utf16be(str: string): Uint8Array {
  return encodeUtf16(str, false);
}

function encodeUtf16(str: string, le: boolean): Uint8Array {
  const codeUnits: number[] = [];
  for (let i = 0; i < str.length; i++) {
    codeUnits.push(str.charCodeAt(i));
  }
  const buf = new Uint8Array(codeUnits.length * 2);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < codeUnits.length; i++) {
    view.setUint16(i * 2, codeUnits[i]!, le);
  }
  return buf;
}

// ── Integer reads (LE, default) ─────────────────────────────────────

describe('BufferReader — integer reads (LE)', () => {
  it('readUInt8', () => {
    const reader = new BufferReader(bytes(0x00, 0x7f, 0xff));
    expect(reader.readUInt8()).toBe(0);
    expect(reader.readUInt8()).toBe(0x7f);
    expect(reader.readUInt8()).toBe(0xff);
  });

  it('readUInt16 LE', () => {
    // 0x0102 stored as LE: [0x02, 0x01]
    const reader = new BufferReader(bytes(0x02, 0x01, 0xff, 0xff));
    expect(reader.readUInt16()).toBe(0x0102);
    expect(reader.readUInt16()).toBe(0xffff);
  });

  it('readUInt32 LE', () => {
    const buf = new Uint8Array(8);
    writeU32LE(buf, 0, 0x12345678);
    writeU32LE(buf, 4, 0xffffffff);
    const reader = new BufferReader(buf);
    expect(reader.readUInt32()).toBe(0x12345678);
    expect(reader.readUInt32()).toBe(0xffffffff);
  });

  it('readInt32 LE — positive and negative', () => {
    const buf = new Uint8Array(8);
    const view = new DataView(buf.buffer);
    view.setInt32(0, 42, true);
    view.setInt32(4, -1, true);
    const reader = new BufferReader(buf);
    expect(reader.readInt32()).toBe(42);
    expect(reader.readInt32()).toBe(-1);
  });

  it('readUInt64 LE', () => {
    const buf = new Uint8Array(8);
    const view = new DataView(buf.buffer);
    view.setBigUint64(0, 0x0102030405060708n, true);
    const reader = new BufferReader(buf);
    expect(reader.readUInt64()).toBe(0x0102030405060708n);
  });

  it('readInt64 LE — negative', () => {
    const buf = new Uint8Array(8);
    const view = new DataView(buf.buffer);
    view.setBigInt64(0, -1n, true);
    const reader = new BufferReader(buf);
    expect(reader.readInt64()).toBe(-1n);
  });

  it('max uint32', () => {
    const buf = new Uint8Array(4);
    writeU32LE(buf, 0, 0xffffffff);
    const reader = new BufferReader(buf);
    expect(reader.readUInt32()).toBe(0xffffffff);
  });

  it('max int32 as -1', () => {
    const buf = new Uint8Array(4);
    const view = new DataView(buf.buffer);
    view.setInt32(0, -1, true);
    const reader = new BufferReader(buf);
    expect(reader.readInt32()).toBe(-1);
  });
});

// ── Integer reads (BE, reversed) ────────────────────────────────────

describe('BufferReader — integer reads (BE / reversed)', () => {
  it('readUInt16 BE', () => {
    // 0x0102 stored as BE: [0x01, 0x02]
    const reader = new BufferReader(bytes(0x01, 0x02), true);
    expect(reader.readUInt16()).toBe(0x0102);
  });

  it('readUInt32 BE', () => {
    const buf = new Uint8Array(4);
    writeU32BE(buf, 0, 0x12345678);
    const reader = new BufferReader(buf, true);
    expect(reader.readUInt32()).toBe(0x12345678);
  });

  it('readInt32 BE', () => {
    const buf = new Uint8Array(4);
    const view = new DataView(buf.buffer);
    view.setInt32(0, -42, false);
    const reader = new BufferReader(buf, true);
    expect(reader.readInt32()).toBe(-42);
  });

  it('readUInt64 BE', () => {
    const buf = new Uint8Array(8);
    const view = new DataView(buf.buffer);
    view.setBigUint64(0, 0x0102030405060708n, false);
    const reader = new BufferReader(buf, true);
    expect(reader.readUInt64()).toBe(0x0102030405060708n);
  });

  it('readInt64 BE', () => {
    const buf = new Uint8Array(8);
    const view = new DataView(buf.buffer);
    view.setBigInt64(0, -999n, false);
    const reader = new BufferReader(buf, true);
    expect(reader.readInt64()).toBe(-999n);
  });
});

// ── readTag ─────────────────────────────────────────────────────────

describe('BufferReader — readTag', () => {
  it('reads 4 ASCII bytes as a string', () => {
    // "mhbd" = [0x6d, 0x68, 0x62, 0x64]
    const reader = new BufferReader(bytes(0x6d, 0x68, 0x62, 0x64));
    expect(reader.readTag()).toBe('mhbd');
  });

  it('reads "mhsd" tag', () => {
    const reader = new BufferReader(
      bytes(0x6d, 0x68, 0x73, 0x64) // "mhsd"
    );
    expect(reader.readTag()).toBe('mhsd');
  });

  it('tag is NOT affected by reversed flag', () => {
    // Even in BE mode, tags should read the same way
    const data = bytes(0x6d, 0x68, 0x62, 0x64); // "mhbd"
    const readerLE = new BufferReader(data, false);
    const readerBE = new BufferReader(data, true);
    expect(readerLE.readTag()).toBe('mhbd');
    expect(readerBE.readTag()).toBe('mhbd');
  });

  it('advances cursor by 4', () => {
    const reader = new BufferReader(new Uint8Array(8));
    reader.readTag();
    expect(reader.offset).toBe(4);
  });
});

// ── readUtf16 ───────────────────────────────────────────────────────

describe('BufferReader — readUtf16', () => {
  it('reads ASCII text as UTF-16LE', () => {
    const encoded = utf16le('Hello');
    const reader = new BufferReader(encoded);
    expect(reader.readUtf16(encoded.byteLength)).toBe('Hello');
  });

  it('reads CJK characters as UTF-16LE', () => {
    const str = '日本語';
    const encoded = utf16le(str);
    const reader = new BufferReader(encoded);
    expect(reader.readUtf16(encoded.byteLength)).toBe(str);
  });

  it('reads ASCII text as UTF-16BE (reversed)', () => {
    const encoded = utf16be('World');
    const reader = new BufferReader(encoded, true);
    expect(reader.readUtf16(encoded.byteLength)).toBe('World');
  });

  it('reads CJK characters as UTF-16BE (reversed)', () => {
    const str = '中文';
    const encoded = utf16be(str);
    const reader = new BufferReader(encoded, true);
    expect(reader.readUtf16(encoded.byteLength)).toBe(str);
  });

  it('reads zero-length string', () => {
    const reader = new BufferReader(new Uint8Array(4));
    expect(reader.readUtf16(0)).toBe('');
    expect(reader.offset).toBe(0);
  });

  it('advances cursor by byteLength', () => {
    const encoded = utf16le('AB');
    const reader = new BufferReader(encoded);
    reader.readUtf16(encoded.byteLength);
    expect(reader.offset).toBe(4); // 2 chars * 2 bytes
  });
});

// ── readBytes ───────────────────────────────────────────────────────

describe('BufferReader — readBytes', () => {
  it('returns correct bytes', () => {
    const reader = new BufferReader(bytes(0xaa, 0xbb, 0xcc, 0xdd));
    const result = reader.readBytes(2);
    expect(result).toEqual(bytes(0xaa, 0xbb));
  });

  it('zero-copy: shares the same ArrayBuffer', () => {
    const data = bytes(0x01, 0x02, 0x03);
    const reader = new BufferReader(data);
    const slice = reader.readBytes(2);
    expect(slice.buffer).toBe(data.buffer);
  });

  it('zero-length readBytes returns empty', () => {
    const reader = new BufferReader(bytes(0x01));
    const result = reader.readBytes(0);
    expect(result.byteLength).toBe(0);
    expect(reader.offset).toBe(0);
  });

  it('advances cursor by n', () => {
    const reader = new BufferReader(new Uint8Array(10));
    reader.readBytes(7);
    expect(reader.offset).toBe(7);
  });
});

// ── Cursor advancement ──────────────────────────────────────────────

describe('BufferReader — cursor advancement', () => {
  it('tracks offset across mixed reads', () => {
    const buf = new Uint8Array(1 + 2 + 4 + 4);
    const reader = new BufferReader(buf);

    reader.readUInt8(); // +1
    expect(reader.offset).toBe(1);

    reader.readUInt16(); // +2
    expect(reader.offset).toBe(3);

    reader.readUInt32(); // +4
    expect(reader.offset).toBe(7);

    reader.readTag(); // +4
    expect(reader.offset).toBe(11);
  });
});

// ── seek / skip ─────────────────────────────────────────────────────

describe('BufferReader — seek and skip', () => {
  it('seek sets cursor position', () => {
    const reader = new BufferReader(new Uint8Array(10));
    reader.seek(5);
    expect(reader.offset).toBe(5);
  });

  it('seek to 0 resets cursor', () => {
    const reader = new BufferReader(new Uint8Array(10));
    reader.readUInt8();
    reader.seek(0);
    expect(reader.offset).toBe(0);
  });

  it('seek to end is allowed', () => {
    const reader = new BufferReader(new Uint8Array(10));
    reader.seek(10);
    expect(reader.offset).toBe(10);
    expect(reader.remaining).toBe(0);
  });

  it('seek beyond end throws ParseError', () => {
    const reader = new BufferReader(new Uint8Array(4));
    expect(() => reader.seek(5)).toThrow(ParseError);
  });

  it('seek to negative throws ParseError', () => {
    const reader = new BufferReader(new Uint8Array(4));
    expect(() => reader.seek(-1)).toThrow(ParseError);
  });

  it('skip advances cursor', () => {
    const reader = new BufferReader(new Uint8Array(10));
    reader.skip(3);
    expect(reader.offset).toBe(3);
    reader.skip(7);
    expect(reader.offset).toBe(10);
  });

  it('skip beyond end throws ParseError', () => {
    const reader = new BufferReader(new Uint8Array(4));
    expect(() => reader.skip(5)).toThrow(ParseError);
  });
});

// ── slice ───────────────────────────────────────────────────────────

describe('BufferReader — slice', () => {
  it('creates a sub-reader over the specified range', () => {
    const data = bytes(0x00, 0x11, 0x22, 0x33, 0x44);
    const reader = new BufferReader(data);
    const sub = reader.slice(1, 4);
    expect(sub.length).toBe(3);
    expect(sub.readUInt8()).toBe(0x11);
    expect(sub.readUInt8()).toBe(0x22);
    expect(sub.readUInt8()).toBe(0x33);
  });

  it('inherits reversed flag', () => {
    const buf = new Uint8Array(4);
    writeU32BE(buf, 0, 0xaabbccdd);
    const reader = new BufferReader(buf, true);
    const sub = reader.slice(0, 4);
    expect(sub.readUInt32()).toBe(0xaabbccdd);
  });

  it('slice does not affect parent cursor', () => {
    const reader = new BufferReader(new Uint8Array(8));
    reader.slice(2, 6);
    expect(reader.offset).toBe(0);
  });

  it('throws on invalid range', () => {
    const reader = new BufferReader(new Uint8Array(4));
    expect(() => reader.slice(-1, 2)).toThrow(ParseError);
    expect(() => reader.slice(0, 5)).toThrow(ParseError);
    expect(() => reader.slice(3, 1)).toThrow(ParseError);
  });
});

// ── length / remaining ──────────────────────────────────────────────

describe('BufferReader — length and remaining', () => {
  it('length returns total byte length', () => {
    const reader = new BufferReader(new Uint8Array(42));
    expect(reader.length).toBe(42);
  });

  it('remaining decreases as data is read', () => {
    const reader = new BufferReader(new Uint8Array(10));
    expect(reader.remaining).toBe(10);
    reader.readUInt8();
    expect(reader.remaining).toBe(9);
    reader.skip(4);
    expect(reader.remaining).toBe(5);
  });
});

// ── Bounds checking ─────────────────────────────────────────────────

describe('BufferReader — bounds checking', () => {
  it('readUInt8 past end throws ParseError', () => {
    const reader = new BufferReader(new Uint8Array(0));
    expect(() => reader.readUInt8()).toThrow(ParseError);
  });

  it('readUInt16 past end throws ParseError', () => {
    const reader = new BufferReader(new Uint8Array(1));
    expect(() => reader.readUInt16()).toThrow(ParseError);
  });

  it('readUInt32 past end throws ParseError', () => {
    const reader = new BufferReader(new Uint8Array(3));
    expect(() => reader.readUInt32()).toThrow(ParseError);
  });

  it('readInt32 past end throws ParseError', () => {
    const reader = new BufferReader(new Uint8Array(2));
    expect(() => reader.readInt32()).toThrow(ParseError);
  });

  it('readUInt64 past end throws ParseError', () => {
    const reader = new BufferReader(new Uint8Array(7));
    expect(() => reader.readUInt64()).toThrow(ParseError);
  });

  it('readInt64 past end throws ParseError', () => {
    const reader = new BufferReader(new Uint8Array(4));
    expect(() => reader.readInt64()).toThrow(ParseError);
  });

  it('readTag past end throws ParseError', () => {
    const reader = new BufferReader(new Uint8Array(3));
    expect(() => reader.readTag()).toThrow(ParseError);
  });

  it('readUtf16 past end throws ParseError', () => {
    const reader = new BufferReader(new Uint8Array(3));
    expect(() => reader.readUtf16(4)).toThrow(ParseError);
  });

  it('readBytes past end throws ParseError', () => {
    const reader = new BufferReader(new Uint8Array(2));
    expect(() => reader.readBytes(3)).toThrow(ParseError);
  });

  it('ParseError includes correct offset', () => {
    const reader = new BufferReader(new Uint8Array(4));
    reader.skip(3);
    try {
      reader.readUInt32();
      expect(true).toBe(false); // should not reach
    } catch (e) {
      expect(e).toBeInstanceOf(ParseError);
      expect((e as ParseError).offset).toBe(3);
    }
  });
});

// ── Empty buffer ────────────────────────────────────────────────────

describe('BufferReader — empty buffer', () => {
  it('constructor works with empty Uint8Array', () => {
    const reader = new BufferReader(new Uint8Array(0));
    expect(reader.length).toBe(0);
    expect(reader.remaining).toBe(0);
    expect(reader.offset).toBe(0);
  });

  it('any read on empty buffer throws', () => {
    const reader = new BufferReader(new Uint8Array(0));
    expect(() => reader.readUInt8()).toThrow(ParseError);
    expect(() => reader.readUInt16()).toThrow(ParseError);
    expect(() => reader.readUInt32()).toThrow(ParseError);
    expect(() => reader.readTag()).toThrow(ParseError);
  });

  it('readBytes(0) on empty buffer succeeds', () => {
    const reader = new BufferReader(new Uint8Array(0));
    const result = reader.readBytes(0);
    expect(result.byteLength).toBe(0);
  });

  it('readUtf16(0) on empty buffer succeeds', () => {
    const reader = new BufferReader(new Uint8Array(0));
    expect(reader.readUtf16(0)).toBe('');
  });
});

// ── Offset with non-zero byteOffset ─────────────────────────────────

describe('BufferReader — Uint8Array with non-zero byteOffset', () => {
  it('handles a subarray view correctly', () => {
    // Simulate a Uint8Array that doesn't start at buffer offset 0
    const full = new Uint8Array(16);
    writeU32LE(full, 4, 0xdeadbeef);
    const sub = full.subarray(4, 8);
    const reader = new BufferReader(sub);
    expect(reader.readUInt32()).toBe(0xdeadbeef);
  });
});
