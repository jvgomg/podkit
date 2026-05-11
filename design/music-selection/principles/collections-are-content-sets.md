---
status: tentative
last-updated: 2026-05-11
user-stories-addressed: [US-01, US-02, US-03, US-06, US-09]
links:
  - inline-collections-on-devices.md
  - playlist-roles-separated.md
  - ../open-questions/source-collection-decoupling.md
  - ../features/README.md
---

# Collections are content sets; devices are constraints

> **Principle.** A collection encapsulates *what content the user wants*
> (filter rules, playlists, content-type-specific knobs). A device
> encapsulates *the constraints under which that content has to live*
> (capacity, state, source binding). The two are kept distinct.

## Why

Selection has two kinds of inputs that change at different rates:

- **Intent** — "what music should this be." Genre rules, playlists,
  content-type preferences. Stable, often shared across multiple devices.
- **Reality** — "what is on this device, what is its capacity, what has the
  user done on the device since last sync." Per-device, ephemeral.

If we put both in the same place (e.g., everything on the device) we lose the
ability to say "the same content rules apply across these N devices." If we
put neither in a clear place we conflate stable intent with ephemeral state
and the config gets noisy.

Separating them gives us:

- One TOML block ("the collection") that the user can review and edit to
  understand and adjust their listening intent.
- Devices that are interchangeable: swap an iPod, point a new one at the
  same collection, and you're done.
- A selector pipeline with a clean contract: `collection ∘ device-state →
  effective track set`.

## What the principle implies

- Filter rules, playlist references, materialised playlist lists, and any
  content-type-specific knobs (e.g., `episodes-per-show`) belong on
  collections, not on devices.
- Source bindings and CLI overrides belong on devices.
- State (play counts, on-device playlists, OTG curation) is read from the
  device at sync time and fed into the selector. It is never written into
  config.
- Selector behaviours that depend on state (rotation, OTG protection,
  eviction priority) are defined as *policies* — the *rule* lives wherever
  is appropriate (collection or device), the *data* lives on the device.

## What the principle does not say

- It does not say a device cannot define a collection inline. Inline
  collections on devices are sugar (see
  [`inline-collections-on-devices`](inline-collections-on-devices.md)) — but
  conceptually they are still collections.
- It does not say sources are part of collections. The relationship between
  source and collection is a separate, still-open question (see
  [`../open-questions/source-collection-decoupling.md`](../open-questions/source-collection-decoupling.md)).

## Discussion / origin

Crystallised in the session of 2026-05-11 after a long thread on whether
playlist-as-content (materialised on the device) belongs on collections or
devices. The user's framing — *"users define collections; when applying to a
device, those rules play out against the device's constraints"* — became the
shorthand for the principle.

## Tensions to watch

- **Per-device tweaks** (US-11) — a device wants 95% of a collection but with
  one playlist removed. Inline-collection-on-device handles this; if the
  syntax of inline overrides becomes too fiddly, we may be putting too much
  on collections that should sit on devices. So far it does not appear to.
- **Device-specific filters as escape hatch** — we expect this to be rare;
  if it becomes common, the principle may need refinement.
