---
id: TASK-436.10
title: Preserve offline collection-config validation (split early/late checks)
status: To Do
assignee: []
created_date: '2026-06-24 16:28'
labels:
  - sync
  - config
  - collections
dependencies:
  - TASK-436.06
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
- [ ] #1 `-c <name>` referencing no configured collection errors before device-path resolution (offline), with the original not-found message/code
- [ ] #2 A bad source path on a flag- or global-resolved collection errors before device-path resolution (offline)
- [ ] #3 The no-flag empty-collections determination and per-device-default-contributed collections are still validated after device matching (so device defaults can supply collections)
- [ ] #4 No double full-resolution that could disagree between the early and late passes
- [ ] #5 Unit/e2e coverage for: offline -c not-found, offline bad-path, and device-default-supplied collection still validated post-match
<!-- AC:END -->
