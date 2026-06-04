---
id: TASK-386
title: SyncOutput / JSON contract audit + ADR
status: To Do
assignee: []
created_date: '2026-06-04 08:06'
labels:
  - enhancement
  - documentation
  - adr
  - json-output
  - api-contract
dependencies:
  - TASK-357
references:
  - packages/podkit-core/src/sync/
  - backlog/docs/doc-040 - PRD-—-Expose-sync-decisions-in-json-TASK-357.md
  - backlog/docs/doc-041 - Save-Transaction-Design-and-State-of-Play.md
priority: low
ordinal: 112000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`SyncOutput` (the `--json` payload from `podkit sync`) is podkit's external API for tooling. After TASK-357 added `json.decisions.*` and per-op `inputCodec`/`outputCodec`, the contract carries codec + artwork decisions cleanly. But several pending tasks would extend it without a holistic design:

- TASK-380 (save-failure matrix) — would assert decisions about save() outcomes, but `SyncOutput` has no `save` block.
- TASK-381 (IpodAdapter portable-tag-write result) — wants `portableTagWarnings: string[]` in JSON.
- TASK-378 (free-space probe) — would emit a typed `free-space-low` warning.

Adding each ad-hoc grows the API surface without coherence.

## Scope

1. **Audit current contract.** Read `SyncOutput` type + every site that populates it. Document:
   - What's in JSON today (decisions, ops, warnings, summary, etc.)
   - What downstream consumers we know exist (CLI rendering, e2e matrix, future daemon HTTP API)
   - What's typed weakly (`warnings: SyncWarning[]` — is the SyncWarning union closed?)

2. **Map future additions.** For each pending task with JSON intent (TASK-380, TASK-381, TASK-378, future device-lockfile), name the field shape.

3. **ADR.** Write `adr/adr-NNN-sync-output-contract.md` capturing:
   - The audit findings
   - Versioning policy (today's `decisions` block was added without version bump; should we have `schemaVersion`?)
   - Stability promises (are field additions backwards-compatible by definition? what about removals?)
   - Extension pattern for new typed warnings / errors

4. **Optional refactor (separate task):** if the ADR identifies a shape change, file the refactor as a follow-up.

## Acceptance criteria

- ADR landed in `adr/`.
- Cross-referenced from doc-040 (TASK-357's PRD) and doc-041 (save-transaction).
- Pending tasks (TASK-380, TASK-381, TASK-378) updated to point at the ADR for the field shape they should adopt.

## Notes

- This is a documentation task with downstream coordination value. It does not block any single follow-up but accelerates several.
- ADR-worthy because the JSON shape is observable to external consumers; changes carry semver weight.

## Reference

- Item 11 from post-team-lead retro (2026-06-04).
- doc-040 (TASK-357 PRD), doc-041 (save-transaction).
<!-- SECTION:DESCRIPTION:END -->
