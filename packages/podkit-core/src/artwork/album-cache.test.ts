import { describe, it, expect } from 'bun:test';
import { AlbumArtworkCache, getAlbumKey } from './album-cache.js';
import type { ExtractedArtwork } from './types.js';
import { hashArtwork } from './hash.js';

const fakeArtwork: ExtractedArtwork = {
  data: Buffer.from('fake-image-data'),
  mimeType: 'image/jpeg',
  width: 300,
  height: 300,
};

describe('getAlbumKey', () => {
  it('normalizes artist and album', () => {
    const key1 = getAlbumKey({ artist: 'The Beatles', album: 'Abbey Road' });
    const key2 = getAlbumKey({ artist: 'the beatles', album: 'abbey road' });
    expect(key1).toBe(key2);
  });

  it('produces different keys for different albums', () => {
    const key1 = getAlbumKey({ artist: 'Artist', album: 'Album A' });
    const key2 = getAlbumKey({ artist: 'Artist', album: 'Album B' });
    expect(key1).not.toBe(key2);
  });
});

describe('AlbumArtworkCache', () => {
  it('returns extracted artwork on cache miss', async () => {
    const cache = new AlbumArtworkCache({
      extractArtwork: async () => fakeArtwork,
    });

    const entry = await cache.get({ artist: 'Artist', album: 'Album' }, '/fake/path.flac');

    expect(entry).not.toBeNull();
    expect(entry!.data).toEqual(fakeArtwork.data);
    expect(entry!.hash).toBe(hashArtwork(fakeArtwork.data));
  });

  it('returns null when source has no artwork', async () => {
    const cache = new AlbumArtworkCache({
      extractArtwork: async () => null,
    });

    const entry = await cache.get({ artist: 'Artist', album: 'Album' }, '/fake/path.flac');
    expect(entry).toBeNull();
  });

  it('caches by album — second call does not re-extract', async () => {
    let extractCount = 0;
    const cache = new AlbumArtworkCache({
      extractArtwork: async () => {
        extractCount++;
        return fakeArtwork;
      },
    });

    const track = { artist: 'Artist', album: 'Album' };
    await cache.get(track, '/fake/track1.flac');
    await cache.get(track, '/fake/track2.flac');

    expect(extractCount).toBe(1);
    expect(cache.size).toBe(1);
  });

  it('does not cache a null result in single-source mode (avoids poisoning the album)', async () => {
    let extractCount = 0;
    const cache = new AlbumArtworkCache({
      extractArtwork: async () => {
        extractCount++;
        return null;
      },
    });

    const track = { artist: 'Artist', album: 'Album' };
    await cache.get(track, '/fake/track1.flac');
    await cache.get(track, '/fake/track2.flac');

    // Both calls extracted — the null result is intentionally not cached so
    // a later caller with sibling candidates can still discover album art.
    expect(extractCount).toBe(2);
    expect(cache.size).toBe(0);
  });

  it('caches null in candidates mode once every candidate yields null', async () => {
    let extractCount = 0;
    const cache = new AlbumArtworkCache({
      extractArtwork: async () => {
        extractCount++;
        return null;
      },
    });

    const track = { artist: 'Artist', album: 'Album' };
    await cache.get(track, '/fake/a.wav', {
      candidates: ['/fake/a.wav', '/fake/b.ogg'],
    });
    // Second call sees the cached null — no further extraction.
    await cache.get(track, '/fake/a.wav', {
      candidates: ['/fake/a.wav', '/fake/b.ogg'],
    });

    expect(extractCount).toBe(2); // both candidates tried on first call
    expect(cache.size).toBe(1);
  });

  it('with candidates: returns first positive regardless of which track called', async () => {
    const fakeArtworkPath = '/fake/with-art.flac';
    const cache = new AlbumArtworkCache({
      extractArtwork: async (path) => (path === fakeArtworkPath ? fakeArtwork : null),
    });

    const track = { artist: 'Artist', album: 'Album' };
    // Caller is the WAV track, but the album's candidate list puts FLAC
    // first — cache resolves to FLAC's art for the WAV track to inherit.
    const entry = await cache.get(track, '/fake/no-art.wav', {
      candidates: ['/fake/no-art.wav', fakeArtworkPath, '/fake/other.alac'],
    });

    expect(entry).not.toBeNull();
    expect(entry!.data).toEqual(fakeArtwork.data);
  });

  it('with candidates: order-independent outcome across two different first-track orderings', async () => {
    // Same album, same candidates list, two different processing orders.
    // The fixture: one of the candidates (path 'b') has art; the rest don't.
    const make = () =>
      new AlbumArtworkCache({
        extractArtwork: async (path) => (path === '/album/b.flac' ? fakeArtwork : null),
      });
    const track = { artist: 'Artist', album: 'Album' };
    const candidates = ['/album/b.flac', '/album/a.wav', '/album/c.ogg'];

    const cacheA = make();
    const orderA = await cacheA.get(track, '/album/a.wav', { candidates });
    const cacheB = make();
    const orderB = await cacheB.get(track, '/album/c.ogg', { candidates });

    expect(orderA).not.toBeNull();
    expect(orderB).not.toBeNull();
    expect(orderA!.data).toEqual(orderB!.data);
    expect(orderA!.hash).toBe(orderB!.hash);
  });

  it('treats different albums as separate cache entries', async () => {
    let extractCount = 0;
    const cache = new AlbumArtworkCache({
      extractArtwork: async () => {
        extractCount++;
        return fakeArtwork;
      },
    });

    await cache.get({ artist: 'Artist', album: 'Album A' }, '/fake/a.flac');
    await cache.get({ artist: 'Artist', album: 'Album B' }, '/fake/b.flac');

    expect(extractCount).toBe(2);
    expect(cache.size).toBe(2);
  });

  it('clear() resets the cache', async () => {
    let extractCount = 0;
    const cache = new AlbumArtworkCache({
      extractArtwork: async () => {
        extractCount++;
        return fakeArtwork;
      },
    });

    const track = { artist: 'Artist', album: 'Album' };
    await cache.get(track, '/fake/path.flac');
    cache.clear();
    await cache.get(track, '/fake/path.flac');

    expect(extractCount).toBe(2);
    expect(cache.size).toBe(1);
  });

  describe('adapter fallback (TASK-142)', () => {
    const adapterBytes = Buffer.from('adapter-supplied-cover');

    it('promotes adapter bytes to the album-level cache when embed extraction returns null (single-source)', async () => {
      let extractCount = 0;
      let fallbackCount = 0;
      const cache = new AlbumArtworkCache({
        extractArtwork: async () => {
          extractCount++;
          return null;
        },
      });

      const track = { artist: 'Artist', album: 'Album' };
      const entry = await cache.get(track, '/fake/track.wav', {
        adapterFallback: async () => {
          fallbackCount++;
          return adapterBytes;
        },
      });

      expect(entry).not.toBeNull();
      expect(entry!.data.equals(adapterBytes)).toBe(true);
      expect(entry!.hash).toBe(hashArtwork(adapterBytes));
      expect(extractCount).toBe(1);
      expect(fallbackCount).toBe(1);

      // Second sibling on the same album reads the cached entry — no re-fetch.
      await cache.get(track, '/fake/sibling.wav', {
        adapterFallback: async () => {
          fallbackCount++;
          return adapterBytes;
        },
      });
      expect(fallbackCount).toBe(1);
    });

    it('candidates mode: adapter fallback runs only after EVERY candidate misses', async () => {
      const cache = new AlbumArtworkCache({
        // Every file in this album lacks embedded art.
        extractArtwork: async () => null,
      });

      let fallbackCount = 0;
      const entry = await cache.get({ artist: 'Artist', album: 'Album' }, '/fake/track.wav', {
        candidates: ['/fake/a.flac', '/fake/b.mp3', '/fake/c.wav'],
        adapterFallback: async () => {
          fallbackCount++;
          return adapterBytes;
        },
      });

      expect(entry).not.toBeNull();
      expect(entry!.data.equals(adapterBytes)).toBe(true);
      expect(fallbackCount).toBe(1);
    });

    it('embed wins over adapter fallback (fallback is consulted only on miss)', async () => {
      let fallbackCount = 0;
      const cache = new AlbumArtworkCache({
        extractArtwork: async () => fakeArtwork,
      });

      const entry = await cache.get({ artist: 'Artist', album: 'Album' }, '/fake/track.flac', {
        adapterFallback: async () => {
          fallbackCount++;
          return adapterBytes;
        },
      });

      expect(entry).not.toBeNull();
      expect(entry!.data.equals(fakeArtwork.data)).toBe(true);
      expect(fallbackCount).toBe(0);
    });

    it('caches a negative result in candidates mode when both embed AND adapter return null', async () => {
      let extractCount = 0;
      let fallbackCount = 0;
      const cache = new AlbumArtworkCache({
        extractArtwork: async () => {
          extractCount++;
          return null;
        },
      });

      const track = { artist: 'Artist', album: 'Album' };
      const opts = {
        candidates: ['/fake/a.flac'],
        adapterFallback: async () => {
          fallbackCount++;
          return null;
        },
      } as const;

      const first = await cache.get(track, '/fake/track.wav', opts);
      expect(first).toBeNull();

      // Siblings should now hit the cached null — no re-extract, no re-fallback.
      await cache.get(track, '/fake/sibling.wav', opts);
      expect(extractCount).toBe(1);
      expect(fallbackCount).toBe(1);
    });

    it('single-source mode: an adapter-null result is NOT cached (sibling-with-art still discoverable)', async () => {
      let extractCount = 0;
      let fallbackCount = 0;
      const cache = new AlbumArtworkCache({
        extractArtwork: async () => {
          extractCount++;
          return null;
        },
      });

      const track = { artist: 'Artist', album: 'Album' };
      await cache.get(track, '/fake/a.wav', {
        adapterFallback: async () => {
          fallbackCount++;
          return null;
        },
      });
      await cache.get(track, '/fake/b.wav', {
        adapterFallback: async () => {
          fallbackCount++;
          return null;
        },
      });

      // Both calls re-tried both layers — no null caching in single-source mode.
      expect(extractCount).toBe(2);
      expect(fallbackCount).toBe(2);
    });
  });
});
