---
id: TASK-247.08
title: Interactive mount prompt and --mount flag
status: To Do
assignee: []
created_date: '2026-03-26 01:55'
labels:
  - feature
  - device
dependencies:
  - TASK-247.01
references:
  - packages/podkit-cli/src/commands/device.ts
parent_task_id: TASK-247
priority: medium
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add mount capability to `device scan` — a `--mount` flag for scripts and an interactive prompt for TTY users.

**PRD:** doc-023 | **Parent:** TASK-247

**`--mount` flag (non-interactive):**
- When set, automatically attempt to mount unmounted-but-mountable devices
- After successful mount, continue readiness checks automatically (user sees full picture in one go)
- Safe for scripts, CI, JSON output, piped contexts

**Interactive prompt (TTY only):**
- When an unmounted-but-mountable device is found AND stdout is a TTY AND `--mount` is not set AND output is not JSON: prompt "Device is unmounted. Mount now? [Y/n]"
- On accept, mount + continue readiness checks
- **Default to no-prompt** — the `--mount` flag is the primary mechanism; the interactive prompt is an enhancement

**UX considerations:**
- TTY detection via `process.stdout.isTTY` can be wrong in Docker/SSH/CI — this is why `--mount` flag is the primary mechanism and prompt is secondary
- Prompting changes scan from read-only to mutating, which can surprise users — keep prompt opt-in feeling

**User stories:** 8, 9, 20
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 --mount flag triggers automatic mount of unmounted devices
- [ ] #2 After mount, readiness checks continue automatically
- [ ] #3 Interactive prompt shown only when: TTY + no --mount + no JSON output
- [ ] #4 No prompt in non-interactive contexts (non-TTY, JSON, piped)
- [ ] #5 Mount failures reported with interpreted error message
- [ ] #6 Unit tests for prompt logic and flag behavior
- [ ] #7 E2E test: --mount flag triggers mount and continues checks
<!-- AC:END -->
