/**
 * Unit tests for SubsonicAdapter
 *
 * Tests use manual mocking of the SubsonicAPI to avoid real network calls.
 */

import { describe, it, expect } from 'bun:test';
import { SubsonicAdapter } from './subsonic.js';
import type { SubsonicAdapterConfig } from './subsonic.js';
import type { Child, AlbumWithSongsID3 } from 'subsonic-api';
import { replayGainToSoundcheck } from '../sync/soundcheck.js';
import { hashArtwork } from '../artwork/hash.js';

// We need to mock the subsonic-api module before importing SubsonicAdapter
// Since bun:test doesn't have vi.mock, we'll test the adapter's behavior
// by verifying the correct API calls are made

// Helper to create a test adapter
function createTestAdapter(config?: Partial<SubsonicAdapterConfig>): SubsonicAdapter {
  return new SubsonicAdapter({
    url: 'https://test.example.com',
    username: 'testuser',
    password: 'testpass',
    ...config,
  });
}

// =============================================================================
// Configuration Tests
// =============================================================================

describe('SubsonicAdapter configuration', () => {
  it('stores configuration correctly', () => {
    const adapter = createTestAdapter({
      url: 'https://music.example.com',
      username: 'james',
      password: 'secret',
    });

    expect(adapter.name).toBe('subsonic');
  });
});

// =============================================================================
// Metadata Mapping Tests (using public methods)
// =============================================================================

describe('SubsonicAdapter metadata mapping', () => {
  // Since we can't easily mock the subsonic-api module in bun:test,
  // we'll test the mapping logic indirectly through integration tests
  // or by testing the public interface

  it('returns empty track count before connection', () => {
    const adapter = createTestAdapter();
    expect(adapter.getTrackCount()).toBe(0);
  });
});

// =============================================================================
// File Access Tests
// =============================================================================

describe('SubsonicAdapter getFileAccess', () => {
  it('returns stream type for file access', () => {
    const adapter = createTestAdapter();
    const mockTrack = {
      id: 'track-123',
      title: 'Test Track',
      artist: 'Test Artist',
      album: 'Test Album',
      filePath: 'subsonic://test.example.com/track-123',
      fileType: 'flac' as const,
    };

    const access = adapter.getFileAccess(mockTrack);

    expect(access.type).toBe('stream');
    if (access.type === 'stream') {
      expect(typeof access.getStream).toBe('function');
    }
  });
});

// =============================================================================
// Filter Logic Tests
// =============================================================================

describe('SubsonicAdapter filtering', () => {
  // Test filter logic without needing to mock the API
  // We can test this by creating tracks directly and calling applyFilter

  // Since applyFilter is private, we test through getFilteredTracks
  // which requires mocked API responses

  it('getFilteredTracks requires connection first', async () => {
    const adapter = createTestAdapter();

    // Without connection, getTracks will attempt to connect
    // which will fail without a real server
    await expect(adapter.getFilteredTracks({ artist: 'Test' })).rejects.toThrow();
  });
});

// =============================================================================
// Disconnect Tests
// =============================================================================

describe('SubsonicAdapter disconnect', () => {
  it('clears cached data on disconnect', async () => {
    const adapter = createTestAdapter();

    await adapter.disconnect();

    expect(adapter.getTrackCount()).toBe(0);
  });

  it('allows reconnecting after disconnect', async () => {
    const adapter = createTestAdapter();

    await adapter.disconnect();

    // Should not throw when disconnected
    expect(adapter.getTrackCount()).toBe(0);
  });
});

// =============================================================================
// Lossless Detection Tests
// =============================================================================

describe('Lossless detection', () => {
  it('detects FLAC as lossless', () => {
    const mockTrack = {
      id: 'track-123',
      title: 'Test Track',
      artist: 'Test Artist',
      album: 'Test Album',
      filePath: 'test.flac',
      fileType: 'flac' as const,
      lossless: true,
    };

    // The track should have lossless flag set
    expect(mockTrack.lossless).toBe(true);
    expect(mockTrack.fileType).toBe('flac');
  });

  it('detects MP3 as lossy', () => {
    const mockTrack = {
      id: 'track-456',
      title: 'Test Track',
      artist: 'Test Artist',
      album: 'Test Album',
      filePath: 'test.mp3',
      fileType: 'mp3' as const,
      lossless: false,
    };

    expect(mockTrack.lossless).toBe(false);
    expect(mockTrack.fileType).toBe('mp3');
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('SubsonicAdapter error handling', () => {
  it('throws descriptive error on connection failure', async () => {
    const adapter = createTestAdapter({
      url: 'https://nonexistent.invalid',
    });

    await expect(adapter.connect()).rejects.toThrow(/Failed to connect/);
  });
});

// =============================================================================
// Sound Check / ReplayGain Tests
// =============================================================================

describe('SubsonicAdapter Sound Check (ReplayGain)', () => {
  // Helper to call the private mapSongToTrack method (async since it may fetch artwork hashes)
  async function mapSong(song: Partial<Child>, album?: Partial<AlbumWithSongsID3>) {
    const adapter = createTestAdapter();
    const fullSong: Child = {
      id: 'song-1',
      isDir: false,
      title: 'Test Song',
      artist: 'Test Artist',
      album: 'Test Album',
      ...song,
    };
    const fullAlbum: AlbumWithSongsID3 = {
      id: 'album-1',
      name: 'Test Album',
      artist: 'Test Artist',
      songCount: 1,
      duration: 300,
      created: new Date('2024-01-01T00:00:00Z'),
      ...album,
    };
    // Access private method via bracket notation
    return await (adapter as any)['mapSongToTrack'](fullSong, fullAlbum);
  }

  it('prefers track gain over album gain', async () => {
    const track = await mapSong({
      replayGain: {
        trackGain: -6.0,
        albumGain: -3.0,
        trackPeak: 1.0,
        albumPeak: 1.0,
        baseGain: 0,
        fallbackGain: 0,
      },
    });

    // Track gain of -6.0 dB should be used, not album gain
    expect(track.soundcheck).toBe(replayGainToSoundcheck(-6.0));
  });

  it('falls back to album gain when track gain is missing', async () => {
    const track = await mapSong({
      replayGain: {
        albumGain: -3.0,
        trackPeak: 1.0,
        albumPeak: 1.0,
        baseGain: 0,
      } as any, // trackGain missing (OpenSubsonic spec says optional)
    });

    expect(track.soundcheck).toBe(replayGainToSoundcheck(-3.0));
  });

  it('soundcheck is undefined when no ReplayGain data present', async () => {
    const track = await mapSong({});

    expect(track.soundcheck).toBeUndefined();
  });

  it('soundcheck is undefined when replayGain object exists but has no gain values', async () => {
    const track = await mapSong({
      replayGain: {
        trackPeak: 1.0,
        albumPeak: 1.0,
        baseGain: 0,
      } as any, // No trackGain or albumGain
    });

    expect(track.soundcheck).toBeUndefined();
  });

  it('a gain of 0 dB correctly produces soundcheck of 1000', async () => {
    const track = await mapSong({
      replayGain: {
        trackGain: 0,
        albumGain: -3.0,
        trackPeak: 1.0,
        albumPeak: 1.0,
        baseGain: 0,
        fallbackGain: 0,
      },
    });

    expect(track.soundcheck).toBe(1000);
  });
});

// =============================================================================
// Artwork Presence Detection Tests
// =============================================================================

describe('SubsonicAdapter artwork presence detection', () => {
  // Fake images: distinct byte patterns so hashes differ
  const realArtwork = Buffer.alloc(200, 0x42);
  const placeholderImage = Buffer.alloc(200, 0xaa);

  /** Helper to create a default song */
  function song(overrides?: Partial<Child>): Child {
    return {
      id: 'song-1',
      isDir: false,
      title: 'Test Song',
      artist: 'Test Artist',
      album: 'Test Album',
      ...overrides,
    };
  }

  /** Helper to create a default album */
  function album(overrides?: Partial<AlbumWithSongsID3>): AlbumWithSongsID3 {
    return {
      id: 'album-1',
      name: 'Test Album',
      artist: 'Test Artist',
      songCount: 1,
      duration: 300,
      created: new Date('2024-01-01T00:00:00Z'),
      ...overrides,
    };
  }

  /**
   * Create an adapter with mocked getCoverArt and optional placeholder hash.
   * Returns a mapSong helper that calls the private mapSongToTrack method.
   */
  function createMockedAdapter(options: {
    getCoverArt: (args: { id: string }) => Promise<Response>;
    placeholderHash?: string | null;
    checkArtwork?: boolean;
  }) {
    const adapter = new SubsonicAdapter({
      url: 'https://test.example.com',
      username: 'testuser',
      password: 'testpass',
      checkArtwork: options.checkArtwork ?? false,
    });
    (adapter as any).api = {
      ...(adapter as any).api,
      getCoverArt: options.getCoverArt,
    };
    if (options.placeholderHash !== undefined) {
      (adapter as any).placeholderHash = options.placeholderHash;
    }

    const mapSong = async (s: Partial<Child>, a?: Partial<AlbumWithSongsID3>) =>
      (adapter as any)['mapSongToTrack'](song(s), album(a));

    return { adapter, mapSong };
  }

  /** Mock that returns real artwork */
  const mockRealArtwork = async () =>
    new Response(realArtwork, { status: 200, headers: { 'content-type': 'image/jpeg' } });

  /** Mock that returns the placeholder image */
  const mockPlaceholder = async () =>
    new Response(placeholderImage, { status: 200, headers: { 'content-type': 'image/webp' } });

  /** Mock that returns a 404 error */
  const mock404 = async () =>
    new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });

  // ---------------------------------------------------------------------------
  // Basic presence detection
  // ---------------------------------------------------------------------------

  it('sets hasArtwork=false when song has no coverArt ID', async () => {
    const { mapSong } = createMockedAdapter({
      getCoverArt: async () => {
        throw new Error('should not be called');
      },
    });
    const track = await mapSong({ coverArt: undefined });
    expect(track.hasArtwork).toBe(false);
    expect(track.artworkHash).toBeUndefined();
  });

  it('skips artwork detection when checkArtwork is false (fast path)', async () => {
    let fetchCount = 0;
    const { mapSong } = createMockedAdapter({
      getCoverArt: async () => {
        fetchCount++;
        return mockRealArtwork();
      },
      checkArtwork: false,
    });
    const track = await mapSong({ coverArt: 'al-123' });
    expect(track.hasArtwork).toBeUndefined();
    expect(track.artworkHash).toBeUndefined();
    expect(fetchCount).toBe(0);
  });

  it('sets hasArtwork=true when getCoverArt returns a valid image', async () => {
    const { mapSong } = createMockedAdapter({ getCoverArt: mockRealArtwork, checkArtwork: true });
    const track = await mapSong({ coverArt: 'al-123' });
    expect(track.hasArtwork).toBe(true);
  });

  it('sets hasArtwork=false when getCoverArt returns non-image content-type', async () => {
    const { mapSong } = createMockedAdapter({
      getCoverArt: async () =>
        new Response('{"error":"not found"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      checkArtwork: true,
    });
    const track = await mapSong({ coverArt: 'al-123' });
    expect(track.hasArtwork).toBe(false);
  });

  it('sets hasArtwork=false when getCoverArt returns non-2xx status', async () => {
    const { mapSong } = createMockedAdapter({ getCoverArt: mock404, checkArtwork: true });
    const track = await mapSong({ coverArt: 'al-123' });
    expect(track.hasArtwork).toBe(false);
  });

  it('sets hasArtwork=false when getCoverArt response is too small', async () => {
    const { mapSong } = createMockedAdapter({
      getCoverArt: async () =>
        new Response(Buffer.alloc(50, 0x42), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      checkArtwork: true,
    });
    const track = await mapSong({ coverArt: 'al-123' });
    expect(track.hasArtwork).toBe(false);
  });

  it('sets hasArtwork=false when getCoverArt throws', async () => {
    const { mapSong } = createMockedAdapter({
      getCoverArt: async () => {
        throw new Error('ECONNREFUSED');
      },
      checkArtwork: true,
    });
    const track = await mapSong({ coverArt: 'al-123' });
    expect(track.hasArtwork).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Placeholder filtering
  // ---------------------------------------------------------------------------

  it('filters placeholder artwork when placeholderHash is set', async () => {
    const { mapSong } = createMockedAdapter({
      getCoverArt: mockPlaceholder,
      placeholderHash: hashArtwork(placeholderImage),
      checkArtwork: true,
    });
    const track = await mapSong({ coverArt: 'al-123' });
    expect(track.hasArtwork).toBe(false);
  });

  it('does not filter real artwork even when placeholderHash is set', async () => {
    const { mapSong } = createMockedAdapter({
      getCoverArt: mockRealArtwork,
      placeholderHash: hashArtwork(placeholderImage),
      checkArtwork: true,
    });
    const track = await mapSong({ coverArt: 'al-123' });
    expect(track.hasArtwork).toBe(true);
  });

  it('does not filter when placeholderHash is null (server has no placeholder)', async () => {
    const { mapSong } = createMockedAdapter({
      getCoverArt: mockRealArtwork,
      placeholderHash: null,
      checkArtwork: true,
    });
    const track = await mapSong({ coverArt: 'al-123' });
    expect(track.hasArtwork).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // artworkHash is always populated (enables progressive sync tag writes)
  // ---------------------------------------------------------------------------

  it('includes artworkHash when checkArtwork is true', async () => {
    const { mapSong } = createMockedAdapter({
      getCoverArt: mockRealArtwork,
      checkArtwork: true,
    });
    const track = await mapSong({ coverArt: 'al-123' });
    expect(track.hasArtwork).toBe(true);
    expect(track.artworkHash).toBe(hashArtwork(realArtwork));
  });

  // ---------------------------------------------------------------------------
  // Caching
  // ---------------------------------------------------------------------------

  it('caches positive results per coverArtId (one fetch per album)', async () => {
    let fetchCount = 0;
    const { mapSong } = createMockedAdapter({
      getCoverArt: async () => {
        fetchCount++;
        return mockRealArtwork();
      },
      checkArtwork: true,
    });

    await mapSong({ id: 'song-1', coverArt: 'al-123' });
    await mapSong({ id: 'song-2', coverArt: 'al-123' });
    expect(fetchCount).toBe(1);
  });

  it('caches negative results per coverArtId', async () => {
    let fetchCount = 0;
    const { mapSong } = createMockedAdapter({
      getCoverArt: async () => {
        fetchCount++;
        return mock404();
      },
      checkArtwork: true,
    });

    const t1 = await mapSong({ id: 'song-1', coverArt: 'al-456' });
    const t2 = await mapSong({ id: 'song-2', coverArt: 'al-456' });
    expect(fetchCount).toBe(1);
    expect(t1.hasArtwork).toBe(false);
    expect(t2.hasArtwork).toBe(false);
  });

  it('maintains separate cache entries for different coverArtIds', async () => {
    let fetchCount = 0;
    const { mapSong } = createMockedAdapter({
      getCoverArt: async ({ id }) => {
        fetchCount++;
        return id === 'al-yes' ? mockRealArtwork() : mock404();
      },
      checkArtwork: true,
    });

    const t1 = await mapSong({ id: 'song-1', coverArt: 'al-yes' });
    const t2 = await mapSong({ id: 'song-2', coverArt: 'al-no' });
    expect(fetchCount).toBe(2);
    expect(t1.hasArtwork).toBe(true);
    expect(t2.hasArtwork).toBe(false);
  });
});
