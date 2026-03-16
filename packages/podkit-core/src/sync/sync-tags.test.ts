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
  buildAudioSyncTag,
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
      writeSyncTag(
        'Great song [podkit:v1 quality=low encoding=vbr]',
        { quality: 'high', encoding: 'cbr' }
      )
    ).toBe('Great song [podkit:v1 quality=high encoding=cbr]');
  });

  it('replaces tag while preserving surrounding text', () => {
    expect(
      writeSyncTag(
        'before [podkit:v1 quality=low encoding=vbr] after',
        { quality: 'high', encoding: 'vbr' }
      )
    ).toBe('before [podkit:v1 quality=high encoding=vbr] after');
  });

  it('replaces tag from different version', () => {
    // v2 tags should be replaced (regex matches any version)
    expect(
      writeSyncTag(
        '[podkit:v2 quality=high newField=abc]',
        { quality: 'medium', encoding: 'cbr' }
      )
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
    { name: 'high CBR with custom bitrate', data: { quality: 'high', encoding: 'cbr', bitrate: 320 } },
    { name: 'video max', data: { quality: 'max' } },
    { name: 'video medium', data: { quality: 'medium' } },
  ];

  for (const { name, data } of testCases) {
    it(`round-trips ${name}`, () => {
      const formatted = formatSyncTag(data);
      const parsed = parseSyncTag(formatted);
      expect(parsed).not.toBeNull();
      expect(syncTagMatchesConfig(parsed!, data)).toBe(true);
    });
  }

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
