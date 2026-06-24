---
id: TASK-436.03
title: Extract resolveEffectiveCollections (global-only) from sync command
status: To Do
assignee: []
created_date: '2026-06-24 15:20'
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
- [ ] #1 resolveEffectiveCollections exists as a standalone resolver module returning collections with a source provenance field
- [ ] #2 sync command uses the module instead of an inline resolver; the prior inline resolveCollections is removed
- [ ] #3 Duplicate default-name plumbing in resolvers/collection.ts is reconciled (wrapped or retired) — only one cascade implementation remains
- [ ] #4 Unit tests cover the extracted global-only behavior including provenance
- [ ] #5 Overall sync behavior is unchanged (global-only resolution)
<!-- AC:END -->
