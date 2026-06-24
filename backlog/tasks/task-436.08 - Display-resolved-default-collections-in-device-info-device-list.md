---
id: TASK-436.08
title: Display resolved default collections in device info + device list
status: Done
assignee: []
created_date: '2026-06-24 15:21'
updated_date: '2026-06-24 17:05'
labels:
  - cli
  - collections
dependencies:
  - TASK-436.06
parent_task_id: TASK-436
ordinal: 189000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surface the resolved per-device default collections in `podkit device info` and `podkit device list` (text and JSON), rendered through the existing provenance/`formatResolved` machinery.

Provenance rendering per content type:
- explicit name → plain (e.g. `main`)
- inherited from the global default → bracketed (e.g. `[shows]`)
- explicit none (`false`) → `none`
- nothing set and no global default → `—`

JSON output extends (does not rename) existing source/provenance fields, exposing the resolved default collection and its `source`.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user stories 16, 17, 18, 19.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 device info shows resolved default music + video collections with provenance (name / [inherited] / none / —)
- [x] #2 device list shows the resolved default collections
- [x] #3 JSON output for both includes the resolved default collection and its source, extending (not renaming) existing fields
- [x] #4 Unit tests cover rendering of all four provenance states in text and JSON
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added a separate display classifier rather than reading provenance from `resolveEffectiveCollections` (which drops the false/missing cases). Lookup is reused, not reimplemented.

Classifier + formatter — `packages/podkit-cli/src/resolvers/default-collection-state.ts`:
- `type DefaultCollectionState = { kind: 'name'; name; source: 'device' } | { kind: 'missing'; name; source: 'device' } | { kind: 'inherited'; name; source: 'global' } | { kind: 'none'; source: 'device' } | { kind: 'empty' }`.
- `classifyDeviceDefault(config, deviceConfig | undefined, type: 'music' | 'video')` — mirrors `resolveType`'s precedence: device `false` → none; string + exists (via `resolveMusicCollection`/`resolveVideoCollection`) → name; string + miss → missing (no global fallback); undefined → global default exists → inherited, else (unset or ghost) → empty.
- `formatDefaultCollection(state)` → `name` / `[name]` (inherited) / `none` / `name (not found)` (missing) / `—` (empty).

JSON contract — `commands/device/output-types.ts`:
- New `DefaultCollectionOutput { kind; name?; source? }`. Added `defaultMusic` + `defaultVideo` of that type to both `DeviceListSuccess.devices[]` and `DeviceInfoSuccess.settings`. Existing fields untouched (additive only).

Render wiring:
- `commands/device/info-render.ts`: added `toDefaultCollectionOutput(state)` (state→JSON mapper) and `printDefaultCollectionRows(out, music, video)` (Summary-style rows `Default music:` / `Default video:`, bracket-for-inherited baked into the formatter; no `from <provenance>` tail since these are config-state, not `Resolved<T>` cascade values).
- `commands/device/info.ts`: classify both types once, feed JSON `settings.defaultMusic/defaultVideo` and the text rows after the Settings zone. (sync.ts NOT touched.)
- `commands/device/list.ts`: classify per device (keyed by name), add `defaultMusic`/`defaultVideo` to JSON rows, add `DEF MUSIC` + `DEF VIDEO` text columns (width fits widest rendered cell), extended the legend with `— = unset`.

Tests added (all five states, both types, text + JSON):
- `resolvers/default-collection-state.test.ts` — classifier (name/missing/inherited/none/empty for music + video, ghost-global, undefined device, independence) + formatter mapping.
- `commands/device/info-render.test.ts` — `printDefaultCollectionRows` (plain / [inherited] / none / — / not-found) + `toDefaultCollectionOutput` mapping.
- `commands/device-list.unit.test.ts` — JSON + text provenance across two devices (device name, opt-out, inherited global, missing name).
- `commands/device-info.behavior.test.ts` — JSON `settings.defaultMusic/defaultVideo` + text rows.

Gates: typecheck clean; oxlint 0 warnings/0 errors on the 9 changed files; `bun run build` (bundle + types) OK; full `bun run test:unit` for podkit = 1902 pass / 0 fail.

Implemented via a new classifier `classifyDeviceDefault(config, deviceConfig, type) -> DefaultCollectionState` + `formatDefaultCollection` in resolvers/default-collection-state.ts (reuses resolveMusicCollection/resolveVideoCollection for existence; resolveEffectiveCollections untouched). Five states: name / missing / inherited / none / empty; formatter maps to `main` / `[shows]` / `none` / `<name> (not found)` / `—`. Wired into device info (info-render.ts rows + info.ts) and device list (DEF MUSIC/DEF VIDEO columns + legend), text + JSON. output-types.ts extended additively (no renames). Reviewed (Sonnet): no blocking. Confirmed five-state precedence mirrors the .06 cascade, false→none suppression exact (even with a global default), ghost-global→empty (no crash), JSON additive, lookup reused. Team-lead follow-ups: exported classifier+formatter+type from resolvers/index.ts (barrel hygiene). Accepted/skipped (cleanup-tier): the always-true guard in info.ts:709 (provides type-narrowing, harmless) and an inherited/empty case in the device-info BEHAVIOR test (all five states already pinned by classifier + info-render unit tests; behavior test covers name+none, proving wiring). Tests: default-collection-state.test.ts (5 states × music/video + formatter), info-render + device-info.behavior + device-list. Integrated gate: typecheck/lint clean, 1902 podkit unit pass.
<!-- SECTION:NOTES:END -->
