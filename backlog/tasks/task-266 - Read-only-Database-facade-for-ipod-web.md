---
id: TASK-266
title: Read-only Database facade for ipod-web
status: Done
assignee: []
created_date: '2026-04-03 19:45'
updated_date: '2026-04-03 20:55'
labels:
  - api
milestone: m-17
dependencies:
  - TASK-116
references:
  - doc-003
  - TASK-121
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement a high-level read-only Database class that the virtual iPod firmware layer uses to query the music library. This is a much simpler API than TASK-121's full 24-method read/write Database — just the query surface.

**API:**
```typescript
class IpodReader {
  static async fromFiles(files: {
    itunesDb: Uint8Array;
    artworkDb?: Uint8Array;
    sysInfo?: string;
    ithmbs?: Map<string, Uint8Array>;  // filename → data
  }): Promise<IpodReader>

  // Library queries
  getTracks(): Track[]
  getTrack(id: number): Track | undefined
  getPlaylists(): Playlist[]
  getPlaylist(id: bigint): Playlist | undefined
  getPlaylistTracks(id: bigint): Track[]
  getMasterPlaylist(): Playlist

  // Artwork
  getTrackArtwork(trackId: number): ImageData | null

  // Device info
  getDeviceInfo(): DeviceInfo | null

  // Indexing helpers (for menu navigation)
  getArtists(): string[]
  getAlbums(): Array<{ name: string; artist: string; trackIds: number[] }>
  getGenres(): string[]
  getTracksByArtist(artist: string): Track[]
  getTracksByAlbum(artist: string, album: string): Track[]
  getTracksByGenre(genre: string): Track[]
}
```

**Design notes:**
- Constructed from raw binary data (no filesystem access) — the StorageProvider is responsible for fetching the files
- Builds in-memory indexes on construction for fast menu navigation (artist → tracks, album → tracks, genre → tracks)
- Immutable after construction — if the database changes (e.g., after a sync), create a new IpodReader
- All methods are synchronous after construction (data is pre-parsed and indexed)
- Browser-compatible (Uint8Array, no Node.js APIs)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 IpodReader constructed from raw binary Uint8Arrays
- [x] #2 getTracks returns all tracks with full metadata
- [x] #3 Playlist queries return correct track associations
- [x] #4 Artist/album/genre indexes built and queryable
- [ ] #5 getTrackArtwork returns decoded ImageData for tracks with artwork
- [x] #6 getDeviceInfo returns parsed model info from SysInfo
- [x] #7 All methods work in browser context (no Node.js APIs)
- [x] #8 Parses golden fixtures (TASK-113) and returns correct data
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
IpodReader.fromFiles() synchronously parses iTunesDB + optional ArtworkDB/SysInfo/ithmbs. Converts MhitRecord→Track via MHOD type mappings (1=title, 2=path, 3=album, 4=artist, 5=genre, 12=composer, 22=albumArtist). Builds O(1) indexes for artist/album/genre lookups. All sorted alphabetically. getTrackArtwork returns null gracefully when no artwork. Compatible with ipod-web's IpodDatabase interface (superset types). AC #5 not checkable — no artwork image data in fixtures. 42 tests, 232 total passing.
<!-- SECTION:NOTES:END -->
