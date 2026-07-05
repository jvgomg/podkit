---
id: TASK-453.03
title: 'Config + CLI + env: [bitrate].reduce/tolerance replaces the sync policy'
status: Done
assignee: []
created_date: '2026-06-30 16:51'
updated_date: '2026-07-05 14:10'
labels:
  - config
  - cli
  - quality
dependencies: []
references:
  - adr/adr-023-lossy-reduction-down-only.md
  - >-
    backlog/docs/doc-055 -
    PRD-Lossy-Reduction-Redesign-—-Down-Only-Transfer-Mode-Defaulted-Axis.md
parent_task_id: TASK-453
priority: high
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 3. Prereq: slice 1 (resolveReductionAxis). The config/CLI/env surface swap. Clean break, no migration.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 [bitrate] schema gains reduce (auto|always|never, default auto) + tolerance (number, default 0.25); sync/toleranceUp/toleranceDown removed; loader validates the new shape and rejects the removed keys with a clear error
- [x] #2 resolve.ts resolves reduce (device→global→auto) and tolerance; computes the axis via resolveReductionAxis(reduce, transferMode); ResolvedMusicConfig carries axis + tolerance (bitrateSync removed)
- [x] #3 CLI: --bitrate-reduce <auto|always|never> and --bitrate-tolerance <fraction> replace --bitrate-sync; decision-source attribution updated
- [x] #4 env: PODKIT_BITRATE_REDUCE / PODKIT_BITRATE_TOLERANCE replace PODKIT_BITRATE_SYNC
- [x] #5 Legacy flat bitrateTolerance removed for audio (verified video's detectBitratePresetMismatch no longer reads it)
- [x] #6 loader.test.ts / resolve.test.ts / sync.test.ts updated (new flags thread through; removed keys gone; default auto→mode lean; tolerance default 0.25)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Done. Swapped the deleted `[bitrate].sync` policy + flat `bitrateTolerance` for `[bitrate].reduce` + `[bitrate].tolerance`, and removed the four temporary shims (S1-S4).

Core (closes S3 + S4 — the structural heart):
- `ResolvedMusicConfig`: removed orphaned `bitrateSync`; added `reductionAxis: 'convert'|'preserve'` + `reductionTolerance: number`. `resolveMusicConfig` now computes both ONCE: `reductionAxis = resolveReductionAxis(config.reduce ?? 'auto', transferMode)`, `reductionTolerance = config.tolerance ?? 0.25`.
- `MusicSyncConfig` input: removed `bitrateTolerance`, `bitrateSync`, `toleranceUp`, `toleranceDown`; added `reduce?: ReductionMode` + `tolerance?: number`.
- `classifier.ts`: deleted the `LOSSY_REDUCTION_TOLERANCE` const and the `resolveReductionAxis('auto', transferMode)` call; `ClassifierContext` now carries `reductionAxis` + `reductionTolerance`, read straight off the ctx in `resolveLossyAction`; `classifierFromConfig` maps them.
- `handler.ts` `qualityTargetFromConfig`: `axis: config.reductionAxis` (was `resolveReductionAxis('auto', ...)`); removed the import + the "two sites" warning comment. Re-sync device-bound still passes `tolerance: 0` to the seam (unchanged).
- Net: exactly ONE production `resolveReductionAxis(` call site — `resolveMusicConfig` (packages/podkit-core/src/sync/music/config.ts).

CLI (closes S1 + S2):
- types.ts: deleted `BITRATE_SYNC_MODES`/`BitrateSyncMode`; added `REDUCE_MODES=['auto','always','never']`/`ReduceMode`. `BitrateConfig`: `sync`/`toleranceUp`/`toleranceDown` → `reduce`/`tolerance`. Removed flat audio `bitrateTolerance` from `PodkitConfig`, `DeviceConfig`, `ConfigFileContent`, `ConfigFileDevice`. `ConfigFileBitrate` → `reduce`/`tolerance`.
- loader.ts: `parseBitrateBlock` validates `reduce` (REDUCE_MODES) + `tolerance` (number ≥ 0); REJECTS removed `sync`/`toleranceUp`/`toleranceDown` keys with a clear message naming the replacement. Removed flat audio `bitrateTolerance` parsing (top-level + per-device), and its deep-merge. Removed now-unused `parseNumberInRange` helper (drive-by).
- resolve.ts: `ResolvedDeviceSettings` drops `bitrateSync`/`toleranceUp`/`toleranceDown`/`bitrateTolerance`; adds `reduce: ResolvedValue<ReduceMode>` (device→global→'auto') + `tolerance: ResolvedValue<number>` (device→global→0.25).
- sync.ts: deleted `--bitrate-sync`; added `--bitrate-reduce <mode>` (.choices) + `--bitrate-tolerance <fraction>` (argParser parseFloat, ≥0). Threading: `effectiveBitrateSync`/`effectiveBitrateTolerance`/`effectiveToleranceUp/Down` → `effectiveReduce`/`effectiveTolerance`, CLI flags overlay the resolved chain.
- sync-presenter.ts MusicContentConfig + music-presenter.ts createMusicHandler call updated to pass `reduce`/`tolerance`.
- index.ts: dropped sync-mode exports, added REDUCE_MODES/ReduceMode.

Env (S1): defaults.ts ENV_KEYS adds `bitrateReduce: PODKIT_BITRATE_REDUCE`; the existing `PODKIT_BITRATE_TOLERANCE` now feeds `[bitrate].tolerance` (≥0). There was never a PODKIT_BITRATE_SYNC key.

Video tolerance left intact: confirmed `detectBitratePresetMismatch` only takes its own `DEFAULT_VBR_TOLERANCE` (0.3) default — video handler calls it 2-arg, never reading the removed flat audio `bitrateTolerance`.

Tests updated: core classifier.test.ts (ctx fixture derives axis via resolveReductionAxis; classifierFromConfig mocks carry reductionAxis/tolerance), config.test.ts (new axis/tolerance describe block: auto+optimized→convert, auto+fast/portable→preserve, always→convert, never→preserve, tolerance default 0.25 / 0 honoured). CLI loader.test.ts (reduce/tolerance parse, removed-key rejection, env), resolve.test.ts (cascade + defaults), sync.test.ts (new flags + --bitrate-sync gone), sync-aggregation.test.ts + info-render.test.ts mocks.

Gates: bun run test:unit --filter @podkit/core (3365 pass) + --filter podkit (1920 pass) green; bunx turbo run typecheck lint build = 42/42 successful (demo transitively builds the CLI — clean). Grep gate: only resolveReductionAxis( production call site is resolveMusicConfig; remaining grep hits are the rejection logic/comments + tests + the pre-existing demo mock-core `resolveReductionAxis` definition (untouched, mirrors core's still-exported function).

Deviations: (1) classifier.test.ts makeContext calls resolveReductionAxis to derive the default axis from transferMode — keeps the many transferMode-based fixtures meaningful rather than reimplementing the seam inline. (2) demo mock-core's resolveReductionAxis definition left as-is (pre-existing, out of scope). Nothing coupled to slices 4/5 was touched; the re-sync device-bound tolerance:0 and report-only surfacing were left exactly as the earlier slices had them.
<!-- SECTION:NOTES:END -->
