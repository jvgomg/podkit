/**
 * Unit tests for the Subsonic playlist resolver.
 *
 * The resolver's only collaborators are injected — a fake Subsonic API and a
 * mapper — so these tests exercise its external contract (returned {id, tracks}
 * or thrown typed errors) without any network. They assert behaviour through
 * the public interface only, never private call sequences.
 */

import { describe, it, expect } from 'bun:test';
import type { Child } from 'subsonic-api';
import {
  resolvePlaylist,
  PlaylistNotFoundError,
  AmbiguousPlaylistError,
  type PlaylistApi,
} from './playlist.js';
import type { CollectionTrack } from '../interface.js';

/**
 * Build a fake PlaylistApi from canned data.
 *
 * @param playlists - what getPlaylists() returns
 * @param entriesById - map of playlist id → its entries (what getPlaylist returns)
 */
function fakeApi(
  playlists: Array<{ id: string; name: string }>,
  entriesById: Record<string, Child[]> = {}
): PlaylistApi {
  return {
    getPlaylists: async () => ({ playlists: { playlist: playlists } }),
    getPlaylist: async ({ id }) => ({ playlist: { entry: entriesById[id] ?? [] } }),
  };
}

/** Minimal Child factory for playlist entries. */
function entry(overrides: Partial<Child> & { id: string }): Child {
  return {
    isDir: false,
    title: 'Untitled',
    ...overrides,
  } as Child;
}

/** Identity-ish mapper: turns a Child into a recognisable CollectionTrack. */
const mapEntry = async (e: Child): Promise<CollectionTrack> => ({
  id: e.id,
  title: e.title,
  artist: e.artist ?? 'Unknown Artist',
  album: e.album ?? 'Unknown Album',
  filePath: `subsonic://test/${e.id}`,
  fileType: 'mp3',
});

describe('resolvePlaylist', () => {
  it('returns {id, tracks} for exactly one name match', async () => {
    const api = fakeApi(
      [
        { id: 'pl-1', name: 'Workout' },
        { id: 'pl-2', name: 'Focus' },
      ],
      {
        'pl-1': [
          entry({ id: 's-1', title: 'Song One', artist: 'A' }),
          entry({ id: 's-2', title: 'Song Two', artist: 'B' }),
        ],
      }
    );

    const result = await resolvePlaylist(api, 'Workout', mapEntry);

    expect(result.id).toBe('pl-1');
    expect(result.tracks).toHaveLength(2);
    expect(result.tracks.map((t) => t.id)).toEqual(['s-1', 's-2']);
    expect(result.tracks[0]!.title).toBe('Song One');
    expect(result.tracks[1]!.artist).toBe('B');
  });

  it('returns an empty track list for a playlist that resolves to zero entries', async () => {
    const api = fakeApi([{ id: 'pl-empty', name: 'Empty' }], { 'pl-empty': [] });

    const result = await resolvePlaylist(api, 'Empty', mapEntry);

    expect(result.id).toBe('pl-empty');
    expect(result.tracks).toEqual([]);
  });

  it('throws PlaylistNotFoundError on zero matches', async () => {
    const api = fakeApi([
      { id: 'pl-1', name: 'Workout' },
      { id: 'pl-2', name: 'Focus' },
    ]);

    const error = await resolvePlaylist(api, 'Roadtrip', mapEntry).catch((e) => e);

    expect(error).toBeInstanceOf(PlaylistNotFoundError);
    expect(error.playlistName).toBe('Roadtrip');
    expect(error.availablePlaylists).toEqual(['Workout', 'Focus']);
    expect(error.message).toContain('Roadtrip');
    expect(error.message).toContain('Workout');
  });

  it('PlaylistNotFoundError reports no-playlists when the server has none', async () => {
    const api = fakeApi([]);

    const error = await resolvePlaylist(api, 'Workout', mapEntry).catch((e) => e);

    expect(error).toBeInstanceOf(PlaylistNotFoundError);
    expect(error.availablePlaylists).toEqual([]);
    expect(error.message).toContain('no playlists');
  });

  it('throws AmbiguousPlaylistError on two or more matches', async () => {
    const api = fakeApi([
      { id: 'pl-1', name: 'Workout' },
      { id: 'pl-2', name: 'Workout' },
      { id: 'pl-3', name: 'Focus' },
    ]);

    const error = await resolvePlaylist(api, 'Workout', mapEntry).catch((e) => e);

    expect(error).toBeInstanceOf(AmbiguousPlaylistError);
    expect(error.playlistName).toBe('Workout');
    expect(error.matchingIds).toEqual(['pl-1', 'pl-2']);
    expect(error.message).toContain('2 playlists');
  });

  it('matches by name case-sensitively (a case mismatch is not found)', async () => {
    const api = fakeApi([{ id: 'pl-1', name: 'Workout' }]);

    const error = await resolvePlaylist(api, 'workout', mapEntry).catch((e) => e);

    expect(error).toBeInstanceOf(PlaylistNotFoundError);
  });

  it('handles a server that omits the playlist array entirely', async () => {
    const api: PlaylistApi = {
      getPlaylists: async () => ({ playlists: {} }),
      getPlaylist: async () => ({ playlist: {} }),
    };

    const error = await resolvePlaylist(api, 'Workout', mapEntry).catch((e) => e);

    expect(error).toBeInstanceOf(PlaylistNotFoundError);
  });
});
