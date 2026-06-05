/**
 * Unit tests for the Subsonic adapter's artwork caches.
 *
 * Each class is tested in isolation — no dependency on `subsonic.ts` internals.
 * The structural invariant "bytes evict, classification survives" is pinned
 * in `subsonic.test.ts` since it's adapter-level behaviour.
 */

import { describe, it, expect } from 'bun:test';
import { ARTWORK_BYTES_CACHE_MAX, ArtworkBytesCache, ArtworkClassificationMemo } from './cache.js';

describe('ArtworkClassificationMemo', () => {
  it('returns undefined for an unknown id', () => {
    const memo = new ArtworkClassificationMemo();
    expect(memo.get('unknown')).toBeUndefined();
  });

  it('stores and retrieves each classification value', () => {
    const memo = new ArtworkClassificationMemo();
    memo.set('a', 'real');
    memo.set('b', 'placeholder');
    memo.set('c', 'missing');
    expect(memo.get('a')).toBe('real');
    expect(memo.get('b')).toBe('placeholder');
    expect(memo.get('c')).toBe('missing');
  });

  it('overwrites an existing classification on re-set', () => {
    const memo = new ArtworkClassificationMemo();
    memo.set('a', 'placeholder');
    memo.set('a', 'real');
    expect(memo.get('a')).toBe('real');
  });

  it('clear() empties the memo', () => {
    const memo = new ArtworkClassificationMemo();
    memo.set('a', 'real');
    memo.set('b', 'placeholder');
    memo.clear();
    expect(memo.size()).toBe(0);
    expect(memo.get('a')).toBeUndefined();
    expect(memo.get('b')).toBeUndefined();
  });

  it('is unbounded — holds 10000 entries without eviction', () => {
    // The memo persists forever in daemon mode. Hash entries are ~30 bytes;
    // 10k * 30 ≈ 300 KB, well under the 1 MB budget for a 10k-album library.
    const memo = new ArtworkClassificationMemo();
    for (let i = 0; i < 10_000; i++) {
      memo.set(`cover-${i}`, i % 3 === 0 ? 'real' : i % 3 === 1 ? 'placeholder' : 'missing');
    }
    expect(memo.size()).toBe(10_000);
    // Spot-check entries across the range — none have been evicted.
    // (i % 3) maps: 0 → real, 1 → placeholder, 2 → missing.
    expect(memo.get('cover-0')).toBe('real');
    expect(memo.get('cover-1')).toBe('placeholder');
    expect(memo.get('cover-5000')).toBe('missing'); // 5000 % 3 === 2
    expect(memo.get('cover-9999')).toBe('real'); // 9999 % 3 === 0
  });
});

describe('ArtworkBytesCache', () => {
  const buf = (n: number): Buffer => Buffer.alloc(200, n & 0xff);

  it('returns undefined for an unknown id', () => {
    const cache = new ArtworkBytesCache();
    expect(cache.get('unknown')).toBeUndefined();
    expect(cache.has('unknown')).toBe(false);
  });

  it('stores and retrieves bytes', () => {
    const cache = new ArtworkBytesCache();
    cache.put('a', buf(1));
    expect(cache.has('a')).toBe(true);
    expect(cache.get('a')?.equals(buf(1))).toBe(true);
  });

  it('size() reflects the number of stored entries', () => {
    const cache = new ArtworkBytesCache();
    expect(cache.size()).toBe(0);
    cache.put('a', buf(1));
    expect(cache.size()).toBe(1);
    cache.put('b', buf(2));
    expect(cache.size()).toBe(2);
  });

  it('clear() empties the cache', () => {
    const cache = new ArtworkBytesCache();
    cache.put('a', buf(1));
    cache.put('b', buf(2));
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBeUndefined();
  });

  it('keeps exactly the cap when inserting up to ARTWORK_BYTES_CACHE_MAX', () => {
    const cache = new ArtworkBytesCache();
    for (let i = 0; i < ARTWORK_BYTES_CACHE_MAX; i++) {
      cache.put(`cover-${i}`, buf(i));
    }
    expect(cache.size()).toBe(ARTWORK_BYTES_CACHE_MAX);
    // All entries still present — no eviction below the cap.
    expect(cache.has('cover-0')).toBe(true);
    expect(cache.has(`cover-${ARTWORK_BYTES_CACHE_MAX - 1}`)).toBe(true);
  });

  it('FIFO-evicts the oldest entry when a new key is inserted at the cap', () => {
    const cache = new ArtworkBytesCache();
    for (let i = 0; i < ARTWORK_BYTES_CACHE_MAX; i++) {
      cache.put(`cover-${i}`, buf(i));
    }
    // One past the cap — cover-0 (the first inserted) should evict.
    cache.put(`cover-${ARTWORK_BYTES_CACHE_MAX}`, buf(0xff));
    expect(cache.size()).toBe(ARTWORK_BYTES_CACHE_MAX);
    expect(cache.has('cover-0')).toBe(false);
    expect(cache.has('cover-1')).toBe(true);
    expect(cache.has(`cover-${ARTWORK_BYTES_CACHE_MAX}`)).toBe(true);
  });

  it('re-inserting an existing key does NOT refresh its eviction order', () => {
    // Documented FIFO semantics: re-put on an existing key updates the value
    // but keeps the original insertion slot. This mirrors the pre-refactor
    // behaviour where `cacheArtworkBytes` skipped eviction for present keys
    // and `Map.set` on an existing key preserves position.
    const cache = new ArtworkBytesCache();
    for (let i = 0; i < ARTWORK_BYTES_CACHE_MAX; i++) {
      cache.put(`cover-${i}`, buf(i));
    }
    // Re-put cover-0 with new bytes — its slot is unchanged.
    cache.put('cover-0', buf(0xaa));
    expect(cache.get('cover-0')?.equals(buf(0xaa))).toBe(true);
    expect(cache.size()).toBe(ARTWORK_BYTES_CACHE_MAX);

    // Now insert one new key past the cap; cover-0 is still the oldest and
    // should evict (not cover-1).
    cache.put('new-cover', buf(0xff));
    expect(cache.has('cover-0')).toBe(false);
    expect(cache.has('cover-1')).toBe(true);
    expect(cache.has('new-cover')).toBe(true);
  });

  it('continues evicting one-per-insert past the cap', () => {
    const cache = new ArtworkBytesCache();
    for (let i = 0; i < ARTWORK_BYTES_CACHE_MAX + 5; i++) {
      cache.put(`cover-${i}`, buf(i));
    }
    expect(cache.size()).toBe(ARTWORK_BYTES_CACHE_MAX);
    // First five are evicted; entries 5..(MAX+4) remain.
    for (let i = 0; i < 5; i++) {
      expect(cache.has(`cover-${i}`)).toBe(false);
    }
    for (let i = 5; i < ARTWORK_BYTES_CACHE_MAX + 5; i++) {
      expect(cache.has(`cover-${i}`)).toBe(true);
    }
  });
});
