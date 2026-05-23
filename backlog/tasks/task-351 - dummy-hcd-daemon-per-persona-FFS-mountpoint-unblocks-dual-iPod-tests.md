---
id: TASK-351
title: 'dummy-hcd-daemon: per-persona FFS mountpoint (unblocks dual-iPod tests)'
status: To Do
assignee: []
created_date: '2026-05-23 15:52'
labels:
  - vm-testing
  - tier-3
  - infrastructure
  - follow-up
  - dummy-hcd
milestone: m-19
dependencies: []
priority: medium
ordinal: 10200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Daemon hardcodes `/dev/ffs-podkit` mountpoint. Second daemon for different persona fails:

```
mount: /dev/ffs-podkit: already mounted
systemctl: dummy-hcd-daemon@<id>.service exited 4
```

Blocks:
- TASK-311 AC #6: multiple iPods simultaneously
- TASK-341 AC #2: dual-iPod discovery scenarios (partial defer)
- Future multi-iPod doctor flows

## Scope
1. Replace hardcoded `/dev/ffs-podkit` with per-persona path (e.g. `/dev/ffs-podkit-<personaId>`)
2. Update systemd template `dummy-hcd-daemon@.service` to pass persona id as mountpoint suffix
3. Update daemon CLI + gadget.ts + functionfs.ts to honour new flag
4. Extend mass-storage-binding.tier3.test.ts smoke test for dual-daemon lifecycle
5. Verify TASK-341 AC #2 dual-persona + TASK-311 AC #6 unblocked

## References
- `tools/device-testing/dummy-hcd/src/main.ts` — hardcoded FFS_MOUNT
- `tools/device-testing/dummy-hcd/dummy-hcd-daemon@.service` — systemd template
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Daemon accepts per-persona FFS mountpoint (CLI flag + systemd template arg)
- [ ] #2 Two concurrent dummy-hcd-daemon@<id> services start cleanly with distinct mountpoints
- [ ] #3 Smoke test verifies dual-daemon lifecycle (start two, both /dev/sg appear, stop both, no orphan configfs)
- [ ] #4 TASK-311 AC #6 + TASK-341 AC #2 dual-iPod scenarios unblocked
- [ ] #5 Tier-3 baseline remains GREEN
<!-- AC:END -->
