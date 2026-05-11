---
id: US-25
title: Track removal warning
priority: P1
status: open
scope: in
theme: device-state
last-updated: 2026-05-11
addressed-by:
  features: [device-state-read, selector-pipeline]
  principles: [track-identity-foundation]
  open-questions: []
  spikes: []
---

# US-25 — Track removal warning

> Before podkit removes tracks I added on the device (outside any
> source), warn me.

## Detail

Generalisation of [US-17 (OTG protection)](us-17-otg-protection.md). The
user may have added tracks to the device through means other than
podkit — manually copied files, an old iTunes sync, or via a tool that
predates podkit. The selector might want to evict these tracks because
they don't correspond to anything in the source.

User wants a clear warning before this happens, with the option to:
- Leave them in place (treat as orphan-protected).
- Remove them with explicit confirmation.
- Configure default behaviour per device.

## Acceptance signal

When the selector encounters tracks on the device that don't match any
source track:

```
⚠ Found 12 tracks on device that don't match any source ("orphan tracks").
  Default behaviour: retain (treat as user-added).
  To remove: rerun with --remove-orphans.
  Tracks: [list]
```

Default leans conservative: preserve unfamiliar content unless the user
opts to clean up.

## Notes

Distinct from OTG protection (which is specifically about device-side
*playlists*). Orphan track detection applies more broadly to any track
that exists on the device but not in the source.

Depends on
[device state read](../features/device-state-read.md) and the
[track-identity](../features/track-identity.md) primitive for matching
device tracks back to source candidates.
