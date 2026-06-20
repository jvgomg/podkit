import { describe, expect, test } from 'bun:test';
import { formatIpodLabel, formatIpodShortLabel } from './format.js';

// ── formatIpodLabel ─────────────────────────────────────────────────────────
//
// Per ADR-020 these formatters are the only place that decides on
// capitalisation, parenthesis, ordinal suffix, and variant placement.
// Tests below pin the contract directly so regressions in the table-driven
// `identify()` callers can be diagnosed at the formatter layer.

describe('formatIpodLabel', () => {
  test('renders family + ordinal alone (USB-source shape)', () => {
    expect(formatIpodLabel({ family: 'iPod nano', ordinal: 3 })).toBe('iPod nano (3rd Generation)');
    expect(formatIpodLabel({ family: 'iPod', ordinal: 5 })).toBe('iPod (5th Generation)');
    expect(formatIpodLabel({ family: 'iPod shuffle', ordinal: 1 })).toBe(
      'iPod shuffle (1st Generation)'
    );
  });

  test('renders rich variant + capacity + colour', () => {
    expect(
      formatIpodLabel({
        family: 'iPod nano',
        ordinal: 2,
        capacityGb: 4,
        color: 'Silver',
      })
    ).toBe('iPod nano 4GB Silver (2nd Generation)');
    expect(
      formatIpodLabel({
        family: 'iPod Classic',
        ordinal: 7,
        capacityGb: 160,
        color: 'Black',
      })
    ).toBe('iPod Classic 160GB Black (7th Generation)');
  });

  test('inserts variant tag between family and capacity', () => {
    expect(
      formatIpodLabel({
        family: 'iPod',
        ordinal: 4,
        capacityGb: 25,
        variant: 'U2',
      })
    ).toBe('iPod U2 25GB (4th Generation)');
    expect(
      formatIpodLabel({
        family: 'iPod Photo',
        ordinal: null,
        capacityGb: 20,
        variant: 'U2',
      })
    ).toBe('iPod Photo U2 20GB');
    expect(
      formatIpodLabel({
        family: 'iPod Video',
        ordinal: 5.5,
        capacityGb: 30,
        variant: 'U2',
      })
    ).toBe('iPod Video U2 30GB (5.5th Generation)');
  });

  test('renders 2015 refresh tag for nano 7G', () => {
    expect(
      formatIpodLabel({
        family: 'iPod nano',
        ordinal: 7,
        capacityGb: 16,
        color: 'Space Gray',
        variant: '2015',
      })
    ).toBe('iPod nano 2015 16GB Space Gray (7th Generation)');
  });

  test('drops the generation marker when ordinal is null (iPod Photo)', () => {
    expect(formatIpodLabel({ family: 'iPod Photo', ordinal: null })).toBe('iPod Photo');
    expect(formatIpodLabel({ family: 'iPod Photo', ordinal: null, capacityGb: 40 })).toBe(
      'iPod Photo 40GB'
    );
  });

  test('decimal ordinals render with -th', () => {
    expect(formatIpodLabel({ family: 'iPod Video', ordinal: 5.5 })).toBe(
      'iPod Video (5.5th Generation)'
    );
  });

  test('sub-GB capacities render in MB', () => {
    expect(formatIpodLabel({ family: 'iPod shuffle', ordinal: 1, capacityGb: 0.5 })).toBe(
      'iPod shuffle 512MB (1st Generation)'
    );
  });

  test('ordinal-suffix table covers 1st/2nd/3rd/4th', () => {
    expect(formatIpodLabel({ family: 'X', ordinal: 1 })).toBe('X (1st Generation)');
    expect(formatIpodLabel({ family: 'X', ordinal: 2 })).toBe('X (2nd Generation)');
    expect(formatIpodLabel({ family: 'X', ordinal: 3 })).toBe('X (3rd Generation)');
    expect(formatIpodLabel({ family: 'X', ordinal: 4 })).toBe('X (4th Generation)');
    expect(formatIpodLabel({ family: 'X', ordinal: 11 })).toBe('X (11th Generation)');
    expect(formatIpodLabel({ family: 'X', ordinal: 21 })).toBe('X (21st Generation)');
  });
});

// ── formatIpodShortLabel ────────────────────────────────────────────────────

describe('formatIpodShortLabel', () => {
  test('renders family + ordinalG', () => {
    expect(formatIpodShortLabel({ family: 'iPod nano', ordinal: 3 })).toBe('iPod nano 3G');
    expect(formatIpodShortLabel({ family: 'iPod Classic', ordinal: 6 })).toBe('iPod Classic 6G');
    expect(formatIpodShortLabel({ family: 'iPod', ordinal: 5 })).toBe('iPod 5G');
  });

  test('preserves decimal ordinals', () => {
    expect(formatIpodShortLabel({ family: 'iPod Video', ordinal: 5.5 })).toBe('iPod Video 5.5G');
  });

  test('returns family alone when ordinal is null', () => {
    expect(formatIpodShortLabel({ family: 'iPod Photo', ordinal: null })).toBe('iPod Photo');
  });
});
