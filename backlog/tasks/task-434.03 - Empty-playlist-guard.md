---
id: TASK-434.03
title: Empty-playlist guard
status: Done
assignee: []
created_date: '2026-06-23 19:04'
updated_date: '2026-06-23 20:57'
labels:
  - collections
  - subsonic
  - sync
dependencies:
  - TASK-434.01
references:
  - doc-049 - RFC-Playlist-Scoped-Subsonic-Collections.md
modified_files:
  - packages/podkit-cli/src/commands/empty-playlist-guard.ts
  - packages/podkit-cli/src/commands/empty-playlist-guard.test.ts
  - packages/podkit-cli/src/commands/empty-playlist-sync.test.ts
  - packages/podkit-cli/src/commands/sync-presenter.ts
  - packages/podkit-cli/src/commands/sync-collection-phase.ts
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-cli/src/config/types.ts
  - packages/podkit-cli/src/config/loader.ts
  - packages/podkit-cli/src/config/defaults.ts
parent_task_id: TASK-434
ordinal: 177000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Guard against a playlist that resolves to zero tracks silently wiping a device. See RFC doc-049 — do not duplicate.

End-to-end behavior: when a playlist-scoped sync resolves to zero tracks, an interactive run warns and prompts for confirmation; a non-interactive run (daemon / no TTY / --json) aborts non-zero unless explicitly overridden.

- Pure decision function: (trackCount, { interactive, yes }) → 'proceed' | 'confirm' | 'abort'. Non-empty → proceed; empty + interactive → confirm (reuse existing yes/no confirm helper); empty + non-interactive → abort; empty + override → proceed.
- Override: `--yes` (one-off CLI) and an `allowEmptyPlaylist` config key (daemon).
- Wire the guard into the sync flow; the decision logic itself does no I/O.

Covers PRD user stories 11, 12, 13.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Pure decision fn returns proceed for non-empty
- [x] #2 Empty + interactive TTY → confirm prompt via the existing helper
- [x] #3 Empty + non-interactive (daemon/no-TTY/json) → abort non-zero
- [x] #4 `--yes` and `allowEmptyPlaylist` config key let an empty playlist proceed
- [x] #5 Guard wired into the sync flow before transfer
- [x] #6 Guard decision-matrix unit tests pass (no sync, no I/O)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Empty-playlist guard — implementation

### Pure decision function (the deep module)
`packages/podkit-cli/src/commands/empty-playlist-guard.ts`
```
decideEmptyPlaylist(trackCount: number, ctx: { interactive: boolean; allowEmpty: boolean })
  => 'proceed' | 'confirm' | 'abort'
```
Matrix: count>0 → proceed; count===0 && allowEmpty → proceed; count===0 && interactive && !allowEmpty → confirm; count===0 && !interactive && !allowEmpty → abort. No I/O, no prompting, no process.exit — the caller acts on the return. Full-matrix unit test co-located in `empty-playlist-guard.test.ts` (6 tests).

### Integration point
Wired INSIDE `genericSyncCollection` (`sync-presenter.ts`), immediately after `adapter.getItems()` succeeds and `spinner.stop()`, BEFORE the pre-existing generic step-2 zero-items skip and before any diff/plan. This is where the resolved track count actually lives. A helper `isPlaylistScoped(collection)` gates the guard so it fires ONLY for a music collection carrying a non-empty subsonic `playlist` — an ordinary empty directory/library collection falls through to the existing step-2 skip unchanged. When the guard approves proceeding for an empty playlist (override or confirm-yes), a local `emptyPlaylistProceedApproved` flag makes the step-2 generic skip stand down so the deliberate empty sync actually proceeds (and wipes the device's tracks for that collection).

### Interactivity detection
`interactive = !out.isJson && out.isTty` (reuses OutputContext's existing `isJson` + `isTty`; no direct process.stdout.isTTY read).

### Override plumbing (--yes + allowEmptyPlaylist)
- CLI flag: `-y, --yes` added to `sync` (mirrors `device reset` / `collection remove` naming). Field `yes?: boolean` on `SyncOptions`. Plain boolean flag, no `--no-` synthesis, so `withCleanOptions` leaves it intact.
- Config key: global `allowEmptyPlaylist?: boolean` added to `PodkitConfig` and raw `ConfigFileContent` (types.ts), parsed in loader.ts (TOML block + `PODKIT_ALLOW_EMPTY_PLAYLIST` env via new `ENV_KEYS.allowEmptyPlaylist` in defaults.ts) — mirrors the `skipUpgrades` boolean end-to-end.
- `runSync` computes `allowEmptyPlaylist = (options.yes ?? false) || (config.allowEmptyPlaylist ?? false)` and threads it (plus an optional injected `confirm`) through `runCollectionPhase` deps → `genericSyncCollection` args.

### Abort → non-zero exit
'abort' (headless empty, or interactive confirm declined) throws a `CliError` with code `EMPTY_PLAYLIST_ABORT` (exported as `EMPTY_PLAYLIST_ABORT_CODE`). It propagates `genericSyncCollection` → `runCollectionPhase` (no catch) → `runSync` → `runAction`, which renders the typed error and sets a non-zero exit (1). Source adapter is disconnected before the throw. No `process.exit` and no direct console/stderr writes — uses `out.warn`/`out.print` and CliError.printText (passes the `check-cli-stderr-writes` lint gate).

### Confirm reuse
Reuses `confirmNo` from `utils/confirm.ts` (same helper `collection remove` / `device reset` use), with an injection seam `confirm?` on the args/deps for testing. Warning body states how many device tracks would be removed.

### Tests
- `empty-playlist-guard.test.ts` — pure decision-fn full matrix (no sync, no I/O).
- `empty-playlist-sync.test.ts` — focused wiring through `genericSyncCollection` with a minimal fake presenter: empty playlist + headless → throws CliError(EMPTY_PLAYLIST_ABORT), never reaches createPlan, disconnects; JSON mode → abort; override → proceeds past guard; confirm-yes → proceeds, confirm-no → aborts; non-empty → proceeds; NON-playlist empty collection → unaffected (existing skip, success:false, guard never engaged).

### Deviations / notes
- Guard lives inside `genericSyncCollection` rather than `runCollectionPhase` because that is the only place the resolved track count exists; `runCollectionPhase` stubs `syncOne` in its tests, so wiring is covered against `genericSyncCollection` directly (matching the existing `sync-empty-source.test.ts` harness).
- Did NOT touch `packages/podkit-core/src/adapters/*` (434.01) or `commands/collection.ts` / `resolvers/collection.ts` (434.04). A pre-existing typecheck failure in 434.04's `collection-playlist-display.test.ts` is unrelated to this task; my files typecheck cleanly (0 errors outside that file).

### Quality gates (targeted)
- typecheck: clean for all files except 434.04's `collection-playlist-display.test.ts` (not mine).
- lint: 0 warnings/0 errors; check-cli-stderr-writes OK.
- build: 20/20 tasks successful.
- test --filter podkit: all pass (274 in the focused guard/loader run; full filter green).

## Code-review fixes (applied post-implementation)

### FIX 1 — EMPTY_PLAYLIST_ABORT registered in SyncErrorCodes
`sync.ts` `SyncErrorCodes` previously omitted `EMPTY_PLAYLIST_ABORT`, breaking the exhaustive contract (all CliError codes from `podkit sync` enumerated there). Added `EMPTY_PLAYLIST_ABORT: 'EMPTY_PLAYLIST_ABORT'` to the object. In `sync-presenter.ts`, the exported `EMPTY_PLAYLIST_ABORT_CODE` constant is now typed as `SyncErrorCode` (the union derived from `SyncErrorCodes`), so TypeScript enforces that the string literal matches an entry in the enum. A direct value import was avoided — `sync.ts` and `sync-presenter.ts` already have a circular import relationship (sync imports from sync-presenter, sync-presenter imports types from sync), and a value import of `SyncErrorCodes` into sync-presenter would hit a TDZ on that cycle at runtime. The type annotation achieves the same safety guarantee without the runtime hazard.

### FIX 2 — Misleading warning when device has 0 tracks
In `sync-presenter.ts`, the fallback branch of `warningBody` previously said 'Proceeding would remove this collection\'s tracks from the device' even when `deviceItemCount === 0` (nothing to remove). Changed to: 'The device has no {itemNoun} for this collection yet — syncing an empty playlist will add nothing.' The `deviceItemCount > 0` branch is unchanged (states how many tracks would be removed).

### FIX 3 — loader tests for allowEmptyPlaylist
Added to `config/loader.test.ts` mirroring the `skipUpgrades` test pattern:
- `allowEmptyPlaylist = true` in TOML → parsed `true` (loadConfigFile describe block)
- `allowEmptyPlaylist = false` in TOML → parsed `false`
- `allowEmptyPlaylist = "yes"` in TOML → result `{}` (wrong type ignored)
- `PODKIT_ALLOW_EMPTY_PLAYLIST=true` env → `true` (loadEnvConfig describe block)
- `PODKIT_ALLOW_EMPTY_PLAYLIST=false` env → `false`

### FIX 4 — comment at decideEmptyPlaylist call site
Added inline comment at the `decideEmptyPlaylist(sourceItems.length, ...)` call (sync-presenter.ts) explaining that `sourceItems.length` is always 0 at this call site (the outer guard enforces it) and that the function\'s >0 branch exists only for unit-level completeness.

### FIX 5 — comment explaining video phase omits allowEmptyPlaylist
Added one-line comment above the video `runCollectionPhase` call in `sync.ts`: 'allowEmptyPlaylist is intentionally omitted: video collections cannot be playlist-scoped, so the empty-playlist guard never applies here.'

### Quality gates
- typecheck: 36/36 tasks successful (0 errors)
- lint: 0 warnings/0 errors; check-cli-stderr-writes OK
- build: 20/20 tasks successful
- test --filter podkit: 1772 pass, 0 fail (previously 23 failures from TDZ; resolved by type annotation approach)

Post-completion: the e2e:docker tests (434.05) caught that the `allowEmptyPlaylist` CONFIG/env override (user story 13, the daemon mechanism) never actually engaged — it was parsed into PartialConfig (loader.ts:250 / env:1623) but `mergeConfigs` never copied it into the final PodkitConfig, so `config.allowEmptyPlaylist` was always undefined at runSync. Only `--yes` worked. Fixed by adding the field to mergeConfigs (loader.ts, alongside skipUpgrades) + merge-level regression tests in loader.test.ts. The original 434.03 unit tests only exercised loadConfigFile parse, not the full merge path, which is why the gap slipped through.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Empty-playlist guard implemented + review-fixed. Pure `decideEmptyPlaylist(count, {interactive, allowEmpty}) -> proceed|confirm|abort` (no I/O) wired into `genericSyncCollection`, gated by `isPlaylistScoped` so non-playlist empty collections keep existing behavior. Interactive = `!isJson && isTty`; override = `--yes` OR `allowEmptyPlaylist` config (+`PODKIT_ALLOW_EMPTY_PLAYLIST`); abort throws CliError(EMPTY_PLAYLIST_ABORT) → non-zero exit; declined confirm = abort (no wipe); adapter disconnected before throw. Reuses `confirmNo`. Review (Sonnet) fix-then-ship: registered EMPTY_PLAYLIST_ABORT in exhaustive SyncErrorCodes (type-constrained to dodge a circular-import TDZ), fixed misleading zero-device warning, added 5 allowEmptyPlaylist loader tests, clarity comments. No correctness bugs found in scope-guard/proceed/abort paths. Gates green.
<!-- SECTION:FINAL_SUMMARY:END -->
