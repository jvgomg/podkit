import { describe, expect, test } from 'bun:test';
import {
  classifyEntries,
  isJunkEntry,
  isWhitelistEntry,
  IPOD_DATA_WHITELIST,
} from './volume-classifier.js';

describe('isWhitelistEntry', () => {
  test('recognises every known iPod data directory', () => {
    for (const name of IPOD_DATA_WHITELIST) {
      expect(isWhitelistEntry(name)).toBe(true);
    }
  });

  test('is case-insensitive (FAT32 volumes vary case)', () => {
    expect(isWhitelistEntry('ipod_control')).toBe(true);
    expect(isWhitelistEntry('IPOD_CONTROL')).toBe(true);
    expect(isWhitelistEntry('Notes')).toBe(true);
  });

  test('rejects unrelated names', () => {
    expect(isWhitelistEntry('my-music.mp3')).toBe(false);
    expect(isWhitelistEntry('.DS_Store')).toBe(false);
  });
});

describe('isJunkEntry', () => {
  test('flags AppleDouble sidecar files', () => {
    expect(isJunkEntry('._iPod_Control')).toBe(true);
    expect(isJunkEntry('._anything')).toBe(true);
  });

  test('flags well-known Apple artefacts', () => {
    expect(isJunkEntry('.DS_Store')).toBe(true);
    expect(isJunkEntry('.Spotlight-V100')).toBe(true);
    expect(isJunkEntry('.fseventsd')).toBe(true);
    expect(isJunkEntry('.Trashes')).toBe(true);
    expect(isJunkEntry('.TemporaryItems')).toBe(true);
    expect(isJunkEntry('.apdisk')).toBe(true);
  });

  test('does not flag iPod data or user files', () => {
    expect(isJunkEntry('iPod_Control')).toBe(false);
    expect(isJunkEntry('mixtape.flac')).toBe(false);
    expect(isJunkEntry('.hidden-user-file')).toBe(false);
  });
});

describe('classifyEntries', () => {
  test('a clean stock iPod has zero foreign entries', () => {
    const result = classifyEntries([
      'iPod_Control',
      'Calendars',
      'Contacts',
      'Notes',
      // junk a Mac adds on mount
      '.DS_Store',
      '._iPod_Control',
      '.Spotlight-V100',
      '.fseventsd',
      '.Trashes',
    ]);

    expect(result.copy).toEqual(['iPod_Control', 'Calendars', 'Contacts', 'Notes']);
    expect(result.foreign).toEqual([]);
    expect(result.junk).toEqual([
      '.DS_Store',
      '._iPod_Control',
      '.Spotlight-V100',
      '.fseventsd',
      '.Trashes',
    ]);
  });

  test('user-added files land in foreign, not copy or junk', () => {
    const result = classifyEntries([
      'iPod_Control',
      'tax-return.pdf',
      'photos',
      '.DS_Store',
      'Notes',
    ]);

    expect(result.copy).toEqual(['iPod_Control', 'Notes']);
    expect(result.junk).toEqual(['.DS_Store']);
    expect(result.foreign).toEqual(['tax-return.pdf', 'photos']);
  });

  test('partitions are disjoint and cover every input', () => {
    const names = ['iPod_Control', 'foo', '.DS_Store', 'Notes', '._foo', 'bar'];
    const { copy, junk, foreign } = classifyEntries(names);
    const total = copy.length + junk.length + foreign.length;
    expect(total).toBe(names.length);
    const seen = new Set([...copy, ...junk, ...foreign]);
    expect(seen.size).toBe(names.length);
  });

  test('empty volume yields empty buckets', () => {
    expect(classifyEntries([])).toEqual({ copy: [], junk: [], foreign: [] });
  });
});
