---
id: TASK-436.03
title: Extract resolveEffectiveCollections (global-only) from sync command
status: Done
assignee: []
created_date: '2026-06-24 15:20'
updated_date: '2026-06-24 16:12'
labels:
  - sync
  - config
  - refactor
dependencies: []
parent_task_id: TASK-436
ordinal: 184000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Behavior-neutral refactor + new tested deep module.

Extract the inline `resolveCollections` logic out of the sync command into a dedicated resolver module: `resolveEffectiveCollections({config, flag?, type?, device?}) → { collections: EffectiveCollection[] }`, where each returned collection carries a `source` provenance label (`flag`/`global`/`none`; `device` added in a later slice). For this slice the `device` input is accepted but unused — resolution stays global-only, exactly matching today's behavior. Replace the inline sync resolver with a call to the module, and reconcile with the single-entity default plumbing in `resolvers/collection.ts` (make those thin wrappers or retire them — no duplicate cascade).

This module was previously untested (logic buried in the 2000+ line sync command); add unit tests for the extracted behavior.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user stories 21, 22.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 resolveEffectiveCollections exists as a standalone resolver module returning collections with a source provenance field
- [x] #2 sync command uses the module instead of an inline resolver; the prior inline resolveCollections is removed
- [x] #3 Duplicate default-name plumbing in resolvers/collection.ts is reconciled (wrapped or retired) — only one cascade implementation remains
- [x] #4 Unit tests cover the extracted global-only behavior including provenance
- [x] #5 Overall sync behavior is unchanged (global-only resolution)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Module as built

New file: `packages/podkit-cli/src/resolvers/effective-collections.ts`, exported via `resolvers/index.ts`.

```ts
export type CollectionSource = 'flag' | 'global' | 'device' | 'none';
export interface EffectiveCollection {
  name: string;
  type: 'music' | 'video';            // CollectionType from resolvers/types
  config: MusicCollectionConfig | VideoCollectionConfig;
  source: CollectionSource;
}
export interface ResolveCollectionsInput {
  config: PodkitConfig;
  flag?: string;
  type?: 'music' | 'video';
  device?: { name: string; config: DeviceConfig };  // accepted, UNUSED this slice
}
export function resolveEffectiveCollections(input: ResolveCollectionsInput): {
  collections: EffectiveCollection[];
};
```

`source` is `'flag'` when `flag` is set, else `'global'`. `'device'` and `'none'` are in the union but NOT emitted yet (reserved for the per-device layer). Empty result on flag-matches-nothing / no-default — no throw (matches old inline behavior; sync renders the not-found/no-collections message downstream from the empty array).

## Duplication reconciled (delegation, not retirement)

The new module does NOT reimplement the cascade. Its per-type lookup delegates to `resolveMusicCollection`/`resolveVideoCollection` (resolvers/collection.ts), which already delegate to `resolveNamedEntity` (resolvers/core.ts) — the single explicit-name-else-default primitive. So the cascade now has exactly one implementation (`resolveNamedEntity`), consumed by both the `collection` command and the new effective resolver. The inline `resolveCollections` in sync.ts (~50 lines, error-swallowing reimplementation) is deleted.

Behavior equivalence verified per-branch: old inline pushed music/video only when `config.music?.[name]` / default existed; `resolveMusicCollection(config, flag|undefined)` returns `{success:true}` in exactly those cases and `{success:false}` otherwise — I push only on `success`, so the resolved set is identical for every (flag, type, config). Both-namespace flag still yields two entries; type filter still gates each branch; missing/nonexistent default still yields empty.

`resolvers/collection.ts` was left intact — `resolveMusicCollection`/`resolveVideoCollection`/`getAllCollections`/`findCollectionByName` are still used by the `collection` command and were not changed (no caller churn there).

## sync.ts changes
- Removed inline `resolveCollections` function.
- Call site now: `resolveEffectiveCollections({ config, flag: options.collection, type: syncType, device: resolvedDevice })`. `resolvedDevice` is `ResolvedDevice = {name, config: DeviceConfig}` (or undefined) — already matches the `device` field shape, so the call site is stable for the device-cascade task.
- `EffectiveCollection` is a structural superset of sync.ts's exported `ResolvedCollection` (`{name,type,config}`); the extra `source` is additive, so all presenters (sync/music/video/sync-collection-phase) that consume `ResolvedCollection` keep working untouched.
- Dropped the now-unused `PodkitConfig` import from sync.ts.

## Tests
New `resolvers/effective-collections.test.ts` (14 tests): flag→music, flag→video, flag→both, flag-matches-nothing→empty; type filter (music/video/suppress-cross-type); global-defaults fallback (both, type-filtered, default-points-at-ghost→empty, no-default→empty, empty-config→empty); device-ignored (flag + global, asserting source stays 'global' not 'device'); `source` label asserted on every result.

## For the downstream device-cascade task
- Wire the per-device layer INSIDE `resolveEffectiveCollections` using `input.device` (currently read into a comment only). When a collection is chosen from a device default, set `source: 'device'`; when a device explicitly opts out of a default, that's the `'none'` case.
- The provenance currently computed as a single `const source = flag ? 'flag' : 'global'` will need to move per-branch once a device default can override one type but not the other.
- Call site already passes `device: resolvedDevice` — no sync.ts change needed to start consuming it.

## Gates (all green)
- typecheck (podkit): pass
- oxlint + CLI stderr-writes convention check: 0 warnings/errors
- `bun run build`: 20/20 tasks succeeded
- `bun run test:unit --filter podkit`: 1833 pass / 0 fail (incl. new 14); no sync/collection regressions
<!-- SECTION:NOTES:END -->
