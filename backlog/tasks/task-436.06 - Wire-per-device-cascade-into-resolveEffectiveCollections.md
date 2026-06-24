---
id: TASK-436.06
title: Wire per-device cascade into resolveEffectiveCollections
status: Done
assignee: []
created_date: '2026-06-24 15:20'
updated_date: '2026-06-24 16:49'
labels:
  - sync
  - collections
dependencies:
  - TASK-436.04
  - TASK-436.05
parent_task_id: TASK-436
ordinal: 187000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
First slice with new user-facing behavior.

Wire the per-device defaults into `resolveEffectiveCollections`: when a named device is present, consult `device.defaults.{music,video}` between the `-c` flag and the global default. Precedence per content type: `flag > device default > global default > none`. Model the cascade on `resolveChain`, with `false` ("none") short-circuiting as a sticky terminal-none via a guard before the chain (the same idiom the resolver already uses for `artwork === false`) — do not change the shared `resolveChain` contract. The `source` provenance now includes `device`.

A device without a config match still passes no device context (global-only); an explicit `-c` flag wins even over a device `false`.

Part of epic TASK-436. See PRD doc-050.

Context: PRD user stories 1, 2, 3, 4, 5, 6, 7, 8, 20, 26.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 resolveEffectiveCollections consults device.defaults.{music,video} for named devices with precedence flag > device > global > none
- [x] #2 false on a device resolves to terminal 'none' (overrides global) without altering the shared resolveChain contract
- [x] #3 An explicit -c flag overrides a device 'false'
- [x] #4 Returned collections carry the correct source provenance (flag/device/global/none)
- [x] #5 Unit tests cover the full precedence matrix: flag × device × global over {name, false, unset}, type filtering, and named-vs-absent device
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Wired the per-device cascade into `resolveEffectiveCollections` (packages/podkit-cli/src/resolvers/effective-collections.ts). Only this module + its test changed.

Structure: two top-level branches.

FLAG BRANCH (`flag !== undefined`) — wholesale override, byte-identical to prior behaviour. Resolves the explicit name via resolveMusicCollection/resolveVideoCollection per requested namespace; every match carries `source: 'flag'`. Device and global defaults are NOT consulted here — `sync -c shows` over a device with `defaultVideo = false` still syncs "shows". Early-returns before any device logic.

NO-FLAG BRANCH — per-type cascade via a small explicit helper `resolveType(config, type, deviceDefault, resolve)`, called once for music and once for video (respecting the `-t` filter). `deviceDefault = device?.config.defaults?.[type]` (a `CollectionDefault | undefined = string | false | undefined`). Logic:
  - `deviceDefault === false`  → return undefined BEFORE any lookup (explicit terminal 'none'; suppresses the global default). This is the `false` guard — placed ahead of the name cascade exactly like the `artwork === false` idiom; resolveChain is untouched.
  - `typeof deviceDefault === 'string'` → `resolve(config, deviceDefault)`; success → emit with `source: 'device'`; miss → undefined (NO fallback to the global default — the device made an explicit choice, mirroring ghost-default empty behaviour).
  - `deviceDefault === undefined` → `resolve(config)` (global default lookup, as before); success → `source: 'global'`; miss → undefined.
Nothing is emitted for the 'none' case, so `'none'` never lands on an EffectiveCollection (documented as the conceptual provenance a display layer reports).

Decision on resolveChain: did NOT use it. The device-string-missing case must TERMINATE rather than fall through to the global-name layer, which is the opposite of resolveChain's fall-through semantics — a name→name chain would wrongly fall back to global. An explicit per-type function reads clearer and keeps the shared primitive (in @podkit/device-types, multiple callers) unforked. Name lookup is still delegated to resolveMusicCollection/resolveVideoCollection → resolveNamedEntity (single lookup implementation).

The previous single `const source = flag ? 'flag' : 'global'` was removed; provenance is now per-branch: 'flag' in the flag branch, 'device'/'global' per type in resolveType.

Regression guards verified: flag branch output unchanged; `device === undefined` (or a device with no `defaults` key) → `deviceDefaults?.music/video` is undefined → pure global path, byte-identical.

Tests (effective-collections.test.ts): replaced the stale "device input is ignored" block with the full matrix. 24 tests, all pass. Coverage added: device string exists (overrides differing global, source 'device'); device string missing (empty, no global fallback); device false (empty even with global default present); device default absent (falls to global); independent types (music device + video global; music false + video device); type-filter × device defaults; flag wins over device false (the grilled `-c shows` / `defaultVideo=false` case, source 'flag'); flag ignores a differing device string default; device-with-no-defaults regression guard identical to global-only.

Gates (all green): typecheck `bunx turbo run typecheck --filter=podkit` ✓; oxlint on both files → 0 warnings/0 errors; `bun run build` → 20/20 tasks ✓; `bun test src/resolvers/effective-collections.test.ts` → 24 pass / 0 fail; full `src/resolvers/` suite → 84 pass / 0 fail.

Reviewed (Sonnet): no blocking. Confirmed false-suppresses-global, missing-device-name-no-fallback, flag-wholesale unchanged, device===undefined byte-identical to global-only, resolveChain unforked, type independence. Should-fix applied by team lead: flag-branch guard changed from `flag !== undefined` to truthy `if (flag)` so an empty-string flag is treated as no-flag (restores original inline behavior; closes a latent empty-string provenance trap). Added 2 test cells: device-string-equals-global-default (still source:device) and both-types-false→empty. Resolver suite now 26 tests.

Note for TASK-436.08 (display): resolveEffectiveCollections deliberately drops the 'none' (device false) and missing-name cases — it only emits collections that will sync. Display needs its OWN per-device classifier reading deviceConfig.defaults?.[type]: false→'none', string+exists→device, string+missing→device(missing), undefined→global. Reuse resolveMusicCollection/resolveVideoCollection for the existence check.
<!-- SECTION:NOTES:END -->
