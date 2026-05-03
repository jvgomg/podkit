import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePlist, type PlistDict, type PlistValue } from './parser.js';

// =============================================================================
// Helpers
// =============================================================================

/** Resolve a path relative to the repository root. */
function repoPath(...parts: string[]): string {
  // import.meta.dir is packages/ipod-firmware/src/plist — 4 levels down from repo root
  return join(import.meta.dir, '../../../..', ...parts);
}

function loadFixture(name: string): string {
  return readFileSync(repoPath('documents/sysinfo-captures', `${name}.xml`), 'utf-8');
}

/** Assert the root is a dict and return its value map. */
function rootDict(result: PlistValue): Record<string, PlistValue> {
  expect(result.type).toBe('dict');
  return (result as PlistDict).value;
}

// =============================================================================
// Fixture round-trip tests (one per captured XML)
// =============================================================================

describe('fixture round-trip', () => {
  test('ipod-5g-video-iflash-1tb.xml parses without error', () => {
    const xml = loadFixture('ipod-5g-video-iflash-1tb');
    const result = parsePlist(xml);
    const d = rootDict(result);

    // Spot-check a few known keys
    expect(d['FamilyID']?.type).toBe('integer');
    expect((d['FamilyID'] as { type: 'integer'; value: bigint }).value).toBe(6n);
    expect(d['SerialNumber']?.type).toBe('string');
    expect(d['ConnectedBus']?.type).toBe('string');
  });

  test('mini-2g.xml parses without error', () => {
    const xml = loadFixture('mini-2g');
    const result = parsePlist(xml);
    const d = rootDict(result);

    expect(d['SerialNumber']?.type).toBe('string');
    expect((d['SerialNumber'] as { type: 'string'; value: string }).value).toBe('JQ5141TFS4G');
    expect(d['FamilyID']?.type).toBe('integer');
    expect((d['FamilyID'] as { type: 'integer'; value: bigint }).value).toBe(3n);
  });

  test('nano-2g-4gb-green.xml parses without error', () => {
    const xml = loadFixture('nano-2g-4gb-green');
    const result = parsePlist(xml);
    const d = rootDict(result);

    // FireWireGUID is a string in this fixture (not integer)
    expect(d['FireWireGUID']?.type).toBe('string');
    expect(d['SerialNumber']?.type).toBe('string');
    expect((d['SerialNumber'] as { type: 'string'; value: string }).value).toBe('YM7275YSVQH');
    expect(d['FamilyID']?.type).toBe('integer');
    expect((d['FamilyID'] as { type: 'integer'; value: bigint }).value).toBe(9n);
  });

  test('nano-4g-8gb-black.xml parses without error', () => {
    const xml = loadFixture('nano-4g-8gb-black');
    const result = parsePlist(xml);
    const d = rootDict(result);

    expect(d['FamilyID']?.type).toBe('integer');
    expect(d['rbsync']?.type).toBe('data');
    expect((d['rbsync'] as { type: 'data'; value: Uint8Array }).value.length).toBeGreaterThan(0);
    expect(d['SerialNumber']?.type).toBe('string');
  });

  test('nano-7g-16gb-scsi.xml parses without error', () => {
    const xml = loadFixture('nano-7g-16gb-scsi');
    const result = parsePlist(xml);
    const d = rootDict(result);

    expect(d['FamilyID']?.type).toBe('integer');
    expect((d['FamilyID'] as { type: 'integer'; value: bigint }).value).toBe(18n);
    expect(d['SerialNumber']?.type).toBe('string');
    expect(d['rbsync']?.type).toBe('data');
  });

  test('nano-7g-16gb-usb.xml parses without error', () => {
    const xml = loadFixture('nano-7g-16gb-usb');
    const result = parsePlist(xml);
    const d = rootDict(result);

    expect(d['FamilyID']?.type).toBe('integer');
    expect(d['SerialNumber']?.type).toBe('string');
    // Check empty arrays
    expect(d['AlbumArt']?.type).toBe('array');
    expect((d['AlbumArt'] as { type: 'array'; value: PlistValue[] }).value).toHaveLength(0);
  });
});

// =============================================================================
// Element type coverage (hand-written minimal XML)
// =============================================================================

describe('element types', () => {
  const wrap = (inner: string) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict>${inner}</dict></plist>`;

  test('<dict> element', () => {
    const xml = wrap('<key>nested</key><dict><key>a</key><string>b</string></dict>');
    const d = rootDict(parsePlist(xml));
    expect(d['nested']?.type).toBe('dict');
    const inner = (d['nested'] as PlistDict).value;
    expect((inner['a'] as { type: 'string'; value: string }).value).toBe('b');
  });

  test('<array> element', () => {
    const xml = wrap('<key>list</key><array><string>x</string><string>y</string></array>');
    const d = rootDict(parsePlist(xml));
    expect(d['list']?.type).toBe('array');
    const arr = (d['list'] as { type: 'array'; value: PlistValue[] }).value;
    expect(arr).toHaveLength(2);
    expect((arr[0] as { type: 'string'; value: string }).value).toBe('x');
  });

  test('<string> element', () => {
    const xml = wrap('<key>s</key><string>hello</string>');
    const d = rootDict(parsePlist(xml));
    expect(d['s']?.type).toBe('string');
    expect((d['s'] as { type: 'string'; value: string }).value).toBe('hello');
  });

  test('<integer> element (parses as bigint)', () => {
    const xml = wrap('<key>n</key><integer>42</integer>');
    const d = rootDict(parsePlist(xml));
    expect(d['n']?.type).toBe('integer');
    expect((d['n'] as { type: 'integer'; value: bigint }).value).toBe(42n);
  });

  test('<integer> element large 64-bit value', () => {
    // 2^40 + 1 — exceeds Number.MAX_SAFE_INTEGER range for precision test
    const xml = wrap('<key>big</key><integer>1099511627777</integer>');
    const d = rootDict(parsePlist(xml));
    expect((d['big'] as { type: 'integer'; value: bigint }).value).toBe(1099511627777n);
  });

  test('<data> element (base64 decoded)', () => {
    // "hello" in base64 is "aGVsbG8="
    const xml = wrap('<key>d</key><data>aGVsbG8=</data>');
    const d = rootDict(parsePlist(xml));
    expect(d['d']?.type).toBe('data');
    const bytes = (d['d'] as { type: 'data'; value: Uint8Array }).value;
    expect(bytes).toEqual(new Uint8Array([104, 101, 108, 108, 111]));
  });

  test('<data> element with internal whitespace (multi-line base64)', () => {
    const xml = wrap('<key>d</key><data>\naGVs\nbG8=\n</data>');
    const d = rootDict(parsePlist(xml));
    const bytes = (d['d'] as { type: 'data'; value: Uint8Array }).value;
    expect(bytes).toEqual(new Uint8Array([104, 101, 108, 108, 111]));
  });

  test('<true/> element (self-closing)', () => {
    const xml = wrap('<key>t</key><true/>');
    const d = rootDict(parsePlist(xml));
    expect(d['t']?.type).toBe('boolean');
    expect((d['t'] as { type: 'boolean'; value: boolean }).value).toBe(true);
  });

  test('<false/> element (self-closing)', () => {
    const xml = wrap('<key>f</key><false/>');
    const d = rootDict(parsePlist(xml));
    expect(d['f']?.type).toBe('boolean');
    expect((d['f'] as { type: 'boolean'; value: boolean }).value).toBe(false);
  });

  test('XML entities in string values', () => {
    const xml = wrap(
      '<key>e</key><string>a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;</string>'
    );
    const d = rootDict(parsePlist(xml));
    expect((d['e'] as { type: 'string'; value: string }).value).toBe('a & b <c> "d" \'e\'');
  });

  test('<real> element', () => {
    const xml = wrap('<key>r</key><real>2.2</real>');
    const d = rootDict(parsePlist(xml));
    expect(d['r']?.type).toBe('real');
    expect((d['r'] as { type: 'real'; value: number }).value).toBeCloseTo(2.2);
  });

  test('empty <string> element', () => {
    const xml = wrap('<key>empty</key><string></string>');
    const d = rootDict(parsePlist(xml));
    expect((d['empty'] as { type: 'string'; value: string }).value).toBe('');
  });

  test('empty <dict> element', () => {
    const xml = wrap('<key>empty</key><dict></dict>');
    const d = rootDict(parsePlist(xml));
    expect(d['empty']?.type).toBe('dict');
    expect(Object.keys((d['empty'] as PlistDict).value)).toHaveLength(0);
  });

  test('empty <array> element', () => {
    const xml = wrap('<key>empty</key><array></array>');
    const d = rootDict(parsePlist(xml));
    expect(d['empty']?.type).toBe('array');
    expect((d['empty'] as { type: 'array'; value: PlistValue[] }).value).toHaveLength(0);
  });

  test('array with labeled entries (Apple-style <key> in array)', () => {
    // Seen in SysInfoExtended: arrays where each dict entry is preceded by a
    // label <key> that the parser skips.
    const xml = wrap(
      '<key>specs</key>' +
        '<array>' +
        '<key>1023</key><dict><key>FormatId</key><integer>1023</integer></dict>' +
        '</array>'
    );
    const d = rootDict(parsePlist(xml));
    const arr = (d['specs'] as { type: 'array'; value: PlistValue[] }).value;
    expect(arr).toHaveLength(1);
    expect(arr[0]?.type).toBe('dict');
    const entry = (arr[0] as PlistDict).value;
    expect((entry['FormatId'] as { type: 'integer'; value: bigint }).value).toBe(1023n);
  });
});

// =============================================================================
// Malformed input rejection
// =============================================================================

describe('malformed input rejection', () => {
  test('truncated XML throws', () => {
    expect(() => parsePlist('<plist version="1.0"><dict>')).toThrow(/plist:/);
  });

  test('missing </dict> closing tag throws', () => {
    expect(() =>
      parsePlist(
        '<?xml version="1.0"?><plist version="1.0"><dict><key>k</key><string>v</string></plist>'
      )
    ).toThrow(/plist:/);
  });

  test('missing </array> closing tag throws', () => {
    expect(() =>
      parsePlist('<?xml version="1.0"?><plist version="1.0"><array><string>x</string></plist>')
    ).toThrow(/plist:/);
  });

  test('unknown element throws', () => {
    expect(() =>
      parsePlist(
        '<?xml version="1.0"?><plist version="1.0"><dict><key>k</key><blob>x</blob></dict></plist>'
      )
    ).toThrow(/plist:.*unknown element/);
  });

  test('invalid base64 throws', () => {
    expect(() =>
      parsePlist(
        '<?xml version="1.0"?><plist version="1.0"><dict><key>d</key><data>!!!!</data></dict></plist>'
      )
    ).toThrow(/plist:/);
  });

  test('truly invalid base64 chars throw', () => {
    // Characters outside the base64 alphabet (e.g., '*') cause an error
    expect(() =>
      parsePlist(
        '<?xml version="1.0"?><plist version="1.0"><dict><key>d</key><data>****</data></dict></plist>'
      )
    ).toThrow(/plist:/);
  });

  test('unbalanced dict (extra closing tag) throws', () => {
    // The </dict> for the nested dict is missing, so the outer </plist> is
    // encountered where </dict> is expected.
    expect(() =>
      parsePlist('<?xml version="1.0"?><plist version="1.0"><dict><key>a</key><dict></plist>')
    ).toThrow(/plist:/);
  });

  test('unbalanced array (outer tag encountered inside) throws', () => {
    expect(() => parsePlist('<?xml version="1.0"?><plist version="1.0"><array></plist>')).toThrow(
      /plist:/
    );
  });

  test('invalid XML entity reference throws', () => {
    expect(() =>
      parsePlist(
        '<?xml version="1.0"?><plist version="1.0"><dict><key>k</key><string>&unknownentity;</string></dict></plist>'
      )
    ).toThrow(/plist:.*entity/);
  });
});
