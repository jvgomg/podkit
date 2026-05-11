---
status: draft
last-updated: 2026-05-11
derived-from:
  principles:
    - collections-are-content-sets
    - content-type-is-explicit
    - inline-collections-on-devices
    - playlist-roles-separated
    - source-capabilities
  features:
    - sources-and-collections
    - per-content-type-collections
    - device-playlists-write
  open-questions:
    - source-collection-decoupling
    - filter-overrides-merge-rules
    - playlist-files-convention
---

# Config schema (target end-state)

> The canonical structure of podkit's TOML config after the
> music-selection rearchitecture lands. Annotations mark each
> field's confidence.
>
> See [terminology](terminology.md) for the canonical meaning of each
> word used here.

## Top-level shape

```toml
version = 2                          # (agreed) bumped from current schema

[sources.<name>]                     # (agreed) one block per source
...

[collections.<name>]                 # (agreed) optional; one block per named collection
...

[devices.<name>]                     # (agreed) one block per device
...

[defaults]                           # (tentative) per-content-type default device
music = "<device-name>"
tv = "<device-name>"
movies = "<device-name>"
```

There is no `[music.*]` / `[video.*]` / `[tv.*]` / `[movies.*]`
top-level namespace. All collections live under `[collections.*]`
with content type as a field. **(agreed)** — see
[content-type-is-explicit](../principles/content-type-is-explicit.md).

## `[sources.<name>]`

```toml
[sources.<name>]
type = "directory" | "subsonic" | ...   # (agreed) source-adapter type
content = "music" | "tv" | "movies" | "audiobook" | "podcast"
                                         # (agreed) required; explicit, never guessed

# Type-specific config (one of):
path = "/Volumes/Music"                  # (agreed) directory type
# OR
url = "https://music.example.com"        # (agreed) subsonic type
username = "..."                         # (agreed) subsonic type
password-env = "SUBSONIC_PASS"           # (agreed) subsonic type

# Capability declarations
provides = ["music", "playlists"]        # (tentative) defaults derived from
                                         # type + presence of playlists/ subdir
playlists = "playlists/"                 # (pending: playlist-files-convention)
                                         # default subpath for playlist files
                                         # (directory type only)
```

**Capabilities** (`provides`): see
[source-capabilities](../principles/source-capabilities.md). For
directory sources, sensible defaults are derived from the directory
shape (`music-provider` if music files are present;
`playlist-provider` if a `playlists/` subdir exists). Users can
override.

**Multiple sources at one location**: when a user has mixed media
under one parent directory, they declare *one source per content type*,
each with its own `path` pointing at the relevant subdirectory. The
parent directory itself is not a source.

## `[collections.<name>]`

```toml
[collections.<name>]
# Optional source binding
source = "<source-name>"                # (pending: source-collection-decoupling)
                                         # If decoupling stays: optional default,
                                         # overridable per device or CLI.
                                         # If decoupling drops: required.

# Filter rules (content-type-specific primitives apply)
filter.genre = ["Jazz", "Bebop"]        # (agreed) for content = "music"
filter.year = ">= 2000"                 # (tentative) operator syntax TBD
filter.rating = ">= 4"                  # (tentative)
filter.tag = ["explicit"]               # (tentative)
filter.added-after = "30d"              # (tentative) duration string
filter.path = "subdir/**"               # (tentative) glob within source
filter.playlist = "<playlist-name>"     # (agreed) constraining playlist role
                                         # OR { name = "...", source = "..." }
                                         # for pinned playlist source

# TV-specific filter primitives (only with content = "tv")
filter.shows = ["Severance"]            # (tentative)
filter.episodes-per-show = 5            # (tentative)
filter.prefer-unwatched = true          # (tentative; depends on device-state-read)

# Materialised device playlists (content role)
playlists = ["Workout Mix", "Road Trip"]
                                         # (agreed) list of playlist names to
                                         # appear on the device

playlist-mode = "union" | "intersect"   # (agreed) default "union"
                                         # how playlists relate to filter.playlist

# Content type (optional; usually inferred from filter primitives)
content = "music" | "tv" | ...          # (tentative) when needed for validation
```

**Collections are content rule sets.** They do not own connection
details. See
[collections-are-content-sets](../principles/collections-are-content-sets.md).

## `[devices.<name>]`

A device has one block per content type it syncs. Each per-content-type
block is *itself an inline collection*, which optionally extends a
named collection via `collection = "<name>"`.

```toml
[devices.<name>]
# Per-content-type block. Repeat for tv, movies, audiobook, podcast as needed.
music.source = "<source-name>"          # (agreed) source for this content type
music.collection = "<collection-name>"  # (agreed) optional named-collection base
                                         # If omitted, all of music.* is the
                                         # inline collection.

# Inline collection fields — same vocabulary as [collections.<name>]
music.filter.genre = ["Jazz"]           # (agreed) inline filter
music.playlists = ["Workout Mix"]       # (pending: filter-overrides-merge-rules)
                                         # default: replace; .add / .remove for
                                         # additive composition

music.playlists.add = ["Gym Pump"]      # (pending: filter-overrides-merge-rules)
music.playlists.remove = ["Sleep Sounds"]

music.playlist-source = "<source-name>" # (tentative) default source for any
                                         # playlist reference; falls back to
                                         # music.source. CLI override:
                                         # --playlist-source <name>

# Device-level policies (per content type)
music.protect = ["On-The-Go"]           # (tentative) device-side playlists whose
                                         # tracks are protected from eviction.
                                         # Depends on device-state-read.
music.over-capacity = "fail"            # (pending: pinned-set-exceeds-capacity)
                                         # "fail" | "drop-overflow"
music.strict = false                    # (tentative) treat warnings as errors

# Repeat block per content type
tv.source = "tv-shows"
tv.collection = "favourite-shows"
movies.source = "movies"
```

**Inline collection on device** semantics: see
[inline-collections-on-devices](../principles/inline-collections-on-devices.md).
A device's `<content>.*` block is conceptually a collection. The
selector pipeline sees one collection per content type, regardless of
how it was spelled.

## CLI overrides

These don't appear in TOML but compose with the config at sync time.
Resolution: CLI flag → device → collection → error.

```bash
podkit sync -d <device>                   # (agreed) base case
podkit sync -d <device> --source <name>   # (pending: source-collection-decoupling)
                                          # swap whichever content-type slot's
                                          # source has matching content type
podkit sync -d <device> --source music=<name> --source tv=<name>
                                          # (tentative) explicit per-content swap
podkit sync -d <device> --playlist-source <name>
                                          # (tentative) override playlist source
podkit sync --dry-run                     # (agreed) preview, no changes
podkit sync --strict                      # (tentative) treat warnings as errors
```

## What the schema doesn't say

- **Capacity** is read from the device at sync time, not configured.
- **Play counts** and **on-device playlists** are read from the device
  at sync time, not configured.
- **Source-internal IDs** (Subsonic song IDs, file paths) are not part
  of the config — they're runtime data.

## Open shape decisions

These shape uncertainties block parts of the schema from being marked
`agreed`:

- [source-collection-decoupling](../open-questions/source-collection-decoupling.md)
  — whether collections can declare `source` as a default, or *must*
  bind to a single source.
- [filter-overrides-merge-rules](../open-questions/filter-overrides-merge-rules.md)
  — final form of `playlists` / `playlists.add` / `playlists.remove`
  and whether silent merge is allowed.
- [pinned-set-exceeds-capacity](../open-questions/pinned-set-exceeds-capacity.md)
  — exact values for `over-capacity` and the default.
- [collection-extends-mechanism](../open-questions/collection-extends-mechanism.md)
  — whether `extends` becomes a first-class field on `[collections.*]`.
- [playlist-files-convention](../open-questions/playlist-files-convention.md)
  — `playlists = "..."` field shape and discovery rules for directory
  sources.

Resolutions to these questions will land here as updated annotations.
