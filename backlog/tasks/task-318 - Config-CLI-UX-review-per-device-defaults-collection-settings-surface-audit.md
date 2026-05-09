---
id: TASK-318
title: 'Config CLI UX review: per-device defaults, collection settings, surface audit'
status: To Do
assignee: []
created_date: '2026-05-09 16:07'
labels:
  - cli
  - ux
  - config
  - audit
dependencies:
  - TASK-260
priority: medium
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Audit + redesign the config-related CLI surface. The specific trigger is the per-device default collection gap (TASK-260) but the broader work is to step back and review the whole config-mutation CLI as a coherent surface — find gaps, inconsistencies, and UX improvements that the per-feature tasks miss.

## Specific gap (immediate trigger)

Setting a per-device default music or video collection has no command. Users currently must either:

- Set the global default `collection default -t music -c <name>` — affects ALL devices, often the wrong shape when an Echo Mini and an iPod want different default collections.
- Pass `-c <name>` on every `sync` invocation — fine for scripts, friction for interactive use.

TASK-260 captures the feature (config field + resolution order: CLI flag > per-device default > global default). This task does NOT duplicate that; rather it adds the CLI command shape and considers how this fits the wider config-mutation surface.

Probable shape:

```
podkit device set -d <name> --default-music <collection-name>
podkit device set -d <name> --default-video <collection-name>
podkit device set -d <name> --clear-default-music
podkit device set -d <name> --clear-default-video
```

Add to the existing `device set` command (which already houses `--quality`, `--artwork`, `--clean-artists`, etc.) so all per-device settings live in one place. `device info` should display the per-device defaults clearly (per TASK-260 AC #4).

## Broader audit — the work this task primarily exists for

Walk through every config-mutation command and identify gaps, inconsistencies, and UX improvements:

- **`device set`** — what fields can users set via CLI vs only by editing config.toml? Is the gap deliberate or accidental?
- **`device add`** — duplicate of `device set` on creation? Should the same `--clean-artists`, `--quality` flags be settable both at add-time and via subsequent set?
- **`device default`** — what does it set? Is the model documented? Inconsistent with `collection default` shape?
- **`collection set`** — does this exist? Should it? E.g., setting source URL, transforms, etc. once vs editing toml.
- **`collection default`** — global only; matches the `device default` global pattern; consistent.
- **Removal symmetry** — `device remove`, `collection remove` — both rely on `-d` / `-c` flags rather than positional names. Surfaced as an issue in m-18 sweep (TASK-317.05). Worth treating as a class problem, not a one-off.
- **`device set --clear-X` flag explosion** — the `device set` command has ~10 `--clear-X` flags. Is there a tidier shape (e.g., `--clear <field>` taking the field name)?
- **JSON/scripting story** — does every config-mutation command support `--json` for read-back? If not, where are the gaps?
- **Init / migrate / reset** — first-run experience and recovery paths. Are they discoverable?

## Output of this task

1. A markdown audit document (in `documents/` or `backlog/docs/`) listing the surface findings, by command, with severity.
2. The specific TASK-260-related work shipped: `device set --default-music` / `--default-video` flags, with the resolution order from TASK-260's AC.
3. Follow-up backlog tasks for any gaps found that warrant independent work (created during audit, not as part of this task).

## Acceptance Criteria
<!-- AC:BEGIN -->
See AC list. Audit-style task: a deliverable doc + one concrete shipping change + targeted follow-ups.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 Audit document produced (e.g. `documents/config-cli-audit.md`) listing every config-mutation command with: current capabilities, observed gaps, proposed UX improvements, severity.
- [ ] #2 `podkit device set --default-music <collection>` and `--default-video <collection>` flags shipped, with `--clear-default-music` / `--clear-default-video` counterparts. Composes with TASK-260's config-schema work.
- [ ] #3 Resolution order on `sync` matches TASK-260: CLI `-c` flag > per-device default > global default > error.
- [ ] #4 `podkit device info` displays per-device default music + video collections when set; falls through to global when not set; documents the resolution explicitly.
- [ ] #5 Unit tests added: per-device-default field round-trips through config; resolution order honored in sync collection-selection logic; CLI flags work as expected.
- [ ] #6 Follow-up backlog tasks created for any non-trivial gaps surfaced by the audit (e.g., positional-arg accepted on remove commands, --clear flag explosion, JSON output gaps, etc.). These tasks reference this one as their origin.
- [ ] #7 Real-hardware test: set `defaultMusic` for echomini to `local_music`; sync without `-c` flag; verify the right collection is selected. Set a different default for an iPod entry; verify each device picks its own.
- [ ] #8 Documentation updated: `docs/users/configuration.md` (or equivalent) reflects the new per-device-default capability and the resolution order.
<!-- AC:END -->
