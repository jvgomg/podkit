---
status: open
last-updated: 2026-05-11
importance: medium
user-stories-addressed: [US-11]
gates-features: [sources-and-collections]
informed-by-spikes: []
links:
  - ../principles/inline-collections-on-devices.md
  - filter-overrides-merge-rules.md
---

# Should collections be able to extend other collections?

> **The question.** A device can extend a named collection inline (the
> "inline collection on device" pattern). Should a *named* collection also
> be able to extend another named collection — i.e., is `extends` a
> first-class collection field?

## Why this matters

The inline-on-device pattern handles per-device tweaks. But there's a
related case: two collections that share most of their rules and differ in
one or two ways.

Example: a `core-music` collection with the user's general taste, and a
`gym-version` collection that adds high-tempo playlists. If a user wants
this *and* wants to apply `gym-version` to multiple devices (so they can't
just inline it), they need either:

- A way for `gym-version` to extend `core-music`.
- To duplicate `core-music`'s rules into `gym-version`.

Without `extends`, the user's only choice for shared-but-tweaked rules
across devices is duplication. With `extends`, named collections become
composable, and inline-on-device extension is a special case (an anonymous
collection that extends a named one).

## Options

### Option 1 — No `extends`. Inline-on-device only.

If you want shared rules across devices, define one canonical collection.
If you want a tweak, inline it on the device.

**Pros:** Simpler config language.
**Cons:** Forces duplication for "shared by N devices, but with one
tweak."

### Option 2 — `extends` as a first-class field

```toml
[collections.core-music]
filter.playlist = "Terapod"
playlists = ["Terapod", "Workout Mix"]

[collections.gym-version]
extends = "core-music"
playlists.add = ["Gym Pump"]
```

Inline-on-device becomes "anonymous extends" — same mechanism.

**Pros:** Symmetric, composable, no duplication.
**Cons:** Adds a layer of indirection that can become hard to follow if
abused (collections extending collections extending collections).

### Option 3 — `extends` with a depth limit

Same as Option 2, but enforce a max chain depth (probably 1) to prevent
spaghetti hierarchies.

**Pros:** Pragmatic constraint.
**Cons:** A bit arbitrary; users may want deeper trees for legitimate
reasons.

## Tensions

- The merge rules question
  ([filter-overrides-merge-rules](filter-overrides-merge-rules.md))
  applies to both inline-on-device and named-collection-extends. If we
  resolve merge rules well, `extends` becomes a small additional step. If
  not, every layer of extension multiplies the merge-rule complexity.
- We have no real-world demand evidence for shared-but-tweaked named
  collections yet. It's a *clean* feature to imagine but might be
  premature.

## What would resolve this

Either:

1. Wait for real demand. Ship inline-on-device first; add `extends` if
   users start hitting duplication.
2. Build it now because the merge-rules logic must support it anyway and
   the additional surface is small.

The current lean is (1) — *don't add `extends` on day one* — but we should
make the inline-on-device merge rules consciously compatible with
extending it later, so adding `extends` doesn't require redesigning the
merge.

## Related

- Inline-collections-on-devices principle.
- Filter-overrides-merge-rules open question (same machinery).
