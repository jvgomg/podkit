---
id: US-01
title: Newbie fast-start
priority: P0
status: open
scope: in
theme: selection-fundamentals
last-updated: 2026-05-11
addressed-by:
  features: [sources-and-collections, selector-pipeline]
  principles: [collections-are-content-sets, inline-collections-on-devices]
  open-questions: []
  spikes: []
---

# US-01 — Newbie fast-start

> Point podkit at a music folder and an iPod and have everything sync, with
> no config beyond paths.

## Detail

A first-time user installs podkit, has a directory of music files and an
iPod plugged in. They want to write a minimal config (one source, one
device) and run `podkit sync`. They should not need to learn the
collection vocabulary, write filter rules, or set up playlists. Default
behaviour: everything from the source goes onto the device, up to
capacity.

## Acceptance signal

```toml
[sources.main]
path = "/Volumes/Music"
content = "music"

[devices.terapod]
music.source = "main"
```

`podkit sync` produces a usable iPod with the user's music on it. No
`[collections.*]` required.

## Notes

This is the "shape 1" case from
[inline-collections-on-devices](../principles/inline-collections-on-devices.md).
The principle implies the newbie path is achievable; this story tests it.
