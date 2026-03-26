/**
 * Tests for sync tag parsing, formatting, comparison, and building.
 *
 * Sync tags are metadata stored in the iPod track comment field to record
 * what transcode settings produced each file.
 */

import { describe, expect, it } from 'bun:test';
import {
  parseSyncTag,
  formatSyncTag,
  writeSyncTag,
  syncTagMatchesConfig,
  syncTagsEqual,
  buildAudioSyncTag,
  buildCopySyncTag,
  buildVideoSyncTag,
} from './sync-tags.js';
import type { SyncTagData } from './sync-tags.js';

// =============================================================================
// parseSyncTag
// =============================================================================

describe('parseSyncTag', () => {
  it('parses a valid VBR tag', () => {
    const result = parseSyncTag('[podkit:v1 quality=high encoding=vbr]');
    expect(result).toEqual({ quality: 'high', encoding: 'vbr' });
  });

  it('parses a valid CBR tag', () => {
    const result = parseSyncTag('[podkit:v1 quality=medium encoding=cbr]');
    expect(result).toEqual({ quality: 'medium', encoding: 'cbr' });
  });

  it('parses a lossless tag (no encoding)', () => {
    const result = parseSyncTag('[podkit:v1 quality=lossless]');
    expect(result).toEqual({ quality: 'lossless' });
  });

  it('parses a tag with custom bitrate', () => {
    const result = parseSyncTag('[podkit:v1 quality=high encoding=cbr bitrate=320]');
    expect(result).toEqual({ quality: 'high', encoding: 'cbr', bitrate: 320 });
  });

  it('parses a video quality tag', () => {
    const result = parseSyncTag('[podkit:v1 quality=max]');
    expect(result).toEqual({ quality: 'max' });
  });

  it('parses tag embedded in other comment text', () => {
    const result = parseSyncTag('Great song [podkit:v1 quality=high encoding=vbr] more text');
    expect(result).toEqual({ quality: 'high', encoding: 'vbr' });
  });

  it('parses tag at end of comment', () => {
    const result = parseSyncTag('My comment [podkit:v1 quality=low encoding=vbr]');
    expect(result).toEqual({ quality: 'low', encoding: 'vbr' });
  });

  it('handles keys in any order', () => {
    const result = parseSyncTag('[podkit:v1 encoding=cbr quality=medium bitrate=192]');
    expect(result).toEqual({ quality: 'medium', encoding: 'cbr', bitrate: 192 });
  });

  it('ignores unknown keys (forward compatibility)', () => {
    const result = parseSyncTag('[podkit:v1 quality=high encoding=vbr futureKey=value]');
    expect(result).toEqual({ quality: 'high', encoding: 'vbr' });
  });

  it('returns null for null comment', () => {
    expect(parseSyncTag(null)).toBeNull();
  });

  it('returns null for undefined comment', () => {
    expect(parseSyncTag(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseSyncTag('')).toBeNull();
  });

  it('returns null for comment without sync tag', () => {
    expect(parseSyncTag('Just a regular comment')).toBeNull();
  });

  it('returns null for unknown version (v2)', () => {
    expect(parseSyncTag('[podkit:v2 quality=high encoding=vbr]')).toBeNull();
  });

  it('returns null for unknown version (v99)', () => {
    expect(parseSyncTag('[podkit:v99 quality=high newField=value]')).toBeNull();
  });

  it('returns null when quality key is missing', () => {
    expect(parseSyncTag('[podkit:v1 encoding=vbr]')).toBeNull();
  });

  it('returns null for malformed tag (no closing bracket)', () => {
    expect(parseSyncTag('[podkit:v1 quality=high')).toBeNull();
  });

  it('handles non-numeric bitrate gracefully', () => {
    const result = parseSyncTag('[podkit:v1 quality=high bitrate=abc]');
    // quality is present so tag is valid, but bitrate is not included
    expect(result).toEqual({ quality: 'high' });
  });

  // --- art= field tests ---

  it('parses sync tag with art field', () => {
    const result = parseSyncTag('[podkit:v1 quality=high encoding=vbr art=aabbccdd]');
    expect(result).toEqual({ quality: 'high', encoding: 'vbr', artworkHash: 'aabbccdd' });
  });

  it('parses sync tag without art field (backward compat)', () => {
    const result = parseSyncTag('[podkit:v1 quality=high encoding=vbr]');
    expect(result).toEqual({ quality: 'high', encoding: 'vbr' });
    expect(result!.artworkHash).toBeUndefined();
  });

  it('rejects art hash with wrong length (too short)', () => {
    const result = parseSyncTag('[podkit:v1 quality=high art=aabb]');
    expect(result).toEqual({ quality: 'high' });
    expect(result!.artworkHash).toBeUndefined();
  });

  it('rejects art hash with wrong length (too long)', () => {
    const result = parseSyncTag('[podkit:v1 quality=high art=aabbccddee]');
    expect(result).toEqual({ quality: 'high' });
    expect(result!.artworkHash).toBeUndefined();
  });

  it('rejects art hash with non-hex characters', () => {
    const result = parseSyncTag('[podkit:v1 quality=high art=aabbccgg]');
    expect(result).toEqual({ quality: 'high' });
    expect(result!.artworkHash).toBeUndefined();
  });

  it('rejects art hash with uppercase hex characters', () => {
    const result = parseSyncTag('[podkit:v1 quality=high art=AABBCCDD]');
    expect(result).toEqual({ quality: 'high' });
    expect(result!.artworkHash).toBeUndefined();
  });

  it('parses art field in any key position', () => {
    const result = parseSyncTag('[podkit:v1 art=12345678 quality=low encoding=cbr]');
    expect(result).toEqual({ quality: 'low', encoding: 'cbr', artworkHash: '12345678' });
  });

  it('parses art field with all other fields present', () => {
    const result = parseSyncTag('[podkit:v1 quality=high encoding=cbr bitrate=320 art=deadbeef]');
    expect(result).toEqual({
      quality: 'high',
      encoding: 'cbr',
      bitrate: 320,
      artworkHash: 'deadbeef',
    });
  });
});

// =============================================================================
// formatSyncTag
// =============================================================================

describe('formatSyncTag', () => {
  it('formats a VBR tag', () => {
    expect(formatSyncTag({ quality: 'high', encoding: 'vbr' })).toBe(
      '[podkit:v1 quality=high encoding=vbr]'
    );
  });

  it('formats a CBR tag with bitrate', () => {
    expect(formatSyncTag({ quality: 'high', encoding: 'cbr', bitrate: 320 })).toBe(
      '[podkit:v1 quality=high encoding=cbr bitrate=320]'
    );
  });

  it('formats a lossless tag', () => {
    expect(formatSyncTag({ quality: 'lossless' })).toBe('[podkit:v1 quality=lossless]');
  });

  it('formats a video tag', () => {
    expect(formatSyncTag({ quality: 'max' })).toBe('[podkit:v1 quality=max]');
  });

  it('formats a medium VBR tag', () => {
    expect(formatSyncTag({ quality: 'medium', encoding: 'vbr' })).toBe(
      '[podkit:v1 quality=medium encoding=vbr]'
    );
  });

  it('formats a tag with artworkHash', () => {
    expect(formatSyncTag({ quality: 'high', encoding: 'vbr', artworkHash: 'a1b2c3d4' })).toBe(
      '[podkit:v1 quality=high encoding=vbr art=a1b2c3d4]'
    );
  });

  it('omits art field when artworkHash is undefined', () => {
    const result = formatSyncTag({ quality: 'high', encoding: 'vbr' });
    expect(result).not.toContain('art=');
  });

  it('formats tag with all fields including artworkHash', () => {
    expect(
      formatSyncTag({ quality: 'high', encoding: 'cbr', bitrate: 320, artworkHash: 'deadbeef' })
    ).toBe('[podkit:v1 quality=high encoding=cbr bitrate=320 art=deadbeef]');
  });
});

// =============================================================================
// writeSyncTag
// =============================================================================

describe('writeSyncTag', () => {
  it('writes tag to empty comment', () => {
    expect(writeSyncTag('', { quality: 'high', encoding: 'vbr' })).toBe(
      '[podkit:v1 quality=high encoding=vbr]'
    );
  });

  it('writes tag to null comment', () => {
    expect(writeSyncTag(null, { quality: 'high', encoding: 'vbr' })).toBe(
      '[podkit:v1 quality=high encoding=vbr]'
    );
  });

  it('writes tag to undefined comment', () => {
    expect(writeSyncTag(undefined, { quality: 'high', encoding: 'vbr' })).toBe(
      '[podkit:v1 quality=high encoding=vbr]'
    );
  });

  it('appends tag to existing comment', () => {
    expect(writeSyncTag('Great song', { quality: 'high', encoding: 'vbr' })).toBe(
      'Great song [podkit:v1 quality=high encoding=vbr]'
    );
  });

  it('replaces existing tag in comment', () => {
    expect(
      writeSyncTag('Great song [podkit:v1 quality=low encoding=vbr]', {
        quality: 'high',
        encoding: 'cbr',
      })
    ).toBe('Great song [podkit:v1 quality=high encoding=cbr]');
  });

  it('replaces tag while preserving surrounding text', () => {
    expect(
      writeSyncTag('before [podkit:v1 quality=low encoding=vbr] after', {
        quality: 'high',
        encoding: 'vbr',
      })
    ).toBe('before [podkit:v1 quality=high encoding=vbr] after');
  });

  it('replaces tag from different version', () => {
    // v2 tags should be replaced (regex matches any version)
    expect(
      writeSyncTag('[podkit:v2 quality=high newField=abc]', { quality: 'medium', encoding: 'cbr' })
    ).toBe('[podkit:v1 quality=medium encoding=cbr]');
  });
});

// =============================================================================
// syncTagMatchesConfig
// =============================================================================

describe('syncTagMatchesConfig', () => {
  it('matches identical VBR configs', () => {
    const tag: SyncTagData = { quality: 'high', encoding: 'vbr' };
    const config: SyncTagData = { quality: 'high', encoding: 'vbr' };
    expect(syncTagMatchesConfig(tag, config)).toBe(true);
  });

  it('matches identical CBR configs with bitrate', () => {
    const tag: SyncTagData = { quality: 'high', encoding: 'cbr', bitrate: 320 };
    const config: SyncTagData = { quality: 'high', encoding: 'cbr', bitrate: 320 };
    expect(syncTagMatchesConfig(tag, config)).toBe(true);
  });

  it('matches identical lossless configs', () => {
    const tag: SyncTagData = { quality: 'lossless' };
    const config: SyncTagData = { quality: 'lossless' };
    expect(syncTagMatchesConfig(tag, config)).toBe(true);
  });

  it('detects quality mismatch', () => {
    const tag: SyncTagData = { quality: 'low', encoding: 'vbr' };
    const config: SyncTagData = { quality: 'high', encoding: 'vbr' };
    expect(syncTagMatchesConfig(tag, config)).toBe(false);
  });

  it('detects encoding mismatch', () => {
    const tag: SyncTagData = { quality: 'high', encoding: 'vbr' };
    const config: SyncTagData = { quality: 'high', encoding: 'cbr' };
    expect(syncTagMatchesConfig(tag, config)).toBe(false);
  });

  it('detects bitrate mismatch', () => {
    const tag: SyncTagData = { quality: 'high', encoding: 'cbr', bitrate: 256 };
    const config: SyncTagData = { quality: 'high', encoding: 'cbr', bitrate: 320 };
    expect(syncTagMatchesConfig(tag, config)).toBe(false);
  });

  it('detects mismatch when tag has bitrate but config does not', () => {
    const tag: SyncTagData = { quality: 'high', encoding: 'cbr', bitrate: 320 };
    const config: SyncTagData = { quality: 'high', encoding: 'cbr' };
    expect(syncTagMatchesConfig(tag, config)).toBe(false);
  });

  it('detects mismatch when config has bitrate but tag does not', () => {
    const tag: SyncTagData = { quality: 'high', encoding: 'cbr' };
    const config: SyncTagData = { quality: 'high', encoding: 'cbr', bitrate: 320 };
    expect(syncTagMatchesConfig(tag, config)).toBe(false);
  });

  it('detects mismatch when tag has encoding but config does not (lossless)', () => {
    const tag: SyncTagData = { quality: 'high', encoding: 'vbr' };
    const config: SyncTagData = { quality: 'lossless' };
    expect(syncTagMatchesConfig(tag, config)).toBe(false);
  });

  it('ignores transferMode differences', () => {
    const tag: SyncTagData = { quality: 'high', encoding: 'vbr', transferMode: 'fast' };
    const config: SyncTagData = { quality: 'high', encoding: 'vbr', transferMode: 'optimized' };
    expect(syncTagMatchesConfig(tag, config)).toBe(true);
  });

  it('ignores missing transferMode', () => {
    const tag: SyncTagData = { quality: 'high', encoding: 'vbr', transferMode: 'fast' };
    const config: SyncTagData = { quality: 'high', encoding: 'vbr' };
    expect(syncTagMatchesConfig(tag, config)).toBe(true);
  });

  it('ignores transferMode for copy quality tags', () => {
    const tag: SyncTagData = { quality: 'copy', transferMode: 'fast' };
    const config: SyncTagData = { quality: 'copy', transferMode: 'optimized' };
    expect(syncTagMatchesConfig(tag, config)).toBe(true);
  });
});

// =============================================================================
// syncTagsEqual
// =============================================================================

describe('syncTagsEqual', () => {
  it('returns true for two identical tags', () => {
    const a: SyncTagData = {
      quality: 'high',
      encoding: 'vbr',
      bitrate: 256,
      artworkHash: 'aabbccdd',
      transferMode: 'fast',
    };
    const b: SyncTagData = {
      quality: 'high',
      encoding: 'vbr',
      bitrate: 256,
      artworkHash: 'aabbccdd',
      transferMode: 'fast',
    };
    expect(syncTagsEqual(a, b)).toBe(true);
  });

  it('returns false when quality differs', () => {
    const a: SyncTagData = { quality: 'high', encoding: 'vbr' };
    const b: SyncTagData = { quality: 'low', encoding: 'vbr' };
    expect(syncTagsEqual(a, b)).toBe(false);
  });

  it('returns false when encoding differs', () => {
    const a: SyncTagData = { quality: 'high', encoding: 'vbr' };
    const b: SyncTagData = { quality: 'high', encoding: 'cbr' };
    expect(syncTagsEqual(a, b)).toBe(false);
  });

  it('returns false when bitrate differs', () => {
    const a: SyncTagData = { quality: 'high', encoding: 'cbr', bitrate: 256 };
    const b: SyncTagData = { quality: 'high', encoding: 'cbr', bitrate: 320 };
    expect(syncTagsEqual(a, b)).toBe(false);
  });

  it('returns false when artworkHash differs', () => {
    const a: SyncTagData = { quality: 'high', encoding: 'vbr', artworkHash: 'aabbccdd' };
    const b: SyncTagData = { quality: 'high', encoding: 'vbr', artworkHash: '11223344' };
    expect(syncTagsEqual(a, b)).toBe(false);
  });

  it('returns false when transferMode differs', () => {
    const a: SyncTagData = { quality: 'high', encoding: 'vbr', transferMode: 'fast' };
    const b: SyncTagData = { quality: 'high', encoding: 'vbr', transferMode: 'optimized' };
    expect(syncTagsEqual(a, b)).toBe(false);
  });

  it('returns false when one has undefined optional field and other has a value', () => {
    const a: SyncTagData = { quality: 'high', encoding: 'vbr' };
    const b: SyncTagData = { quality: 'high', encoding: 'vbr', artworkHash: 'aabbccdd' };
    expect(syncTagsEqual(a, b)).toBe(false);
  });

  it('returns false when one has undefined transferMode and other has a value', () => {
    const a: SyncTagData = { quality: 'high', encoding: 'vbr' };
    const b: SyncTagData = { quality: 'high', encoding: 'vbr', transferMode: 'fast' };
    expect(syncTagsEqual(a, b)).toBe(false);
  });

  it('returns true when both have undefined for the same optional fields', () => {
    const a: SyncTagData = { quality: 'high', encoding: 'vbr' };
    const b: SyncTagData = { quality: 'high', encoding: 'vbr' };
    expect(syncTagsEqual(a, b)).toBe(true);
  });

  it('returns true for minimal tags with quality only', () => {
    const a: SyncTagData = { quality: 'lossless' };
    const b: SyncTagData = { quality: 'lossless' };
    expect(syncTagsEqual(a, b)).toBe(true);
  });
});

// =============================================================================
// buildAudioSyncTag
// =============================================================================

describe('buildAudioSyncTag', () => {
  it('builds tag for high VBR', () => {
    expect(buildAudioSyncTag('high', 'vbr')).toEqual({
      quality: 'high',
      encoding: 'vbr',
    });
  });

  it('builds tag for medium CBR', () => {
    expect(buildAudioSyncTag('medium', 'cbr')).toEqual({
      quality: 'medium',
      encoding: 'cbr',
    });
  });

  it('builds tag for lossless (no encoding mode)', () => {
    expect(buildAudioSyncTag('lossless')).toEqual({
      quality: 'lossless',
    });
  });

  it('builds tag for lossless ignoring encoding mode', () => {
    // Even if encoding mode is passed, lossless should not include it
    expect(buildAudioSyncTag('lossless', 'vbr')).toEqual({
      quality: 'lossless',
    });
  });

  it('builds tag for lossless ignoring custom bitrate', () => {
    expect(buildAudioSyncTag('lossless', 'cbr', 320)).toEqual({
      quality: 'lossless',
    });
  });

  it('builds tag with custom bitrate', () => {
    expect(buildAudioSyncTag('high', 'cbr', 320)).toEqual({
      quality: 'high',
      encoding: 'cbr',
      bitrate: 320,
    });
  });

  it('builds tag without custom bitrate when not provided', () => {
    expect(buildAudioSyncTag('low', 'vbr')).toEqual({
      quality: 'low',
      encoding: 'vbr',
    });
  });

  it('includes transferMode when provided', () => {
    expect(buildAudioSyncTag('high', 'vbr', undefined, 'optimized')).toEqual({
      quality: 'high',
      encoding: 'vbr',
      transferMode: 'optimized',
    });
  });

  it('omits transferMode when not provided', () => {
    const result = buildAudioSyncTag('high', 'vbr');
    expect(result.transferMode).toBeUndefined();
  });
});

// =============================================================================
// buildCopySyncTag
// =============================================================================

describe('buildCopySyncTag', () => {
  it('builds tag with quality=copy and transferMode', () => {
    expect(buildCopySyncTag('fast')).toEqual({
      quality: 'copy',
      transferMode: 'fast',
    });
  });

  it('builds tag with optimized transferMode', () => {
    expect(buildCopySyncTag('optimized')).toEqual({
      quality: 'copy',
      transferMode: 'optimized',
    });
  });

  it('builds tag with portable transferMode', () => {
    expect(buildCopySyncTag('portable')).toEqual({
      quality: 'copy',
      transferMode: 'portable',
    });
  });

  it('includes artworkHash when provided', () => {
    expect(buildCopySyncTag('optimized', 'a1b2c3d4')).toEqual({
      quality: 'copy',
      transferMode: 'optimized',
      artworkHash: 'a1b2c3d4',
    });
  });

  it('omits artworkHash when not provided', () => {
    const result = buildCopySyncTag('fast');
    expect(result.artworkHash).toBeUndefined();
  });

  it('formats correctly via formatSyncTag', () => {
    const tag = buildCopySyncTag('fast', 'a1b2c3d4');
    expect(formatSyncTag(tag)).toBe('[podkit:v1 quality=copy art=a1b2c3d4 transfer=fast]');
  });
});

// =============================================================================
// buildVideoSyncTag
// =============================================================================

describe('buildVideoSyncTag', () => {
  it('builds tag for max video quality', () => {
    expect(buildVideoSyncTag('max')).toEqual({ quality: 'max' });
  });

  it('builds tag for high video quality', () => {
    expect(buildVideoSyncTag('high')).toEqual({ quality: 'high' });
  });

  it('builds tag for low video quality', () => {
    expect(buildVideoSyncTag('low')).toEqual({ quality: 'low' });
  });
});

// =============================================================================
// Round-trip tests
// =============================================================================

describe('round-trip: format → parse → compare', () => {
  const testCases: Array<{ name: string; data: SyncTagData }> = [
    { name: 'high VBR', data: { quality: 'high', encoding: 'vbr' } },
    { name: 'medium CBR', data: { quality: 'medium', encoding: 'cbr' } },
    { name: 'low VBR', data: { quality: 'low', encoding: 'vbr' } },
    { name: 'lossless', data: { quality: 'lossless' } },
    {
      name: 'high CBR with custom bitrate',
      data: { quality: 'high', encoding: 'cbr', bitrate: 320 },
    },
    { name: 'video max', data: { quality: 'max' } },
    { name: 'video medium', data: { quality: 'medium' } },
    {
      name: 'high VBR with artworkHash',
      data: { quality: 'high', encoding: 'vbr', artworkHash: 'a1b2c3d4' },
    },
    { name: 'lossless with artworkHash', data: { quality: 'lossless', artworkHash: 'deadbeef' } },
    {
      name: 'CBR with bitrate and artworkHash',
      data: { quality: 'high', encoding: 'cbr', bitrate: 320, artworkHash: '00112233' },
    },
  ];

  for (const { name, data } of testCases) {
    it(`round-trips ${name}`, () => {
      const formatted = formatSyncTag(data);
      const parsed = parseSyncTag(formatted);
      expect(parsed).not.toBeNull();
      expect(syncTagMatchesConfig(parsed!, data)).toBe(true);
    });
  }

  it('round-trips artworkHash through format then parse', () => {
    const data: SyncTagData = { quality: 'high', encoding: 'vbr', artworkHash: 'a1b2c3d4' };
    const formatted = formatSyncTag(data);
    const parsed = parseSyncTag(formatted);
    expect(parsed).not.toBeNull();
    expect(parsed!.artworkHash).toBe('a1b2c3d4');
  });

  it('round-trips through writeSyncTag with existing comment', () => {
    const data: SyncTagData = { quality: 'high', encoding: 'vbr' };
    const comment = writeSyncTag('My comment', data);
    const parsed = parseSyncTag(comment);
    expect(parsed).not.toBeNull();
    expect(syncTagMatchesConfig(parsed!, data)).toBe(true);
  });

  it('round-trips through writeSyncTag replacing existing tag', () => {
    const oldData: SyncTagData = { quality: 'low', encoding: 'cbr' };
    const newData: SyncTagData = { quality: 'high', encoding: 'vbr' };
    const comment1 = writeSyncTag('My song', oldData);
    const comment2 = writeSyncTag(comment1, newData);
    const parsed = parseSyncTag(comment2);
    expect(parsed).not.toBeNull();
    expect(syncTagMatchesConfig(parsed!, newData)).toBe(true);
    // Should not match old data
    expect(syncTagMatchesConfig(parsed!, oldData)).toBe(false);
  });
});

// =============================================================================
// transferMode (transfer= field) tests
// =============================================================================

describe('transferMode in sync tags', () => {
  it('parseSyncTag reads transfer field', () => {
    const result = parseSyncTag('[podkit:v1 quality=high encoding=vbr transfer=optimized]');
    expect(result).toEqual({ quality: 'high', encoding: 'vbr', transferMode: 'optimized' });
  });

  it('parseSyncTag reads transfer=portable', () => {
    const result = parseSyncTag('[podkit:v1 quality=high encoding=vbr transfer=portable]');
    expect(result).toEqual({ quality: 'high', encoding: 'vbr', transferMode: 'portable' });
  });

  it('parseSyncTag reads transfer=fast', () => {
    const result = parseSyncTag('[podkit:v1 quality=high encoding=vbr transfer=fast]');
    expect(result).toEqual({ quality: 'high', encoding: 'vbr', transferMode: 'fast' });
  });

  it('parseSyncTag omits transferMode when transfer field is absent', () => {
    const result = parseSyncTag('[podkit:v1 quality=high encoding=vbr]');
    expect(result!.transferMode).toBeUndefined();
  });

  it('formatSyncTag includes transfer when transferMode is set', () => {
    const result = formatSyncTag({ quality: 'high', encoding: 'vbr', transferMode: 'optimized' });
    expect(result).toBe('[podkit:v1 quality=high encoding=vbr transfer=optimized]');
  });

  it('formatSyncTag includes transfer=portable', () => {
    const result = formatSyncTag({ quality: 'high', encoding: 'vbr', transferMode: 'portable' });
    expect(result).toBe('[podkit:v1 quality=high encoding=vbr transfer=portable]');
  });

  it('formatSyncTag omits transfer when transferMode is undefined', () => {
    const result = formatSyncTag({ quality: 'high', encoding: 'vbr' });
    expect(result).not.toContain('transfer=');
  });

  it('round-trips transferMode through format then parse', () => {
    const data: SyncTagData = { quality: 'high', encoding: 'vbr', transferMode: 'portable' };
    const formatted = formatSyncTag(data);
    const parsed = parseSyncTag(formatted);
    expect(parsed).not.toBeNull();
    expect(parsed!.transferMode).toBe('portable');
  });

  it('round-trips transfer=fast through format then parse', () => {
    const data: SyncTagData = { quality: 'high', encoding: 'vbr', transferMode: 'fast' };
    const formatted = formatSyncTag(data);
    const parsed = parseSyncTag(formatted);
    expect(parsed).not.toBeNull();
    expect(parsed!.transferMode).toBe('fast');
  });

  it('round-trips transfer=optimized through format then parse', () => {
    const data: SyncTagData = { quality: 'high', encoding: 'vbr', transferMode: 'optimized' };
    const formatted = formatSyncTag(data);
    const parsed = parseSyncTag(formatted);
    expect(parsed).not.toBeNull();
    expect(parsed!.transferMode).toBe('optimized');
  });

  it('round-trips copy tag with transfer through format then parse', () => {
    const data: SyncTagData = { quality: 'copy', transferMode: 'optimized' };
    const formatted = formatSyncTag(data);
    const parsed = parseSyncTag(formatted);
    expect(parsed).not.toBeNull();
    expect(parsed!.quality).toBe('copy');
    expect(parsed!.transferMode).toBe('optimized');
  });
});

// =============================================================================
// Backward compatibility: old mode= key
// =============================================================================

describe('backward compatibility with old mode= key', () => {
  it('does not parse old mode= key into transferMode', () => {
    const result = parseSyncTag('[podkit:v1 quality=high encoding=vbr mode=optimized]');
    expect(result).not.toBeNull();
    expect(result!.transferMode).toBeUndefined();
  });

  it('old mode= key is treated as unknown and ignored', () => {
    const result = parseSyncTag('[podkit:v1 quality=high encoding=vbr mode=portable]');
    expect(result).toEqual({ quality: 'high', encoding: 'vbr' });
  });
});
