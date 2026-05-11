---
id: US-21
title: Audiobook unread
priority: P3
status: deferred
scope: in
theme: future-content-types
last-updated: 2026-05-11
addressed-by:
  features: [audiobook-content-type]
  principles: [content-type-is-explicit]
  open-questions: []
  spikes: []
---

# US-21 — Audiobook unread

> Sync only unread audiobooks from an audiobook source. Skip the ones I've
> already listened to.

## Detail

Audiobook collectors want their device to be a "to-listen" queue. A
finished audiobook should drop off after the next sync (or be retained
if the user has marked it for re-listen). Progress and finished state
come from the device.

## Acceptance signal

```toml
[sources.audiobooks]
type = "directory"
path = "/Volumes/Audiobooks"
content = "audiobook"

[collections.unread]
filter.state = "unfinished"
filter.prefer-recently-added = true

[devices.terapod]
audiobook.source = "audiobooks"
audiobook.collection = "unread"
```

## Notes

Deferred — first need the audiobook content type as a first-class
concept. Audiobook-specific filter primitives (`state`, perhaps `series`,
`author`) live in the audiobook-content-type sub-PRD.

Audiobook progress tracking on iPods is a known weak spot — depends on
the [device state read](../features/device-state-read.md) capability for
bookmark/progress data.
