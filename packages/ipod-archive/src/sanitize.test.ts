import { describe, expect, test } from 'bun:test';
import { sanitizeSegment, sanitizePathSegment } from './sanitize.js';

describe('sanitizeSegment (compact / underscore policy)', () => {
  test('replaces reserved characters', () => {
    expect(sanitizeSegment('a/b\\c:d*e?f')).toBe('a_b_c_d_e_f');
  });

  test('collapses whitespace to underscores', () => {
    expect(sanitizeSegment('My   iPod')).toBe('My_iPod');
  });

  test('strips leading/trailing dots and spaces', () => {
    expect(sanitizeSegment('  .TERAPOD.  ')).toBe('TERAPOD');
  });

  test('returns empty string for all-illegal input', () => {
    expect(sanitizeSegment('   ')).toBe('');
    expect(sanitizeSegment('...')).toBe('');
  });

  test('prefixes Windows reserved device names (with or without extension)', () => {
    expect(sanitizeSegment('CON')).toBe('_CON');
    expect(sanitizeSegment('nul.txt')).toBe('_nul.txt');
    expect(sanitizeSegment('LPT1')).toBe('_LPT1');
  });

  test('caps over-long segments at the byte limit without splitting code points', () => {
    const out = sanitizeSegment('x'.repeat(1000));
    expect(out.length).toBe(200);
  });

  test('normalises to NFC so decomposed and composed forms are byte-equal', () => {
    expect(sanitizeSegment('Café')).toBe(sanitizeSegment('Café'));
  });
});

describe('sanitizePathSegment (browsable / space-preserving policy)', () => {
  test('preserves interior spaces, collapsing runs', () => {
    expect(sanitizePathSegment('The   Band')).toBe('The Band');
  });

  test('still replaces reserved characters and control chars', () => {
    expect(sanitizePathSegment('AC/DC: Live')).toBe('AC_DC_ Live');
  });

  test('strips leading/trailing dots and spaces', () => {
    expect(sanitizePathSegment('  Album.  ')).toBe('Album');
  });

  test('prefixes reserved device names', () => {
    expect(sanitizePathSegment('PRN')).toBe('_PRN');
  });

  test('caps over-long segments at the byte limit', () => {
    expect(sanitizePathSegment('y'.repeat(1000)).length).toBe(200);
  });
});
