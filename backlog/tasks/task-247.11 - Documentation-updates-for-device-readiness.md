---
id: TASK-247.11
title: Documentation updates for device readiness
status: Done
assignee: []
created_date: '2026-03-26 01:55'
updated_date: '2026-03-28 15:55'
labels:
  - docs
  - device
dependencies:
  - TASK-247.01
  - TASK-247.02
  - TASK-247.03
  - TASK-247.04
  - TASK-247.05
  - TASK-247.06
  - TASK-247.07
  - TASK-247.08
  - TASK-247.09
  - TASK-247.10
references:
  - docs/
  - agents/shell-completions.md
  - agents/demo.md
  - packages/demo/demo.tape
parent_task_id: TASK-247
priority: medium
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Update user-facing documentation and CLI help text to cover all device readiness diagnostics features.

**PRD:** doc-023 | **Parent:** TASK-247

**User docs:**
- Enhanced `device scan` command with readiness output explanation
- Enhanced `doctor` command with two-phase diagnostics
- Enhanced `device info` readiness summary
- Enhanced `device init` readiness-aware behavior and stub messages
- New `--mount` flag documentation
- New `--report` flag documentation
- Readiness levels reference (what each level means and suggested actions)
- Troubleshooting guide: common error codes and what they mean

**CLI help text:**
- Update help for `device scan`, `doctor`, `device info`, `device init`
- Add `--mount` and `--report` flag descriptions

**Shell completions:**
- Add `--mount` and `--report` to scan completions
- Verify no other completions need updating

**Demo tape:**
- Check if `packages/demo/demo.tape` runs `device scan` — if so, update to match new output format
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 User docs updated for all enhanced commands
- [x] #2 New flags (--mount, --report) documented
- [x] #3 Readiness levels reference page or section added
- [x] #4 Troubleshooting guide covers common error codes
- [x] #5 CLI help text updated for affected commands
- [x] #6 Shell completions updated for new flags
- [x] #7 Demo tape checked and updated if needed
<!-- AC:END -->
