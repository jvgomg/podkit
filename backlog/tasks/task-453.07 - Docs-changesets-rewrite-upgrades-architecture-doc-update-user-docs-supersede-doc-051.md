---
id: TASK-453.07
title: >-
  Docs + changesets: rewrite upgrades architecture doc, update user docs,
  supersede doc-051
status: Done
assignee: []
created_date: '2026-06-30 16:52'
updated_date: '2026-06-30 20:31'
labels:
  - docs
  - quality
dependencies: []
references:
  - adr/adr-023-lossy-reduction-down-only.md
  - >-
    backlog/docs/doc-055 -
    PRD-Lossy-Reduction-Redesign-—-Down-Only-Transfer-Mode-Defaulted-Axis.md
  - documents/principles/transcoding.md
modified_files:
  - documents/architecture/sync/upgrades.md
  - docs/reference/config-file.md
  - docs/reference/cli-commands.md
  - docs/reference/environment-variables.md
  - docs/user-guide/syncing/upgrades.md
  - docs/user-guide/transcoding/audio.md
  - docs/troubleshooting/common-issues.md
  - docs/developers/quality-preset-testing.md
  - >-
    backlog/docs/doc-051 -
    Bidirectional-quality-change-extend-cap-enforcement-to-lossy-unify-the-quality-classifier.md
  - .changeset/lossy-reduction-redesign.md
  - .changeset/quality-change-unified.md
  - .changeset/lossy-cap-on-add.md
  - .changeset/lossy-source-down-suppression.md
  - .changeset/sync-tag-sole-quality-truth.md
parent_task_id: TASK-453
priority: medium
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 7. Prereq: slices 2, 3, 4. The cross-cutting documentation + release deliverables.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 documents/architecture/sync/upgrades.md rewritten for the two-axis, down-only model (policy gate / cap-up / source-improved sections removed; resolveLossyReduction seam documented; links to the principles docs)
- [x] #2 User docs updated: docs/reference/{config-file,cli-commands,environment-variables}.md, docs/user-guide/{syncing/upgrades,transcoding/audio}.md, docs/troubleshooting/common-issues.md, docs/developers/quality-preset-testing.md
- [x] #3 doc-051's lossy-cap portion marked superseded by ADR-023 (link, don't delete)
- [x] #4 Changesets added: minor bump for podkit + @podkit/core (breaking config change)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
All documentation and changeset deliverables complete. Docs build passes (68 pages, all internal links valid).

**AC#1 — Architecture doc rewritten** (`documents/architecture/sync/upgrades.md`): Full rewrite for the two-axis, down-only model. §1 vocabulary updated (added `below-cap`, `cap-up` scoped to lossless only, `encoding-mismatch` scoped to lossless only, `source-improved` removed). §1a (five-mode policy gate) replaced with the `resolveLossyReduction` seam documentation (four-row target-bitrate table, reduction axis, tolerance semantics). §4 lossy device-bound rewritten around the seam (tolerance: 0 on re-sync, `below-cap` report-only, no `cap-up` for lossy). §5 vocabulary rename updated (source-improved removed). §6 interactions simplified (no `bitrate.sync`). §8 references updated. Links to ADR-023, ADR-022, and the three principles docs.

**AC#2 — User docs updated**:
- `docs/reference/config-file.md`: "Bitrate Sync Policy" section replaced with "Lossy Reduction"; `[bitrate].reduce` / `[bitrate].tolerance` schema; removed `sync`/`toleranceUp`/`toleranceDown`/`bitrateTolerance`; device settings table updated.
- `docs/reference/cli-commands.md`: `--bitrate-sync` replaced with `--bitrate-reduce` and `--bitrate-tolerance`; completions table updated.
- `docs/reference/environment-variables.md`: `PODKIT_BITRATE_REDUCE` added; `PODKIT_BITRATE_TOLERANCE` description updated to new meaning.
- `docs/user-guide/syncing/upgrades.md`: Preset Changes section rewritten for down-only model; below-cap report documented; tolerance section updated to `[bitrate].tolerance`; encoding-mode section scoped to lossless only; pre-existing broken anchor fixed.
- `docs/user-guide/transcoding/audio.md`: Cap enforcement section rewritten — down-only, no up-direction, `below-cap` report + `--force-transcode` to lift, `preserve` axis and tolerance explained.
- `docs/troubleshooting/common-issues.md`: Migration section added for removed `[bitrate].sync` key; "raised cap didn't re-upgrade" FAQ added; tolerance and encoding-mode entries updated.
- `docs/developers/quality-preset-testing.md`: Detection approach rewritten for sync-tag-driven model; sub-reason vocabulary updated (added `below-cap`, removed `source-improved`, scoped `cap-up` and `encoding-mismatch` to lossless).

**AC#3 — doc-051 superseded**: Added superseded blockquotes to the "Policy gate" section and the "Config schema / CLI" section linking to ADR-023, with "retained as historical context only" note.

**AC#4 — Changesets**:
- Created `.changeset/lossy-reduction-redesign.md` (minor bump, `podkit` + `@podkit/core`): covers `[bitrate].sync` → `[bitrate].reduce`/`tolerance` config break, down-only model, `below-cap` report, new CLI flags and env vars, migration table.
- Deleted `.changeset/bitrate-sync-policy.md` (described the superseded five-mode policy).
- Deleted `.changeset/lossy-cap-up-enforcement.md` (described behavior removed by ADR-023).
- Updated `.changeset/quality-change-unified.md`: removed `source-improved` from vocabulary, added `below-cap` and `encoding-mismatch` (lossless-only) to sub-reason table.
- Fixed minor stale references in `lossy-cap-on-add.md`, `lossy-source-down-suppression.md`, `sync-tag-sole-quality-truth.md`.

**Discrepancy found (code trusted)**: Brief says `encoding-mismatch` fires on "both lossless and lossy cap paths". Code (`upgrades.ts` jsdoc, ADR-023 §6) says it fires only on the lossless-source sync-tag-exact path — a CBR/VBR flip on a lossy source is a lossy→lossy degradation that can grow the file and is deliberately excluded. Documented accordingly in all updated files.
<!-- SECTION:FINAL_SUMMARY:END -->
