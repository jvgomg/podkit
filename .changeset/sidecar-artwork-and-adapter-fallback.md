---
'@podkit/core': minor
'podkit': minor
---

Sidecar artwork support and executor adapter fallback.

The sync pipeline now picks up out-of-band artwork that lives alongside the audio file or on the source server, not just embedded pictures:

- **Directory adapter** detects peer `cover.jpg` / `folder.jpg` / `front.jpg` / `album.jpg` (also `.jpeg` / `.png`, case-insensitive) in the same directory as the audio file. When a file has no embedded picture, the sidecar bytes are used. Under `--check-artwork` the sidecar bytes are hashed and pinned in the sync tag, so swapping a `cover.jpg` for a new image is detected on the next sync.
- **Subsonic adapter** falls back to Navidrome's `getCoverArt` endpoint when the downloaded audio file body has no embedded picture. This closes the gap where a Navidrome library indexed sidecar art on the server but podkit silently dropped it on every sync.
- A one-time placeholder probe runs on every Subsonic `connect()` so Navidrome's static "no cover" image is filtered regardless of `--check-artwork`.

Embed-in-the-file wins when both are present; the sidecar / API fallback only fires on a miss. Album-level caching means siblings on the same album share a single sidecar read or API request.

Adapters gain an optional `getArtwork(item): Promise<Buffer | null>` method on `CollectionAdapter`. The executor calls it through the existing `AlbumArtworkCache` after embedded extraction returns null.

**Known gap (deferred to TASK-370 / TASK-371 / TASK-372):** mass-storage devices accept the bytes via `setArtworkFromData`, which is a no-op for non-OGG/Opus containers — adapter-fallback bytes reach the device only when the output is OGG/Opus copy (via the existing taglib path) OR the target is an iPod (via the iTunesDB). For other mass-storage outputs the bytes are dropped silently today; the e2e artwork matrix fences those cells with a `[BUG] TASK-370` skip rather than failing the suite.
