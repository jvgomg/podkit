---
id: US-11
title: Per-device tweak
priority: P1
status: open
scope: in
theme: multi-device
last-updated: 2026-05-11
addressed-by:
  features: [sources-and-collections]
  principles: [inline-collections-on-devices]
  open-questions: [filter-overrides-merge-rules, collection-extends-mechanism]
  spikes: []
---

# US-11 — Per-device tweak

> Use the same collection on two devices but skip one playlist on the
> smaller one.

## Detail

User has a shared `my-music` collection used by multiple devices. For one
specific device (the small one, say), they want *everything from*
`my-music` *except one playlist*. They don't want to define a parallel
collection just for this single tweak.

## Acceptance signal

```toml
[collections.my-music]
playlists = ["Terapod", "Workout Mix", "Sleep Sounds", "Road Trip"]

[devices.terapod]
music.source = "navidrome"
music.collection = "my-music"

[devices.gym-nano]
music.source = "navidrome"
music.collection = "my-music"
music.playlists.remove = ["Sleep Sounds"]
```

`gym-nano` ends up with three playlists instead of four. The base
collection is untouched.

## Notes

This is the canonical motivation for
[inline collections on devices](../principles/inline-collections-on-devices.md)
having proper merge semantics. The exact override syntax is open — see
[filter-overrides-merge-rules](../open-questions/filter-overrides-merge-rules.md).
