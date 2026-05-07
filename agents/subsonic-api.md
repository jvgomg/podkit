# Subsonic API (Navidrome)

Reference for agents working on the Subsonic collection adapter. Covers the Subsonic / OpenSubsonic API as implemented by **Navidrome** — endpoint shape, response fields, auth, quirks, and the signals available for change detection.

See [AGENTS.md](../AGENTS.md) for project overview.

## When to read this

- Adding or modifying anything under `packages/podkit-core/src/adapters/subsonic.ts`
- Investigating sync behavior with a Navidrome (or other OpenSubsonic) source
- Designing change-detection / re-sync logic for remote sources
- Picking which fields to extract into `CollectionTrack`

## Authoritative external sources

These pages are the source of truth — link out for anything not covered here.

| Topic | URL |
|---|---|
| Canonical Subsonic API spec (1.16.1) | http://www.subsonic.org/pages/api.jsp |
| XSD schema (1.16.1) | http://subsonic.org/pages/inc/api/schema/subsonic-rest-api-1.16.1.xsd |
| OpenSubsonic site | https://opensubsonic.netlify.app/ |
| OpenSubsonic API reference (auth, errors, envelope) | https://opensubsonic.netlify.app/docs/api-reference/ |
| OpenSubsonic changes vs vanilla | https://opensubsonic.netlify.app/docs/opensubsonic-changes/ |
| Subsonic version table | https://opensubsonic.netlify.app/docs/subsonic-versions/ |
| Endpoint reference index | https://opensubsonic.netlify.app/docs/endpoints/ |
| Response schema index | https://opensubsonic.netlify.app/docs/responses/ |
| `Child` (song) response | https://opensubsonic.netlify.app/docs/responses/child/ |
| `AlbumID3` response | https://opensubsonic.netlify.app/docs/responses/albumid3/ |
| `Error` response | https://opensubsonic.netlify.app/docs/responses/error/ |
| OpenAPI 3.0 source (machine-readable) | https://github.com/opensubsonic/open-subsonic-api/tree/main/openapi |
| Navidrome compatibility page | https://www.navidrome.org/docs/developers/subsonic-api/ |
| Navidrome OpenSubsonic extension tracker | https://github.com/navidrome/navidrome/issues/2695 |
| Navidrome multi-library | https://www.navidrome.org/docs/usage/features/multi-library/ |

## NPM package

podkit uses [`subsonic-api`](https://github.com/explodingcamera/subsonic-api) (imported as `SubsonicAPI` plus the `Child` and `AlbumWithSongsID3` types) in `packages/podkit-core/src/adapters/subsonic.ts:8`. The package's TypeScript types are the practical ground truth at the call site — when adding a new field, check that the type already declares it before extracting it.

## Authentication

Every endpoint under `/rest/<methodName>` requires the auth+meta query params below. Either token-based (`t`+`s`) or API key (`apiKey`, OpenSubsonic only) is preferred over plaintext (`p`).

| Param | Required | Meaning |
|---|---|---|
| `u` | yes\* | Username |
| `p` | one-of | Password, plaintext or `enc:<hex>` (deprecated since 1.13.0; testing only) |
| `t` | one-of | `md5(password + salt)` (lowercase hex, UTF-8) — since 1.13.0 |
| `s` | one-of | Random salt, ≥ 6 chars — since 1.13.0 |
| `apiKey` | one-of | **[OpenSubsonic]** API key. When set, none of `u/p/t/s` may be present. |
| `v` | yes | Protocol version client targets (e.g. `1.16.1`) |
| `c` | yes | Unique client identifier string |
| `f` | no | `xml` (default), `json`, or `jsonp` (since 1.6.0; pair with `callback`) |

\* `u` is required unless using `apiKey`. One of `{p}` or `{t,s}` or `{apiKey}` must be supplied.

**Token example:** password `sesame` + salt `c19b2d` → `t = md5("sesamec19b2d") = 26719a1196d2a940705a59634eb18eab`.

**Version negotiation:** "Backward compatible iff client major == server major and client minor ≤ server minor." OpenSubsonic servers should support ≥ 1.14.0; 1.16.1 recommended. Navidrome targets 1.16.1 with exceptions.

**Form POST:** OpenSubsonic adds `application/x-www-form-urlencoded` POST support, gated on the `formpost` extension.

## Response envelope

All non-binary endpoints return a JSON or XML envelope:

```json
{
  "subsonic-response": {
    "status": "ok" | "failed",
    "version": "1.16.1",
    "type": "Navidrome",            // [OS, required]
    "serverVersion": "0.52.5 (...)", // [OS, required]
    "openSubsonic": true,            // [OS, required] — canonical detection signal
    "...": "<endpoint-specific payload>"
  }
}
```

Vanilla Subsonic only guarantees `status` and `version`. The presence of `openSubsonic: true` is the canonical OpenSubsonic detection signal.

Binary endpoints (`stream`, `download`, `getCoverArt`, `getAvatar`, `hls.m3u8`, `getCaptions`) ignore `f` and return raw bytes with HTTP-level status codes.

### Error envelope

```json
{ "subsonic-response": {
    "status": "failed", "version": "1.16.1", "type": "...", "serverVersion": "...", "openSubsonic": true,
    "error": { "code": 40, "message": "Wrong username or password.", "helpUrl": "..." }
}}
```

`helpUrl` is OpenSubsonic-only.

### Error codes

| Code | Meaning |
|---|---|
| 0 | Generic error |
| 10 | Required parameter missing |
| 20 | Client must upgrade protocol version |
| 30 | Server must upgrade protocol version |
| 40 | Wrong username or password |
| 41 | Token auth not supported (OS clarifies: for any reason) |
| 42 | **[OS]** Provided auth mechanism not supported |
| 43 | **[OS]** Multiple conflicting auth mechanisms |
| 44 | **[OS]** Invalid API key |
| 50 | Not authorized for this operation |
| 60 | Trial period over (Navidrome: never returns this) |
| 70 | Data not found |

## Endpoints used (or candidates) for sync

All paths are under `/rest/`. Pagination is per-endpoint — there is no global pagination convention.

| Endpoint | Required params | Returns | Notes |
|---|---|---|---|
| `ping` | — | bare envelope | Connectivity check |
| `getLicense` | — | `license` | Navidrome: always valid |
| `getMusicFolders` | — | `musicFolders.musicFolder[]` | Multi-library: returns folders the user can access |
| `getIndexes` | — | `indexes` (file-tree style) | Navidrome simulates as `/Artist/Album/01 - Song.mp3`; no shortcuts/direct children |
| `getArtists` | — | `artists` (`ArtistsID3`) | ID3-tag-based browse — canonical on Navidrome |
| `getArtist` | `id` | `artist` (`ArtistWithAlbumsID3`) | Includes nested `album[]` |
| `getAlbum` | `id` | `album` (`AlbumID3WithSongs`) | Includes `song[]` (`Child[]`) — primary endpoint for podkit |
| `getAlbumList2` | `type` | `albumList2.album[]` | Used by podkit to paginate the catalog |
| `getSong` | `id` | `song` (`Child`) | |
| `getMusicDirectory` | `id` | `directory.child[]` | Navidrome simulates from ID3 model |
| `search3` | `query` | `searchResult3` | `*Count` / `*Offset` per type. Navidrome: simple autocomplete only — no Lucene |
| `getStarred2` | — | `starred2` | ID3 variant |
| `getRandomSongs` | — | `randomSongs.song[]` | `size` ≤ 500 |
| `getSongsByGenre` | `genre` | `songsByGenre.song[]` | `count` ≤ 500, `offset` for paging |
| `getCoverArt` | `id` | binary | `size?` scales to N px |
| `stream` | `id` | binary audio | `maxBitRate?`, `format?` (`raw` disables transcode), `estimateContentLength?` (since 1.8.0). **Does NOT mark played** on Navidrome. |
| `download` | `id` | binary | No transcode by default. **Navidrome:** also accepts Album/Artist/Playlist IDs and the same transcoding params as `stream`. |
| `getPlaylists` | — | `playlists.playlist[]` | Navidrome ignores the `username` param; always returns auth user's playlists |
| `getPlaylist` | `id` | `playlist` (`PlaylistWithSongs`) | |
| `scrobble` | `id` | bare envelope | `submission=true` is what marks a song played on Navidrome |
| `getScanStatus` | — | `scanStatus` | Library-level only. Navidrome adds `lastScan`, `folderCount` |
| `startScan` | — | `scanStatus` | Navidrome adds `fullScan` boolean |
| `getOpenSubsonicExtensions` | — | `openSubsonicExtensions[]` | **Must work without auth params.** OS extension discovery |
| `tokenInfo` | — | info about the `apiKey` | OpenSubsonic extension `apikeyauth` |

## The `Child` object (song / track)

This is the response shape for songs in `getSong`, `getAlbum.song[]`, `search3.song[]`, `getRandomSongs.song[]`, `getMusicDirectory.child[]`, etc.

Required: `id`, `isDir`, `title`. All others optional. Fields marked **[OS]** are OpenSubsonic additions to the vanilla 1.16.1 schema.

### Vanilla fields

| Field | Type | Notes |
|---|---|---|
| `id` | string | **Required.** Navidrome IDs are MD5/UUID strings — do not parse as int |
| `parent` | string | Parent folder/album id |
| `isDir` | boolean | **Required** |
| `title` | string | **Required** |
| `album` | string | |
| `artist` | string | |
| `track` | int | |
| `year` | int | |
| `genre` | string | Single primary genre (legacy; prefer `genres[]` if present) |
| `coverArt` | string | id to pass to `getCoverArt` |
| `size` | int | File size in bytes — see "Change detection" below |
| `contentType` | string | MIME type |
| `suffix` | string | File extension |
| `transcodedContentType` | string | If server will transcode |
| `transcodedSuffix` | string | |
| `duration` | int | Seconds |
| `bitRate` | int | kbps |
| `path` | string | Full server-side path |
| `isVideo` | boolean | Navidrome never sets — no video support |
| `userRating` | int | 1–5 |
| `averageRating` | number | 1.0–5.0 |
| `playCount` | int | |
| `discNumber` | int | |
| `created` | datetime (ISO 8601) | When the **server** first ingested the file (DB row creation) — NOT filesystem mtime |
| `starred` | datetime (ISO 8601) | |
| `albumId` | string | |
| `artistId` | string | |
| `type` | enum | `GenericMediaType` (vanilla) |
| `bookmarkPosition` | int | seconds |
| `originalWidth` / `originalHeight` | int | video only |

### OpenSubsonic additions

| Field | Type | Notes |
|---|---|---|
| `bitDepth` | int | |
| `samplingRate` | int | Hz |
| `channelCount` | int | |
| `mediaType` | enum | `song` / `album` / `artist` — required if `musicBrainzId` is supported |
| `played` | datetime | Last-played timestamp |
| `bpm` | int | |
| `comment` | string | |
| `sortName` | string | |
| `musicBrainzId` | string | |
| `isrc` | string[] | e.g. `["USSM18300073"]` |
| `genres` | `ItemGenre[]` | Each `{ name }` |
| `artists` | `ArtistID3[]` | Track artists |
| `displayArtist` | string | Single-value display string — **clients should prefer this over `artist`** |
| `albumArtists` | `ArtistID3[]` | |
| `displayAlbumArtist` | string | |
| `contributors` | `Contributor[]` | `{ role, subRole?, artist }` — performer/producer/etc. (TIPL/TMCL) |
| `displayComposer` | string | |
| `moods` | string[] | |
| `replayGain` | `ReplayGain` | `{ trackGain?, albumGain?, trackPeak?, albumPeak?, baseGain?, fallbackGain? }` (all dB). The field itself must always be present, but may be `{}`. |
| `explicitStatus` | enum | `clean` / `explicit` / `""` |
| `works` | `Work[]` | Classical |
| `movements` | `Movement[]` | Classical |

### `AlbumID3` notable OS additions

`version`, `recordLabels[]`, `musicBrainzId`, `genres[]`, `artists[]`, `displayArtist`, `releaseTypes[]`, `moods[]`, `sortName`, `originalReleaseDate` (`ItemDate`), `releaseDate` (`ItemDate`), `isCompilation`, `explicitStatus`, `discTitles[]`. Required: `id`, `name`, `songCount`, `duration`, `created`.

### `ArtistID3` notable OS additions

`musicBrainzId`, `sortName`, `roles[]`. Required: `id`, `name`.

## Detecting OpenSubsonic and discovering extensions

1. Issue any authenticated request (e.g. `ping`).
2. If the response envelope contains `openSubsonic: true`, the server speaks OpenSubsonic v1.
3. Call `getOpenSubsonicExtensions` (no auth needed) to enumerate supported extensions:

```json
{ "subsonic-response": { ..., "openSubsonicExtensions": [
    { "name": "apikeyauth", "versions": [1] },
    { "name": "formpost",   "versions": [1] },
    ...
]}}
```

Required fields per entry: `name`, `versions`. Treat the runtime list as authoritative — do not hardcode. Common extension names seen in the wild: `apikeyauth`, `formpost`, `transcodeOffset`, `songLyrics`, `getPodcastEpisode`, `indexBasedQueue`.

## Navidrome-specific behavior

From the [Navidrome compatibility page](https://www.navidrome.org/docs/developers/subsonic-api/):

- **Targets Subsonic 1.16.1** with documented exceptions; OpenSubsonic extension support tracked at https://github.com/navidrome/navidrome/issues/2695.
- **No video.** Music-only by design.
- **Multi-library** with per-user access controls — `getMusicFolders` returns only folders the authenticated user can see.
- **No native browse-by-folder.** `getIndexes` and `getMusicDirectory` synthesize a tree formatted as `/Artist/Album/01 - Song.mp3` from the ID3 model.
- **`stream` does NOT mark a song played.** Only `scrobble?submission=true` updates `playCount` / `played`.
- **IDs are strings** (MD5 hashes or UUIDs). Coercing to int will break.
- **`getIndexes`** does not support `shortcuts` or top-level direct children.
- **`search2` / `search3`** — no Lucene; simple autocomplete only.
- **`getPlaylists`** ignores `username`; always returns the authenticated user's playlists.
- **`download`** also accepts Album / Artist / Playlist IDs and the same transcoding params as `stream` (Navidrome extension).
- **`getArtistInfo` / `getAlbumInfo` / `getTopSongs` / `getSimilarSongs`** require external integrations (Last.fm etc.) to be configured.
- **`getLyrics`** reads embedded tags and external `.lrc` files.
- **`getAvatar`** redirects to Gravatar if enabled and the user has an email; otherwise returns a placeholder.
- **`getPlayQueue.current`** is a string id, not an int (deviates from the official schema).
- **`getScanStatus`** adds `lastScan` and `folderCount`.
- **`startScan`** accepts an extra `fullScan` boolean.
- **`getUser`** ignores `username`, returns the auth user. Roles reflect actual server capabilities (e.g. `downloadRole` is true only if downloads are enabled).
- **`getUsers`** returns only the authenticated user.
- **Sharing endpoints** require `EnableSharing=true` in server config.
- **Server-side transcoding profiles** (configured in the Navidrome admin UI) determine what `stream` (and Navidrome's extended `download`) produce. Use `format=raw` to bypass.
- **Smart playlists** are exposed through the standard `getPlaylists` / `getPlaylist` endpoints — clients see them as regular playlists.
- **License is always valid** — no commercial trial.

## Change detection — what's available, what isn't

ADR-009 (self-healing sync) explicitly rejects file hashing and mtime in favor of metadata comparison. For Subsonic sources the practical situation is:

| Signal | Field | Vanilla / OS | Reliability |
|---|---|---|---|
| **File size (bytes)** | `Child.size` | Vanilla (since 1.7.0) | **High.** Defined in the canonical schema; reflects original file bytes for non-transcoded `download`. The `subsonic-api` npm Child type already declares `size: number`. |
| **First-seen timestamp** | `Child.created` | Vanilla | Medium. This is when the **server** first ingested the file — DB row creation. Not the filesystem mtime. Navidrome's behavior on in-place file replacement is server-version-specific; re-tagging with the same path generally does NOT change it. |
| **Modification time** | — | not in spec | Not exposed. No `changed` / `modified` / `lastModified` / `mtime` field on `Child` in either spec. |
| **Hash / checksum / etag / md5 / sha1** | — | not in spec | **Not available anywhere.** Confirmed against the OpenSubsonic extensions list — no file-integrity extension exists in vanilla Subsonic, OpenSubsonic, Navidrome, or Gonic. |
| **HTTP HEAD / Range** | `Range` on `stream` | de-facto | Servers (Navidrome, Gonic) support `Accept-Ranges: bytes` and 206 responses. A `Range: bytes=0-0` request returns `Content-Length` for non-transcoded content. For transcoded content, only `estimateContentLength=true` is available and is unreliable. |
| **Library scan status** | `getScanStatus` | Vanilla 1.15.0 (+ OS additions) | Library-level only — useless for "this one file changed". |

**Practical takeaway:** `Child.size` is the only viable per-track replacement signal. Combine `(size, bitrate, duration)` for more robust detection. For transcoded paths (FLAC → AAC), the source `size` cannot be compared cross-format on the iPod side without storing it at copy time — that is not currently done.

## Local code references

| Purpose | Path |
|---|---|
| Subsonic adapter | `packages/podkit-core/src/adapters/subsonic.ts` |
| Adapter unit tests | `packages/podkit-core/src/adapters/subsonic.test.ts` |
| Adapter integration tests | `packages/podkit-core/src/adapters/subsonic.integration.test.ts` |
| `CollectionTrack` type | `packages/podkit-core/src/adapters/interface.ts` |
| Sync diff engine | `packages/podkit-core/src/sync/engine/differ.ts` |
| Music handler / upgrade detection | `packages/podkit-core/src/sync/music/handler.ts` |
| Upgrade detection rules | `packages/podkit-core/src/sync/engine/upgrades.ts` |
| E2E sync workflow | `packages/e2e-tests/src/workflows/subsonic-sync.e2e.test.ts` |
| E2E Subsonic source helpers | `packages/e2e-tests/src/sources/subsonic.ts` |
| Compilation-album E2E (Navidrome) | `packages/e2e-tests/src/features/compilation-subsonic.e2e.test.ts` |

## Related ADRs

- [ADR-007: Subsonic Collection Source](../adr/adr-007-subsonic-collection-source.md)
- [ADR-009: Self-Healing Sync](../adr/adr-009-self-healing-sync.md)
- [ADR-012: Artwork Change Detection](../adr/adr-012-artwork-change-detection.md)
