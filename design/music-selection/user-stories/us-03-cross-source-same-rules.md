---
id: US-03
title: Cross-source, same rules
priority: P1
status: open
scope: contingent
theme: cross-source
last-updated: 2026-05-11
addressed-by:
  features: [sources-and-collections]
  principles: [source-capabilities, collections-are-content-sets]
  open-questions: [source-collection-decoupling]
  spikes: []
---

# US-03 — Cross-source, same rules

> Have the same music available in two places (e.g., local directory and
> Subsonic) and sync from either with the same selection rules.

## Detail

User maintains their music in two places — say, a local directory of FLAC
files and a Subsonic server that serves transcoded copies. They want to
write their selection rules once (one collection) and run sync against
either source as circumstances demand (offline trip = local; online =
Subsonic). The selection rules apply uniformly.

## Acceptance signal

```toml
[devices.terapod]
music.source = "local-music"     # default
music.collection = "my-music"
```

Then:

```bash
podkit sync -d terapod                   # uses local-music
podkit sync -d terapod --source navidrome # uses navidrome, same rules
```

Both runs produce comparable selections (modulo track-identity matching
edge cases).

## Scope: contingent

This story is in scope only if the
[source-collection-decoupling](../open-questions/source-collection-decoupling.md)
question resolves toward keeping collections portable across sources. If
it resolves the other way (collections are bound to a specific source),
this story is rejected and the cross-source CLI swap is removed from the
design.
