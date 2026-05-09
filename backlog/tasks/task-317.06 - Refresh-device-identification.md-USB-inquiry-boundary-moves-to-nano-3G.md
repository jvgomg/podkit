---
id: TASK-317.06
title: 'Refresh device-identification.md: USB inquiry boundary moves to nano 3G'
status: To Do
assignee: []
created_date: '2026-05-09 15:21'
labels:
  - docs
milestone: m-18
dependencies:
  - TASK-317.01
  - TASK-317.02
  - TASK-317.03
  - TASK-317.04
  - TASK-317.05
parent_task_id: TASK-317
priority: low
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Documentation refresh — runs last so it captures the final state of all sibling tasks' work.

## What to update

`documents/device-identification.md` currently states something like "USB inquiry preferred for 5G+, SCSI as fallback for older devices". The m-18 sweep proved this is incomplete: **nano 3G supports USB inquiry**. The boundary sits between iPod 5.5G (USB fails) and nano 3G (USB succeeds), not between iPod 5.5G and nano 4G as previously assumed.

Specifically:

- Pre-iPod-5G: not in inventory, no data
- iPod 5G / 5.5G: SCSI only, USB inquiry STALLs
- nano 1G/2G: SCSI only, USB inquiry STALLs (mini 2G also)
- **nano 3G: USB inquiry works** (this is the new finding) — verified on real hardware, fixture at `documents/sysinfo-captures/nano-3g-8gb-black.xml`
- nano 4G+, nano 7G: USB inquiry works

Refresh the doc to:

1. Correct the "5G+ supports USB" assertion.
2. Add nano 3G as confirmed USB-supporting.
3. Note the data subtlety: nano 3G's SysInfoExtended is byte-stable across reads (no per-read crypto blob, unlike nano 4G/7G).
4. Pull in any other findings from sibling tasks (e.g., the new `sysinfo-serial-consistency` diagnostic from TASK-317.04, the centralized unsupported-device wording from TASK-317.03, the doctor repair changes from TASK-317.02).

## Why this is last

Depends on all other sub-tasks because the doc should reflect the final state of behavior changes — wording for unsupported devices, new diagnostic, repair semantics, etc. Running it last as a single coherent pass is more efficient than incrementally updating per sub-task.

## No real-hardware verification

The doc is descriptive, not behavioral. Sibling sub-tasks do their own real-hardware verification of the underlying behavior; this task just records what's true.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `documents/device-identification.md` USB inquiry boundary section corrected to reflect nano 3G as confirmed USB-supporting; iPod 5.5G as USB-failing.
- [ ] #2 Per-device USB / SCSI inquiry support table updated to include nano 3G + nano 7G #2 (Blue) findings from the m-18 sweep.
- [ ] #3 Doc references the sibling sub-tasks' outcomes when relevant: cascade primitive single source of truth, new `sysinfo-serial-consistency` diagnostic, centralized unsupported-device wording.
- [ ] #4 `documents/test-devices.md` cross-references reviewed; coverage tables stay in sync.
- [ ] #5 No real-hardware verification needed; mark AC as 'N/A — documentation-only'.
<!-- AC:END -->
