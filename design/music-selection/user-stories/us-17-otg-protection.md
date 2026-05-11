---
id: US-17
title: OTG protection
priority: P1
status: open
scope: in
theme: device-state
last-updated: 2026-05-11
addressed-by:
  features: [device-state-read]
  principles: [track-identity-foundation]
  open-questions: []
  spikes: []
---

# US-17 — OTG protection

> A track the user added to an On-The-Go (or otherwise user-curated)
> playlist on the device should not be removed by the next sync.

## Detail

iPods support "On-The-Go" playlists curated directly on the device. Users
may also rename or reorder podkit-synced playlists in place. The next
sync should respect these device-side curation actions — at minimum by
*not removing* tracks the user has put into their own playlists, even if
those tracks would otherwise be evicted (e.g., out-of-pool, or
capacity-fit).

## Acceptance signal

User adds Track X to the OTG playlist on the iPod. Next sync runs.
Track X stays on the device, with a diagnostic noting that it was
preserved because of OTG membership.

By default, OTG-protected tracks count against capacity but are not
evicted to make room for newer pool tracks. The user can opt out per
device if they prefer the "always strictly follow config" behaviour.

## Notes

Depends on the
[device state read](../features/device-state-read.md) feature being
implemented — without read-back support for on-device playlists, podkit
can't know which tracks are protected.

The matching from device-side tracks back to source identities uses the
[track-identity](../features/track-identity.md) primitive.
