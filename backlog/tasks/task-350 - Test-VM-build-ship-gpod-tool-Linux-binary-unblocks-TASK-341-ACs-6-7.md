---
id: TASK-350
title: 'Test VM: build + ship gpod-tool Linux binary (unblocks TASK-341 ACs #6 #7)'
status: To Do
assignee: []
created_date: '2026-05-23 15:52'
labels:
  - vm-testing
  - tier-3
  - infrastructure
  - follow-up
  - gpod-tool
milestone: m-19
dependencies: []
priority: low
ordinal: 10100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
TASK-341 ACs #6 (SysInfo ModelNumStr mismatch) + #7 (doctor repair correctness) need `gpod-tool` in the test VM to populate iPod database state. Tier-3 runner currently emits:

```
[lima-test-vm] no gpod-tool binary configured — set PODKIT_GPOD_TOOL_BINARY to a Linux gpod-tool path if your test needs it.
```

## Scope
1. Build gpod-tool for linux/arm64 via the existing `builder` Lima VM (has libgpod dev libs)
2. Stage as build artifact under `tools/gpod-tool/dist/gpod-tool-linux-arm64`
3. Extend Tier-3 runner `prepare()` to transfer + install to `/usr/local/bin/gpod-tool` (similar to dummy-hcd-daemon path)
4. Wire `PODKIT_GPOD_TOOL_BINARY` default
5. Land TASK-341 ACs #6 + #7 tests

## References
- `tools/gpod-tool/gpod-tool.c`
- `tools/device-testing/lima/builder.yaml`
- `packages/device-testing/src/runners/lima-test-vm.ts` prepare() pipeline
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 gpod-tool linux-arm64 build script lives under tools/gpod-tool/ or tools/device-testing/
- [ ] #2 Tier-3 runner prepare() transfers gpod-tool to /usr/local/bin/gpod-tool in test VM
- [ ] #3 PODKIT_GPOD_TOOL_BINARY default points at the staged location
- [ ] #4 TASK-341 AC #6 + #7 Tier-3 tests landed
- [ ] #5 Tier-3 baseline remains GREEN
<!-- AC:END -->
