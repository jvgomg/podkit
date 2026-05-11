---
status: agreed
last-updated: 2026-05-11
links:
  - source-capabilities.md
  - ../features/README.md
---

# Content type is explicit, declared on sources

> **Principle.** A source declares its content type as data. podkit does not
> guess. Items in a source that do not match the declared content type are
> warned and dropped.

## Why

The current code treats "video" as a single bucket and tries to detect TV vs
movie from filenames or metadata. doc-007 attempted to fix this by splitting
video into TV and movies *via section name* (`[tv.X]` vs `[movies.X]`) — but
auto-detection still drove the runtime behaviour.

Auto-detection is a footgun:

- It silently miscategorises content (e.g., a music video tagged as TV).
- It hides a configuration intent that should be a deliberate choice.
- It makes diagnostics confusing: when a sync misbehaves, the user doesn't
  know whether to fix tags, fix files, or fix config.

Declaring content type explicitly on the source removes the guesswork.

## What the principle implies

- Every source has `content = "music" | "tv" | "movies" | "audiobook" |
  "podcast"` (and so on as content types are added).
- A directory containing mixed media is *N sources*, one per content type,
  each pointed at the relevant subdirectory.
- A source with mixed-content items warns about items that don't match its
  declared content type, and drops them from the sync set.
- Collections inherit content type from the source they are applied to;
  collections may *also* declare content type for validation, but the source
  is the authoritative declaration.
- The CLI `--source X` swap respects content type — `X` is selected to
  swap whichever device-content-type slot has a matching content type.

## What the principle does not say

- It does not say files inside a source can't be auto-categorised within a
  content type (e.g., TV episodes can still be auto-grouped by show/season
  via metadata; movies can be sorted by year).
- It does not say sources can't carry multiple roles
  (see [source-capabilities](source-capabilities.md)) — a source can be both
  a music provider and a playlist provider; that's about *capabilities*, not
  content type.

## Discussion / origin

Established as a direct response to doc-007's auto-detection approach. The
user's framing: *"I would like to know what the default playlist formats are
for each adapter ... we should be moving away from podkit guessing what
video type the content is."*

doc-007 is expected to be obsoleted by a per-content-type-collections sub-PRD
that adopts this principle as its core.

## Implementation notes

- Source schema gains `content` as a required field for any source the user
  declares.
- Validators reject sources that omit it.
- Diagnostics format: `Source <name> declared content="tv"; found N items
  whose detected content does not match (skipped). Run "podkit source
  inspect <name>" for details.`
