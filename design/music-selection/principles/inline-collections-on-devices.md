---
status: tentative
last-updated: 2026-05-11
links:
  - collections-are-content-sets.md
  - ../open-questions/collection-extends-mechanism.md
  - ../open-questions/filter-overrides-merge-rules.md
---

# Inline collection definitions on devices are sugar

> **Principle.** A device's `music.*` (or `tv.*`, etc.) block *is* a
> collection definition. Whether the user wrote it inline or pulled it in by
> reference is a config-ergonomics choice, not a semantic distinction. The
> selector pipeline only ever sees "a collection."

## Why

We want three usage shapes to be served by one mechanism:

1. **Newbie / single device.** No `[collections.*]` block. All curation
   inline on the device.
2. **Power user / shared rules.** Named `[collections.*]` block referenced
   by multiple devices.
3. **Device-specific tweak.** Reference a named collection *and* layer
   per-device overrides on top.

If we treat (1) and (2) as different concepts, we double the surface area for
no semantic gain. If we treat (3) as something exotic, the user has to
reach for a separate mechanism the moment they want a small variation.

Treating *all three* as variations on "the device defines a collection,
optionally seeded by reference" gives a single mental model and a single
implementation path.

## What the principle implies

- The newbie's `music.source = "main"` block is conceptually a collection
  with no filter rules — i.e., "the whole source." No `[collections.*]`
  block needed in their config.
- A named collection in `[collections.*]` is reusable across devices.
- A device that wants almost-a-collection-with-tweaks writes
  `music.collection = "named"` plus inline override fields. The inline
  fields *extend* the named collection. (Merge rules — see
  [open question on merge rules](../open-questions/filter-overrides-merge-rules.md).)
- Lifting from inline to named is purely a refactor when the user notices
  repetition. No new vocabulary, no new concepts.

## What the principle does not say

- It does not commit to specific override syntax (`.add` / `.remove` /
  replace semantics). That's an open question.
- It does not commit to collections being able to extend other collections
  (a generalisation of the inline-extends-named pattern). That's also open
  (see [`../open-questions/collection-extends-mechanism.md`](../open-questions/collection-extends-mechanism.md)).
- It does not say all collection fields are valid inline. Some
  fields might only make sense at the named-collection level (e.g., a
  rotation configuration that needs persistence). TBD per field.

## Discussion / origin

Crystallised in the session of 2026-05-11 when the user proposed:
*"users are defining an inline collection definition directly on the device,
rather than using the convenience of defining a global collection in the
config. This will help with users who want a simple config setup and with
users who want to overwrite/amend/tweak a collection against a device."*

This unified the previously-separate threads of "device-level filters as
incremental ladder" and "device-level playlists" into one mechanism.

## Tensions to watch

- **Override merge rules** are the load-bearing detail. If silent merging
  produces footguns, we may need explicit `.add`/`.remove` operators (the
  current tentative direction). The cost is verbosity. See open question.
- **Inline collections that *only* live on a device** can't be shared. If a
  user wants to share an inline-tweaked collection later, they have to lift
  it. That's manual but clean.
