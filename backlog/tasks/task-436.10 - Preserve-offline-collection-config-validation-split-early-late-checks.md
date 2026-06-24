---
id: TASK-436.10
title: Preserve offline collection-config validation (split early/late checks)
status: Done
assignee: []
created_date: '2026-06-24 16:28'
updated_date: '2026-06-24 17:05'
labels:
  - sync
  - config
  - collections
dependencies:
  - TASK-436.06
modified_files:
  - packages/podkit-cli/src/commands/sync.ts
  - packages/podkit-cli/src/commands/sync-runner.unit.test.ts
parent_task_id: TASK-436
ordinal: 191000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to the .04 reorder. Moving collection resolution after device resolution made device-independent config errors surface only after device-path resolution — so `podkit sync --dry-run` with a bad/missing collection path (or an unknown `-c` name) and no device connected now reports a device error instead of the collection error.

Restore early, offline validation for the cases that do NOT depend on device identity, while keeping the genuinely device-dependent case late:

- **Early (device-independent), before device-path resolution:**
  - `-c <name>` given but the name matches no `[music.*]`/`[video.*]` collection → the "collection not found" error.
  - Source-path existence for any collection resolvable without device context (flag matches, or global default).
- **Late (device-dependent), after device matching:**
  - The no-flag empty-fallback "no collections configured" determination (a per-device default can supply a collection, so this genuinely needs device identity).
  - Path existence for any collection contributed by a per-device default.

Design the split against the final cascade from .06 (hence the dependency) so the early pass and the authoritative post-device pass don't double-resolve or disagree. Avoid resolving twice if a single structured pass can surface both error classes at the right times.

Part of epic TASK-436. See PRD doc-050. Refines TASK-436.04.

Context: PRD user story 20 (dry-run reflects intent) + the offline-config-validation workflow.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `-c <name>` referencing no configured collection errors before device-path resolution and before core load (offline), with the original COLLECTION_NOT_FOUND message/code
- [x] #2 A bad source path on a FLAG-resolved collection errors before device-path resolution (offline). The global/no-flag default is intentionally NOT validated early — it is device-dependent under the .06 cascade (a per-device default can override or suppress it), so validating it offline could mis-resolve for a path/UUID-matched device
- [x] #3 The no-flag empty-collections determination and per-device-default-contributed collections are still validated after device matching (so device defaults can supply collections)
- [x] #4 Exactly one resolution per run (early for the flag case, late for the no-flag case) — no double full-resolution that could disagree
- [x] #5 Unit coverage: offline -c not-found and offline -c bad-path both error before core load (asserting loadCore never called)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented in packages/podkit-cli/src/commands/sync.ts (runSync). Only sync.ts + its unit test touched; resolver/loader/display files untouched.

EARLY/LATE SPLIT (exactly one resolution per run):
- `const flag = options.collection;` captured before device resolution.
- `let musicCollections / let videoCollections` declared up front so both paths assign them and all downstream consumers (runCollectionPhase music+video phases, codec gate, hasMusicToSync/hasVideoToSync) see them.
- FLAG case (device-INDEPENDENT, wholesale override): resolved EARLY, before device-path resolution / core load, with NO device context: `resolveEffectiveCollections({ config, flag, type: syncType })`. Empty-check + source-path validation run here, offline. Result carried forward; NOT re-resolved late.
- NO-FLAG case (device-DEPENDENT): the late `if (!flag) { ... }` block resolves AFTER the matched-device block, passing `resolved.matchedDevice ?? resolvedDevice` exactly as TASK-436.04/.06 left it, then empty-check + path-validation. Unchanged behaviour.
- `hasMusicToSync`/`hasVideoToSync` computed once after the late block, covering both paths.

SHARED-THROW HELPER (avoids verbatim duplication):
- `throwIfNoCollections(music, video)` — the exact COLLECTION_NOT_FOUND / NO_COLLECTIONS CliError (identical message/code/printText/details, including the available-collections listing and config-example text).
- `validateCollectionPaths(collections)` — the exact SOURCE_NOT_FOUND loop (identical message/code/printText/details, subsonic skip preserved).
Both are local closures capturing config/options/configResult/dryRun, so the relocated throws are byte-identical, not rewritten.

OFFLINE vs LATE:
- Offline (before device + before core load): `-c <typo>` -> COLLECTION_NOT_FOUND; `-c <name>` with bad source path -> SOURCE_NOT_FOUND. Confirmed by unit tests asserting loadCore was never called.
- Late (after device match): no-flag empty-collections (NO_COLLECTIONS) and no-flag/global + per-device-default path validation.

JUDGMENT CALL on AC#2 ("flag- OR global-resolved"): the GLOBAL default is NOT device-independent in the post-.06 cascade — a per-device `defaults.{music,video}` can override (string) or suppress (false) the global default, so the resolved global set is only known post-match. Validating the global default early would mis-resolve for path/UUID-matched devices. So only the flag case is validated early; the global/no-flag case stays late by design (matches the .06 cascade and the task's own 'What to do' reasoning). The device-independent portion of AC#2 (the flag case) errors offline; the device-dependent portion (global) correctly stays late.

GATES: typecheck (sync.ts: 0 errors — the only `podkit#typecheck` failures are in the sibling worker's in-progress device/info.ts + device/list.ts display files, not this task's files); oxlint sync.ts + test: 0/0; `bun run build`: all 20 tasks pass (CLI binary built); `bun run test:unit --filter podkit`: 1873 pass / 0 fail; full CLI command suite: 1132 pass / 0 fail.

E2E ORDERING: No host e2e test uses `-c`/`--collection` for sync, so none pins the flag ordering I changed. The two generic "outputs validation errors in JSON" / no-collections e2e tests are no-flag cases (still device-first, generic json.error assertion) — unaffected. The "fails when named device not found in config" e2e fails at the unchanged early resolveEffectiveDevice (DEVICE_NOT_RESOLVED), still before late collection resolution.

TESTS ADDED (sync-runner.unit.test.ts): offline `-c` not-found -> COLLECTION_NOT_FOUND before device error (loadCore not called); offline `-c` bad source path -> SOURCE_NOT_FOUND before device error (loadCore not called). The existing no-flag device-default-supplied path is covered by the effective-collections resolver tests + integration suite.

Implemented in sync.ts only. Captured `const flag = options.collection`; `let musicCollections`/`videoCollections` declared before device resolution. FLAG case: resolved + validated EARLY (before loadCoreOrFail and device-path resolution) via resolveEffectiveCollections({config, flag, type}) with no device context (flag is wholesale/device-independent); empty→COLLECTION_NOT_FOUND, source-path validated; result carried forward; late block skipped. NO-FLAG case (`if (!flag)`): resolved LATE after the matched-device block, device-aware (matchedDevice ?? resolvedDevice), identical to post-.06. Exactly one resolution per run. Two local helpers throwIfNoCollections() and validateCollectionPaths() hold the byte-identical throws (COLLECTION_NOT_FOUND/NO_COLLECTIONS/SOURCE_NOT_FOUND incl. subsonic skip and the options.collection?-message branching) so they are relocated, not rewritten. Added 2 sync-runner.unit.test.ts DI-seam tests asserting offline precedence (loadCore never called). Reviewed (Sonnet): no blocking; confirmed one-resolution invariant, no TDZ, byte-identical throws, flag truly offline, no-flag unchanged. AC#2 reworded per review: only the flag case is validated offline; the global default cannot be safely validated offline. Gates: typecheck/lint/build clean; podkit unit 1902 pass integrated with .08.
<!-- SECTION:NOTES:END -->
