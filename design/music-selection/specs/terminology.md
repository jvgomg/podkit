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
    - track-identity-foundation
  features: []
  open-questions: []
---

# Terminology

> Canonical names for entities, concepts, and supporting technology used
> across the music-selection design.
>
> **The goal is one canonical word per concept.** When you find yourself
> reaching for a synonym ("library" vs "source", "rules" vs
> "constraints"), use the canonical form. Update this file before
> introducing a new term elsewhere.

## How to read this file

Each entry has:

- **Canonical name** — the word the design uses.
- **Definition** — 1–2 sentences.
- **Is not** — common near-synonyms that mean something different
  and shouldn't be used interchangeably.
- **Used in** — where the term appears, for back-reference.

---

## Entities

### Source

A place content lives. A directory on disk, a Subsonic server, an RSS
feed, etc. A source declares its `content` type (music, tv, movies,
audiobook, podcast) explicitly. Sources also declare *capabilities* —
the kinds of operations the adapter can fulfil (music provider, playlist
provider).

**Is not:** a "library" (avoid this word — it conflates source with
"the user's whole music collection"), a "collection" (which is a rule
set, not a place), an "adapter" (which is the *code* implementing a
source type).

**Used in:** every principle and feature that touches selection.

### Source adapter

The code that implements a source type. The Subsonic adapter, the
directory adapter, etc. Adapters translate source-specific data
(API responses, file system reads) into the canonical podkit data
model.

**Is not:** a source instance (which is a configured source with
specific connection details).

### Collection

A named (or inline) **content rule set**. Contains filter rules,
playlist references, and content-type-specific selection knobs.
Collections are portable — they don't own connection details.

**Is not:** a source. A collection *applies to* a source; it isn't one.
Not a "playlist" (which is one *type* of selection rule, named on a
source).

**Used in:** [`collections-are-content-sets`](../principles/collections-are-content-sets.md),
[`inline-collections-on-devices`](../principles/inline-collections-on-devices.md).

### Inline collection

A collection defined directly in a device's per-content-type block
(`[devices.X] music.filter.genre = [...]`) rather than as a named
`[collections.X]` block. Semantically identical to a named collection;
the selector pipeline sees no difference.

**Is not:** a per-device override applied to a separately-existing
collection (though it can *extend* a named collection via
`music.collection = "X"` plus inline override fields).

### Device

A target for sync. An iPod, an Echo Mini, a mass-storage music player.
A device has per-content-type bindings (which source, which collection),
holds state (capacity, on-device playlists, play counts), and is the
unit of CLI override.

**Is not:** a source, a destination filesystem, or a "target" (which is
ambiguous between source and device).

### Track

A single piece of audio content with metadata. A track lives in a source
(file in a directory, song record in Subsonic) and may also live on a
device (synced copy). The same logical track in two places is identified
via [track identity](#track-identity).

**Is not:** a file (a file is the storage; a track is the addressable
unit with metadata). Not a "song" — `track` is the canonical word and
covers music, audiobooks-tracks, podcast-episodes-as-tracks, etc.

### Playlist

A named, ordered set of track references. Playlists have **two roles**
in the design, and the role matters more than the name:

- **Playlist as constraint** — used in `filter.playlist` to *narrow the
  pool* of eligible tracks. Read-only on the source side.
- **Playlist as content** — used in `playlists = [...]` to *materialise
  a navigable playlist on the device* after sync.

**Is not:** a collection (a collection is broader — filter rules,
playlists, content-type knobs).

**Used in:** [`playlist-roles-separated`](../principles/playlist-roles-separated.md).

### Track identity

A normalised representation of "which track this is," independent of
where it's stored. Fields: `mbid` (optional), `artist`, `album` (optional),
`title`, `duration` (optional). Matched across sources via a tiered
cascade (MBID → exact tag → fuzzy tag → duration tiebreak).

**Is not:** a primary key (matching can be ambiguous; identity is a
contract, not an ID). Not a fingerprint (which is a separate, content-based
identifier).

**Used in:** [`track-identity-foundation`](../principles/track-identity-foundation.md).

---

## Concepts

### Filter

A rule (or set of rules) declared inside a collection that narrows which
tracks from the source are eligible for sync. Examples: `filter.genre`,
`filter.year`, `filter.playlist`, `filter.episodes-per-show`. Filters
are content-type-aware: some primitives only apply to certain content
types.

**Is not:** an override (which composes between a collection and a
device). Not a "constraint" (use *filter* unless specifically referring
to capacity constraints).

### Pool

The set of tracks that pass a collection's filter rules. The "background"
set that fills remaining capacity after pinned tracks are placed.

**Is not:** the full source contents (the source contains tracks; the
pool is the filtered subset).

### Pin / pinned set

Tracks that *must* be on the device because they are referenced by the
collection's `playlists` (materialised playlist) list. Pinned tracks
take priority over pool tracks. The pinned set is the union of all
materialised-playlist members.

**Is not:** a separate config concept — it's derived from
`playlists = [...]`. Don't introduce a `pinned = [...]` field.

### Selector / selector pipeline

The runtime stage that takes (collection ∘ device state ∘ device
capacity) and produces the effective track set: pinned tracks first,
pool fills the rest, capacity-fit prunes overflow, eviction policy
governs removals.

**Is not:** a filter (the filter is one input; the selector is the whole
process).

### Capacity-fit

The selector stage that ensures the effective track set fits within
the device's available capacity. Drops from the pool first; pinned
overflow is governed by the
[over-capacity policy](../open-questions/pinned-set-exceeds-capacity.md).

### Content type

A first-class classification of what kind of content lives in a source
or applies to a collection: `music`, `tv`, `movies`, `audiobook`,
`podcast`. Declared explicitly on sources; never auto-detected.

**Is not:** a media type (which is a MIME-level concept) or a file
format (mp3 / mp4).

### Capability

A source-instance property declaring what kinds of operations the
source can fulfil. Standard capabilities so far: `music-provider`,
`playlist-provider`. Filter primitives have capability requirements;
mismatches between collection demands and source capabilities are
surfaced at runtime.

**Used in:** [`source-capabilities`](../principles/source-capabilities.md).

### Mode (playlist-mode)

A collection-level scalar governing how `playlists` (content role)
interacts with `filter.playlist` (constraint role).

- `union` (default): pinned + pool, pinned can include tracks outside
  the pool.
- `intersect`: pinned must satisfy the constraint; tracks in pinned
  playlists that fail the constraint are dropped.

### Active source

The source actually used for a sync run, after CLI overrides. Default
is the device's configured source for the content type; CLI `--source`
overrides it.

### Pinned playlist source

A specific source named in `filter.playlist = { name = "...", source =
"..." }`, used to resolve a playlist regardless of the active music
source. Distinct from the active source; resolved through track
identity.

---

## Supporting technology

### libgpod / libgpod-node

The C library (libgpod) and its Node bindings (`@podkit/libgpod-node`)
used for reading and writing the iTunes DB. Database-level operations
only — no USB handling.

### ipod-db

The pure-TypeScript iTunesDB / ArtworkDB parser
(`@podkit/ipod-db`). Browser-compatible. Used by ipod-web and as the
read-side for device-state operations.

### Subsonic / OpenSubsonic

The streaming-server protocol used by Navidrome, Airsonic, and original
Subsonic. OpenSubsonic is the modern superset; podkit primarily targets
OpenSubsonic-compatible servers. Carries native playlist support and (on
OpenSubsonic servers) MusicBrainz IDs.

### Navidrome

A common OpenSubsonic implementation. Mentioned often in examples
because it has good MBID coverage. Not the only target — anything
OpenSubsonic-compatible should work.

### M3U / M3U8

The standard plaintext playlist format. M3U is Latin-1; M3U8 is UTF-8
(podkit defaults to M3U8 for output). Two flavours per spec: simple
(bare path list) and extended (`#EXTM3U` header plus `#EXTINF` per
entry).

### MBID (MusicBrainz Recording ID)

A stable UUID for a recording in the MusicBrainz database. When
populated on both sides of a cross-source match, MBID match is the
most reliable identity signal. Coverage varies wildly in real-world
libraries.

### AcoustID / fingerprinting

Content-based audio fingerprinting (Chromaprint → AcoustID). Distinct
from MBID. Not in podkit's current scope but mentioned as the upper
bound of robust matching.

### Backlog.md / MCP

The task-management system the project uses, with corresponding MCP
tooling for creating and editing tasks and PRDs. Backlog PRDs live in
`backlog/docs/doc-NNN`. Workspace sub-PRDs migrate there when shipped.

### ADR

Architecture Decision Record. Atomic, point-in-time decision documents
living in `adr/`. Design workspaces produce ADRs when discrete
decisions crystallise.

---

## Adding a term

When introducing a new entity, concept, or supporting tech reference:

1. Add it to this spec **first**, before using it elsewhere.
2. Give it a canonical name, a 1–2 sentence definition, and a clear
   "is not" line.
3. Update other workspace files to use the canonical form.
4. If you're renaming a term, search-and-replace across the workspace
   to keep usage consistent.

The goal is that any reader, landing on any workspace file, encounters
words that mean exactly what this spec says they mean.
