/**
 * Playlist resolution for the Subsonic adapter.
 *
 * A self-contained deep module: given a Subsonic API client and a playlist
 * name, it resolves the name to exactly one server-side playlist and returns
 * that playlist's tracks. Resolution is by name (exact, case-sensitive):
 *
 * - zero matches  → {@link PlaylistNotFoundError}
 * - two or more   → {@link AmbiguousPlaylistError}
 * - exactly one   → fetch the full playlist via `getPlaylist` and map its
 *   entries to {@link CollectionTrack}s using the caller-supplied mapper.
 *
 * The module owns none of the adapter's network or caching internals — it
 * takes the API and a `mapEntry` function so the adapter's existing
 * song→track mapping (artwork classification, normalization, etc.) is reused
 * rather than duplicated. The typed errors mirror the `SubsonicConnectionError`
 * precedent: clear, actionable messages plus the relevant fields.
 */

import type SubsonicAPI from 'subsonic-api';
import type { Child } from 'subsonic-api';
import type { CollectionTrack } from '../interface.js';

/**
 * The subset of the Subsonic API surface the resolver depends on.
 *
 * Declared structurally (rather than taking the full `SubsonicAPI`) so the
 * resolver can be exercised with a small fake in tests and so its contract is
 * the two calls it actually makes.
 */
export interface PlaylistApi {
  getPlaylists(args?: {
    username?: string;
  }): Promise<{ playlists: { playlist?: Array<{ id: string; name: string }> } }>;
  getPlaylist(args: { id: string }): Promise<{ playlist: { entry?: Child[] } }>;
}

// Compile-time check that the real SubsonicAPI satisfies the structural
// dependency. If subsonic-api changes either method's shape, this fails here
// rather than at the (untyped) call site.
type _AssertApiCompatible = SubsonicAPI extends PlaylistApi ? true : never;

/**
 * Maps a single Subsonic playlist entry (a `Child`) to a {@link CollectionTrack}.
 * Supplied by the adapter so playlist tracks go through the exact same mapping
 * as whole-library tracks.
 */
export type PlaylistEntryMapper = (entry: Child) => Promise<CollectionTrack>;

/**
 * Thrown when no playlist on the server matches the configured name.
 *
 * Lists the names that *do* exist so the user can spot a typo without leaving
 * the error. Aborts the sync before any transfer.
 */
export class PlaylistNotFoundError extends Error {
  readonly playlistName: string;
  readonly availablePlaylists: string[];

  constructor(playlistName: string, availablePlaylists: string[]) {
    const available =
      availablePlaylists.length > 0
        ? `Available playlists: ${availablePlaylists.map((n) => `"${n}"`).join(', ')}.`
        : 'The server has no playlists.';
    super(
      `Playlist "${playlistName}" was not found on the Subsonic server. ` +
        `${available} ` +
        `Check the playlist name in your collection config, or create the playlist on the server.`
    );
    this.name = 'PlaylistNotFoundError';
    this.playlistName = playlistName;
    this.availablePlaylists = availablePlaylists;
  }
}

/**
 * Thrown when two or more playlists on the server share the configured name.
 *
 * Carries the colliding ids so the user (or a future id-based config) can
 * disambiguate rather than silently syncing an arbitrary one. Aborts the sync
 * before any transfer.
 */
export class AmbiguousPlaylistError extends Error {
  readonly playlistName: string;
  readonly matchingIds: string[];

  constructor(playlistName: string, matchingIds: string[]) {
    super(
      `Playlist name "${playlistName}" matches ${matchingIds.length} playlists on the Subsonic server ` +
        `(ids: ${matchingIds.join(', ')}). ` +
        `Rename one of them on the server so the name is unique.`
    );
    this.name = 'AmbiguousPlaylistError';
    this.playlistName = playlistName;
    this.matchingIds = matchingIds;
  }
}

/**
 * Resolve a playlist by name to its id and mapped tracks.
 *
 * @param api - Subsonic API client (only `getPlaylists`/`getPlaylist` are used)
 * @param name - the playlist name to resolve (matched exactly, case-sensitively)
 * @param mapEntry - maps each playlist entry to a {@link CollectionTrack}
 * @returns the resolved playlist id and its tracks, in playlist order
 * @throws {PlaylistNotFoundError} when no playlist matches the name
 * @throws {AmbiguousPlaylistError} when more than one playlist matches the name
 */
export async function resolvePlaylist(
  api: PlaylistApi,
  name: string,
  mapEntry: PlaylistEntryMapper
): Promise<{ id: string; tracks: CollectionTrack[] }> {
  const response = await api.getPlaylists();
  const playlists = response.playlists.playlist ?? [];

  const matches = playlists.filter((p) => p.name === name);

  if (matches.length === 0) {
    throw new PlaylistNotFoundError(
      name,
      playlists.map((p) => p.name)
    );
  }

  if (matches.length > 1) {
    throw new AmbiguousPlaylistError(
      name,
      matches.map((p) => p.id)
    );
  }

  const id = matches[0]!.id;
  const detail = await api.getPlaylist({ id });
  const entries = detail.playlist.entry ?? [];

  const tracks: CollectionTrack[] = [];
  for (const entry of entries) {
    tracks.push(await mapEntry(entry));
  }

  return { id, tracks };
}
