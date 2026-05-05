/**
 * Structured plist parser
 *
 * Parses the Apple property list (plist) XML subset used in iPod
 * SysInfoExtended payloads. Supports dict, array, string, integer,
 * data (base64-decoded to Uint8Array), real (parsed as number), and
 * boolean elements.
 *
 * @module
 */

// =============================================================================
// PlistValue union
// =============================================================================

/** A plist dict element — key/value map. */
export type PlistDict = { type: 'dict'; value: Record<string, PlistValue> };

/** A plist array element — ordered list. */
export type PlistArray = { type: 'array'; value: PlistValue[] };

/** A plist string element. */
export type PlistString = { type: 'string'; value: string };

/**
 * A plist integer element.
 *
 * Parsed as `bigint` to preserve 64-bit values (e.g., FireWireGUID).
 * Downstream consumers (e.g., TASK-292.07) format as hex strings and
 * should use `Number(v.value)` only when the value is known to fit in
 * a safe integer.
 */
export type PlistInteger = { type: 'integer'; value: bigint };

/** A plist data element — base64-decoded to bytes. */
export type PlistData = { type: 'data'; value: Uint8Array };

/** A plist boolean element. */
export type PlistBoolean = { type: 'boolean'; value: boolean };

/** A plist real element — IEEE 754 double. */
export type PlistReal = { type: 'real'; value: number };

/**
 * Union of all plist value variants produced by `parsePlist`.
 * Use `plistValue.type` to narrow to a specific variant.
 */
export type PlistValue =
  | PlistDict
  | PlistArray
  | PlistString
  | PlistInteger
  | PlistData
  | PlistBoolean
  | PlistReal;

// =============================================================================
// XML entity map
// =============================================================================

const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

// =============================================================================
// Base64 decoder
// =============================================================================

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const BASE64_TABLE: Uint8Array = (() => {
  const t = new Uint8Array(128).fill(255);
  for (let i = 0; i < BASE64_CHARS.length; i++) {
    t[BASE64_CHARS.charCodeAt(i)] = i;
  }
  t['='.charCodeAt(0)] = 64; // pad sentinel
  return t;
})();

function decodeBase64(raw: string): Uint8Array {
  // Strip whitespace (newlines, spaces, tabs that Apple inserts for formatting)
  let s = raw.replace(/\s/g, '');
  if (s.length === 0) return new Uint8Array(0);

  // Pad to a multiple of 4 if needed (some Apple plist data elements omit
  // trailing '=' padding characters).
  const rem = s.length % 4;
  if (rem !== 0) {
    s = s + '='.repeat(4 - rem);
  }

  let outputLen = (s.length / 4) * 3;
  if (s[s.length - 1] === '=') outputLen--;
  if (s[s.length - 2] === '=') outputLen--;

  const out = new Uint8Array(outputLen);
  let outIdx = 0;

  for (let i = 0; i < s.length; i += 4) {
    const c0 = s.charCodeAt(i);
    const c1 = s.charCodeAt(i + 1);
    const c2 = s.charCodeAt(i + 2);
    const c3 = s.charCodeAt(i + 3);

    if (c0 >= 128 || c1 >= 128 || c2 >= 128 || c3 >= 128) {
      throw new Error(`plist: invalid base64 character in data element`);
    }

    const b0 = BASE64_TABLE[c0] ?? 255;
    const b1 = BASE64_TABLE[c1] ?? 255;
    const b2 = BASE64_TABLE[c2] ?? 255;
    const b3 = BASE64_TABLE[c3] ?? 255;

    if (b0 === 255 || b1 === 255) {
      throw new Error(`plist: invalid base64 character in data element`);
    }
    // b2 / b3 may be pad (64) — only invalid if not at end position
    if (b2 === 255 || b3 === 255) {
      throw new Error(`plist: invalid base64 character in data element`);
    }

    const n = ((b0 & 0x3f) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
    out[outIdx++] = (n >> 16) & 0xff;
    if (b2 !== 64) out[outIdx++] = (n >> 8) & 0xff;
    if (b3 !== 64) out[outIdx++] = n & 0xff;
  }

  return out.subarray(0, outIdx);
}

// =============================================================================
// Minimal XML scanner
// =============================================================================

/**
 * Hand-rolled XML scanner state.  We only need to handle the small
 * subset Apple uses in plist payloads; we do NOT implement a general
 * XML parser.
 */
class Scanner {
  private pos: number = 0;

  constructor(private readonly src: string) {}

  get done(): boolean {
    return this.pos >= this.src.length;
  }

  /** Remaining text from the current position (for error messages). */
  private context(): string {
    return JSON.stringify(this.src.slice(this.pos, this.pos + 40));
  }

  /** Advance past all ASCII whitespace. */
  skipWs(): void {
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        this.pos++;
      } else {
        break;
      }
    }
  }

  /** Peek at the character at the current position without consuming. */
  peek(): string {
    return this.src[this.pos] ?? '';
  }

  /** Check whether the remaining source starts with `s`. */
  startsWith(s: string): boolean {
    return this.src.startsWith(s, this.pos);
  }

  /** Consume exactly `s` or throw. */
  expect(s: string): void {
    if (!this.startsWith(s)) {
      throw new Error(
        `plist: expected ${JSON.stringify(s)} at position ${this.pos}, got ${this.context()}`
      );
    }
    this.pos += s.length;
  }

  /** Advance until we find `needle`, return the text before it, leave pos at needle start. */
  readUntil(needle: string): string {
    const idx = this.src.indexOf(needle, this.pos);
    if (idx === -1) {
      throw new Error(`plist: expected ${JSON.stringify(needle)} but reached end of input`);
    }
    const result = this.src.slice(this.pos, idx);
    this.pos = idx;
    return result;
  }

  /** Read an XML tag name (letters, digits, dot, hyphen, underscore, colon). */
  readTagName(): string {
    const start = this.pos;
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos] ?? '';
      if (
        (ch >= 'a' && ch <= 'z') ||
        (ch >= 'A' && ch <= 'Z') ||
        (ch >= '0' && ch <= '9') ||
        ch === '-' ||
        ch === '_' ||
        ch === '.' ||
        ch === ':'
      ) {
        this.pos++;
      } else {
        break;
      }
    }
    if (this.pos === start) {
      throw new Error(`plist: expected tag name at position ${this.pos}, got ${this.context()}`);
    }
    return this.src.slice(start, this.pos);
  }

  /**
   * Skip attributes in an opening tag, stopping at `>` or `/>`.
   * We only need this to tolerate the `version="1.0"` attribute on <plist>.
   */
  skipAttributes(): boolean {
    while (this.pos < this.src.length) {
      this.skipWs();
      if (this.startsWith('/>')) return true; // self-closing
      if (this.startsWith('>')) return false; // regular close
      // skip attribute: name="value" or name='value'
      this.readTagName();
      this.skipWs();
      if (this.startsWith('=')) {
        this.pos++;
        this.skipWs();
        const quote = this.src[this.pos];
        if (quote === '"' || quote === "'") {
          this.pos++;
          this.readUntil(quote);
          this.pos++; // consume the closing quote
        } else {
          throw new Error(`plist: expected quoted attribute value at position ${this.pos}`);
        }
      }
    }
    throw new Error('plist: truncated tag (no closing >)');
  }

  /**
   * Strip XML text entities (&amp; &lt; &gt; &quot; &apos;).
   */
  decodeEntities(text: string): string {
    if (!text.includes('&')) return text;
    return text.replace(/&([a-zA-Z]+);/g, (_match, name: string) => {
      const replacement = XML_ENTITIES[name];
      if (replacement === undefined) {
        throw new Error(`plist: unknown XML entity &${name};`);
      }
      return replacement;
    });
  }
}

// =============================================================================
// Recursive descent
// =============================================================================

function parseValue(sc: Scanner): PlistValue {
  sc.skipWs();
  if (!sc.startsWith('<')) {
    throw new Error(`plist: expected '<' at start of value, got ${JSON.stringify(sc.peek())}`);
  }

  // Peek at what tag is coming
  const savedPos = (sc as unknown as { pos: number }).pos;
  sc.expect('<');

  // Check for self-closing tags first
  if (sc.startsWith('true')) {
    sc.expect('true');
    // may be "true/>" or "true>"
    sc.skipWs();
    if (sc.startsWith('/>')) {
      sc.expect('/>');
    } else {
      sc.expect('>');
      sc.skipWs();
      sc.expect('</true>');
    }
    return { type: 'boolean', value: true };
  }

  if (sc.startsWith('false')) {
    sc.expect('false');
    sc.skipWs();
    if (sc.startsWith('/>')) {
      sc.expect('/>');
    } else {
      sc.expect('>');
      sc.skipWs();
      sc.expect('</false>');
    }
    return { type: 'boolean', value: false };
  }

  const tagName = sc.readTagName();
  const selfClose = sc.skipAttributes();

  switch (tagName) {
    case 'dict': {
      if (selfClose) return { type: 'dict', value: {} };
      return parseDict(sc);
    }

    case 'array': {
      if (selfClose) return { type: 'array', value: [] };
      return parseArray(sc);
    }

    case 'string': {
      if (selfClose) return { type: 'string', value: '' };
      sc.expect('>');
      const raw = sc.readUntil('</string>');
      sc.expect('</string>');
      return { type: 'string', value: sc.decodeEntities(raw) };
    }

    case 'integer': {
      if (selfClose) {
        throw new Error('plist: self-closing <integer/> is not valid');
      }
      sc.expect('>');
      const raw = sc.readUntil('</integer>').trim();
      sc.expect('</integer>');
      if (!/^-?\d+$/.test(raw)) {
        throw new Error(`plist: invalid integer value ${JSON.stringify(raw)}`);
      }
      return { type: 'integer', value: BigInt(raw) };
    }

    case 'real': {
      if (selfClose) {
        throw new Error('plist: self-closing <real/> is not valid');
      }
      sc.expect('>');
      const raw = sc.readUntil('</real>').trim();
      sc.expect('</real>');
      const n = parseFloat(raw);
      if (isNaN(n)) {
        throw new Error(`plist: invalid real value ${JSON.stringify(raw)}`);
      }
      return { type: 'real', value: n };
    }

    case 'data': {
      if (selfClose) return { type: 'data', value: new Uint8Array(0) };
      sc.expect('>');
      const raw = sc.readUntil('</data>');
      sc.expect('</data>');
      return { type: 'data', value: decodeBase64(raw) };
    }

    default:
      // Restore position to give a useful error
      (sc as unknown as { pos: number }).pos = savedPos;
      throw new Error(`plist: unknown element <${tagName}> at position ${savedPos}`);
  }
}

function parseDict(sc: Scanner): PlistDict {
  sc.expect('>');
  const result: Record<string, PlistValue> = {};

  while (true) {
    sc.skipWs();
    if (sc.startsWith('</dict>')) {
      sc.expect('</dict>');
      return { type: 'dict', value: result };
    }
    if (sc.done) {
      throw new Error('plist: truncated input inside <dict> (missing </dict>)');
    }

    // Expect a <key>...</key>
    sc.expect('<key>');
    const key = sc.decodeEntities(sc.readUntil('</key>'));
    sc.expect('</key>');
    sc.skipWs();

    const value = parseValue(sc);
    result[key] = value;
  }
}

function parseArray(sc: Scanner): PlistArray {
  sc.expect('>');
  const items: PlistValue[] = [];

  while (true) {
    sc.skipWs();
    if (sc.startsWith('</array>')) {
      sc.expect('</array>');
      return { type: 'array', value: items };
    }
    if (sc.done) {
      throw new Error('plist: truncated input inside <array> (missing </array>)');
    }

    // Apple SysInfoExtended arrays sometimes include a <key>label</key> before
    // each dict entry (acting as a named label, not a dict key).  We skip those
    // orphan <key> elements rather than failing.
    if (sc.startsWith('<key>')) {
      sc.expect('<key>');
      sc.readUntil('</key>');
      sc.expect('</key>');
      sc.skipWs();
      // If nothing follows (e.g. empty array with just a stray key) loop again
      continue;
    }

    items.push(parseValue(sc));
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse an Apple plist XML string into a structured `PlistValue` tree.
 *
 * Supports the subset of plist elements used in iPod SysInfoExtended payloads:
 * `<dict>`, `<array>`, `<string>`, `<integer>`, `<real>`, `<data>`,
 * `<true/>`, `<false/>`.
 *
 * Integer values are parsed as `bigint` to preserve 64-bit precision.
 * Real values are parsed as `number` (IEEE 754 double).
 * Data element bodies are base64-decoded to `Uint8Array`; whitespace inside
 * the base64 block is stripped before decoding.
 *
 * @param xml - Raw plist XML string (UTF-8 decoded to JS string).
 * @returns Structured plist value tree rooted at the top-level plist element.
 * @throws {Error} If the XML is malformed, contains unsupported element types,
 *   or contains invalid base64 in a `<data>` element.
 *
 * @example
 * ```typescript
 * import { parsePlist } from '@podkit/ipod-firmware';
 *
 * const plist = parsePlist(xmlString);
 * if (plist.type === 'dict') {
 *   const familyId = plist.value['FamilyID'];
 *   if (familyId?.type === 'integer') {
 *     console.log(Number(familyId.value)); // e.g. 120
 *   }
 * }
 * ```
 */
export function parsePlist(xml: string): PlistValue {
  const sc = new Scanner(xml);

  // Strip XML declaration: <?xml ... ?>
  sc.skipWs();
  while (sc.startsWith('<?')) {
    sc.readUntil('?>');
    sc.expect('?>');
    sc.skipWs();
  }

  // Strip DOCTYPE declaration: <!DOCTYPE ...>
  // DOCTYPE may contain nested [...] blocks; we use a simple depth counter
  while (sc.startsWith('<!')) {
    let depth = 1;
    sc.expect('<');
    sc.expect('!');
    while (!sc.done && depth > 0) {
      const ch = sc as unknown as { src: string; pos: number };
      if (ch.src[ch.pos] === '<') {
        depth++;
        ch.pos++;
      } else if (ch.src[ch.pos] === '>') {
        depth--;
        ch.pos++;
      } else {
        ch.pos++;
      }
    }
    sc.skipWs();
  }

  // Strip XML comments: <!-- ... -->
  while (sc.startsWith('<!--')) {
    sc.readUntil('-->');
    sc.expect('-->');
    sc.skipWs();
  }

  // Now expect <plist ...>
  sc.expect('<plist');
  const selfClosePlist = sc.skipAttributes();
  if (!selfClosePlist) {
    sc.expect('>');
  }

  sc.skipWs();

  // Parse the single root value inside <plist>
  const root = parseValue(sc);

  sc.skipWs();

  // Expect </plist> (unless plist was self-closing)
  if (!selfClosePlist) {
    sc.expect('</plist>');
  }

  sc.skipWs();

  return root;
}
