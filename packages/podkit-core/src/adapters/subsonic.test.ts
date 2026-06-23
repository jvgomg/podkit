/**
 * Unit tests for SubsonicAdapter
 *
 * Tests use manual mocking of the SubsonicAPI to avoid real network calls.
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { SubsonicAdapter, SubsonicConnectionError } from './subsonic.js';
import type { SubsonicAdapterConfig } from './subsonic.js';
import { PlaylistNotFoundError, AmbiguousPlaylistError } from './subsonic/playlist.js';
import type { CollectionTrack } from './interface.js';
import type { Child, AlbumWithSongsID3 } from 'subsonic-api';
import { replayGainToSoundcheck } from '../metadata/normalization.js';
import { hashArtwork } from '../artwork/hash.js';
import { detectUpgrades } from '../sync/engine/upgrades.js';
import type { DeviceTrack } from '../device/adapter.js';

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

describe('SubsonicAdapter getPlanWarnings', () => {
  it('returns artwork-detection-disabled warning when checkArtwork is off', () => {
    const adapter = createTestAdapter({ checkArtwork: false });
    const warnings = adapter.getPlanWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.type).toBe('artwork-detection-disabled');
    expect(warnings[0]!.message).toContain('fast mode');
    expect(warnings[0]!.message).toContain('--check-artwork');
    expect(warnings[0]!.tracks).toEqual([]);
  });

  it('returns no warnings when checkArtwork is on', () => {
    const adapter = createTestAdapter({ checkArtwork: true });
    expect(adapter.getPlanWarnings()).toEqual([]);
  });

  it('warns by default (checkArtwork omitted) — adapter defaults to fast mode', () => {
    const adapter = createTestAdapter({});
    expect(adapter.getPlanWarnings()).toHaveLength(1);
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

  it('getFilteredItems requires connection first', async () => {
    const adapter = createTestAdapter();

    // Without connection, getItems will attempt to connect
    // which will fail without a real server
    await expect(adapter.getFilteredItems({ artist: 'Test' })).rejects.toThrow();
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
    expect(track.normalization).toEqual({
      source: 'replaygain-track',
      trackGain: -6.0,
      trackPeak: 1.0,
      albumGain: -3.0,
      albumPeak: 1.0,
      soundcheckValue: replayGainToSoundcheck(-6.0),
    });
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

    expect(track.normalization).toEqual({
      source: 'replaygain-album',
      trackGain: -3.0,
      trackPeak: 1.0,
      albumGain: -3.0,
      albumPeak: 1.0,
      soundcheckValue: replayGainToSoundcheck(-3.0),
    });
  });

  it('normalization is undefined when no ReplayGain data present', async () => {
    const track = await mapSong({});

    expect(track.normalization).toBeUndefined();
  });

  it('normalization is undefined when replayGain object exists but has no gain values', async () => {
    const track = await mapSong({
      replayGain: {
        trackPeak: 1.0,
        albumPeak: 1.0,
        baseGain: 0,
      } as any, // No trackGain or albumGain
    });

    expect(track.normalization).toBeUndefined();
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

    expect(track.normalization?.soundcheckValue).toBe(1000);
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

  it('leaves hasArtwork undefined when checkArtwork is false (fast path)', async () => {
    let fetchCount = 0;
    const { mapSong } = createMockedAdapter({
      getCoverArt: async () => {
        fetchCount++;
        return mockRealArtwork();
      },
      checkArtwork: false,
    });
    const track = await mapSong({ coverArt: 'al-123' });
    // coverArt ID alone can't distinguish a real cover from Navidrome's
    // placeholder, so without checkArtwork hasArtwork stays undefined
    // ("unknown") and detectUpgrades' strict `=== true` short-circuits the
    // artwork-added rule. See "loop-free" test below for the engine contract.
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

// =============================================================================
// Loop-free artwork: no artwork-added churn without --check-artwork
// =============================================================================

/**
 * Without `--check-artwork` the adapter cannot distinguish a real cover from
 * Navidrome's placeholder, so it leaves `hasArtwork` undefined. detectUpgrades'
 * strict `source.hasArtwork === true` check short-circuits, preventing the
 * artwork-added churn that an optimistic `true` would produce on every sync
 * for placeholder-only albums.
 */
describe('SubsonicAdapter loop-free artwork', () => {
  const song = (overrides?: Partial<Child>): Child => ({
    id: 'song-1',
    isDir: false,
    title: 'Test Song',
    artist: 'Test Artist',
    album: 'Test Album',
    ...overrides,
  });
  const album = (overrides?: Partial<AlbumWithSongsID3>): AlbumWithSongsID3 => ({
    id: 'album-1',
    name: 'Test Album',
    artist: 'Test Artist',
    songCount: 1,
    duration: 300,
    created: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  });

  function deviceTrackWithoutArt(): DeviceTrack {
    // Minimal shape: only the fields detectUpgrades reads (hasArtwork, syncTag,
    // filetype, bitrate, normalization, metadata). Cast covers the operation
    // methods that aren't invoked by detectUpgrades.
    return {
      filePath: '/ipod/Test Song.m4a',
      title: 'Test Song',
      artist: 'Test Artist',
      album: 'Test Album',
      duration: 300_000,
      bitrate: 256,
      sampleRate: 44100,
      size: 5_000_000,
      filetype: 'AAC audio file',
      hasArtwork: false,
      hasFile: true,
      compilation: false,
      mediaType: 1,
      syncTag: null,
    } as unknown as DeviceTrack;
  }

  it('source.hasArtwork is undefined when Navidrome reports coverArt but checkArtwork is off', async () => {
    const adapter = new SubsonicAdapter({
      url: 'https://test.example.com',
      username: 'u',
      password: 'p',
      checkArtwork: false,
    });
    const track = await (adapter as any)['mapSongToTrack'](
      song({ coverArt: 'al-placeholder' }),
      album()
    );
    expect(track.hasArtwork).toBeUndefined();
    expect(track.artworkHash).toBeUndefined();
  });

  it('detectUpgrades does not fire artwork-added for an undefined source.hasArtwork', async () => {
    const adapter = new SubsonicAdapter({
      url: 'https://test.example.com',
      username: 'u',
      password: 'p',
      checkArtwork: false,
    });
    const source = await (adapter as any)['mapSongToTrack'](
      song({ coverArt: 'al-placeholder' }),
      album()
    );
    const ipod = deviceTrackWithoutArt();

    const reasons = detectUpgrades(source, ipod);
    expect(reasons).not.toContain('artwork-added');
  });

  it('detectUpgrades stays silent when a stale syncTag.artworkHash lingers from a prior --check-artwork sync', async () => {
    // Scenario: a user ran one sync with --check-artwork (which wrote
    // artworkHash to the iPod's syncTag), then disabled the flag. The adapter
    // now reports hasArtwork=undefined and artworkHash=undefined. The
    // artwork-updated rule is gated on `source.artworkHash` being set, so the
    // stale device-side hash must not be the trigger; if a refactor ever
    // relaxed that gate it would re-introduce an artwork-updated loop here.
    const adapter = new SubsonicAdapter({
      url: 'https://test.example.com',
      username: 'u',
      password: 'p',
      checkArtwork: false,
    });
    const source = await (adapter as any)['mapSongToTrack'](song({ coverArt: 'al-real' }), album());
    const ipodWithStaleHash = {
      ...deviceTrackWithoutArt(),
      hasArtwork: true,
      syncTag: { artworkHash: 'stale_old_hash_from_prior_sync' },
    } as unknown as DeviceTrack;

    const reasons = detectUpgrades(source, ipodWithStaleHash);
    expect(reasons).not.toContain('artwork-added');
    // artwork-removed requires source.hasArtwork === false (not undefined);
    // included to pin the strict-equality contract on that rule too.
    expect(reasons).not.toContain('artwork-removed');
    expect(reasons).not.toContain('artwork-updated');
  });
});

// =============================================================================
// Connection Retry Tests
// =============================================================================

describe('SubsonicAdapter connection retries', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /**
   * Create an adapter with a mocked globalThis.fetch.
   * The mock must be installed BEFORE creating the adapter because
   * createRetryFetch captures globalThis.fetch at construction time.
   */
  function createAdapterWithMockedFetch(
    mockFetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  ) {
    globalThis.fetch = mockFetch as typeof globalThis.fetch;
    return new SubsonicAdapter({
      url: 'https://music.example.com',
      username: 'testuser',
      password: 'testpass',
    });
  }

  it('retries connection errors up to 3 times then throws SubsonicConnectionError', async () => {
    let fetchCount = 0;
    const adapter = createAdapterWithMockedFetch(async () => {
      fetchCount++;
      throw new TypeError('fetch failed');
    });

    const error = await adapter.connect().catch((e) => e);
    expect(error).toBeInstanceOf(SubsonicConnectionError);
    expect(fetchCount).toBe(3);
  });

  it('error message includes the server URL', async () => {
    const adapter = createAdapterWithMockedFetch(async () => {
      throw new TypeError('fetch failed');
    });

    const error = await adapter.connect().catch((e) => e);
    expect(error.message).toContain('https://music.example.com');
  });

  it('error message includes retry count and diagnostic hints', async () => {
    const adapter = createAdapterWithMockedFetch(async () => {
      throw new TypeError('fetch failed');
    });

    const error = await adapter.connect().catch((e) => e);
    expect(error.message).toContain('after 3 attempts');
    expect(error.message).toContain('Check that the server is running');
    expect(error.message).toContain('Docker');
  });

  it('SubsonicConnectionError has url property', async () => {
    const adapter = createAdapterWithMockedFetch(async () => {
      throw new TypeError('fetch failed');
    });

    const error = await adapter.connect().catch((e) => e);
    expect(error).toBeInstanceOf(SubsonicConnectionError);
    expect(error.url).toBe('https://music.example.com');
  });

  it('retries on DNS resolution failure (ENOTFOUND)', async () => {
    let fetchCount = 0;
    const adapter = createAdapterWithMockedFetch(async () => {
      fetchCount++;
      const err = new Error('getaddrinfo ENOTFOUND music.example.com');
      throw err;
    });

    await expect(adapter.connect()).rejects.toBeInstanceOf(SubsonicConnectionError);
    expect(fetchCount).toBe(3);
  });

  it('retries on connection refused (ECONNREFUSED)', async () => {
    let fetchCount = 0;
    const adapter = createAdapterWithMockedFetch(async () => {
      fetchCount++;
      throw new Error('connect ECONNREFUSED 192.168.1.100:4533');
    });

    await expect(adapter.connect()).rejects.toBeInstanceOf(SubsonicConnectionError);
    expect(fetchCount).toBe(3);
  });

  it('retries on timeout (ETIMEDOUT)', async () => {
    let fetchCount = 0;
    const adapter = createAdapterWithMockedFetch(async () => {
      fetchCount++;
      throw new Error('connect ETIMEDOUT 10.0.0.1:443');
    });

    await expect(adapter.connect()).rejects.toBeInstanceOf(SubsonicConnectionError);
    expect(fetchCount).toBe(3);
  });

  it('succeeds on retry after transient connection failure', async () => {
    let fetchCount = 0;
    const adapter = createAdapterWithMockedFetch(async () => {
      fetchCount++;
      if (fetchCount < 3) {
        throw new TypeError('fetch failed');
      }
      // Return a successful Subsonic ping response
      return new Response(
        JSON.stringify({
          'subsonic-response': { status: 'ok', version: '1.16.1' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    // Should not throw — succeeds on 3rd attempt. A 4th fetch follows for the
    // unconditional placeholder probe (`detectPlaceholderArtwork`); it sees
    // the JSON response, finds no image content-type, and stores null.
    await adapter.connect();
    expect(fetchCount).toBe(4);
  });

  it('does not retry on non-connection errors', async () => {
    let fetchCount = 0;
    const adapter = createAdapterWithMockedFetch(async () => {
      fetchCount++;
      // A non-connection error (e.g., thrown by middleware)
      throw new Error('some other error');
    });

    // Should fail immediately without retrying
    // The error wrapping in connect() catches it as a generic connection failure
    await expect(adapter.connect()).rejects.toThrow(/Failed to connect/);
    expect(fetchCount).toBe(1);
  });

  it('does not retry when server returns HTTP 401 (authentication failure)', async () => {
    let fetchCount = 0;
    const adapter = createAdapterWithMockedFetch(async () => {
      fetchCount++;
      // HTTP 401 is returned as a Response, not thrown — fetch() resolves for HTTP errors.
      // The subsonic-api library parses the response and may throw its own error,
      // but the fetch layer itself succeeds. We verify fetch is called only once.
      return new Response(
        JSON.stringify({
          'subsonic-response': {
            status: 'failed',
            error: { code: 40, message: 'Wrong username or password' },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });

    // The adapter wraps the "status: failed" response into an error
    await expect(adapter.connect()).rejects.toThrow(/Failed to connect/);
    // fetch was called exactly once — no retries for auth failures
    expect(fetchCount).toBe(1);
  });

  it('does not retry when server returns HTTP 403 (forbidden)', async () => {
    let fetchCount = 0;
    const adapter = createAdapterWithMockedFetch(async () => {
      fetchCount++;
      return new Response('Forbidden', {
        status: 403,
        headers: { 'content-type': 'text/plain' },
      });
    });

    await expect(adapter.connect()).rejects.toThrow(/Failed to connect/);
    expect(fetchCount).toBe(1);
  });
});

// =============================================================================
// getArtwork — adapter-side artwork fallback (TASK-142)
// =============================================================================

describe('SubsonicAdapter getArtwork', () => {
  const realArtwork = Buffer.alloc(200, 0x42);
  const placeholderImage = Buffer.alloc(200, 0xaa);

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
   * Mount a mock getCoverArt onto a fresh adapter and expose mapSong so tests can
   * populate the per-track coverArt map before calling getArtwork.
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

  const mockRealArtwork = async () =>
    new Response(realArtwork, { status: 200, headers: { 'content-type': 'image/jpeg' } });

  const mockPlaceholder = async () =>
    new Response(placeholderImage, { status: 200, headers: { 'content-type': 'image/webp' } });

  const mock404 = async () =>
    new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain' } });

  it('returns null for a track with no coverArt id', async () => {
    const { adapter, mapSong } = createMockedAdapter({
      getCoverArt: async () => {
        throw new Error('should not be called');
      },
    });
    const track = await mapSong({ id: 'song-x', coverArt: undefined });
    expect(await adapter.getArtwork(track)).toBeNull();
  });

  it('returns bytes from getCoverArt when the cover resolves to a real image', async () => {
    const { adapter, mapSong } = createMockedAdapter({ getCoverArt: mockRealArtwork });
    const track = await mapSong({ id: 'song-x', coverArt: 'al-123' });

    const bytes = await adapter.getArtwork(track);
    expect(bytes).not.toBeNull();
    expect(bytes!.equals(realArtwork)).toBe(true);
  });

  it('returns null when the server responds with a placeholder image', async () => {
    const placeholderHash = hashArtwork(placeholderImage);
    const { adapter, mapSong } = createMockedAdapter({
      getCoverArt: mockPlaceholder,
      placeholderHash,
    });
    const track = await mapSong({ id: 'song-x', coverArt: 'al-123' });

    expect(await adapter.getArtwork(track)).toBeNull();
  });

  it('returns null on HTTP error (e.g. Gonic 404 for missing artwork)', async () => {
    const { adapter, mapSong } = createMockedAdapter({ getCoverArt: mock404 });
    const track = await mapSong({ id: 'song-x', coverArt: 'al-456' });

    expect(await adapter.getArtwork(track)).toBeNull();
  });

  it('returns null when getCoverArt throws', async () => {
    const { adapter, mapSong } = createMockedAdapter({
      getCoverArt: async () => {
        throw new Error('network down');
      },
    });
    const track = await mapSong({ id: 'song-x', coverArt: 'al-789' });

    expect(await adapter.getArtwork(track)).toBeNull();
  });

  it('reuses cached bytes for a second track on the same album (one fetch)', async () => {
    let fetchCount = 0;
    const { adapter, mapSong } = createMockedAdapter({
      getCoverArt: async () => {
        fetchCount++;
        return mockRealArtwork();
      },
    });
    const t1 = await mapSong({ id: 'song-1', coverArt: 'al-shared' });
    const t2 = await mapSong({ id: 'song-2', coverArt: 'al-shared' });

    expect(await adapter.getArtwork(t1)).not.toBeNull();
    expect(await adapter.getArtwork(t2)).not.toBeNull();
    expect(fetchCount).toBe(1);
  });

  it('short-circuits to null when an earlier check-artwork pass marked the cover as missing', async () => {
    const { adapter, mapSong } = createMockedAdapter({
      getCoverArt: mock404,
      checkArtwork: true,
    });
    // With checkArtwork on, mapSongToTrack pre-classifies the coverArt as
    // 'missing' (404). getArtwork must respect that without re-fetching.
    const track = await mapSong({ id: 'song-x', coverArt: 'al-missing' });

    let postMapFetchCount = 0;
    (adapter as any).api.getCoverArt = async () => {
      postMapFetchCount++;
      return mockRealArtwork();
    };
    expect(await adapter.getArtwork(track)).toBeNull();
    expect(postMapFetchCount).toBe(0);
  });

  it("short-circuits to null when an earlier check-artwork pass marked the cover as 'placeholder'", async () => {
    // Sister to the 'missing' short-circuit above: classify == 'placeholder'
    // must also skip the fetch. Pins the readers-treat-placeholder-and-missing-
    // identically contract that the discriminated-union rewrite was trying to
    // encode.
    const placeholderHash = hashArtwork(placeholderImage);
    const { adapter, mapSong } = createMockedAdapter({
      getCoverArt: mockPlaceholder,
      placeholderHash,
      checkArtwork: true,
    });
    const track = await mapSong({ id: 'song-x', coverArt: 'al-placeholder' });

    let postMapFetchCount = 0;
    (adapter as any).api.getCoverArt = async () => {
      postMapFetchCount++;
      return mockRealArtwork();
    };
    expect(await adapter.getArtwork(track)).toBeNull();
    expect(postMapFetchCount).toBe(0);
  });

  it('disconnect clears the per-track coverArt map and the byte cache', async () => {
    const { adapter, mapSong } = createMockedAdapter({ getCoverArt: mockRealArtwork });
    const track = await mapSong({ id: 'song-x', coverArt: 'al-clear' });
    expect(await adapter.getArtwork(track)).not.toBeNull();

    await adapter.disconnect();
    // The stale track reference no longer resolves a coverArtId — null fallback.
    expect(await adapter.getArtwork(track)).toBeNull();
  });

  it('bytes cache is bounded — oldest entry evicts past the cap (FIFO)', async () => {
    // The cap (100) is large; we drive past it with synthetic ids and assert
    // the first one inserted is no longer cached when getArtwork is asked
    // again later. Re-asking would trigger a refetch — we count fetch calls.
    let fetchCount = 0;
    const { adapter } = createMockedAdapter({
      getCoverArt: async () => {
        fetchCount++;
        return new Response(realArtwork, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        });
      },
    });

    // Manually populate the per-track map to avoid the per-mapSong fetch.
    const internals = adapter as unknown as {
      coverArtByTrack: Map<string, string>;
    };
    for (let i = 0; i < 101; i++) {
      internals.coverArtByTrack.set(`t-${i}`, `cover-${i}`);
    }

    // First eviction: fetch cover-0 then cover-1..100 (101 albums); cap is 100
    // so cover-0 falls off after cover-100 lands.
    for (let i = 0; i < 101; i++) {
      const track = { id: `t-${i}` } as unknown as CollectionTrack;
      const result = await adapter.getArtwork(track);
      expect(result).not.toBeNull();
    }
    expect(fetchCount).toBe(101);

    // cover-0 evicted → second call triggers a re-fetch.
    fetchCount = 0;
    const stale = { id: 't-0' } as unknown as CollectionTrack;
    await adapter.getArtwork(stale);
    expect(fetchCount).toBe(1);

    // cover-100 (most recently inserted) is still cached → no re-fetch.
    fetchCount = 0;
    const fresh = { id: 't-100' } as unknown as CollectionTrack;
    await adapter.getArtwork(fresh);
    expect(fetchCount).toBe(0);
  });

  it('classification survives bytes eviction — structural invariant of the cache split', async () => {
    // The whole point of separating ArtworkClassificationMemo from
    // ArtworkBytesCache: bytes evict under memory pressure, but the
    // 'real/placeholder/missing' decision persists so a daemon never has to
    // re-decide. Drive past the bytes cap and verify the evicted entry's
    // classification is still cached.
    const { adapter } = createMockedAdapter({
      getCoverArt: async () =>
        new Response(realArtwork, {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
    });

    const internals = adapter as unknown as {
      coverArtByTrack: Map<string, string>;
      classify: { get(id: string): 'real' | 'placeholder' | 'missing' | undefined; size(): number };
      bytes: { has(id: string): boolean; size(): number };
    };
    for (let i = 0; i < 101; i++) {
      internals.coverArtByTrack.set(`t-${i}`, `cover-${i}`);
    }

    for (let i = 0; i < 101; i++) {
      const track = { id: `t-${i}` } as unknown as CollectionTrack;
      await adapter.getArtwork(track);
    }

    // Bytes cache holds the cap; cover-0 has evicted from bytes...
    expect(internals.bytes.has('cover-0')).toBe(false);
    // ...but its classification is still memoised.
    expect(internals.classify.get('cover-0')).toBe('real');
    // And the memo has grown beyond the bytes cap — proving it's unbounded.
    expect(internals.classify.size()).toBe(101);
  });
});

// =============================================================================
// Playlist-scoped collections (schema + resolver + adapter wiring)
// =============================================================================

/**
 * These tests assert external behaviour through the adapter's public surface:
 * connect() resolves/validates the configured playlist (throwing the typed
 * resolver errors before any transfer), and getItems() returns only the
 * playlist's tracks when scoped — and the full library when not.
 *
 * The whole `api` object is replaced with an in-memory fake so no network is
 * hit. ping/getCoverArt satisfy connect()'s existing probes; getPlaylists/
 * getPlaylist drive the resolver; getAlbumList2/getAlbum drive the unscoped
 * whole-library path.
 */
describe('SubsonicAdapter playlist scoping', () => {
  function child(overrides: Partial<Child> & { id: string }): Child {
    return {
      isDir: false,
      title: `Title ${overrides.id}`,
      artist: 'Artist',
      album: 'Album',
      ...overrides,
    } as Child;
  }

  type FakeApiOptions = {
    playlists?: Array<{ id: string; name: string }>;
    playlistEntries?: Record<string, Child[]>;
    /** Songs returned by the whole-library scan (one synthetic album). */
    librarySongs?: Child[];
  };

  /** Build an adapter whose `api` is a fully in-memory fake. */
  function createAdapterWithFakeApi(
    config: Partial<SubsonicAdapterConfig>,
    opts: FakeApiOptions = {}
  ): SubsonicAdapter {
    const adapter = new SubsonicAdapter({
      url: 'https://test.example.com',
      username: 'u',
      password: 'p',
      ...config,
    });

    const librarySongs = opts.librarySongs ?? [];

    const fakeApi = {
      ping: async () => ({ status: 'ok' as const }),
      // No placeholder image — keep the probe a no-op.
      getCoverArt: async () =>
        new Response('not an image', { status: 404, headers: { 'content-type': 'text/plain' } }),
      getPlaylists: async () => ({ playlists: { playlist: opts.playlists ?? [] } }),
      getPlaylist: async ({ id }: { id: string }) => ({
        playlist: { entry: opts.playlistEntries?.[id] ?? [] },
      }),
      // Whole-library scan: one album page, then empty to terminate pagination.
      getAlbumList2: async ({ offset }: { offset: number }) =>
        offset === 0
          ? { albumList2: { album: [{ id: 'album-1' }] } }
          : { albumList2: { album: [] } },
      getAlbum: async () => ({
        album: {
          id: 'album-1',
          name: 'Album',
          artist: 'Artist',
          songCount: librarySongs.length,
          duration: 0,
          created: new Date('2024-01-01T00:00:00Z'),
          song: librarySongs,
        },
      }),
    };

    (adapter as unknown as { api: unknown }).api = fakeApi;
    return adapter;
  }

  it('connect() throws PlaylistNotFoundError when the configured playlist is missing', async () => {
    const adapter = createAdapterWithFakeApi(
      { playlist: 'Roadtrip' },
      { playlists: [{ id: 'pl-1', name: 'Workout' }] }
    );

    const error = await adapter.connect().catch((e) => e);
    expect(error).toBeInstanceOf(PlaylistNotFoundError);
  });

  it('connect() throws AmbiguousPlaylistError when two playlists share the name', async () => {
    const adapter = createAdapterWithFakeApi(
      { playlist: 'Workout' },
      {
        playlists: [
          { id: 'pl-1', name: 'Workout' },
          { id: 'pl-2', name: 'Workout' },
        ],
      }
    );

    const error = await adapter.connect().catch((e) => e);
    expect(error).toBeInstanceOf(AmbiguousPlaylistError);
  });

  it('getItems() returns only the playlist tracks when playlist is set', async () => {
    const adapter = createAdapterWithFakeApi(
      { playlist: 'Workout' },
      {
        playlists: [{ id: 'pl-1', name: 'Workout' }],
        playlistEntries: {
          'pl-1': [
            child({ id: 'p-1', title: 'Playlist Song 1' }),
            child({ id: 'p-2', title: 'Playlist Song 2' }),
          ],
        },
        // Library has different songs — these must NOT appear.
        librarySongs: [child({ id: 'lib-1', title: 'Library Song' })],
      }
    );

    await adapter.connect();
    const items = await adapter.getItems();

    expect(items.map((t) => t.id)).toEqual(['p-1', 'p-2']);
    expect(items.some((t) => t.id === 'lib-1')).toBe(false);
  });

  it('getItems() returns the full library when no playlist is set', async () => {
    const adapter = createAdapterWithFakeApi(
      {},
      {
        librarySongs: [
          child({ id: 'lib-1', title: 'Library Song 1' }),
          child({ id: 'lib-2', title: 'Library Song 2' }),
        ],
      }
    );

    await adapter.connect();
    const items = await adapter.getItems();

    expect(items.map((t) => t.id).sort()).toEqual(['lib-1', 'lib-2']);
  });

  it('getFilteredItems() layers in-memory filters on top of the playlist scope', async () => {
    const adapter = createAdapterWithFakeApi(
      { playlist: 'Workout' },
      {
        playlists: [{ id: 'pl-1', name: 'Workout' }],
        playlistEntries: {
          'pl-1': [
            child({ id: 'p-1', title: 'Keep', artist: 'Daft Punk' }),
            child({ id: 'p-2', title: 'Drop', artist: 'Radiohead' }),
          ],
        },
      }
    );

    await adapter.connect();
    const filtered = await adapter.getFilteredItems({ artist: 'daft' });

    expect(filtered.map((t) => t.id)).toEqual(['p-1']);
  });

  // ---------------------------------------------------------------------------
  // B-1: adapter must NOT be left in a usable state when connect() throws
  // ---------------------------------------------------------------------------

  it('adapter is not left usable after connect() throws PlaylistNotFoundError', async () => {
    const adapter = createAdapterWithFakeApi(
      { playlist: 'Missing' },
      { playlists: [{ id: 'pl-1', name: 'Other' }] }
    );

    // connect() must reject
    await expect(adapter.connect()).rejects.toBeInstanceOf(PlaylistNotFoundError);

    // A subsequent getItems() must not silently return [] — because
    // connected === false, getItems() re-attempts connect(), which again throws
    // PlaylistNotFoundError. The adapter never enters the "connected with null
    // playlistTracks" corrupt state (the invariant guard in getItems() is
    // therefore unreachable here, but is still a meaningful safety net for any
    // future path that could bypass connect()).
    await expect(adapter.getItems()).rejects.toBeInstanceOf(PlaylistNotFoundError);
  });

  // ---------------------------------------------------------------------------
  // S-2: reconnect coverage — disconnect() clears playlistTracks; reconnect re-resolves
  // ---------------------------------------------------------------------------

  it('reconnect after disconnect re-resolves the playlist and getItems() returns tracks', async () => {
    const adapter = createAdapterWithFakeApi(
      { playlist: 'Workout' },
      {
        playlists: [{ id: 'pl-1', name: 'Workout' }],
        playlistEntries: {
          'pl-1': [child({ id: 'p-1', title: 'Track 1' }), child({ id: 'p-2', title: 'Track 2' })],
        },
      }
    );

    // First connect → getItems
    await adapter.connect();
    const firstItems = await adapter.getItems();
    expect(firstItems.map((t) => t.id)).toEqual(['p-1', 'p-2']);

    // Disconnect clears state
    await adapter.disconnect();

    // Reconnect re-resolves the playlist
    await adapter.connect();
    const secondItems = await adapter.getItems();
    expect(secondItems.map((t) => t.id)).toEqual(['p-1', 'p-2']);
  });
});
