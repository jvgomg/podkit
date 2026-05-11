---
status: open
last-updated: 2026-05-11
importance: medium
links:
  - ../principles/playlist-roles-separated.md
  - ../features/README.md
  - ../user-stories.md
---

# What happens when the pinned set exceeds device capacity?

> **The question.** A user defines materialised playlists on the device
> (the "pinned set") whose tracks alone exceed the device's available
> capacity. The selector pipeline can no longer satisfy "every pinned track
> must be on the device." What should happen?

## Why this matters

The user-facing premise of pinned playlists is *"these tracks are
must-have."* Quietly evicting some of them violates that premise. But
failing the sync entirely punishes the user for hitting a capacity wall —
they may not have known.

The design needs a clear, explained behaviour for this case. The wrong
answer here makes the device-playlists feature feel unreliable.

## Options

### Option 1 — Hard fail with explanation

Sync aborts. Diagnostic explains: *"Pinned playlists 'A', 'B', 'C' total X
GB; device has Y GB available. Trim a playlist or grow the device."*

**Pros:** Loud and unambiguous. Respects the must-have promise.
**Cons:** Sync produces no output. Unfriendly when user is mid-flight.

### Option 2 — Best-effort with prominent warning

Sync proceeds. Selector picks the largest prefix of pinned tracks that fit;
the rest are dropped with prominent warnings naming each missing playlist.

**Pros:** Sync produces something usable. User can react incrementally.
**Cons:** Quietly violates the must-have promise. User may not notice the
warnings.

### Option 3 — User-configured priority within pins

Pinned playlists carry an order or a priority weight. The selector fills
from highest-priority pins first; lower-priority pins drop with warnings if
needed.

**Pros:** Gives users control. Predictable.
**Cons:** New config concept (priority/order). Most users won't set it; need
sensible default behaviour.

### Option 4 — Interactive prompt (CLI only)

When the CLI runs into this, prompt: "drop X playlist? trim to Y tracks?
abort?"

**Pros:** User stays in control.
**Cons:** Doesn't work in non-interactive contexts (daemon, CI, sync
hooks). Need a non-interactive fallback anyway.

## Likely shape of resolution

A combination, probably:

- Default behaviour: **Option 1 (hard fail with explanation)** — preserves
  the must-have promise, makes capacity issues visible.
- Override: a per-device or per-collection `over-capacity = "drop-overflow"
  | "fail" | ...` knob to opt into Option 2 if the user prefers.
- Future: Option 3 (priority within pins) if real demand emerges.
- CLI: a `--force` or `--allow-pin-eviction` flag that mirrors the
  config knob for one-off runs.

## What would resolve this

A decision on the default behaviour (probably Option 1) plus a sketch of
the override surface. Belongs in the device-playlists-write or
selector-pipeline sub-PRD.

## Related

- The same question applies to the *pool* (filter-eligible tracks) hitting
  capacity — but that case has an obvious answer (drop overflow, that's
  what the pool is for). The pinned case is what needs the explicit
  decision.
- Connects to estimation accuracy: if estimates are unreliable, capacity
  overflows happen mid-sync (transcoding produces unexpectedly large
  files). The selector needs to handle that case too — possibly the same
  policy applies.
