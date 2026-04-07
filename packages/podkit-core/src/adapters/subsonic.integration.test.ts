/**
 * Integration tests for SubsonicAdapter
 *
 * Uses a local mock HTTP server to test the full request/response cycle.
 * This verifies that the adapter correctly:
 * - Constructs URLs and authentication parameters
 * - Handles pagination
 * - Parses responses
 * - Handles errors
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'bun:test';
import { SubsonicAdapter } from './subsonic.js';
import { hashArtwork } from '../artwork/hash.js';

// =============================================================================
// Mock HTTP Server
// =============================================================================

interface MockServerState {
  albums: MockAlbum[];
  songs: Record<string, MockSong[]>;
  /** Map of coverArt ID → image bytes. If absent, getCoverArt returns 404. */
  coverArt: Record<string, Buffer>;
  /** Placeholder image served for empty coverArt ID (simulates Navidrome). Undefined = 404. */
  placeholder?: Buffer;
  /** Track getCoverArt request count per coverArt ID */
  coverArtRequests: Record<string, number>;
  authError: boolean;
  serverError: boolean;
  pingCount: number;
  albumListCount: number;
}

interface MockAlbum {
  id: string;
  name: string;
  artist: string;
  songCount: number;
  duration: number;
  created: string;
  genre?: string;
  year?: number;
}

interface MockSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  track?: number;
  discNumber?: number;
  duration?: number;
  bitRate?: number;
  suffix?: string;
  contentType?: string;
  coverArt?: string;
  size?: number;
  genre?: string;
  year?: number;
}

let mockServer: ReturnType<typeof Bun.serve> | null = null;
let mockServerPort = 0;
let serverState: MockServerState;

function resetServerState(): void {
  serverState = {
    albums: [],
    songs: {},
    coverArt: {},
    coverArtRequests: {},
    authError: false,
    serverError: false,
    pingCount: 0,
    albumListCount: 0,
  };
}

function createMockServer(port: number) {
  return Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // Check authentication
      const user = url.searchParams.get('u');
      const token = url.searchParams.get('t') || url.searchParams.get('p');

      if (serverState.authError || !user || !token) {
        return Response.json({
          'subsonic-response': {
            status: 'failed',
            version: '1.16.1',
            error: { code: 40, message: 'Wrong username or password.' },
          },
        });
      }

      if (serverState.serverError) {
        return new Response('Internal Server Error', { status: 500 });
      }

      // Route requests
      if (path.endsWith('/rest/ping') || path.endsWith('/rest/ping.view')) {
        serverState.pingCount++;
        return Response.json({
          'subsonic-response': { status: 'ok', version: '1.16.1' },
        });
      }

      if (path.endsWith('/rest/getAlbumList2') || path.endsWith('/rest/getAlbumList2.view')) {
        serverState.albumListCount++;
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const size = parseInt(url.searchParams.get('size') || '500');

        const albums = serverState.albums.slice(offset, offset + size);

        return Response.json({
          'subsonic-response': {
            status: 'ok',
            version: '1.16.1',
            albumList2: { album: albums },
          },
        });
      }

      if (path.endsWith('/rest/getAlbum') || path.endsWith('/rest/getAlbum.view')) {
        const id = url.searchParams.get('id');
        const album = serverState.albums.find((a) => a.id === id);

        if (!album) {
          return Response.json({
            'subsonic-response': {
              status: 'failed',
              version: '1.16.1',
              error: { code: 70, message: 'Album not found.' },
            },
          });
        }

        return Response.json({
          'subsonic-response': {
            status: 'ok',
            version: '1.16.1',
            album: {
              ...album,
              song: id ? serverState.songs[id] || [] : [],
            },
          },
        });
      }

      if (path.endsWith('/rest/download') || path.endsWith('/rest/download.view')) {
        // Return mock audio data
        const mockAudioData = new Uint8Array([0xff, 0xfb, 0x90, 0x00]); // Fake MP3 header
        return new Response(mockAudioData, {
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Length': String(mockAudioData.length),
          },
        });
      }

      if (path.endsWith('/rest/getCoverArt') || path.endsWith('/rest/getCoverArt.view')) {
        const coverArtId = url.searchParams.get('id') ?? '';

        // Empty id: serve placeholder if configured (Navidrome behavior), else 404 (Gonic)
        if (!coverArtId) {
          if (serverState.placeholder) {
            return new Response(new Uint8Array(serverState.placeholder), {
              status: 200,
              headers: { 'Content-Type': 'image/webp' },
            });
          }
          return new Response('Cover art not found', { status: 404 });
        }

        // Track requests per coverArt ID
        serverState.coverArtRequests[coverArtId] =
          (serverState.coverArtRequests[coverArtId] ?? 0) + 1;

        const artworkData = serverState.coverArt[coverArtId];
        if (artworkData) {
          return new Response(new Uint8Array(artworkData), {
            status: 200,
            headers: { 'Content-Type': 'image/jpeg' },
          });
        }

        // No artwork for this ID — return 404 (Gonic) or placeholder (Navidrome)
        if (serverState.placeholder) {
          // Navidrome: serves placeholder for existing entities without artwork too
          serverState.coverArtRequests[coverArtId] = serverState.coverArtRequests[coverArtId] ?? 0;
          return new Response(new Uint8Array(serverState.placeholder), {
            status: 200,
            headers: { 'Content-Type': 'image/webp' },
          });
        }
        return new Response('Cover art not found', { status: 404 });
      }

      return new Response('Not Found', { status: 404 });
    },
  });
}

// =============================================================================
// Test Setup
// =============================================================================

beforeAll(async () => {
  // Find an available port
  mockServerPort = 19000 + Math.floor(Math.random() * 1000);
  resetServerState();
  mockServer = createMockServer(mockServerPort);
});

afterAll(() => {
  mockServer?.stop();
});

beforeEach(() => {
  resetServerState();
});

function createAdapter(): SubsonicAdapter {
  return new SubsonicAdapter({
    url: `http://localhost:${mockServerPort}`,
    username: 'testuser',
    password: 'testpass',
  });
}

// =============================================================================
// Connection Tests
// =============================================================================

describe('SubsonicAdapter connection', () => {
  it('connect() succeeds when server responds OK', async () => {
    const adapter = createAdapter();
    await expect(adapter.connect()).resolves.toBeUndefined();
    expect(serverState.pingCount).toBe(1);
  });

  it('connect() throws on authentication failure', async () => {
    serverState.authError = true;
    const adapter = createAdapter();

    await expect(adapter.connect()).rejects.toThrow(/Failed to connect/);
  });

  it('connect() throws on server error', async () => {
    serverState.serverError = true;
    const adapter = createAdapter();

    await expect(adapter.connect()).rejects.toThrow();
  });
});

// =============================================================================
// Album/Track Fetching Tests
// =============================================================================

describe('SubsonicAdapter getTracks', () => {
  it('returns empty array for empty library', async () => {
    const adapter = createAdapter();
    const tracks = await adapter.getItems();

    expect(tracks).toEqual([]);
    expect(serverState.albumListCount).toBe(1);
  });

  it('fetches tracks from single album', async () => {
    serverState.albums = [
      {
        id: 'album1',
        name: 'Test Album',
        artist: 'Test Artist',
        songCount: 2,
        duration: 300,
        created: '2024-01-01T00:00:00Z',
      },
    ];
    serverState.songs = {
      album1: [
        {
          id: 'song1',
          title: 'Track 1',
          artist: 'Test Artist',
          album: 'Test Album',
          duration: 180,
          suffix: 'mp3',
          bitRate: 320,
        },
        {
          id: 'song2',
          title: 'Track 2',
          artist: 'Test Artist',
          album: 'Test Album',
          duration: 120,
          suffix: 'flac',
        },
      ],
    };

    const adapter = createAdapter();
    const tracks = await adapter.getItems();

    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({
      id: 'song1',
      title: 'Track 1',
      artist: 'Test Artist',
      album: 'Test Album',
    });
  });

  it('converts duration from seconds to milliseconds', async () => {
    serverState.albums = [
      {
        id: 'album1',
        name: 'Test Album',
        artist: 'Test Artist',
        songCount: 1,
        duration: 180,
        created: '2024-01-01T00:00:00Z',
      },
    ];
    serverState.songs = {
      album1: [
        {
          id: 'song1',
          title: 'Track 1',
          artist: 'Test Artist',
          album: 'Test Album',
          duration: 180,
        },
      ],
    };

    const adapter = createAdapter();
    const tracks = await adapter.getItems();

    expect(tracks[0]?.duration).toBe(180000); // 180 seconds = 180000 ms
  });

  it('detects FLAC as lossless', async () => {
    serverState.albums = [
      {
        id: 'album1',
        name: 'Test Album',
        artist: 'Test Artist',
        songCount: 1,
        duration: 180,
        created: '2024-01-01T00:00:00Z',
      },
    ];
    serverState.songs = {
      album1: [
        {
          id: 'song1',
          title: 'Track 1',
          artist: 'Test Artist',
          album: 'Test Album',
          suffix: 'flac',
        },
      ],
    };

    const adapter = createAdapter();
    const tracks = await adapter.getItems();

    expect(tracks[0]?.lossless).toBe(true);
    expect(tracks[0]?.fileType).toBe('flac');
  });

  it('detects MP3 as lossy', async () => {
    serverState.albums = [
      {
        id: 'album1',
        name: 'Test Album',
        artist: 'Test Artist',
        songCount: 1,
        duration: 180,
        created: '2024-01-01T00:00:00Z',
      },
    ];
    serverState.songs = {
      album1: [
        {
          id: 'song1',
          title: 'Track 1',
          artist: 'Test Artist',
          album: 'Test Album',
          suffix: 'mp3',
        },
      ],
    };

    const adapter = createAdapter();
    const tracks = await adapter.getItems();

    expect(tracks[0]?.lossless).toBe(false);
    expect(tracks[0]?.fileType).toBe('mp3');
  });

  it('caches tracks on second call', async () => {
    serverState.albums = [
      {
        id: 'album1',
        name: 'Test Album',
        artist: 'Test Artist',
        songCount: 1,
        duration: 180,
        created: '2024-01-01T00:00:00Z',
      },
    ];
    serverState.songs = {
      album1: [{ id: 'song1', title: 'Track 1', artist: 'Test Artist', album: 'Test Album' }],
    };

    const adapter = createAdapter();

    // First call
    const tracks1 = await adapter.getItems();
    const albumListCountAfterFirst = serverState.albumListCount;

    // Second call should use cache
    const tracks2 = await adapter.getItems();

    expect(tracks1).toBe(tracks2); // Same array reference (cached)
    expect(serverState.albumListCount).toBe(albumListCountAfterFirst); // No additional API calls
  });

  it('handles pagination across multiple album pages', async () => {
    // Create more albums than page size
    serverState.albums = Array.from({ length: 3 }, (_, i) => ({
      id: `album${i}`,
      name: `Album ${i}`,
      artist: 'Artist',
      songCount: 1,
      duration: 180,
      created: '2024-01-01T00:00:00Z',
    }));
    serverState.songs = Object.fromEntries(
      serverState.albums.map((album) => [
        album.id,
        [
          {
            id: `song-${album.id}`,
            title: `Song from ${album.name}`,
            artist: 'Artist',
            album: album.name,
          },
        ],
      ])
    );

    const adapter = createAdapter();
    const tracks = await adapter.getItems();

    expect(tracks).toHaveLength(3);
  });
});

// =============================================================================
// Filter Tests
// =============================================================================

describe('SubsonicAdapter filtering', () => {
  beforeEach(() => {
    serverState.albums = [
      {
        id: 'album1',
        name: 'Rock Album',
        artist: 'Rock Band',
        songCount: 1,
        duration: 180,
        created: '2024-01-01T00:00:00Z',
        genre: 'Rock',
        year: 2024,
      },
      {
        id: 'album2',
        name: 'Jazz Album',
        artist: 'Jazz Group',
        songCount: 1,
        duration: 180,
        created: '2024-01-01T00:00:00Z',
        genre: 'Jazz',
        year: 2023,
      },
    ];
    serverState.songs = {
      album1: [
        {
          id: 'song1',
          title: 'Rock Song',
          artist: 'Rock Band',
          album: 'Rock Album',
          genre: 'Rock',
          year: 2024,
        },
      ],
      album2: [
        {
          id: 'song2',
          title: 'Jazz Song',
          artist: 'Jazz Group',
          album: 'Jazz Album',
          genre: 'Jazz',
          year: 2023,
        },
      ],
    };
  });

  it('filters by artist', async () => {
    const adapter = createAdapter();
    const filtered = await adapter.getFilteredItems({ artist: 'Rock' });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.artist).toBe('Rock Band');
  });

  it('filters by album', async () => {
    const adapter = createAdapter();
    const filtered = await adapter.getFilteredItems({ album: 'Jazz' });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.album).toBe('Jazz Album');
  });

  it('filters by genre', async () => {
    const adapter = createAdapter();
    const filtered = await adapter.getFilteredItems({ genre: 'Rock' });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.genre).toBe('Rock');
  });

  it('filters by year', async () => {
    const adapter = createAdapter();
    const filtered = await adapter.getFilteredItems({ year: 2024 });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.year).toBe(2024);
  });
});

// =============================================================================
// File Access Tests
// =============================================================================

describe('SubsonicAdapter file access', () => {
  it('getFileAccess returns stream type', () => {
    const adapter = createAdapter();
    const mockTrack = {
      id: 'song1',
      title: 'Test',
      artist: 'Test',
      album: 'Test',
      filePath: 'test.mp3',
      fileType: 'mp3' as const,
    };

    const access = adapter.getFileAccess(mockTrack);

    expect(access.type).toBe('stream');
    if (access.type === 'stream') {
      expect(typeof access.getStream).toBe('function');
    }
  });

  it('getStream fetches from download endpoint', async () => {
    serverState.albums = [
      {
        id: 'album1',
        name: 'Test',
        artist: 'Test',
        songCount: 1,
        duration: 180,
        created: '2024-01-01T00:00:00Z',
      },
    ];
    serverState.songs = {
      album1: [{ id: 'song1', title: 'Test', artist: 'Test', album: 'Test' }],
    };

    const adapter = createAdapter();
    const tracks = await adapter.getItems();
    const access = adapter.getFileAccess(tracks[0]!);

    if (access.type === 'stream') {
      const stream = await access.getStream();
      expect(stream).toBeDefined();

      // Consume the stream - handle both Web ReadableStream and Node Readable
      if ('getReader' in stream && typeof stream.getReader === 'function') {
        const reader = stream.getReader();
        const { value } = await reader.read();
        expect(value).toBeInstanceOf(Uint8Array);
      }
    }
  });
});

// =============================================================================
// Disconnect Tests
// =============================================================================

describe('SubsonicAdapter disconnect', () => {
  it('clears cache on disconnect', async () => {
    serverState.albums = [
      {
        id: 'album1',
        name: 'Test',
        artist: 'Test',
        songCount: 1,
        duration: 180,
        created: '2024-01-01T00:00:00Z',
      },
    ];
    serverState.songs = {
      album1: [{ id: 'song1', title: 'Test', artist: 'Test', album: 'Test' }],
    };

    const adapter = createAdapter();

    // Fetch tracks to populate cache
    await adapter.getItems();
    expect(adapter.getTrackCount()).toBe(1);

    // Disconnect
    await adapter.disconnect();
    expect(adapter.getTrackCount()).toBe(0);
  });
});

// =============================================================================
// Artwork Presence Detection Tests
// =============================================================================

// Distinct fake images so hashes differ
const realArtwork = Buffer.alloc(200, 0x42);
const placeholderImage = Buffer.alloc(200, 0xaa);

describe('SubsonicAdapter artwork presence detection', () => {
  /** Helper: set up a single album with one song that has a coverArt ID */
  function setupSingleTrack(coverArtId?: string) {
    serverState.albums = [
      {
        id: 'album1',
        name: 'Album',
        artist: 'Artist',
        songCount: 1,
        duration: 180,
        created: '2024-01-01T00:00:00Z',
      },
    ];
    serverState.songs = {
      album1: [
        {
          id: 'song1',
          title: 'Track 1',
          artist: 'Artist',
          album: 'Album',
          suffix: 'flac',
          coverArt: coverArtId,
        },
      ],
    };
  }

  function createAdapter(checkArtwork = false): SubsonicAdapter {
    return new SubsonicAdapter({
      url: `http://localhost:${mockServerPort}`,
      username: 'testuser',
      password: 'testpass',
      checkArtwork,
    });
  }

  // ---------------------------------------------------------------------------
  // Fast path (checkArtwork=false): no getCoverArt calls
  // ---------------------------------------------------------------------------

  it('skips artwork detection when checkArtwork is false', async () => {
    setupSingleTrack('al-1');
    serverState.coverArt = { 'al-1': realArtwork };

    const adapter = createAdapter(false);
    const tracks = await adapter.getItems();

    // When checkArtwork is false but coverArt ID exists, optimistically report true
    // without making any HTTP calls
    expect(tracks[0]?.hasArtwork).toBe(true);
    expect(tracks[0]?.artworkHash).toBeUndefined();
    expect(serverState.coverArtRequests['al-1']).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Presence detection (checkArtwork=true)
  // ---------------------------------------------------------------------------

  it('sets hasArtwork=true when getCoverArt returns a valid image', async () => {
    setupSingleTrack('al-1');
    serverState.coverArt = { 'al-1': realArtwork };

    const adapter = createAdapter(true);
    const tracks = await adapter.getItems();

    expect(tracks[0]?.hasArtwork).toBe(true);
  });

  it('sets hasArtwork=false when getCoverArt returns 404', async () => {
    setupSingleTrack('al-missing');

    const adapter = createAdapter(true);
    const tracks = await adapter.getItems();

    expect(tracks[0]?.hasArtwork).toBe(false);
  });

  it('sets hasArtwork=false when song has no coverArt ID', async () => {
    setupSingleTrack(undefined);

    const adapter = createAdapter(true);
    const tracks = await adapter.getItems();

    expect(tracks[0]?.hasArtwork).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Placeholder filtering (Navidrome behavior)
  // ---------------------------------------------------------------------------

  it('connect() detects placeholder hash from empty-id probe', async () => {
    serverState.placeholder = placeholderImage;

    const adapter = createAdapter(true);
    await adapter.connect();

    expect((adapter as any).placeholderHash).toBe(hashArtwork(placeholderImage));
  });

  it('connect() sets null placeholderHash when server returns error for empty id', async () => {
    serverState.placeholder = undefined;

    const adapter = createAdapter(true);
    await adapter.connect();

    expect((adapter as any).placeholderHash).toBeNull();
  });

  it('filters placeholder artwork and sets hasArtwork=false', async () => {
    setupSingleTrack('al-placeholder');
    serverState.coverArt = { 'al-placeholder': placeholderImage };
    serverState.placeholder = placeholderImage;

    const adapter = createAdapter(true);
    const tracks = await adapter.getItems();

    expect(tracks[0]?.hasArtwork).toBe(false);
  });

  it('does not filter real artwork even when placeholder is detected', async () => {
    setupSingleTrack('al-real');
    serverState.coverArt = { 'al-real': realArtwork };
    serverState.placeholder = placeholderImage;

    const adapter = createAdapter(true);
    const tracks = await adapter.getItems();

    expect(tracks[0]?.hasArtwork).toBe(true);
  });

  it('handles mixed albums — real artwork vs placeholder', async () => {
    serverState.albums = [
      {
        id: 'album-real',
        name: 'Real Art',
        artist: 'A',
        songCount: 1,
        duration: 180,
        created: '2024-01-01T00:00:00Z',
      },
      {
        id: 'album-none',
        name: 'No Art',
        artist: 'A',
        songCount: 1,
        duration: 180,
        created: '2024-01-01T00:00:00Z',
      },
    ];
    serverState.songs = {
      'album-real': [
        { id: 'song1', title: 'T1', artist: 'A', album: 'Real Art', coverArt: 'al-real' },
      ],
      'album-none': [
        { id: 'song2', title: 'T2', artist: 'A', album: 'No Art', coverArt: 'al-none' },
      ],
    };
    serverState.coverArt = { 'al-real': realArtwork, 'al-none': placeholderImage };
    serverState.placeholder = placeholderImage;

    const adapter = createAdapter(true);
    const tracks = await adapter.getItems();

    expect(tracks.find((t) => t.id === 'song1')?.hasArtwork).toBe(true);
    expect(tracks.find((t) => t.id === 'song2')?.hasArtwork).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // artworkHash is always populated (enables progressive sync tag writes)
  // ---------------------------------------------------------------------------

  it('includes artworkHash when checkArtwork is true', async () => {
    setupSingleTrack('al-1');
    serverState.coverArt = { 'al-1': realArtwork };

    const adapter = createAdapter(true);
    const tracks = await adapter.getItems();

    expect(tracks[0]?.hasArtwork).toBe(true);
    expect(tracks[0]?.artworkHash).toBe(hashArtwork(realArtwork));
  });

  // ---------------------------------------------------------------------------
  // Caching
  // ---------------------------------------------------------------------------

  it('caches per coverArtId — one HTTP request per album', async () => {
    serverState.albums = [
      {
        id: 'album1',
        name: 'Album',
        artist: 'A',
        songCount: 3,
        duration: 540,
        created: '2024-01-01T00:00:00Z',
      },
    ];
    serverState.songs = {
      album1: [
        { id: 'song1', title: 'T1', artist: 'A', album: 'Album', coverArt: 'al-1' },
        { id: 'song2', title: 'T2', artist: 'A', album: 'Album', coverArt: 'al-1' },
        { id: 'song3', title: 'T3', artist: 'A', album: 'Album', coverArt: 'al-1' },
      ],
    };
    serverState.coverArt = { 'al-1': realArtwork };

    const adapter = createAdapter(true);
    const tracks = await adapter.getItems();

    expect(tracks).toHaveLength(3);
    for (const track of tracks) expect(track.hasArtwork).toBe(true);
    expect(serverState.coverArtRequests['al-1']).toBe(1);
  });

  it('clears artwork cache and placeholder hash on disconnect', async () => {
    setupSingleTrack('al-1');
    serverState.coverArt = { 'al-1': realArtwork };
    serverState.placeholder = placeholderImage;

    const adapter = createAdapter(true);
    await adapter.getItems();
    expect(serverState.coverArtRequests['al-1']).toBe(1);

    await adapter.disconnect();
    expect((adapter as any).placeholderHash).toBeNull();

    // Re-fetch makes fresh requests (including placeholder probe on reconnect)
    serverState.coverArtRequests = {};
    await adapter.getItems();
    expect(serverState.coverArtRequests['al-1']).toBe(1);
  });
});
