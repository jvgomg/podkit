# User Stories

> The set of user-facing scenarios driving the music-selection design.
> Each story is a discrete file with its own status, priority, scope, and
> mappings to features, principles, open questions, and spikes.

## The user problem

podkit users want to put **the right content** on their portable music
devices, with minimal fuss, and have it stay right over time.

"Right content" is a moving target:

- It depends on **what the user has** (one library or many, local files or
  cloud, mixed media or pure music).
- It depends on **what the user wants** (everything, a genre, a curated
  playlist, the last 5 unwatched episodes of a show).
- It depends on **what the device can hold** (capacity, current state, what
  the user has done on the device since the last sync).
- It depends on **trust** — the user has to believe podkit isn't going to
  silently lose tracks, surprise them with a full device, or undo curation
  they did themselves.

Today's podkit handles a narrow slice of this: one source per device, a
single content type at a time, naive capacity assumptions, no real curation.
The stories below are the surface area the music-selection design must
cover (or explicitly choose not to cover).

## How to read this index

Stories are ranked by priority and tagged by theme. Each row links to the
story file, which carries the detail and the mappings to features /
principles / open questions / spikes.

**Status values:** `open` (active), `in-progress` (being worked on),
`solved` (completed — file in `archive/`), `deferred` (real but not now),
`out-of-scope` (explicitly not solving here).

**Priority:** `P0` (must), `P1` (should), `P2` (could), `P3` (future).

**Scope:** `in` (solving here), `out` (covered elsewhere or rejected),
`contingent` (depends on an open question, currently in if that resolves
toward "yes").

## Active stories

| ID | Title | Priority | Status | Scope | Theme |
|----|-------|----------|--------|-------|-------|
| [US-01](us-01-newbie-fast-start.md) | Newbie fast-start | P0 | open | in | selection-fundamentals |
| [US-02](us-02-shared-rules-across-devices.md) | Shared rules across devices | P0 | open | in | multi-device |
| [US-03](us-03-cross-source-same-rules.md) | Cross-source, same rules | P1 | open | contingent | cross-source |
| [US-04](us-04-multi-content-type-device.md) | Multi-content-type device | P1 | open | in | multi-content-type |
| [US-05](us-05-curated-playlists-plus-pool.md) | Curated playlists plus pool | P0 | open | in | playlists |
| [US-06](us-06-different-selection-per-device-size.md) | Different selection per device size | P0 | open | in | multi-device |
| [US-07](us-07-subsonic-as-curator.md) | Subsonic-as-curator | P1 | open | in | playlists |
| [US-08](us-08-strict-gate.md) | Strict gate (intersect mode) | P2 | open | in | playlists |
| [US-09](us-09-genre-filter.md) | Genre filter | P1 | open | in | selection-fundamentals |
| [US-10](us-10-tv-recent-unwatched.md) | TV recent unwatched | P2 | open | in | multi-content-type |
| [US-11](us-11-per-device-tweak.md) | Per-device tweak | P1 | open | in | multi-device |
| [US-12](us-12-self-named-playlist.md) | Self-named device playlist | P2 | open | in | playlists |
| [US-14](us-14-standalone-m3u-directory.md) | Standalone M3U directory | P2 | open | in | playlists |
| [US-15](us-15-podkit-native-playlists.md) | Podkit-native playlists | P3 | deferred | in | playlists |
| [US-16](us-16-subsonic-curation-local-files.md) | Subsonic curation, local files | P1 | open | contingent | cross-source |
| [US-17](us-17-otg-protection.md) | OTG protection | P1 | open | in | device-state |
| [US-18](us-18-capacity-aware-sync.md) | Capacity-aware sync | P0 | open | in | selection-fundamentals |
| [US-19](us-19-estimation-transparency.md) | Estimation transparency | P1 | open | in | diagnostics-ux |
| [US-21](us-21-audiobook-unread.md) | Audiobook unread | P3 | deferred | in | future-content-types |
| [US-22](us-22-podcast-recent-unplayed.md) | Podcast recent unplayed | P3 | deferred | in | future-content-types |
| [US-23](us-23-dry-run-preview.md) | Dry-run preview | P1 | open | in | diagnostics-ux |
| [US-24](us-24-pre-flight-validation.md) | Pre-flight validation | P1 | open | in | diagnostics-ux |
| [US-25](us-25-track-removal-warning.md) | Track removal warning | P1 | open | in | device-state |
| [US-26](us-26-config-migration-friendliness.md) | Config migration friendliness | P1 | open | in | diagnostics-ux |
| [US-27](us-27-manual-video-curation.md) | Manual video curation | P2 | open | in | multi-content-type |
| [US-28](us-28-movies-fresh-unwatched.md) | Fresh unwatched movies | P2 | open | in | multi-content-type |

## Archived (solved / out-of-scope)

See [`archive/`](archive/).

| ID | Title | Final status | Where it lives now |
|----|-------|--------------|--------------------|
| [US-20](archive/us-20-self-healing-sync.md) | Self-healing sync | out-of-scope | Covered by ADR-009. |

US-13 (originally "two devices, same rules") was folded into US-02 during
the first restructure pass — same scenario, different framing.

## Personas

Concrete user archetypes that drive the story set. Fun first names plus
a one-line strap line let us refer to them in shorthand
("Curator Casey would want…") while still being clear about who we're
designing for.

### Quick-start Quinn — *the user who plugs in their iPod and wants their whole music library on it without learning anything new*

- **Setup:** one large iPod (Classic-class, ~160 GB). One local music
  directory. No external server.
- **Tech level:** low. Doesn't want to write filters, collections, or
  playlists to start.
- **Goals:** point podkit at the music folder, plug in the iPod, sync.
  Get on with their life. Trust that the default behaviour is sensible.
- **Drives:** US-01, US-18, US-19, US-26.

### Two-device Theo — *the user who has a big "everything" iPod and a smaller "favourites" one, with the same curation rule applied to both*

- **Setup:** two iPods of different capacities. One source (local or
  Subsonic — doesn't really care). Wants the big one to get most/all of
  the library and the small one to get a curated subset (genre, rating,
  or a "favourites" playlist).
- **Tech level:** medium. Comfortable writing a small bit of config to
  express the subset rule.
- **Goals:** define the favourites rule once and apply it to both
  devices without copy-pasting. Tweak per-device occasionally without
  fragmenting their config.
- **Drives:** US-02, US-06, US-09, US-11, US-23.

### Curator Casey — *the multi-iPod Subsonic curator who gives each device a distinct purpose (relaxed / gym / fresh)*

- **Setup:** three or more smaller iPods, each with its own purpose
  ("relaxed listening", "gym / high-energy", "fresh discoveries").
  Music lives in Subsonic (Navidrome). Curation happens in Subsonic
  playlists.
- **Tech level:** high. Maintains several collections; thinks of
  iPods as themed devices, not as one-size-fits-all.
- **Goals:** each iPod reflects its theme via a Subsonic-curated
  playlist (or set of playlists). Updating a theme in Subsonic flows
  through to the device. Strict semantics where appropriate (gym iPod
  = only high-energy tracks).
- **Drives:** US-02, US-05, US-06, US-07, US-08, US-11, US-12, US-17.

### Hand-pick Hank — *the video user who wants to manually choose specific movies and TV seasons, with no automation*

- **Setup:** iPod 5G or Classic with video. One source for TV, one for
  movies. Specific shows and seasons in mind; specific movies they
  want to watch.
- **Tech level:** medium. Comfortable enumerating items in config; not
  comfortable with rotation logic deciding for them.
- **Goals:** spell out exactly what should be on the device. Trust that
  podkit will not silently swap things in or out. Updates are
  deliberate edits to the list.
- **Drives:** US-04, US-27.

### Rotation Robin — *the video user whose iPod is a queue of fresh unwatched movies and the next N unwatched episodes per TV show*

- **Setup:** iPod with video. TV source + movies source. Watches on the
  device and expects what they've watched to rotate out.
- **Tech level:** medium-high. Comfortable with selection rules that
  consume device state (watched / unwatched).
- **Goals:** the iPod is always full of stuff they haven't seen yet.
  After a flight where they watched three episodes and a movie, the
  next sync rotates in fresh content automatically.
- **Drives:** US-04, US-10, US-28. (Depends on device state read for
  watched flags.)

### Audiobook Ada — *the user whose iPod is a queue of unfinished audiobooks, rotating as they finish them*

- **Setup:** a smaller iPod dedicated (mostly) to audiobooks. Source
  is a directory of audiobook files (M4B / MP3 chapters).
- **Tech level:** medium.
- **Goals:** the device shows only books they haven't finished. When a
  book finishes, it drops off; new books rotate in. Progress is
  preserved across syncs.
- **Drives:** US-21, plus depends on device-state-read for progress.

### Podcast Penny — *the user whose iPod is the last N unplayed episodes per podcast feed*

- **Setup:** an iPod (any class) for spoken-word commuting. Subscribes
  to a handful of podcast feeds via RSS / OPML.
- **Tech level:** medium.
- **Goals:** their iPod always has the latest N episodes of each feed
  they care about; played episodes rotate out. Doesn't have to manage
  the queue manually.
- **Drives:** US-22, plus depends on device-state-read for played
  state.

## Themes

| Theme | Meaning |
|-------|---------|
| `selection-fundamentals` | The basics of how content gets chosen. |
| `playlists` | Playlist-as-constraint, playlist-as-content, playlist sources. |
| `multi-device` | Multiple devices, shared and per-device rules. |
| `cross-source` | The same selection rules against different sources. Gated on `source-collection-decoupling`. |
| `multi-content-type` | Music + TV + movies + future content types on a device. |
| `device-state` | OTG, on-device curation, play counts. |
| `diagnostics-ux` | Dry-run, validation, transparency, migration. |
| `future-content-types` | Audiobooks, podcasts. |

## Adding a story

1. Pick the next ID (`US-NN`).
2. Pick a slug (lowercase, hyphenated, short).
3. Create the file with frontmatter (id, title, priority, status, scope,
   theme, addressed-by, last-updated) and a short body.
4. Add to the index above.
5. Cross-reference in any feature / principle / open question / spike that
   the story drives.

## Resolving a story

1. Update its frontmatter status to `solved` (or `out-of-scope` if rejected).
2. Add a "Resolution" section at the bottom linking to where the story
   now lives (which feature / PR / ADR / etc.).
3. Move the file to `archive/`.
4. Update this index: remove the row from "Active", add to "Archived".
