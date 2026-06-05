---
id: DRAFT-011
title: SyncOutput / JSON contract audit + ADR
status: Draft
assignee: []
created_date: '2026-06-04 08:06'
updated_date: '2026-06-05 18:04'
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

## Status (2026-06-05)

**Deferred to Draft.** Decision in team-lead session: write the ADR alongside whichever of TASK-380 / TASK-381 / TASK-378 lands first, using its real shape as the worked example, rather than speculating now.

When this task is reopened, the three sub-questions to resolve are:

1. **`schemaVersion` field on `SyncOutput`** — yes/no. Initial lean: no — `@podkit/cli` semver IS the schema version; duplicating invites drift.
2. **Stability policy** — strict additive (new fields ok any time, removals need major) vs versioned vs best-effort. Initial lean: strict additive (matches what's already happened with TASK-357's `decisions` block).
3. **Warning union shape** — closed (`SyncWarning = WarningA | WarningB | ...`) vs open (`SyncWarning = { kind: string; ... }`). Tradeoff: closed = consumers exhaustive-switch + every new kind needs a bump; open = no exhaustive check + non-breaking additions.

## Scope (when reopened)

1. **Audit current contract.** Read `SyncOutput` type + every site that populates it. Document:
   - What's in JSON today (decisions, ops, warnings, summary, etc.)
   - What downstream consumers we know exist (CLI rendering, e2e matrix, future daemon HTTP API)
   - What's typed weakly (`warnings: SyncWarning[]` — is the SyncWarning union closed?)

2. **Map future additions.** For each pending task with JSON intent (TASK-380, TASK-381, TASK-378, future device-lockfile), name the field shape.

3. **ADR.** Write `adr/adr-NNN-sync-output-contract.md` capturing audit findings, versioning policy, stability promises, extension pattern.

4. **Optional refactor (separate task):** if the ADR identifies a shape change, file the refactor as a follow-up.

## Acceptance criteria

- ADR landed in `adr/`.
- Cross-referenced from doc-040 (TASK-357's PRD) and doc-041 (save-transaction).
- Pending tasks (TASK-380, TASK-381, TASK-378) updated to point at the ADR for the field shape they should adopt.

## Reference

- Item 11 from post-team-lead retro (2026-06-04).
- doc-040 (TASK-357 PRD), doc-041 (save-transaction).
- Deferred 2026-06-05.
<!-- SECTION:DESCRIPTION:END -->
