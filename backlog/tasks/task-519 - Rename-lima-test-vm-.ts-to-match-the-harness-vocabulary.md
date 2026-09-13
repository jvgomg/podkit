---
id: TASK-519
title: Rename lima-test-vm*.ts to match the harness vocabulary
status: To Do
assignee: []
created_date: '2026-09-13 21:58'
labels:
  - testing
  - refactor
  - ready-for-agent
milestone: m-20
dependencies:
  - TASK-494
references:
  - CONTEXT.md
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
priority: low
type: chore
ordinal: 273700
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-494 renamed the singleton away from `limaTestVmRunner` — a name saying "Lima" for something that may be an SSH connection to Proxmox is how the next reader gets misled, which is ADR-028's own argument. But the **files** are still `runners/lima-test-vm*.ts`, and they no longer contain anything Lima-specific: the limactl knowledge moved into the Lima link.

Left undone deliberately. No acceptance criterion asked for it, TASK-494's diff was already 63 files, and a file rename churns import specifiers across every VM test for no semantic gain — bundled into that change it would have buried the parts a reviewer needed to see.

Worth doing on its own, where the diff is legible as pure motion. Use the vocabulary CONTEXT.md already defines (substrate, harness) and mind the recorded "runner" overload.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The runner file names carry no Lima-specific vocabulary, and do not reintroduce the 'runner' overload CONTEXT.md records
- [ ] #2 The change is pure motion — no behaviour, no logic, no test assertions altered
- [ ] #3 test:vm is green
<!-- AC:END -->
