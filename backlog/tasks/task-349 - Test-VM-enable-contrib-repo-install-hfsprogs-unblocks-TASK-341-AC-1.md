---
id: TASK-349
title: 'Test VM: enable contrib repo + install hfsprogs (unblocks TASK-341 AC #1)'
status: To Do
assignee: []
created_date: '2026-05-23 15:52'
labels:
  - vm-testing
  - tier-3
  - infrastructure
  - follow-up
milestone: m-19
dependencies: []
priority: low
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-341 AC #1 (HFS+ refusal scenarios) cannot be covered until the test VM has `hfsprogs` installed. `hfsprogs` ships from Debian's `contrib` repository (not `main`), so adding `hfsprogs` to the apt install list directly fails:

```
E: Package 'hfsprogs' has no installation candidate
```

## Scope

1. Enable Debian `contrib` component in the test VM's apt sources
2. Add `hfsprogs` to the apt install list in `tools/device-testing/lima/test-vm.yaml`
3. Verify `mkfs.hfsplus --version` succeeds in the VM
4. Implement TASK-341 AC #1 Tier-3 tests: device add HFS+ → exit non-zero + `UNSUPPORTED_FILESYSTEM_ON_LINUX`; device scan HFS+ iPod → ⚠ filesystem-not-supported headline; FAT32 regression

## References
- `backlog/tasks/task-341 - ...md` AC #1 — deferred behaviour
- TASK-317.12 — HFS+ refusal landed
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Debian contrib repo enabled in test VM apt sources (idempotent)
- [ ] #2 hfsprogs installed: mkfs.hfsplus --version succeeds in VM
- [ ] #3 TASK-341 AC #1 Tier-3 tests landed (HFS+ refusal scenarios)
- [ ] #4 Tier-3 baseline remains GREEN after changes
<!-- AC:END -->
