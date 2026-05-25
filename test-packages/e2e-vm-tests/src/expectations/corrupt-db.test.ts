/**
 * unit smoke tests for the `ipod-video-5g-corrupt-db` persona + expectations.
 *
 * Separate from `rejection-personas.test.ts` because this is not a rejection
 * persona — the USB classifier accepts the device as a supported iPod 5G
 * Video; the iTunesDB parser is the layer that fails.
 *
 * Pins the synthesis recipe (real iPod 5G identity + deliberately-truncated
 * iTunesDB) so future schema changes can't accidentally un-corrupt the
 * fixture or misclassify the persona's expected failure mode.
 *
 * @module
 */

import { describe, it, expect } from 'bun:test';
import { parseDatabase } from '@podkit/ipod-db';
import { ipodVideo5gCorruptDb, corruptItunesDb, personas } from '@podkit/device-testing';
import * as expectations from './ipod-video-5g-corrupt-db.js';

describe('ipod-video-5g-corrupt-db persona (synthesised)', () => {
  it('is registered in the persona registry under its declared id', () => {
    expect(personas.get('ipod-video-5g-corrupt-db')).toBe(ipodVideo5gCorruptDb);
  });

  it('mirrors a real supported iPod 5G Video USB identity', () => {
    // Same PID as `ipod-video-5g-iflash-1tb` — the classifier accepts it.
    expect(ipodVideo5gCorruptDb.usbDescriptor.vendorId).toBe(0x05ac);
    expect(ipodVideo5gCorruptDb.usbDescriptor.productId).toBe(0x1209);
    expect(ipodVideo5gCorruptDb.usbDescriptor.deviceSerial?.length ?? 0).toBeGreaterThan(0);
  });

  it('ships a valid SIE XML payload (SIE parse succeeds; DB parse is the fault)', () => {
    // The SIE XML is shared from the real TERAPOD persona. A well-formed
    // SIE means the classifier and SIE layer pass cleanly — only the DB
    // layer fails. This confirms the persona tests "DB layer" not "SIE layer".
    expect(typeof ipodVideo5gCorruptDb.sysInfoExtendedXml).toBe('string');
    expect(ipodVideo5gCorruptDb.sysInfoExtendedXml).not.toBeNull();
    // The full iPod 5G SIE XML is 9,693 bytes — sanity-check it's > 1 kB.
    expect(ipodVideo5gCorruptDb.sysInfoExtendedXml!.length).toBeGreaterThan(1000);
  });

  describe('corruptItunesDb binary', () => {
    it('is exactly 512 bytes', () => {
      expect(corruptItunesDb).toBeInstanceOf(Uint8Array);
      expect(corruptItunesDb.byteLength).toBe(512);
    });

    it('starts with mhbd magic (bytes 0-3)', () => {
      // Synthesis recipe: 4-byte `mhbd` LE ASCII + 508 zero bytes.
      expect(corruptItunesDb[0]).toBe(0x6d); // 'm'
      expect(corruptItunesDb[1]).toBe(0x68); // 'h'
      expect(corruptItunesDb[2]).toBe(0x62); // 'b'
      expect(corruptItunesDb[3]).toBe(0x64); // 'd'
    });

    it('has headerLen = 0 (bytes 4-7 are all zero)', () => {
      // `parseMhbd` reads a LE uint32 at offset 4 for `headerLen`.
      // Zero triggers "mhbd header too small" (< 32 bytes).
      expect(corruptItunesDb[4]).toBe(0);
      expect(corruptItunesDb[5]).toBe(0);
      expect(corruptItunesDb[6]).toBe(0);
      expect(corruptItunesDb[7]).toBe(0);
    });

    it('parseDatabase throws when given the truncated iTunesDB — the path under test', () => {
      // The whole point of this persona: `parseDatabase` must fail on this
      // input. `parseMhbd` reads `headerLen = 0` and throws.
      // If a future parser becomes lenient enough to accept headerLen = 0,
      // the persona needs a more aggressive corruption — see provenance.md.
      expect(() => parseDatabase(corruptItunesDb)).toThrow();
    });

    it('parseDatabase error mentions header size', () => {
      // The exact error wording from `parseMhbd`:
      // "mhbd header too small" — assert the prefix so internal
      // improvements don't break the fixture.
      let err: Error | null = null;
      try {
        parseDatabase(corruptItunesDb);
      } catch (e) {
        err = e as Error;
      }
      expect(err).not.toBeNull();
      expect(err!.message).toMatch(/header|too small|too short/i);
    });
  });

  it('expectedReadiness.level === needs-repair (database stage, not SIE stage)', () => {
    expect(expectations.expectedReadiness.level).toBe('needs-repair');
  });

  it('expectedReadiness has a single failed database stage', () => {
    const stages = expectations.expectedReadiness.stages;
    expect(stages).toHaveLength(1);
    expect(stages[0]?.stage).toBe('database');
    expect(stages[0]?.status).toBe('fail');
    expect(stages[0]?.details?.truncated).toBe(true);
    expect(stages[0]?.details?.dbBytes).toBe(512);
  });

  it('exposes the iPod 5G Video nominal capability set (identity recoverable from USB PID)', () => {
    // Capabilities are derivable from USB PID even without a working DB.
    expect(expectations.expectedCapabilities).not.toBeNull();
    expect(expectations.expectedCapabilities?.supportsVideo).toBe(true);
    expect(expectations.expectedCapabilities?.artworkMaxResolution).toBe(200);
  });

  it('has a FAT32 backing file synthesis recipe with initialContent', () => {
    const backing = ipodVideo5gCorruptDb.massStorageBackingFile;
    expect(backing).not.toBeNull();
    expect(backing?.synthesis).toBeDefined();
    expect(backing?.synthesis?.filesystem).toBe('FAT32');
    const content = backing?.synthesis?.initialContent;
    expect(content).toBeDefined();
    expect(content!.length).toBeGreaterThan(0);
    // The corrupt iTunesDB must be seeded at the canonical iPod DB path.
    const dbEntry = content!.find((c) => c.path.includes('iTunesDB'));
    expect(dbEntry).toBeDefined();
  });

  it('is marked synthesised in its provenance', () => {
    expect(ipodVideo5gCorruptDb.provenance.source).toBe('synthesised');
  });
});
