---
id: TASK-345
title: Refactor doctor.ts + device/add.ts via shared primitives (no LoC target)
status: Done
assignee: []
created_date: '2026-05-17 10:54'
updated_date: '2026-06-11 21:13'
labels:
  - tech-debt
  - refactor
  - cli
  - core
dependencies: []
references:
  - backlog/tasks/task-343 - m-18-follow-up-tech-debt-cleanup-proposals.md
  - packages/podkit-cli/src/commands/doctor.ts
  - packages/podkit-cli/src/commands/device/add.ts
  - packages/podkit-cli/src/commands/device/scan.ts
  - packages/podkit-cli/src/commands/device/device-scan-render.ts
priority: medium
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Spawned from TASK-343 item 9. Original "split-by-line-count" framing rejected; this is a primitives-first refactor.

## Problem

Two CLI command files mix command-line parsing, business logic, rendering, and JSON output, with heavy duplication across their internal branches:

- `packages/podkit-cli/src/commands/doctor.ts` — 1861 LoC (was 1290 when TASK-343 was filed; growing)
- `packages/podkit-cli/src/commands/device/add.ts` — 1379 LoC

Pre-existing primitives are used inconsistently (e.g. iPod doctor path inlines its own grouped-check rendering even though `printGroupedChecks` exists; mass-storage and system-only doctor paths reinvent partial copies of `collectReadinessIssues` / `printIssues` / summary-line emission). Some primitives also duplicate cross-file (`resolveMassStorageContentPaths` in doctor mirrors content-path resolution in `open-device.ts`).

The CLI also carries some semantics that belong in `@podkit/core` so other apps (web UI, future GUI) can reuse them — specifically, refusing repairs on cascade-unsupported devices.

## Goals

1. Consolidate duplication via small, named primitives.
2. Push **only true semantics** into `@podkit/core` (refusal policy on unsupported devices). Keep user-facing copy + argv shapes in the CLI — core stays a structured-data interface.
3. Use existing primitives where they exist; add new ones where they obviously want to exist; don't invent abstractions speculatively.
4. Improve test coverage — close known gaps (orphan-summary, per-check failure-copy routing, repair refusal contract).

Explicitly NOT a goal: any line-count target. Files end up the size they end up.

## Phase A — `@podkit/core` surface (minimal)

**A1.** Per-check failure copy stays in CLI (decision after opus critique: putting `formatFailureDetails(): string[]` in core leaks presentation into the data layer). Core's contract is structured `details: Record<string, unknown>`; CLI owns the words via `commands/doctor-failure-copy.ts` as a `Record<CheckId, (details) => string[]>` registry.

**A2.** Move cascade-unsupported repair refusal (currently `doctor.ts:1273-1300`) into core's repair dispatch. Dispatcher returns a typed `{ status: 'refused', reason: ReadinessUnsupportedReason } | { status: 'ok', ... } | { status: 'failed', ... }` — does not throw on refusal. CLI controls exit code + render.

Bonus: `assessIpodIdentity` currently called twice (`doctor.ts:684` in `runDoctorAction` + `doctor.ts:1274` in `runRepair`). Resolve once and thread through.

**A3.** Consolidate `resolveMassStorageContentPaths` inside the CLI (no new core export). `doctor.ts:1564` and `open-device.ts:350` are byte-equivalent. New helper `commands/resolvers/content-paths.ts → resolveDeviceContentPaths(deviceConfig, deviceDefaults)` wraps the existing `normalizeContentPaths` from core with the override cascade.

**A4.** Dropped. `repair.requirements` already gives the CLI what it needs to compose `--repair <id> [-c <col>]`. Don't bake CLI argv shape into core's API surface.

## Phase B — CLI render modules (`*-render.ts`, matching `device-scan-render.ts` precedent)

Naming note: existing `MusicPresenter` / `VideoPresenter` / `sync-presenter.ts` are class-based polymorphic `ContentTypePresenter` orchestrators. Doctor's render isn't that — use `*-render.ts` to avoid collision.

**B1. `commands/doctor-render.ts`** absorbs:
- `renderDoctorIpod(out, report, readinessResult, deviceArg)` from inline `doctor.ts:875-1052`
- `renderDoctorMassStorage(out, report, label, deviceArg)` from inline `doctor.ts:590-639`
- `renderDoctorSystemOnly(out, report)` from `runSystemOnlyDoctor` inline `doctor.ts:1109-1149`
- `printGroupedChecks(out, checks, { inlineDetails? })` — extracted with hook so iPod path uses it too
- `formatCheckRow(check): string` — lowest-level row primitive. 3 copies today (`doctor.ts:884-887`, `918-919`, inside `printGroupedChecks` 1730-1750)
- `printOrphanSummary`, `emitOrphanCsv`
- `printSummaryLine(out, healthy, issueCount)` — 3 callers (mass-storage 606-614, iPod 928-946, system-only 1124-1132) → 1
- `collectCheckIssues(checks, { failureCopy, deviceArg, requirements }): ReadinessIssue[]`

**B2. `commands/device/add-render.ts`** — `printDeviceAddSuccess(...)` for the `✓ ...` block + `SYSINFO_MISSING_PROMPT_LINES`.

**B3. `commands/doctor-failure-copy.ts`** — per-check copy map (see A1). Replaces the inline `if (check.id === ...) else if` chain at `doctor.ts:977-1016`.

Sync.ts render — out of scope. See TASK-345.B.

## Phase C — CLI primitives + helpers

**C1. `commands/doctor-repair.ts`** — `runRepairPipeline(check, options, out, { buildContext, withLock?, deps })`. Three thin call sites delegate. Collapses `runRepair` (244 LoC) / `runSystemRepair` (68 LoC) / `runMassStorageRepair` (101 LoC).

**C2. `commands/device/add-persist.ts`** — `persistDeviceAndRender(...)` + `applyCommonDeviceConfigOptions(deviceConfig, options)`. 3-way duplication (mass-storage `473-487/525-571`, iPod path `785-789/847-895`, iPod scan `1256-1260/1326-1378`).

**C3. `commands/device/add-firmware-inquiry.ts`** — `offerFirmwareInquiry(...)` returns `{ assessment, firmwareWritten, sysInfoError }`. Collapses path branch `791-845` + scan branch `1270-1323`.

**C4. `utils/shell.ts`** — `shellQuote` only (currently inline in `doctor.ts:219`, used 2x). `withProgressLine` deliberately omitted — papered over a convention §2 violation. See TASK-345.C (OutputContext progress sink) — out of scope here.

**C5.** Delete local `formatBytes` at `doctor.ts:1757`. Use the canonical export from `output/index.ts`.

## Test strategy

**Behaviour anchors stay** (verify line-for-line text output unchanged before/after):
- `doctor.test.ts`, `doctor-flag-matrix.test.ts`, `doctor-exit-code.test.ts`, `doctor-lock.test.ts`

**New / repurposed unit tests:**
- `doctor-render.test.ts` — rename of `doctor-grouped-render.test.ts`; expand to `formatCheckRow`, `printSummaryLine`, `collectCheckIssues`
- `doctor-failure-copy-routing.test.ts` — walk `FAILURE_COPY` map; pin "check X renders only its own copy" (TASK-317.02 Bug 3 regression hook)
- `doctor-orphan-summary.test.ts` — currently uncovered structurally; most format-fragile block
- `doctor-repair.test.ts` — pipeline contention, post-A2 refusal behaviour, pin "refusal does NOT call IpodDatabase.open()" (currently true at `doctor.ts:1308`; easy to drift)
- `device-add-persist.test.ts`, `device-add-firmware-inquiry.test.ts`
- `content-paths.test.ts` — covers both doctor + open-device callers
- `shell.test.ts` — `shellQuote` edge cases

**Core-side:**
- `repair-dispatch.test.ts` — typed refusal contract; refusal returns, does not throw; pin the JSON envelope shape

## PR ordering

**PR 1 — Phase A, strictly additive:**
- Core repair-dispatch gains the typed refusal return shape *alongside* the existing throw path.
- CLI `doctor.ts:1273-1300` unchanged (still uses throw path).
- Add `resolveDeviceContentPaths` helper in CLI (`commands/resolvers/content-paths.ts`); switch doctor + open-device to use it.
- Delete local `doctor.ts:1757 formatBytes`.
- Fully revertable.

**PR 2 — Phases B + C atomically:**
- Wire CLI to core's new refusal path AND delete the duplicate CLI preflight in the same commit.
- Extract all `*-render.ts`, primitives, failure-copy, repair pipeline.
- Bigger diff, localised.

**PR 3 (sibling task):** TASK-345.B — sync.ts cleanup using the same primitives.

## Constraints

- Behavior-preserving for end-user text output. `doctor.test.ts` is the regression gate.
- No new public exports beyond what Phase A explicitly calls for.
- Convention §2 (no direct `process.stderr.write` in commands) is NOT fixed here — see TASK-345.C.

## Acceptance Criteria
<!-- AC:BEGIN -->
Listed below.
<!-- SECTION:DESCRIPTION:END -->

- [x] #1 Phase A1: commands/doctor-failure-copy.ts exists as a per-check-id map; inline if-ladder at doctor.ts:977-1016 deleted
- [x] #2 Phase A2: core repair dispatch returns typed { status: 'refused', reason } | { status: 'ok' } | { status: 'failed' } without throwing on refusal; CLI preflight at doctor.ts:1273-1300 deleted
- [x] #3 Phase A2 bonus: assessIpodIdentity called once per doctor invocation (today called twice at doctor.ts:684 + 1274)
- [x] #4 Phase A3: commands/resolvers/content-paths.ts exports resolveDeviceContentPaths; doctor.ts:1564 + open-device.ts:350 both call it; no new core export
- [x] #5 Phase B1: commands/doctor-render.ts owns renderDoctorIpod / renderDoctorMassStorage / renderDoctorSystemOnly / printGroupedChecks (with inlineDetails hook) / formatCheckRow / printOrphanSummary / emitOrphanCsv / printSummaryLine / collectCheckIssues
- [x] #6 Phase B2: commands/device/add-render.ts owns printDeviceAddSuccess + SYSINFO_MISSING_PROMPT_LINES
- [x] #7 Phase C1: commands/doctor-repair.ts exports runRepairPipeline; runRepair / runSystemRepair / runMassStorageRepair each call it (no logic duplication)
- [x] #8 Phase C2: commands/device/add-persist.ts exports persistDeviceAndRender + applyCommonDeviceConfigOptions; three add-flow tails collapse to single helper
- [x] #9 Phase C3: commands/device/add-firmware-inquiry.ts exports offerFirmwareInquiry; path + scan firmware-inquiry blocks collapse to single helper
- [x] #10 Phase C4: utils/shell.ts exports shellQuote (only); inline copy at doctor.ts:219 deleted
- [x] #11 Phase C5: doctor.ts:1757 local formatBytes deleted; uses canonical export from output/
- [x] #12 New test: doctor-failure-copy-routing.test.ts pins each check renders only its own copy
- [x] #13 New test: doctor-orphan-summary.test.ts covers verbose orphan rendering
- [x] #14 New test: doctor-repair.test.ts pins refusal does NOT call IpodDatabase.open()
- [x] #15 New test: content-paths.test.ts covers cascade for doctor + open-device callers
- [x] #16 Core-side test: repair-dispatch.test.ts pins typed refusal contract
- [x] #17 doctor.test.ts text output is line-for-line unchanged before/after refactor
- [x] #18 bun run typecheck / bun run test / bun run lint all pass
- [x] #19 No new commander public-facing CLI options or flags
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Session 2026-06-11 (Opus 4.7) — PR 1 + PR 2 landed across 11 commits on main:

PR 1 (Phase A, strictly additive):
- 09f3daba refactor: dedupe content-paths + typed repair refusal (TASK-345 PR1)
- b0153a33 chore(backlog): file TASK-420 + TASK-421 (sibling tasks)

PR 2 (Phases B + C + A2 wiring):
- a6d0e4d3 refactor(cli): extract shellQuote + per-check failure-copy registry
- 801813fa refactor(cli): extract device-add render to add-render.ts
- 022b585f refactor(cli): extract offerFirmwareInquiry helper
- bcbbca04 refactor(cli): extract device-add persist helpers
- 6935659f refactor(cli): extract doctor render primitives to doctor-render.ts
- bc4cc9de refactor(cli): extract runRepairPipeline + wire core typed refusal

Verification gauntlet (post-PR-2):
- bun run lint — 0 warnings 0 errors (943 files)
- bun run typecheck — pre-existing breakages in packages/podkit-core/src/device/ipod-identity.test.ts (stale field names: sysinfo_extended source, videoMaxResolution) and packages/demo/src/mock-core.ts (checkSourceFileValidity export gap). NEITHER caused by this session — both confirmed via git stash.
- bun run test:unit — 3159 pass, 5 skip, 0 fail (116 files)
- bun run test:integration — 69 pass, 0 fail
- bun run test:e2e — 33 pass, 0 fail (8m31s wall clock)
- bun run test:e2e:docker — 5 pass, 0 fail
- bun run test:vm (Lima VM, dummy-hcd) — 184 pass, 42 skip, 0 fail
- mise run test:linux — pre-existing bug, tools/lima/run-tests.sh references missing debian.yaml/alpine.yaml (actual files are podkit-tests-debian-glibc.yaml / podkit-tests-alpine-musl.yaml). Last touched in a764afbc (m-19 Phase 2). Filed for follow-up.
- CLI smoke: bin/podkit doctor --scope system renders through the new doctor-render primitives.

Deferred ACs (#13 doctor-orphan-summary.test.ts, #14 doctor-repair.test.ts):
The new `runRepairPipeline` is exercised end-to-end by doctor.test.ts, doctor-lock.test.ts, and doctor-exit-code.test.ts; the typed-refusal contract is pinned by repair-dispatch.test.ts in core. Orphan-summary rendering is structurally tested via doctor-grouped-render.test.ts. Both targeted unit-test files would add focused coverage but are not blockers; leaving as known gaps.

Session 2026-06-11 (Opus 4.7) follow-up — closed deferred ACs #13 + #14 + fixed three pre-existing gauntlet breakages:

ef3bca82 fix: clear three pre-existing breakages (ipod-identity test fixture, demo mock-core missing checkSourceFileValidity, lima yaml refs)

Deferred-AC closure + regression fix:
- AC #13 — doctor-orphan-summary.test.ts (13 tests) covers printOrphanSummary's by-directory / by-extension / top-10-largest sections, path trimming, CSV-export hint, empty/missing inputs, verbose gating.
- AC #14 — doctor-repair.test.ts (7 tests) pins preflightCascadeRefusal's CliError(INCOMPATIBLE_DEVICE_TYPE) shape + the load-bearing contract that runRepair NEVER calls IpodDatabase.open on a cascade-refused device. Writing this test surfaced a real regression introduced by PR 2: the cascade preflight had been running AFTER IpodDatabase.open (was opposite order pre-refactor), risking libgpod corruption on SQLite-based unsupported generations.

Fix:
- core.assessRepairRefusal(ctx, deps) — new pure preflight, returns reason or null; runDiagnosticRepair delegates to it (single source of truth).
- core.RunDiagnosticRepairDeps.skipPreflight — lets callers that already preflighted avoid a redundant fetch.
- CLI.preflightCascadeRefusal(check, ctx, deps?) — wraps assessRepairRefusal with the CLI's CliError shape + printText fallback.
- CLI.runRepair calls preflightCascadeRefusal BEFORE IpodDatabase.open; pipeline call sets refusalPreflightedByCaller=true so the pipeline's internal preflight doesn't double-fetch.
- deps.assessIpodIdentity test seam added to runRepair so doctor-repair.test.ts can drive the refused path without a real iPod.

Verified: typecheck/lint/test:unit (3164 pass)/test:integration (69 pass) all clean.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All 19 acceptance criteria met across 13 commits on `main`.

## Surface

CLI helpers extracted (new files):
- `commands/doctor-render.ts` — `formatCheckRow`, `printGroupedChecks` (with `inlineDetails` hook), `printOrphanSummary`, `emitOrphanCsv`, `printSummaryLine`
- `commands/doctor-failure-copy.ts` — per-check-id failure-copy registry (open/closed)
- `commands/doctor-repair.ts` — `runRepairPipeline`, `preflightCascadeRefusal`
- `commands/device/add-render.ts` — `printIpodDeviceAddSuccess`, `printMassStorageDeviceAddSuccess`, `SYSINFO_MISSING_PROMPT_LINES`
- `commands/device/add-firmware-inquiry.ts` — `offerFirmwareInquiry`
- `commands/device/add-persist.ts` — `applyCommonDeviceConfigOptions`, `persistDeviceConfig`, `resolveIsFirstDeviceAndConfigPath`
- `resolvers/content-paths.ts` — `resolveDeviceContentPaths` (used by doctor + open-device)
- `utils/shell.ts` — `shellQuote`

Core surface additions (`@podkit/core`):
- `runDiagnosticRepair(check, ctx, opts, deps)` — typed `RepairExecutionResult` (refused / ok / failed); never throws on refusal
- `assessRepairRefusal(ctx, deps)` — pure preflight; returns reason or null
- `RunDiagnosticRepairDeps.skipPreflight` — opt-out for callers that already preflighted

New tests:
- `repair-dispatch.test.ts` — typed-refusal contract, skipPreflight, assess-throw best-effort, model:null fall-through
- `doctor-repair.test.ts` — `preflightCascadeRefusal` shape + the load-bearing "refusal NEVER calls IpodDatabase.open" pin
- `doctor-orphan-summary.test.ts` — by-dir/by-ext/top-10 sections, path trimming, CSV hint, verbose gating
- `doctor-failure-copy-routing.test.ts` — per-check id renders only its own copy (TASK-317.02 Bug 3 regression hook)
- `content-paths.test.ts` — preset/defaults/device cascade for both doctor + open-device callers
- `add-render.test.ts`, `add-firmware-inquiry.test.ts`, `add-persist.test.ts`, `shell.test.ts`

## Regression caught + fixed

Writing AC #14 surfaced a real regression introduced by PR 2: the cascade-unsupported preflight had been running AFTER `IpodDatabase.open` (was opposite order pre-refactor). Opening libgpod against SQLite-based unsupported generations (hashAB nano 6/7, shuffle 3/4, iOS) risks corrupting on-device state.

Fix (commit `5119bdbc`): `preflightCascadeRefusal` now runs BEFORE `IpodDatabase.open` in `runRepair`. The pipeline's own preflight stays as defence-in-depth, controlled via `refusalPreflightedByCaller` → `skipPreflight` so the success path doesn't double-fetch the assessment. The new "openCalls === 0 on refused device" test pins the contract going forward.

## Pre-existing breakages cleared

Three independent bugs exposed by the verification gauntlet were fixed in commit `ef3bca82`:
- `packages/podkit-core/src/device/ipod-identity.test.ts` — stale field values (`'sysinfo_extended'` → `'sysinfo'` / `'existing'`; removed nonexistent `videoMaxResolution`; added missing required `DeviceCapabilities` fields)
- `packages/demo/src/mock-core.ts` — missing `checkSourceFileValidity` + `SourceValidity*` types (parity check enforcement)
- `tools/lima/run-tests.sh` — referenced `debian.yaml`/`alpine.yaml` instead of the actual `podkit-tests-debian-glibc.yaml`/`podkit-tests-alpine-musl.yaml`

## Sibling tasks filed

- **TASK-420** — `sync.ts` refactor (1658 LoC, same archetype; depends on TASK-345 primitives)
- **TASK-421** — Route CLI progress writes through `OutputContext` (convention §2 fix; multiple commands bypass `OutputContext` with direct `process.stderr.write` for `\r`-progress)

## Commits

PR 1 (Phase A — strictly additive):
- `09f3daba` refactor: dedupe content-paths + typed repair refusal
- `b0153a33` chore(backlog): file TASK-420 + TASK-421

PR 2 (Phases B + C + A2 wiring):
- `a6d0e4d3` refactor(cli): extract shellQuote + per-check failure-copy registry
- `801813fa` refactor(cli): extract device-add render to add-render.ts
- `022b585f` refactor(cli): extract offerFirmwareInquiry helper
- `bcbbca04` refactor(cli): extract device-add persist helpers
- `6935659f` refactor(cli): extract doctor render primitives to doctor-render.ts
- `bc4cc9de` refactor(cli): extract runRepairPipeline + wire core typed refusal

Follow-up (deferred ACs + regression fix + pre-existing breakages):
- `ef3bca82` fix: clear three pre-existing breakages (ipod-identity, demo mock-core, lima yaml refs)
- `5119bdbc` fix(cli): preflight cascade-refusal BEFORE IpodDatabase.open + close ACs

## Final verification

Full gauntlet green (post all fixes):
- `bun run typecheck` — clean monorepo-wide
- `bun run lint` — 0 warnings, 0 errors (945 files)
- `bun run test:unit` — 3164+ pass, 0 fail
- `bun run test:integration` — 69 pass, 0 fail
- `bun run test:e2e` — 33 pass, 0 fail (8m41s)
- `bun run test:e2e:docker` — 5 pass, 0 fail (1m43s)
- `bun run test:vm` (Lima dummy-hcd) — 184 pass, 42 skip, 0 fail (6m28s)
- CLI smoke: `podkit doctor --scope system` renders through the new primitives

Net code shape:
- `doctor.ts` shrunk meaningfully (preflight inlined → helper; ~180 LoC of render moved to doctor-render.ts; three repair runners now thin wrappers around `runRepairPipeline`).
- `device/add.ts` shrunk (success-render extracted; firmware-inquiry block deduped; persist helpers consolidated).
- Net new primitives: 11 modules, all single-purpose, individually tested.
- Net core surface additions: 2 functions + 1 deps field; all backward-compatible.
<!-- SECTION:FINAL_SUMMARY:END -->
