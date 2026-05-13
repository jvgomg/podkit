# Music Selection — Design Workspace

> **Master PRD / entry point.** This document frames the problem, sketches the
> conceptual model, and points at every other file in the workspace.
> It is intentionally short — depth lives in the principles, features, spikes,
> and open questions referenced below.

**Status:** shaping (early). The conceptual model has converged across several
sessions; sub-feature PRDs are not yet drafted. One foundational design
principle (source/collection decoupling) remains explicitly open.

**Last refined:** 2026-05-11

---

## Problem statement

podkit syncs music collections to iPod-class devices. Today, the unit of
configuration in the core (per ADR-008) is a "collection" — but a collection
is really just a connection to a source (a directory or a Subsonic server).
There is no separation between *where music lives* and *what subset of it
should be on a device*. The selection logic is naive: largely "everything from
this source goes on this device, until the device is full."

This causes a cluster of problems:

- **Capacity overruns.** Sync runs frequently exceed device capacity because
  file-size estimation is imprecise and there is no first-class "fit
  selection to capacity" stage.
- **No real curation.** Users have one source per device; there is no
  expressive way to say "this device gets jazz only" or "this device gets the
  playlist I curate in Subsonic, plus a handful of named playlists."
- **Video is guessed.** doc-007 proposed a TV/movies split that is still
  unimplemented; the current model conflates all video content.
- **Cross-source is ambiguous.** Users with the same music in two places
  (local directory + Subsonic) have no way to express "use my curation rules
  against either source."
- **Device-side state is invisible to selection.** OTG playlists, on-device
  curation, and play counts cannot influence what gets synced or evicted.
- **Playlists are absent.** podkit cannot read playlists from a source as a
  selection input, nor write playlists to a device as content output.

This workspace exists to design a coherent answer that addresses these as
parts of one system rather than as scattered patches.

## Conceptual model

The design converges on four layers:

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     Source      │ →  │   Collection    │ →  │     Device      │
│ (where content  │    │ (content rule   │    │ (binding +      │
│  lives)         │    │  set / intent)  │    │  state +        │
│                 │    │                 │    │  capacity)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                      ↓
                                          ┌─────────────────────┐
                                          │  Selector pipeline  │
                                          │ (intent ∘ reality   │
                                          │  → effective set)   │
                                          └─────────────────────┘
```

- **Source** — a place content lives. Declares connection details, content
  type (no auto-detection), and capabilities (provides music, provides
  playlists, etc.). One source per content type per device, by current rule.
- **Collection** — a portable, named *content rule set*. Owns filter rules,
  playlist references (as constraint), playlists to materialise on the device
  (as content output), playlist mode (union/intersect), and any
  content-type-specific knobs. Defined once in `[collections.*]` for reuse,
  or inline on the device when single-use.
- **Device** — wires sources to collections per content type. Holds state
  (capacity, play counts, on-device playlists). Inline collection definitions
  on a device are sugar for the same mechanism as a named collection.
- **Selector pipeline** — runs at sync time. Takes the collection (intent),
  the device state (reality), and the device capacity (constraint), and
  produces the effective track set with pin > pool ordering, capacity-fit,
  and eviction policies.

A separate **track identity** primitive sits between collections and the
active source whenever cross-source matching is needed (cross-source
playlists, self-healing sync, source ↔ device matching).

## How this workspace works

This workspace follows the conventions documented in
[`../README.md`](../README.md) — directory layout, frontmatter, status
values, bidirectional-link discipline. The bidirectional-link lint
config is in [`.lint.yaml`](.lint.yaml); run it from the repo root:

```bash
bun run scripts/lint-frontmatter-links.ts design/music-selection/.lint.yaml
```

## Where to read more

Each area below has its own README. Follow whichever matches what
you're looking for; the indexes will route you to the specific files.

- **[`user-stories/`](user-stories/README.md)** — user-facing scenarios
  driving the design. Personas, themes, the ranked story index. Start
  here if you want to understand *who* and *why*.
- **[`principles/`](principles/README.md)** — design rules that
  constrain how features are built. Start here if a feature decision
  feels like it should be guided by a rule.
- **[`features/`](features/README.md)** — sub-PRDs (stub or drafted).
  Start here if you want to know what's being built and how the pieces
  depend on each other.
- **[`open-questions/`](open-questions/README.md)** — decisions still to
  be made. Start here if something in the design feels uncertain.
  **Most foundational:**
  [source-collection-decoupling](open-questions/source-collection-decoupling.md).
- **[`spikes/`](spikes/README.md)** — technical investigations that
  resolve hard unknowns ahead of feature work. Start here when a
  feature claims to depend on research.
- **[`specs/`](specs/README.md)** — living end-state documents: the
  agreed config schema, the canonical terminology vocabulary. When in
  doubt about what to call something, look in
  [`specs/terminology.md`](specs/terminology.md) first.
- **[`roadmap.md`](roadmap.md)** — tier-ordered sequencing of features.
  Start here if you want to know what gets built when.

## What is in scope

- Music selection (filter, playlist constraint, capacity-aware pruning).
- Device-side playlist *write* (materialising playlists from collections).
- Per-content-type collections (music, TV, movies; later: audiobooks,
  podcasts).
- Cross-content-type sync onto a single device.
- Inline-collection-on-device ergonomics.
- Track identity primitive (insofar as the selector and cross-source features
  need it).
- File-size estimation (insofar as capacity-fit needs reliable numbers).

## What is out of scope (here)

- Transcoding correctness or codec selection. Covered by ADR-003 / ADR-006
  and the codec preference PRD.
- Device capability discovery. Covered by the device-types and
  devices-* packages.
- Database persistence on the device. Covered by libgpod-node and the ipod-db
  effort.
- Backwards compatibility shims for old configs. The config migration
  framework is expected to handle the transition; no in-place compatibility.

## Migration & shipping strategy

- This is a **breaking change** to the config schema. The config migration
  framework (doc-006) handles the version bump.
- Sub-PRDs ship in tiers (see [roadmap](roadmap.md)). Each tier is
  independently shippable; later tiers depend on earlier tiers but earlier
  tiers do not depend on later ones.
- The first tier is the foundation: sources/collections architecture, the
  selector pipeline core, and improved file-size estimation. Without these
  three, nothing else is meaningful.
