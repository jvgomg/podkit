---
id: TASK-436.05
title: 'Add CollectionDefault type + per-device defaults schema, parse, validation'
status: Done
assignee: []
created_date: '2026-06-24 15:20'
updated_date: '2026-06-24 16:37'
labels:
  - config
  - collections
dependencies:
  - TASK-436.02
  - TASK-436.03
modified_files:
  - packages/podkit-cli/src/config/types.ts
  - packages/podkit-cli/src/config/loader.ts
  - packages/podkit-cli/src/config/loader.test.ts
parent_task_id: TASK-436
ordinal: 186000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add the types and config-loading plumbing for per-device defaults, with no resolver wiring yet (no new sync behavior).

- Introduce `CollectionDefault = string | false`.
- Add a nested in-memory `DeviceConfig.defaults?: { music?: CollectionDefault; video?: CollectionDefault }`, mirroring the top-level `DefaultsConfig`.
- TOML surface stays flat: parse `defaultMusic` / `defaultVideo` keys under `[devices.x]` and normalize them into the nested in-memory shape. Accept a string or `false`; reject any other type (notably `true`).
- Drive per-device default reference validation through the shared `validateRef` helper (from 436.02): warn on a string referencing a missing collection; `false` skips validation.

This slice ships only types + parse + validation; the cascade is not yet consulted at sync time.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user stories 14, 15.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CollectionDefault type exists and DeviceConfig carries a nested defaults?.{music,video} shape
- [x] #2 Flat defaultMusic/defaultVideo TOML keys parse and normalize into the nested in-memory shape
- [x] #3 A string or false is accepted; true (and other non-string-non-false values) is rejected at parse
- [x] #4 Per-device default string refs are validated via the shared validateRef helper (warn on missing; false skips)
- [x] #5 Unit tests cover parse tri-state, normalization, and validation warnings
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Types (packages/podkit-cli/src/config/types.ts):
- Added `export type CollectionDefault = string | false;` (tri-state: name | false=explicit-none | undefined=inherit global).
- Added nested in-memory shape to DeviceConfig: `defaults?: { music?: CollectionDefault; video?: CollectionDefault }` (JSDoc + flat-TOML example).
- Added raw flat TOML fields to ConfigFileDevice: `defaultMusic?: unknown; defaultVideo?: unknown` (typed unknown so the loader validates and rejects bad types, matching the `unsupported` field convention).

Parse/normalize (loader.ts):
- New dedicated helper `parseCollectionDefault({ raw, field, context, assign })` next to the other shared scalar parse helpers. Accept rules:
  * string  -> assign(string)
  * false   -> assign(false)  (preserved verbatim, NOT coerced to undefined)
  * undefined -> no-op (skip)
  * everything else (true, number, array, inline table) -> throws: `Invalid ${field} value in ${context}. Expected a collection name (string) or false.`
  Note `true` throws by design (no "the default" to enable).
- In parseDevices per-device block (after manufacturer/productName): parse both flat keys into locals, then create `device.defaults = {}` only if at least one of the two is non-undefined, assigning each present key. `false` flows through intact.

Validation (loader.ts validateDefaultReferences):
- Kept the existing global `defaults` block (now guarded by `if (defaults)` instead of early-return so per-device validation still runs when [defaults] is absent).
- Added a `for...of` over `config.devices`: for each device with `defaults`, if `defaults.music` is a STRING call shared `validateRef({ value, label: 'devices.${name}.defaultMusic', kind: 'music collection', availableLabel: 'collections', registry: music })`; same for video (`kind: 'video collection'`, registry: video). `false`/absent skip validation. validateRef is non-throwing (advisory warning only). No new validation block written — reused validateRef.

Tests (loader.test.ts, new `per-device default collections` describe under `defaults`): 9 cases, all pass.
- defaultMusic="main" -> defaults={music:'main'}, no warnings
- defaultVideo=false -> defaults.video===false
- both keys -> defaults={music:'main',video:false}
- neither key -> defaults undefined
- defaultMusic=true -> throws (context-tagged message)
- defaultMusic=42 -> throws
- defaultVideo=[array] -> throws
- defaultMusic="ghost" (no [music.ghost]) -> loads, value preserved, emits validateRef warning mentioning devices.terapod.defaultMusic + "references a non-existent music collection"
- defaultVideo=false with no video collections -> NO warning

Downstream (TASK-436.06 cascade) reads: `deviceConfig.defaults?.music` and `deviceConfig.defaults?.video`, each of type `CollectionDefault | undefined` (= string | false | undefined). Semantics: string=that named collection; false=sync none of that type; undefined=inherit global DefaultsConfig.

NOT done (out of scope per slice): no resolveEffectiveCollections / config/resolve.ts / sync wiring; TOML surface left flat.

Gates: typecheck (tsc --noEmit) clean; oxlint 0 warnings/0 errors on the 3 changed files; `bun run build` (bundle + build:types) ok; loader.test.ts 255 pass / 0 fail (9 new).

Reviewed (Sonnet): no blocking. Confirmed false-preservation end-to-end (defaultMusic/Video=false → defaults.x===false, not coerced), true/number/array throw with context tag, defaults object created only when a key is present, and the validateDefaultReferences guard change is safe (global checks still guarded by `if (defaults)`, per-device loop guarded by `if (devices)`, no crash when either absent). Two should-fix test-symmetry gaps added by the team lead: defaultMusic=false in isolation, and defaultVideo string ghost-ref warning. Loader suite now 257 pass.
<!-- SECTION:NOTES:END -->
