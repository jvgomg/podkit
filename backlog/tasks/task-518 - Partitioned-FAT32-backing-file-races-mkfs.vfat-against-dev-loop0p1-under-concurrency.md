---
id: TASK-518
title: >-
  Partitioned FAT32 backing file races mkfs.vfat against /dev/loop0p1 under
  concurrency
status: To Do
assignee: []
created_date: '2026-09-13 21:57'
labels:
  - testing
  - flaky
  - ready-for-agent
milestone: m-20
dependencies: []
references:
  - test-packages/device-testing/src/runners/
  - docs/adr/adr-016-linux-vm-test-harness.md
priority: medium
type: bug
ordinal: 273600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed during TASK-494, on 2 of 5 real `test:vm` executions:

```
failed to synthesise partitioned FAT32 backing file for persona 'ipod-5g-video-mbr-part':
mkfs.vfat: unable to open /dev/loop0p1: No such file or directory
```

This is the same surface commit `65874a2e` fixed earlier. That fix added a wait loop which closes the udev-lag race — the node not existing *yet* — but not the case where the node exists at the check and is gone by the time `mkfs` opens it.

The suspected trigger is concurrency rather than timing alone: turbo runs `@podkit/device-testing#test:vm` and `@podkit/e2e-vm-tests#test:vm` in parallel, and both `prepare()` paths synthesise the same persona, so two loop-device setups can contend for the same `/dev/loop0` and tear each other's partition nodes down.

**Evidence it is not caused by the SubstrateLink refactor:** the generated build script is byte-identical across that change, the argv reaching the guest is byte-identical, and the suite passes when run alone. Two forced full `test:vm` runs after the refactor were both green, so the rate is well under 100% and absence in a short run proves nothing.

A bounded retry around the `mkfs` is the obvious mitigation, but the better fix may be to stop two suites synthesising the same persona concurrently, or to allocate a distinct loop device per synthesis. Diagnose before patching — a retry that hides a genuine contention bug will hold until the next person adds a third parallel suite.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The race is reproduced deliberately rather than by waiting for it
- [ ] #2 The fix addresses whether two suites may synthesise the same persona concurrently, not only the symptom at mkfs
- [ ] #3 test:vm is green across repeated forced runs with both VM suites in parallel
- [ ] #4 If a retry is used, its bound and its rationale are stated where the next reader will find them
<!-- AC:END -->
