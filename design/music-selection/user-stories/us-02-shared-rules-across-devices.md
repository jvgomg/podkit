---
id: US-02
title: Shared rules across devices
priority: P0
status: open
scope: in
theme: multi-device
last-updated: 2026-05-11
addressed-by:
  features: [sources-and-collections]
  principles: [collections-are-content-sets, inline-collections-on-devices]
  open-questions: []
  spikes: []
---

# US-02 — Shared rules across devices

> Define content rules once and apply them to several devices without
> duplicating the rules per device.

## Detail

User has two or more devices and wants the same content selection rules
to govern all of them. Edits to the rules apply uniformly. No
copy-paste-and-keep-in-sync.

## Acceptance signal

```toml
[collections.my-music]
filter.playlist = "Terapod"
playlists = ["Terapod", "Workout Mix"]

[devices.terapod]
music.source = "navidrome"
music.collection = "my-music"

[devices.living-room-classic]
music.source = "navidrome"
music.collection = "my-music"
```

Both devices sync the same selection; editing `my-music` updates both.

## Notes

Folds in the original US-13 ("two devices same rules") — same scenario,
no need for a separate story. This is the canonical motivation for named
collections.
