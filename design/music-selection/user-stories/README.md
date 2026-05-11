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

## Archived (solved / out-of-scope)

See [`archive/`](archive/).

| ID | Title | Final status | Where it lives now |
|----|-------|--------------|--------------------|
| [US-20](archive/us-20-self-healing-sync.md) | Self-healing sync | out-of-scope | Covered by ADR-009. |

US-13 (originally "two devices, same rules") was folded into US-02 during
the first restructure pass — same scenario, different framing.

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
