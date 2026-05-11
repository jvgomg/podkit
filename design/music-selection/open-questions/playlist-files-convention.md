---
status: open
last-updated: 2026-05-11
importance: low-medium
links:
  - ../principles/source-capabilities.md
  - ../principles/playlist-roles-separated.md
  - ../user-stories.md
---

# Where do playlist files live in a directory source?

> **The question.** When a directory source provides playlists, where on
> disk do those playlist files live, and how does podkit discover them?

## Why this matters

Directory sources are common, and playlist support against them is real
(US-14 — standalone M3U directory). The convention determines:

- How users organise their files on disk.
- Whether playlists can live in the same source as the music or only in a
  separate source.
- How discovery scales (do we walk the entire tree looking for `.m3u8`
  files? Look only in a known location?).

Get it wrong and users either organise around an awkward convention or
podkit's discovery is unpredictable.

## Options

### Option 1 — Convention: `<source>/playlists/`

A directory source claims `playlist-provider` capability if a `playlists/`
subdir exists at its root. All `.m3u8` and `.m3u` files in there are
discovered.

**Pros:** Simple. Predictable. Easy to teach.
**Cons:** Forces a specific layout. Users with playlists at the source
root or scattered through subdirs need to reorganise.

### Option 2 — Configurable subpath

```toml
[sources.music-local]
type = "directory"
path = "/Volumes/Music"
content = "music"
playlists = "lists/"     # configurable, defaults to "playlists/"
```

**Pros:** Convention with escape hatch.
**Cons:** Slight extra config field; most users won't change it.

### Option 3 — Recursive discovery

Walk the entire source tree finding `.m3u8` / `.m3u` files. Each one
becomes a playlist named after its filename (or `#PLAYLIST:` directive if
present).

**Pros:** No layout assumptions. "Just works" for users with existing
libraries.
**Cons:** Discovery cost on large libraries. Naming collisions if two
playlists have the same filename in different subdirs. Harder to predict.

### Option 4 — Separate playlist-only source

The playlist-providing capability lives in a dedicated source pointing at
a directory of playlist files. The music source has no playlist
discovery.

```toml
[sources.local-music]
type = "directory"
path = "/Volumes/Music"
content = "music"

[sources.local-m3us]
type = "directory"
path = "/Users/me/playlists"
provides = ["playlists"]
content = "music"   # the playlists reference music tracks
```

**Pros:** Decoupling. Supports US-14 directly.
**Cons:** More config. Users with co-located playlists have to declare two
sources.

## Likely shape of resolution

Some combination:

- **Convention default**: Option 1 (`<source>/playlists/`) for sources that
  also provide music — the common case.
- **Configurable**: Option 2 — a `playlists` field overrides the default
  subpath, including pointing outside the source root.
- **Standalone playlist source**: Option 4 — supported via the same
  capabilities mechanism for users who keep playlists separate (US-14).

Option 3 (recursive discovery) is probably too unpredictable to be the
default but could be an opt-in `playlists.discovery = "recursive"` flag.

## What would resolve this

A short design pass while drafting the sources-and-collections sub-PRD.
This question is small enough to answer in a paragraph rather than its own
spike, but it does need a concrete decision before the directory adapter
playlist support can be implemented.

## Related

- Cross-source playlist resolution (parked WIP PRD) inherits whatever
  discovery convention is decided here.
- The `playlist-provider` capability flag (source-capabilities principle)
  takes its meaning from this convention.
