---
id: TASK-532
title: >-
  Capability report probes only the Lima device VM, ignoring the selected
  substrate
status: To Do
assignee: []
created_date: '2026-09-29 21:55'
labels:
  - testing
  - infrastructure
milestone: m-20
dependencies: []
references:
  - test-packages/device-testing/src/capabilities.ts
  - test-packages/device-testing/scripts/run-mirror-body.ts
  - test-packages/device-testing/src/runners/substrate.ts
priority: medium
type: bug
ordinal: 302000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found during TASK-517.

`probeDeviceSubstrate()` in `test-packages/device-testing/src/capabilities.ts` runs `limactl list podkit-device` (or `PODKIT_DEVICE_SUBSTRATE`, a variable nothing else reads). It never consults `PODKIT_SUBSTRATE` or the selection resolver. So on a machine driving the remote substrate (`PODKIT_SUBSTRATE=deviceRemote`), the `quality` capability report says the device substrate is unavailable and lists every `vm-*` cell as "not covered". `run-mirror-body.ts` then returns `EXIT_INCOMPLETE` even when those cells ran and passed.

Since TASK-517 this also covers `vm-docker-image` · `local-dir` · `loopback-fat`.

The fix is probably to probe through `resolveDeviceSubstrate()` + `probeSubstrate()`, the same path the VM preflight uses. Those are async and `probeCapabilities()` is sync, so the report becomes async.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The device-substrate capability reflects the substrate the selection resolver picks, Lima or ssh
- [ ] #2 A reachable remote substrate is reported available and its cells are not listed as uncovered
- [ ] #3 An unreachable one is still reported unavailable with a reason
<!-- AC:END -->
