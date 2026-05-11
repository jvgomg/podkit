---
id: US-07
title: Subsonic-as-curator
priority: P1
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

# US-07 — Subsonic-as-curator

> Maintain playlists in Subsonic (e.g., Navidrome) and have those
> playlists reflected on the device, with their current contents.

## Detail

User curates their listening in their Subsonic UI — adds tracks to
playlists, reorders, renames. They want their iPod to mirror those
playlists. The next sync should pick up changes from the Subsonic side.

## Acceptance signal

```toml
[collections.my-music]
playlists = ["Workout Mix", "Road Trip"]

[devices.terapod]
music.source = "navidrome"
music.collection = "my-music"
```

After a sync, the iPod has "Workout Mix" and "Road Trip" as playlists,
containing the same tracks as in Navidrome.

If the user reorders / renames / edits a playlist in Navidrome and
re-syncs, the device reflects the new state.

## Notes

Same-source case — the playlist comes from the active music source.
Doesn't require cross-source machinery. The harder cross-source variant
is [US-16](us-16-subsonic-curation-local-files.md).
