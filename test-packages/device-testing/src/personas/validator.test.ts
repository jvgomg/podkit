/**
 * Unit tests for the load-time persona validator.
 *
 * Each rule is tested via a table-driven negative case + a positive
 * baseline. The baseline persona is shaped just enough to satisfy the
 * `DevicePersona` type — fields not under test are filled with the
 * minimum that typechecks.
 */

import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type { DevicePersona } from './types.js';
import {
  ID_REGEX,
  MAX_DESCRIPTION_UTF16_BYTES,
  MAX_ID_ASCII_CHARS,
  validateDescription,
  validateId,
  validateInitialContentExists,
  validateInitialContentPaths,
  validatePersona,
} from './validator.js';

// ---------------------------------------------------------------------------
// Baseline shape — a minimal valid persona used as a positive starting point.
// Each negative test clones this and mutates exactly one field.
// ---------------------------------------------------------------------------

const baseline: DevicePersona = {
  id: 'valid-test-persona',
  description: 'Valid test persona',
  schemaVersion: 3,
  usbDescriptor: {
    vendorId: 0x05ac,
    productId: 0x1209,
    deviceSerial: '000000000001',
    deviceClass: 0,
    deviceSubclass: 0,
    deviceProtocol: 0,
    bMaxPacketSize0: 64,
    bcdUSB: 0x0200,
    bcdDevice: 0x0001,
    bNumConfigurations: 1,
    configurations: [],
    stringDescriptors: {},
  },
  sysInfoExtendedXml: null,
  lsblkJson: null,
  systemProfilerJson: null,
  diskutilPlist: null,
  partitionLayout: { luns: [] },
  massStorageBackingFile: null,
  provenance: {
    provenanceDoc: 'provenance.md',
    source: 'synthesised',
  },
};

function clone(p: DevicePersona): DevicePersona {
  return JSON.parse(JSON.stringify(p));
}

// ---------------------------------------------------------------------------
// validateId
// ---------------------------------------------------------------------------

describe('validateId', () => {
  it('accepts kebab-case id within length cap', () => {
    expect(() => validateId({ id: 'ipod-5g-stale-guid' })).not.toThrow();
  });

  it('rejects empty id', () => {
    expect(() => validateId({ id: '' })).toThrow(/empty/);
  });

  it(`rejects id longer than ${MAX_ID_ASCII_CHARS} chars`, () => {
    const tooLong = 'a'.repeat(MAX_ID_ASCII_CHARS + 1);
    expect(() => validateId({ id: tooLong })).toThrow(/exceeds .* ASCII chars/);
  });

  it(`accepts id at exactly ${MAX_ID_ASCII_CHARS} chars`, () => {
    const atLimit = 'a'.repeat(MAX_ID_ASCII_CHARS);
    expect(() => validateId({ id: atLimit })).not.toThrow();
  });

  it.each([
    ['UPPERCASE', 'Ipod-Nano-3g'],
    ['underscore', 'ipod_nano_3g'],
    ['space', 'ipod nano 3g'],
    ['slash', 'ipod/nano'],
    ['dot', 'ipod.nano'],
  ] as const)('rejects illegal char (%s) in id', (_label, badId) => {
    expect(() => validateId({ id: badId })).toThrow(/must match/);
  });

  it('exposes the regex shape for callers / debugging', () => {
    expect(ID_REGEX.test('ipod-5g')).toBe(true);
    expect(ID_REGEX.test('Bad')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateDescription
// ---------------------------------------------------------------------------

describe('validateDescription', () => {
  it('accepts short ASCII description', () => {
    expect(() => validateDescription({ id: 'p', description: 'A short label' })).not.toThrow();
  });

  it(`rejects description over ${MAX_DESCRIPTION_UTF16_BYTES} UTF-16-LE bytes`, () => {
    // ASCII chars = 1 code unit = 2 bytes each.
    const codeUnits = MAX_DESCRIPTION_UTF16_BYTES / 2 + 1;
    const tooLong = 'x'.repeat(codeUnits);
    expect(() => validateDescription({ id: 'p', description: tooLong })).toThrow(
      /exceeds USB string descriptor budget/
    );
  });

  it(`accepts description at exactly ${MAX_DESCRIPTION_UTF16_BYTES} bytes`, () => {
    const codeUnits = MAX_DESCRIPTION_UTF16_BYTES / 2;
    const atLimit = 'x'.repeat(codeUnits);
    expect(() => validateDescription({ id: 'p', description: atLimit })).not.toThrow();
  });

  it('counts non-BMP chars as 2 code units (surrogate pair)', () => {
    // 🎵 (U+1F3B5) = 2 code units = 4 bytes.
    // Budget for emoji-only descriptions is MAX/4 emoji.
    const overByOneEmoji = '🎵'.repeat(MAX_DESCRIPTION_UTF16_BYTES / 4 + 1);
    expect(() => validateDescription({ id: 'p', description: overByOneEmoji })).toThrow(
      /exceeds USB string descriptor budget/
    );
  });

  it('names the persona id in the error', () => {
    const tooLong = 'x'.repeat(MAX_DESCRIPTION_UTF16_BYTES);
    expect(() => validateDescription({ id: 'my-broken-persona', description: tooLong })).toThrow(
      /my-broken-persona/
    );
  });
});

// ---------------------------------------------------------------------------
// validateInitialContentPaths
// ---------------------------------------------------------------------------

describe('validateInitialContentPaths', () => {
  it('accepts a persona with no massStorageBackingFile', () => {
    expect(() => validateInitialContentPaths(baseline)).not.toThrow();
  });

  it('accepts a persona with synthesis but no initialContent', () => {
    const p = clone(baseline);
    p.massStorageBackingFile = {
      synthesis: { sizeMiB: 1, filesystem: 'FAT32', label: 'TEST' },
      resetStrategy: 'copy',
    };
    expect(() => validateInitialContentPaths(p)).not.toThrow();
  });

  it('accepts sourceFixture inside the persona dir', () => {
    const p = clone(baseline);
    p.massStorageBackingFile = {
      synthesis: {
        sizeMiB: 1,
        filesystem: 'FAT32',
        label: 'TEST',
        initialContent: [{ path: 'iPod_Control/iTunes/iTunesDB', sourceFixture: 'raw/itdb.bin' }],
      },
      resetStrategy: 'copy',
    };
    expect(() => validateInitialContentPaths(p)).not.toThrow();
  });

  it('rejects sourceFixture containing ".." segment', () => {
    const p = clone(baseline);
    p.massStorageBackingFile = {
      synthesis: {
        sizeMiB: 1,
        filesystem: 'FAT32',
        label: 'TEST',
        initialContent: [{ path: 'a', sourceFixture: '../sibling/raw/foo.bin' }],
      },
      resetStrategy: 'copy',
    };
    expect(() => validateInitialContentPaths(p)).toThrow(/must not contain '\.\.'/);
  });

  it('rejects empty sourceFixture', () => {
    const p = clone(baseline);
    p.massStorageBackingFile = {
      synthesis: {
        sizeMiB: 1,
        filesystem: 'FAT32',
        label: 'TEST',
        initialContent: [{ path: 'a', sourceFixture: '' }],
      },
      resetStrategy: 'copy',
    };
    expect(() => validateInitialContentPaths(p)).toThrow(/empty sourceFixture/);
  });
});

// ---------------------------------------------------------------------------
// validatePersona — orchestrator
// ---------------------------------------------------------------------------

describe('validatePersona', () => {
  it('passes a fully-valid baseline', () => {
    expect(() => validatePersona(baseline)).not.toThrow();
  });

  it('reports id error before description error (id is the diagnostic anchor)', () => {
    const p = clone(baseline);
    p.id = 'BAD_ID';
    p.description = 'x'.repeat(MAX_DESCRIPTION_UTF16_BYTES + 1);
    expect(() => validatePersona(p)).toThrow(/must match/);
  });
});

// ---------------------------------------------------------------------------
// validateInitialContentExists — fs-side check
// ---------------------------------------------------------------------------

describe('validateInitialContentExists', () => {
  it('accepts a persona with no synthesis', () => {
    expect(() => validateInitialContentExists(baseline, '/tmp/whatever')).not.toThrow();
  });

  it('passes when the sourceFixture file actually exists on disk', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'persona-validator-'));
    try {
      const raw = path.join(dir, 'raw');
      mkdirSync(raw);
      writeFileSync(path.join(raw, 'itdb.bin'), 'fake');

      const p = clone(baseline);
      p.massStorageBackingFile = {
        synthesis: {
          sizeMiB: 1,
          filesystem: 'FAT32',
          label: 'TEST',
          initialContent: [{ path: 'a', sourceFixture: 'raw/itdb.bin' }],
        },
        resetStrategy: 'copy',
      };
      expect(() => validateInitialContentExists(p, dir)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws on typoed sourceFixture (file not present)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'persona-validator-'));
    try {
      const p = clone(baseline);
      p.massStorageBackingFile = {
        synthesis: {
          sizeMiB: 1,
          filesystem: 'FAT32',
          label: 'TEST',
          initialContent: [{ path: 'a', sourceFixture: 'raw/missing.bin' }],
        },
        resetStrategy: 'copy',
      };
      expect(() => validateInitialContentExists(p, dir)).toThrow(/not found/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws when sourceFixture resolves outside the persona dir', () => {
    // Even with a fake fs that "exists everywhere", the path check fires first.
    const fakeFs = { existsSync: () => true, statSync: () => ({ isFile: () => true }) };
    const p = clone(baseline);
    p.massStorageBackingFile = {
      synthesis: {
        sizeMiB: 1,
        filesystem: 'FAT32',
        label: 'TEST',
        // Absolute path escapes personaDir.
        initialContent: [{ path: 'a', sourceFixture: '/etc/passwd' }],
      },
      resetStrategy: 'copy',
    };
    expect(() => validateInitialContentExists(p, '/persona/root', fakeFs)).toThrow(
      /resolves outside the persona directory/
    );
  });
});

// ---------------------------------------------------------------------------
// Registry-wide sanity — every shipped persona passes the validator.
// ---------------------------------------------------------------------------

describe('all registered personas', () => {
  it('every shipped persona passes validatePersona', async () => {
    // Dynamic import keeps this test independent of the registry hook
    // landing — once index.ts calls validatePersona on every entry, this
    // test still asserts the same property at the unit level.
    const { personas } = await import('./index.js');
    for (const persona of personas.values()) {
      expect(() => validatePersona(persona)).not.toThrow();
    }
  });
});
