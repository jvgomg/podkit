---
id: doc-050
title: 'PRD: Per-Device Default Collections + Collection-Resolution Consolidation'
type: specification
created_date: '2026-06-24 13:45'
tags:
  - prd
  - collections
  - config
  - sync
  - refactor
---
## Problem Statement

Today podkit only supports a single **global** set of default collections. The
`[defaults]` block holds one `music` name, one `video` name, and one `device`
name. When a user runs `podkit sync` with no `-c` flag, those global defaults
decide what gets synced — regardless of which device is targeted.

Users with more than one device want different devices to default to different
collections. Examples:

- A large iPod that should sync the full `main` music library *and* `shows`.
- A small flash device that should default to a curated `workout` collection
  and **explicitly sync no video at all** — even though a global default video
  collection exists.

There is no way to express any of this. The user must pass `-c` on every sync,
or accept that every device inherits the same global defaults. Critically,
there is also no way to say "this device should sync *nothing* of a given type
by default" — absence of a value means "inherit", not "none".

Underneath the user-facing gap sits a tangle of duplicated resolution code that
makes the feature awkward to add safely:

- The "pick the default collection" cascade is reimplemented three times, and
  the one the real sync path uses lives inline in a 2000+ line command module
  and silently swallows errors.
- That inline resolver runs **before** the target device is fully known, so any
  device-scoped defaulting would be silently skipped for devices matched by
  path or UUID.
- The settings resolver (`config/resolve.ts`) is half-migrated to a shared
  cascade primitive: simple scalars use it, but quality/audio/video/artwork
  still use ~120 lines of hand-written `if (x !== undefined)` ladders.
- The config loader repeats the same "type-check, validate enum, throw,
  assign" TOML-parse block ~30 times, and the default-reference validator is
  three copy-pasted blocks.

## Solution

Add **per-device default collections** with a clean tri-state, and land the
feature on a **consolidated** resolution core rather than a fourth parallel
code path.

From the user's perspective:

- Each named device can declare a default **music** collection and a default
  **video** collection.
- Each is a tri-state: **unset** = inherit the global default; an explicit
  **collection name** = use that collection; **`false`** = sync nothing of that
  type by default (a hard "none" that overrides the global default).
- Precedence per content type when syncing: an explicit `-c <name>` flag always
  wins; otherwise the device's own default; otherwise the global default;
  otherwise nothing.
- Per-device defaults apply to any device that resolves to a named
  `[devices.x]` entry — whether selected by name, path, or auto-detected by
  UUID. A raw, unconfigured device (e.g. `-d /Volumes/iPod` with no matching
  config entry) falls back to the global defaults, exactly as today.
- A `podkit device set` extension lets users set, clear, or null these
  defaults from the CLI without hand-editing TOML.
- `podkit device info` and `podkit device list` show the resolved default
  collections, with provenance: an explicitly-set value plain, an inherited
  global value bracketed, an explicit "none" shown as `none`, and nothing shown
  as `—`.

## User Stories

1. As a multi-device user, I want each device to remember its own default music
   collection, so that `podkit sync -d <device>` syncs the right music without
   me passing `-c` every time.
2. As a multi-device user, I want each device to remember its own default video
   collection, so that the right shows/movies sync to the right device.
3. As an owner of a small flash player, I want to mark a device as "no video by
   default", so that a global default video collection does not get pushed onto
   a device that should never receive video.
4. As a user, I want a device with no per-device default to keep inheriting the
   global default, so that I only configure the exceptions.
5. As a user, I want an explicit `-c <collection>` flag to override both the
   device default and the global default, so that I can do a one-off sync of a
   different collection without changing config.
6. As a user, I want `-c <collection>` to win even when the device is marked
   "no video", so that the explicit request is honored over the standing veto.
7. As a user syncing a device matched by UUID/auto-detect (not by name), I want
   its per-device defaults to still apply, so that defaulting does not depend on
   how I happened to select the device.
8. As a user syncing a raw, unconfigured volume by path, I want the global
   defaults to apply (not some other device's defaults), so that behavior is
   predictable and unchanged from today.
9. As a user, I want `podkit device set -d <device> --default-music <name>` to
   set a device's default music collection, so that I do not have to hand-edit
   the TOML.
10. As a user, I want `--default-video <name>` likewise for video.
11. As a user, I want `--no-default-music` / `--no-default-video` to record the
    explicit "none" state, so that I can declare a device should sync nothing of
    that type.
12. As a user, I want `--clear-default-music` / `--clear-default-video` to
    remove the per-device value, so that the device reverts to inheriting the
    global default.
13. As a user, I want `device set` to refuse with a clear error when I reference
    a collection that does not exist, so that I catch typos immediately and see
    the available collections.
14. As a user hand-editing TOML, I want a warning (not a hard failure) at load
    time when a per-device default references a missing collection, so that a
    config I am mid-editing still loads while telling me what is wrong.
15. As a user, I want a per-device default of `true` (a nonsensical value) to be
    rejected, so that only a name or `false` is accepted.
16. As a user, I want `podkit device info` to show each device's resolved
    default music and video collections, so that I can see at a glance what a
    sync would do.
17. As a user, I want `device info` to distinguish an explicitly-set default
    from an inherited global one (brackets) and from an explicit "none", so that
    I understand *why* the value is what it is.
18. As a user, I want `podkit device list` to include the resolved default
    collections, so that I can compare all my devices at once.
19. As a user, I want JSON output for `device list`/`device info` to include the
    resolved defaults and their provenance source, so that scripts can read
    them.
20. As a user running `sync --dry-run`, I want the plan to reflect per-device
    defaults, so that I can verify behavior before committing.
21. As a developer, I want a single, tested module that resolves the effective
    collections for a `(config, CLI args, device)` triple, so that the sync
    path, the display path, and the dry-run path cannot disagree.
22. As a developer, I want collection-default resolution to carry provenance
    (where each value came from), so that display and diagnostics read one
    source of truth instead of recomputing `isDefault` booleans.
23. As a developer, I want the settings cascades in the config resolver to use
    the shared cascade primitive, so that quality/audio/video/artwork stop
    duplicating hand-written ladders.
24. As a developer, I want the loader's repeated TOML scalar/enum parse blocks
    consolidated into a shared validator, so that adding a new field does not
    mean copy-pasting a 31st block.
25. As a developer, I want the default-reference validator to be one helper
    invoked per reference, so that adding per-device validation does not add
    more copy-pasted blocks.
26. As a maintainer, I want the existing global-defaults behavior and the
    by-path sync behavior to be unchanged, so that the consolidation is a safe
    refactor with no regression.

## Implementation Decisions

### New / changed types

- Introduce a named tri-state: `CollectionDefault = string | false`. Used for
  the per-device defaults and (typed onto, with `false` rejected at parse) the
  global defaults, so there is one shared shape.
- `DeviceConfig` gains a **nested** in-memory sub-shape:
  `defaults?: { music?: CollectionDefault; video?: CollectionDefault }`,
  mirroring the top-level `DefaultsConfig`. This makes the cascade code
  structurally symmetric (`device.defaults?.music` vs `config.defaults?.music`).
- **TOML surface stays flat**: users write `defaultMusic = "main"` /
  `defaultVideo = false` under `[devices.x]`. The loader normalizes these flat
  keys into the nested in-memory `defaults` shape. (Flat TOML keys were chosen
  to match the rest of `DeviceConfig`'s flat key style and the `device set`
  flag names; the nested in-memory shape is purely for resolver symmetry.)

### Deep module: effective-collection resolver

- Extract collection resolution out of the sync command into a dedicated,
  unit-tested resolver module. Proposed interface (signatures only):

  ```ts
  type CollectionSource = 'flag' | 'device' | 'global' | 'none';

  interface EffectiveCollection {
    name: string;
    type: 'music' | 'video';
    config: MusicCollectionConfig | VideoCollectionConfig;
    source: CollectionSource;          // provenance
  }

  interface ResolveCollectionsInput {
    config: PodkitConfig;
    flag?: string;                     // -c
    type?: 'music' | 'video';          // -t; undefined = both
    device?: { name: string; config: DeviceConfig };  // absent ⇒ global-only
  }

  function resolveEffectiveCollections(
    input: ResolveCollectionsInput
  ): { collections: EffectiveCollection[] };
  ```

- The optional `device` field is the seam that did not previously exist. When
  absent (raw/path/unresolved device) the resolver consults only the global
  cascade — this is the no-regression guarantee for by-path syncs.
- This module replaces the inline `resolveCollections` in the sync command and
  reconciles with the single-entity default plumbing in the `resolvers/`
  collection helpers (those become thin wrappers over it or are retired).

### Cascade primitive reuse

- The precedence `flag → device.default → global.default → none` is expressed
  through the shared `resolveChain` primitive from `@podkit/device-types`,
  **not** a new bespoke ladder.
- `false` ("none") must terminate the chain as a sticky none rather than fall
  through. Because `resolveChain` treats only `undefined` as "skip", model the
  `false` case with a short-circuit guard before the chain (the same idiom the
  resolver already uses for `artwork === false`). The shared primitive's
  contract is **not** changed.

### Sync call-site ordering fix (correctness)

- Move effective-collection resolution to **after** the target device
  (including path/UUID-matched config entries) is fully resolved, then pass the
  resolved device in. Today the inline resolver runs before the matched device
  is bound, which would cause per-device defaults to be silently ignored for
  devices not selected by literal name. This reordering is required for the
  feature to be correct, and is behavior-neutral for the global-only path.

### Settings-resolver consolidation (`config/resolve.ts`)

- Migrate the hand-written quality/audio/video/artwork cascades (both global
  and device variants) onto `resolveChain`, preserving every existing source
  label (`global-quality`, `device-quality`, `unsupported`, `unknown`, etc.)
  and the capability-gating order (the explicit-`false` bypass and the
  unsupported/unknown checks must keep their current precedence).
- Stop growing the parallel `ConfigSource` provenance vocabulary for the new
  feature: collection provenance uses its own small `CollectionSource`; the
  thin `ResolvedValue<T>` alias is demoted in favor of importing the canonical
  `Resolved<T, Source>` where practical.

### Loader consolidation

- Collapse the ~30 copy-pasted "type-check primitive → validate enum → throw
  context-tagged error → assign" TOML parse blocks into a shared scalar/enum
  parse helper, retrofitting existing call sites (using the established
  capability-fields parser as prior art).
- Collapse the three copy-pasted default-reference validation blocks into a
  single `validateRef(name, kind, registry)`-style helper, then drive
  per-device default validation through a loop over devices.
- Per-device default parsing accepts a **string** or **`false`**; a string is
  validated by reference (warn if missing); `false` skips reference validation;
  any other type (notably `true`) is rejected at parse.

### Write path: `podkit device set`

- Extend the existing `device set` command (which already follows the
  set / `--clear-X` / `--no-X` + option-source-filter pattern):
  - `--default-music <name>` / `--default-video <name>` — set a name.
  - `--no-default-music` / `--no-default-video` — record `false` (none).
  - `--clear-default-music` / `--clear-default-video` — remove the value
    (revert to inheriting the global default).
- The command **errors** at write time if a provided name does not reference an
  existing collection (consistent with how it already rejects bad `--quality`
  presets), listing the available collections.
- The defaults apply to all device types (collections are not device-type
  specific), so they are **not** placed behind the mass-storage-only option
  gate.
- The underlying `updateDevice` writer change is limited to widening its
  `updates` value type to include the two new keys (with `null` meaning
  "remove"); its generic write loop already handles arbitrary keys, so no new
  TOML-surgery routine is needed.

### Display

- `device info` and `device list` (text and JSON) render the resolved default
  collections through the existing provenance/`formatResolved` machinery:
  - explicit name → plain (e.g. `main`)
  - inherited from global → bracketed (e.g. `[shows]`)
  - explicit none (`false`) → `none`
  - nothing set and no global default → `—`
- JSON output extends (does not rename) existing source/provenance fields.

### Not a published-package change

- This is CLI-only (`podkit` ships as a Bun `--compile` binary, not npm), so no
  changeset is required.

## Testing Decisions

Good tests here exercise **external behavior** — the resolved outcome and its
provenance for a given config + CLI args + device — not the internal cascade
mechanics. The resolver's value is precisely that it can be tested in isolation
without spinning up a sync.

Modules to be tested:

1. **`resolveEffectiveCollections` (new resolver)** — the primary target.
   Cover the full precedence matrix: `flag` × `device-default` ×
   `global-default`, each over `{name, false, unset}`; `type` filtering
   (`-t music`/`-t video`/both); named device vs absent device (global-only);
   and the asserted `source` provenance on each returned collection. This logic
   was previously untested (buried inside the sync command); the extraction is
   what makes it testable.
2. **Loader parse + validation** — per-device `defaultMusic`/`defaultVideo`
   parsing (string accepted, `false` accepted, `true`/other rejected); the
   flat-TOML → nested-in-memory normalization; and `validateRef` warnings for
   missing string references (with `false` skipping). Prior art: existing loader
   parse/validation tests.
3. **`device set` write path** — `--default-music`/`--default-video` set,
   `--no-default-*` writing `false`, `--clear-default-*` removing the value, the
   write-time missing-collection error, and a round-trip through `updateDevice`.
   Prior art: existing `device set` and `writer` tests.
4. **Display rendering** — `device info` and `device list` rendering of the four
   provenance states (`name`, `[inherited]`, `none`, `—`) in text and JSON.
   Prior art: existing info/list render tests.
5. **A light end-to-end test** — one happy-path e2e covering a sync where a
   named device's per-device default drives the synced collection, to pin the
   wired behavior end to end. Prior art: existing config/sync e2e tests.

For the consolidation refactors (settings-resolver `resolveChain` migration and
loader parse dedup), the discipline is **behavior preservation under the
existing test suites** — the current `resolve` tests pin source labels and
capability-gating order, and the `writer`/e2e config tests pin output; all must
stay green with no assertion changes attributable to the refactor.

## Out of Scope

- Multiple default collections per type per device (the design is one music +
  one video default per device; a list-per-device was considered and rejected
  because it cannot cleanly express the "none" state).
- Per-device default *device* selection or any change to the global
  `defaults.device` semantics.
- A nested-TOML surface for per-device defaults (`[devices.x.defaults]` table);
  the TOML keys stay flat. Revisiting this for symmetry with the global
  `[defaults]` block is a possible future change.
- Changing the canonical `Resolved` / `resolveChain` primitive in
  `@podkit/device-types` (reused as-is; only its *usage* expands).
- Collection-source-specific behavior (e.g. Subsonic playlist nuances) beyond
  what default-name resolution already entails.

## Further Notes

- The defining insight from design: **this feature is mostly a refactor.** Most
  of the work is extracting the inline collection resolver into a
  provenance-carrying, device-aware module and fixing its call-site ordering;
  the user-facing addition (a small tri-state type plus a cascade layer and CLI
  flags) is comparatively thin. The guiding principle is to finish the
  `resolveChain` migration the codebase already started rather than add a fourth
  parallel resolution path.
- Recommended incremental, independently-shippable commit sequence:
  1. Migrate `config/resolve.ts` quality/audio/video/artwork ladders to
     `resolveChain` (behavior-neutral; gated by existing resolve tests).
  2. Extract `resolveEffectiveCollections` (global-only, returning `source`);
     replace the inline sync resolver; add unit tests.
  3. Fix the sync call-site ordering (resolve device first, then collections),
     threading the resolved device — still global-only cascade, behavior
     unchanged.
  4. Add the types + flat→nested parse + consolidated `validateRef`/scalar parse
     helpers (retrofitting existing copies).
  5. Wire the per-device cascade into the resolver (first new behavior).
  6. Extend the `device set` write path (flags + write-time error).
  7. Add display rendering (`device info` + `device list`, text + JSON).
  8. Add the light e2e.
- Highest-risk step is the settings-resolver migration (50+ tests pin exact
  source labels and capability-gating order); do it first, behind the green
  suite, isolated from the feature commits.
- Single biggest behavioral risk is accidentally applying per-device defaults to
  raw by-path/unconfigured devices; the optional `device` input on the resolver
  is the enforcement point, and the call-site reordering is what lets
  UUID-matched named devices still receive their defaults.
