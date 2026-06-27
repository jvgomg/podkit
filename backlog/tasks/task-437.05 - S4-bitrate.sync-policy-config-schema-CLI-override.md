---
id: TASK-437.05
title: 'S4: bitrate.sync policy + config schema + CLI override'
status: To Do
assignee: []
created_date: '2026-06-25 22:38'
labels:
  - sync
  - transcoding
  - quality
  - config
  - cli
dependencies:
  - TASK-437.02
  - TASK-437.03
  - TASK-437.04
references:
  - >-
    backlog/docs/doc-051 -
    Bidirectional-quality-change-extend-cap-enforcement-to-lossy-unify-the-quality-classifier.md
  - packages/podkit-cli/src/config/types.ts
  - packages/podkit-cli/src/commands/sync.ts
parent_task_id: TASK-437
priority: medium
ordinal: 197000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**AFK. Convergence point** — gates the up/down/source-down triggers from S1/S2/S3. See PRD doc-051.

Add the per-device `bitrate.sync` policy with five modes (`off | match-cap | match-all | up-only | down-only`, default `match-cap`) and a pure **policy gate** mapping `(direction, reason, mode) -> fire | suppress-log`, kept as a distinct testable concern from the classifier. Add the config schema + validation, the `--bitrate-sync=<mode>` one-run override (reuse the existing config-override pattern; guard unset-vs-explicit via option-source so Commander defaults aren't synthesised), and the opt-in source-bound `tolerance` config (default 0; the only place tolerance survives, on the ffprobe source comparison). Precondition classes bypass the gate (handled in S5); `skipUpgrades` remains the top veto above `bitrate.sync`.

**Context:** user stories 8 (match-all opt-in), 9 (up-only/down-only), 10 (off blocks bitrate), 11 (tolerance), 15 (--bitrate-sync override).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Config accepts [devices.<name>.bitrate].sync with the five values; default match-cap when unset; invalid values fail validation with a clear error
- [ ] #2 Pure policy gate maps (direction, reason, mode) -> fire/suppress; unit-tested independently of the classifier
- [ ] #3 Each mode behaves per the PRD table: match-cap (both, source-down suppressed), match-all (+source-down), up-only, down-only, off (no bitrate moves)
- [ ] #4 --bitrate-sync=<mode> overrides device config for one run; only applies when explicitly passed (option-source guarded)
- [ ] #5 Opt-in source-bound tolerance config (default 0) damps source-bound lossy comparison; legacy bitrateTolerance reinterpreted (DB-fallback role gone)
- [ ] #6 Policy ladder honoured: skipUpgrades > bitrate.sync=off > bitrate moves
- [ ] #7 Config schema validation tests + per-mode e2e (up-only suppresses down, down-only suppresses up, off blocks bitrate, match-all re-encodes source-down)
- [ ] #8 Changeset added
- [ ] #9 User docs updated (config reference for bitrate.sync + tolerance, CLI reference for --bitrate-sync)
- [ ] #10 Architecture doc upgrades.md updated for the policy gate + ladder
<!-- AC:END -->
