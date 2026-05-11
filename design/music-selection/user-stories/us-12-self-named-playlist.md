---
id: US-12
title: Self-named device playlist
priority: P2
status: open
scope: in
theme: playlists
last-updated: 2026-05-11
addressed-by:
  features: [device-playlists-write]
  principles: [playlist-roles-separated]
  open-questions: []
  spikes: []
---

# US-12 — Self-named device playlist

> Maintain a Subsonic playlist named after the iPod (e.g., "Terapod") that
> serves as both the constraining pool *and* a materialised playlist on
> the device.

## Detail

A particular curation pattern: the user has a playlist named for the
target iPod, where they collect tracks they want on that device. They
want the playlist to:

1. Constrain selection (only tracks in "Terapod" are eligible).
2. Appear on the device as a navigable playlist with the same name.

These are two distinct roles per the
[playlist-roles-separated](../principles/playlist-roles-separated.md)
principle. The user spells both explicitly.

## Acceptance signal

```toml
[collections.my-music]
filter.playlist = "Terapod"          # constraining role
playlists = ["Terapod"]              # content role — same playlist

[devices.terapod]
music.source = "navidrome"
music.collection = "my-music"
```

Result: device contains exactly the tracks in "Terapod", grouped into a
"Terapod" playlist.

## Notes

podkit does not auto-derive the playlist name from the device name —
that's a coincidence the user maintains in Subsonic. Explicit config
is preferred over magic.
