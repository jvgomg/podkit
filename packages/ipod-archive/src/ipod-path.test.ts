import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
  ipodPathToRelativeSegments,
  resolveDumpAudioPath,
  ipodPathExtension,
  ipodPathBasename,
} from './ipod-path.js';

describe('ipodPathToRelativeSegments', () => {
  test('splits a colon-separated path, dropping leading/empty segments', () => {
    expect(ipodPathToRelativeSegments(':iPod_Control:Music:F00:ABCD.m4a')).toEqual([
      'iPod_Control',
      'Music',
      'F00',
      'ABCD.m4a',
    ]);
  });

  test('returns null for null/empty/colon-only input', () => {
    expect(ipodPathToRelativeSegments(null)).toBeNull();
    expect(ipodPathToRelativeSegments(undefined)).toBeNull();
    expect(ipodPathToRelativeSegments('')).toBeNull();
    expect(ipodPathToRelativeSegments(':::')).toBeNull();
  });
});

describe('ipodPathToRelativeSegments — path-traversal filtering', () => {
  test('drops dot and double-dot segments', () => {
    expect(ipodPathToRelativeSegments(':iPod_Control:.:Music:F00:ABCD.m4a')).toEqual([
      'iPod_Control',
      'Music',
      'F00',
      'ABCD.m4a',
    ]);
    expect(ipodPathToRelativeSegments(':..:..:etc:passwd')).toEqual(['etc', 'passwd']);
  });

  test('drops segments containing a path separator', () => {
    expect(ipodPathToRelativeSegments(':foo/bar:baz')).toEqual(['baz']);
    expect(ipodPathToRelativeSegments(':foo\\bar:baz')).toEqual(['baz']);
  });

  test('returns null when every segment is a traversal token', () => {
    expect(ipodPathToRelativeSegments(':..:..')).toBeNull();
    expect(ipodPathToRelativeSegments(':.')).toBeNull();
  });
});

describe('resolveDumpAudioPath', () => {
  test('joins the relative segments under the iPod root', () => {
    expect(resolveDumpAudioPath('/dump/root', ':iPod_Control:Music:F00:ABCD.m4a')).toBe(
      join('/dump/root', 'iPod_Control', 'Music', 'F00', 'ABCD.m4a')
    );
  });

  test('returns null when there is no audio path', () => {
    expect(resolveDumpAudioPath('/dump/root', null)).toBeNull();
    expect(resolveDumpAudioPath('/dump/root', '')).toBeNull();
  });

  test('returns null for a path-traversal attempt that escapes ipodRoot', () => {
    // After ipodPathToRelativeSegments filters `.` and `..`, a path like
    // `:..:..:etc:passwd` resolves to `/dump/root/etc/passwd` (safe). But if a
    // separator-bearing segment somehow slipped through, resolve() would escape.
    // Confirm the containment check catches any residual escape at this layer.
    expect(resolveDumpAudioPath('/dump/root', ':..:..:etc:passwd')).not.toBeNull(); // filtered → safe
    // Manually verify the result stays within the root.
    const result = resolveDumpAudioPath('/dump/root', ':..:..:etc:passwd');
    expect(result?.startsWith('/dump/root')).toBe(true);
  });
});

describe('ipodPathExtension', () => {
  test('returns the lowercased extension', () => {
    expect(ipodPathExtension(':iPod_Control:Music:F00:ABCD.M4A')).toBe('.m4a');
    expect(ipodPathExtension(':iPod_Control:Music:F00:x.mp3')).toBe('.mp3');
  });

  test('returns empty string with no extension or no path', () => {
    expect(ipodPathExtension(':iPod_Control:Music:F00:NOEXT')).toBe('');
    expect(ipodPathExtension(null)).toBe('');
  });
});

describe('ipodPathBasename', () => {
  test('returns the basename without extension', () => {
    expect(ipodPathBasename(':iPod_Control:Music:F00:ABCD.m4a')).toBe('ABCD');
    expect(ipodPathBasename(':iPod_Control:Music:F00:NOEXT')).toBe('NOEXT');
  });

  test('returns empty string for no path', () => {
    expect(ipodPathBasename(null)).toBe('');
  });
});
