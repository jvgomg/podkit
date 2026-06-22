import { describe, expect, test } from 'bun:test';
import {
  buildOutputDirName,
  formatTimestamp,
  resolveIdentityToken,
  sanitizeSegment,
} from './output-naming.js';

const FIXED = new Date(Date.UTC(2026, 5, 22, 9, 7, 3)); // 2026-06-22 09:07:03 UTC

describe('sanitizeSegment', () => {
  test('replaces filesystem-illegal characters', () => {
    expect(sanitizeSegment('a/b\\c:d*e?f')).toBe('a_b_c_d_e_f');
  });

  test('strips leading/trailing dots and spaces', () => {
    expect(sanitizeSegment('  .TERAPOD.  ')).toBe('TERAPOD');
  });

  test('collapses whitespace runs', () => {
    expect(sanitizeSegment('My   iPod')).toBe('My_iPod');
  });

  test('returns empty string for all-illegal input', () => {
    expect(sanitizeSegment('   ')).toBe('');
    expect(sanitizeSegment('...')).toBe('');
  });
});

describe('formatTimestamp', () => {
  test('renders a sortable separator-free UTC stamp', () => {
    expect(formatTimestamp(FIXED)).toBe('20260622-090703');
  });
});

describe('resolveIdentityToken', () => {
  test('prefers serial over firewire over volume label', () => {
    expect(
      resolveIdentityToken({ serialNumber: 'ABC123', firewireGuid: 'DEAD', volumeLabel: 'IPOD' })
    ).toBe('ABC123');
  });

  test('falls back to firewire when serial absent', () => {
    expect(resolveIdentityToken({ firewireGuid: '000A2700', volumeLabel: 'IPOD' })).toBe(
      '000A2700'
    );
  });

  test('falls back to volume label when serial and firewire absent', () => {
    expect(resolveIdentityToken({ volumeLabel: 'TERAPOD' })).toBe('TERAPOD');
  });

  test('returns undefined when nothing usable is present', () => {
    expect(resolveIdentityToken({})).toBeUndefined();
    expect(resolveIdentityToken({ serialNumber: '   ' })).toBeUndefined();
  });
});

describe('buildOutputDirName', () => {
  test('full form: deviceName-serial-timestamp', () => {
    expect(buildOutputDirName({ deviceName: 'TERAPOD', serialNumber: 'F9GXYZ123' }, FIXED)).toBe(
      'TERAPOD-F9GXYZ123-20260622-090703'
    );
  });

  test('degrades to firewire when serial is absent', () => {
    expect(
      buildOutputDirName({ deviceName: 'TERAPOD', firewireGuid: '000A270012345678' }, FIXED)
    ).toBe('TERAPOD-000A270012345678-20260622-090703');
  });

  test('degrades to volume label when serial and firewire are absent', () => {
    expect(buildOutputDirName({ deviceName: 'My iPod', volumeLabel: 'IPOD' }, FIXED)).toBe(
      'My_iPod-IPOD-20260622-090703'
    );
  });

  test('does not duplicate the label when it equals the device name', () => {
    expect(buildOutputDirName({ deviceName: 'IPOD', volumeLabel: 'IPOD' }, FIXED)).toBe(
      'IPOD-20260622-090703'
    );
  });

  test('timestamp-only when no identity at all', () => {
    expect(buildOutputDirName({}, FIXED)).toBe('20260622-090703');
  });

  test('never produces an empty name', () => {
    expect(buildOutputDirName({ deviceName: '   ', volumeLabel: '...' }, FIXED)).toBe(
      '20260622-090703'
    );
  });
});
