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

// =============================================================================
// Mock HTTP Server
// =============================================================================

interface MockServerState {
  albums: MockAlbum[];
  songs: Record<string, MockSong[]>;
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
    const tracks = await adapter.getTracks();

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
    const tracks = await adapter.getTracks();

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
    const tracks = await adapter.getTracks();

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
    const tracks = await adapter.getTracks();

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
    const tracks = await adapter.getTracks();

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
    const tracks1 = await adapter.getTracks();
    const albumListCountAfterFirst = serverState.albumListCount;

    // Second call should use cache
    const tracks2 = await adapter.getTracks();

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
    const tracks = await adapter.getTracks();

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
    const filtered = await adapter.getFilteredTracks({ artist: 'Rock' });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.artist).toBe('Rock Band');
  });

  it('filters by album', async () => {
    const adapter = createAdapter();
    const filtered = await adapter.getFilteredTracks({ album: 'Jazz' });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.album).toBe('Jazz Album');
  });

  it('filters by genre', async () => {
    const adapter = createAdapter();
    const filtered = await adapter.getFilteredTracks({ genre: 'Rock' });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.genre).toBe('Rock');
  });

  it('filters by year', async () => {
    const adapter = createAdapter();
    const filtered = await adapter.getFilteredTracks({ year: 2024 });

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
    const tracks = await adapter.getTracks();
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
    await adapter.getTracks();
    expect(adapter.getTrackCount()).toBe(1);

    // Disconnect
    await adapter.disconnect();
    expect(adapter.getTrackCount()).toBe(0);
  });
});
