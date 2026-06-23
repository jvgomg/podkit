---
"@podkit/core": minor
---

Add playlist-scoped Subsonic collections

A Subsonic adapter config now accepts an optional `playlist` name. When set, the adapter resolves that named server playlist at connect time and syncs only its tracks (server-side `getPlaylist`) instead of scanning the whole library. The playlist is validated before any transfer: a missing name throws `PlaylistNotFoundError`, and a name shared by two or more playlists throws `AmbiguousPlaylistError` — both abort the sync up front rather than syncing the wrong set.

In-memory track filters (artist/album/genre/year) still layer on top of the playlist scope unchanged. The resolver is exposed as a standalone module (`resolvePlaylist`) alongside the two typed errors.
