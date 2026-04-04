import { ParseError } from './errors.js';

const textDecoderLe = new TextDecoder('utf-16le' as ConstructorParameters<typeof TextDecoder>[0]);
const textDecoderBe = new TextDecoder('utf-16be' as ConstructorParameters<typeof TextDecoder>[0]);
const asciiDecoder = new TextDecoder('ascii' as ConstructorParameters<typeof TextDecoder>[0]);

/**
 * A cursor-based reader over a `Uint8Array` that uses `DataView` for
 * all integer reads, making it safe for both Node.js and browser
 * (Web Worker) environments.
 *
 * By default all multi-byte integers are read as **little-endian**
 * (the iPod native byte order). Pass `reversed = true` to switch to
 * big-endian mode (used by some older iPod firmware).
 */
export class BufferReader {
  private readonly data: Uint8Array;
  private readonly view: DataView;
  private readonly reversed: boolean;
  private cursor: number;

  constructor(data: Uint8Array, reversed: boolean = false) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.reversed = reversed;
    this.cursor = 0;
  }

  // ── Integer reads ───────────────────────────────────────────────

  readUInt8(): number {
    this.ensureAvailable(1);
    const value = this.view.getUint8(this.cursor);
    this.cursor += 1;
    return value;
  }

  readUInt16(): number {
    this.ensureAvailable(2);
    const value = this.view.getUint16(this.cursor, !this.reversed);
    this.cursor += 2;
    return value;
  }

  readUInt32(): number {
    this.ensureAvailable(4);
    const value = this.view.getUint32(this.cursor, !this.reversed);
    this.cursor += 4;
    return value;
  }

  readInt32(): number {
    this.ensureAvailable(4);
    const value = this.view.getInt32(this.cursor, !this.reversed);
    this.cursor += 4;
    return value;
  }

  readUInt64(): bigint {
    this.ensureAvailable(8);
    const value = this.view.getBigUint64(this.cursor, !this.reversed);
    this.cursor += 8;
    return value;
  }

  readInt64(): bigint {
    this.ensureAvailable(8);
    const value = this.view.getBigInt64(this.cursor, !this.reversed);
    this.cursor += 8;
    return value;
  }

  // ── String reads ────────────────────────────────────────────────

  /**
   * Read 4 ASCII bytes and return them as a string (e.g. "mhbd").
   * Tag byte order is always little-endian regardless of the
   * `reversed` flag.
   */
  readTag(): string {
    this.ensureAvailable(4);
    const bytes = this.data.subarray(this.cursor, this.cursor + 4);
    this.cursor += 4;
    return asciiDecoder.decode(bytes);
  }

  /**
   * Read `byteLength` bytes and decode as UTF-16.
   * Uses UTF-16LE by default, or UTF-16BE when `reversed` is true.
   */
  readUtf16(byteLength: number): string {
    this.ensureAvailable(byteLength);
    const bytes = this.data.subarray(this.cursor, this.cursor + byteLength);
    this.cursor += byteLength;
    const decoder = this.reversed ? textDecoderBe : textDecoderLe;
    return decoder.decode(bytes);
  }

  // ── Raw data ────────────────────────────────────────────────────

  /**
   * Return a zero-copy subarray of `n` bytes starting at the cursor.
   */
  readBytes(n: number): Uint8Array {
    this.ensureAvailable(n);
    const sub = this.data.subarray(this.cursor, this.cursor + n);
    this.cursor += n;
    return sub;
  }

  // ── Cursor control ──────────────────────────────────────────────

  get offset(): number {
    return this.cursor;
  }

  get length(): number {
    return this.data.byteLength;
  }

  get remaining(): number {
    return this.data.byteLength - this.cursor;
  }

  seek(position: number): void {
    if (position < 0 || position > this.data.byteLength) {
      throw new ParseError('Seek out of bounds', {
        offset: this.cursor,
        expected: `position in [0, ${this.data.byteLength}]`,
        actual: String(position),
      });
    }
    this.cursor = position;
  }

  skip(n: number): void {
    this.ensureAvailable(n);
    this.cursor += n;
  }

  // ── Utilities ───────────────────────────────────────────────────

  /**
   * Create a new `BufferReader` over a sub-range of the underlying
   * data, sharing the same `ArrayBuffer` (zero-copy).
   */
  slice(start: number, end: number): BufferReader {
    if (start < 0 || end > this.data.byteLength || start > end) {
      throw new ParseError('Slice out of bounds', {
        offset: this.cursor,
        expected: `range within [0, ${this.data.byteLength}]`,
        actual: `[${start}, ${end}]`,
      });
    }
    return new BufferReader(this.data.subarray(start, end), this.reversed);
  }

  // ── Internal ────────────────────────────────────────────────────

  private ensureAvailable(n: number): void {
    if (this.cursor + n > this.data.byteLength) {
      throw new ParseError('Unexpected end of data', {
        offset: this.cursor,
        expected: `${n} bytes`,
        actual: `${this.remaining} bytes remaining`,
      });
    }
  }
}
