/**
 * Tests for source adapter utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  parseSubsonicUrl,
  isSubsonicUrl,
  getSubsonicPasswordEnvVar,
  createMusicAdapter,
  createSubsonicAdapterFromUrl,
  createAdapterFromSource,
} from './source-adapter.js';
import { DirectoryAdapter, SubsonicAdapter } from '@podkit/core';

describe('parseSubsonicUrl', () => {
  it('parses basic subsonic URL', () => {
    const result = parseSubsonicUrl('subsonic://music.example.com');
    expect(result.url).toBe('https://music.example.com/');
    expect(result.username).toBeUndefined();
    expect(result.password).toBeUndefined();
  });

  it('parses URL with username', () => {
    const result = parseSubsonicUrl('subsonic://james@music.example.com');
    expect(result.url).toBe('https://music.example.com/');
    expect(result.username).toBe('james');
    expect(result.password).toBeUndefined();
  });

  it('parses URL with username and password', () => {
    const result = parseSubsonicUrl('subsonic://james:secret@music.example.com');
    expect(result.url).toBe('https://music.example.com/');
    expect(result.username).toBe('james');
    expect(result.password).toBe('secret');
  });

  it('parses URL with path', () => {
    const result = parseSubsonicUrl('subsonic://user@music.example.com/api');
    expect(result.url).toBe('https://music.example.com/api');
    expect(result.username).toBe('user');
  });

  it('parses URL with port', () => {
    const result = parseSubsonicUrl('subsonic://user@music.example.com:4533');
    expect(result.url).toBe('https://music.example.com:4533/');
    expect(result.username).toBe('user');
  });

  it('throws for non-subsonic URL', () => {
    expect(() => parseSubsonicUrl('https://music.example.com')).toThrow(/Not a Subsonic URL/);
  });
});

describe('isSubsonicUrl', () => {
  it('returns true for subsonic:// URLs', () => {
    expect(isSubsonicUrl('subsonic://music.example.com')).toBe(true);
    expect(isSubsonicUrl('subsonic://user@music.example.com')).toBe(true);
  });

  it('returns false for other URLs', () => {
    expect(isSubsonicUrl('https://music.example.com')).toBe(false);
    expect(isSubsonicUrl('/path/to/music')).toBe(false);
    expect(isSubsonicUrl('C:\\Music')).toBe(false);
  });
});

describe('getSubsonicPasswordEnvVar', () => {
  it('generates correct env var name for simple names', () => {
    expect(getSubsonicPasswordEnvVar('main')).toBe('PODKIT_MUSIC_MAIN_PASSWORD');
    expect(getSubsonicPasswordEnvVar('work')).toBe('PODKIT_MUSIC_WORK_PASSWORD');
  });

  it('handles hyphenated names', () => {
    expect(getSubsonicPasswordEnvVar('my-collection')).toBe('PODKIT_MUSIC_MY_COLLECTION_PASSWORD');
  });

  it('handles mixed case names', () => {
    expect(getSubsonicPasswordEnvVar('MyCollection')).toBe('PODKIT_MUSIC_MYCOLLECTION_PASSWORD');
  });
});

describe('createMusicAdapter', () => {
  it('creates DirectoryAdapter for directory type', () => {
    const adapter = createMusicAdapter({
      config: { path: '/tmp/music', type: 'directory' },
      name: 'test',
    });
    expect(adapter).toBeInstanceOf(DirectoryAdapter);
  });

  it('creates DirectoryAdapter when type is not specified', () => {
    const adapter = createMusicAdapter({
      config: { path: '/tmp/music' },
      name: 'test',
    });
    expect(adapter).toBeInstanceOf(DirectoryAdapter);
  });

  describe('subsonic type', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('throws if URL is missing', () => {
      expect(() =>
        createMusicAdapter({
          config: { path: '', type: 'subsonic', username: 'user' },
          name: 'test',
        })
      ).toThrow(/requires 'url'/);
    });

    it('throws if username is missing', () => {
      expect(() =>
        createMusicAdapter({
          config: { path: '', type: 'subsonic', url: 'https://music.example.com' },
          name: 'test',
        })
      ).toThrow(/requires 'username'/);
    });

    it('throws if password env var is not set', () => {
      expect(() =>
        createMusicAdapter({
          config: {
            path: '',
            type: 'subsonic',
            url: 'https://music.example.com',
            username: 'user',
          },
          name: 'test',
        })
      ).toThrow(/requires password/);
    });

    it('creates SubsonicAdapter with collection-specific password env var', () => {
      process.env.PODKIT_MUSIC_MYSERVER_PASSWORD = 'secret123';

      const adapter = createMusicAdapter({
        config: {
          path: '',
          type: 'subsonic',
          url: 'https://music.example.com',
          username: 'user',
        },
        name: 'myserver',
      });

      expect(adapter).toBeInstanceOf(SubsonicAdapter);
    });

    it('falls back to SUBSONIC_PASSWORD env var', () => {
      process.env.SUBSONIC_PASSWORD = 'fallback123';

      const adapter = createMusicAdapter({
        config: {
          path: '',
          type: 'subsonic',
          url: 'https://music.example.com',
          username: 'user',
        },
        name: 'unknown',
      });

      expect(adapter).toBeInstanceOf(SubsonicAdapter);
    });
  });
});

describe('createSubsonicAdapterFromUrl', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws if username is not in URL or env', () => {
    expect(() => createSubsonicAdapterFromUrl('subsonic://music.example.com')).toThrow(
      /username required/
    );
  });

  it('throws if password is not in URL or env', () => {
    process.env.SUBSONIC_USERNAME = 'user';
    expect(() => createSubsonicAdapterFromUrl('subsonic://music.example.com')).toThrow(
      /password required/
    );
  });

  it('creates adapter with URL credentials', () => {
    const adapter = createSubsonicAdapterFromUrl('subsonic://user:pass@music.example.com');
    expect(adapter).toBeInstanceOf(SubsonicAdapter);
  });

  it('creates adapter with env credentials', () => {
    process.env.SUBSONIC_USERNAME = 'envuser';
    process.env.SUBSONIC_PASSWORD = 'envpass';

    const adapter = createSubsonicAdapterFromUrl('subsonic://music.example.com');
    expect(adapter).toBeInstanceOf(SubsonicAdapter);
  });

  it('URL credentials override env credentials', () => {
    process.env.SUBSONIC_USERNAME = 'envuser';
    process.env.SUBSONIC_PASSWORD = 'envpass';

    // URL has user:pass, so those should be used
    const adapter = createSubsonicAdapterFromUrl('subsonic://urluser:urlpass@music.example.com');
    expect(adapter).toBeInstanceOf(SubsonicAdapter);
  });
});

describe('createAdapterFromSource', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates DirectoryAdapter for file paths', () => {
    const adapter = createAdapterFromSource('/tmp/music');
    expect(adapter).toBeInstanceOf(DirectoryAdapter);
  });

  it('creates SubsonicAdapter for subsonic:// URLs', () => {
    process.env.SUBSONIC_USERNAME = 'user';
    process.env.SUBSONIC_PASSWORD = 'pass';

    const adapter = createAdapterFromSource('subsonic://music.example.com');
    expect(adapter).toBeInstanceOf(SubsonicAdapter);
  });
});
