---
id: TASK-532
title: >-
  Capability report probes only the Lima device VM, ignoring the selected
  substrate
status: Done
assignee: []
created_date: '2026-09-29 21:55'
updated_date: '2026-09-29 22:12'
labels:
  - testing
  - infrastructure
milestone: m-20
dependencies: []
references:
  - test-packages/device-testing/src/capabilities.ts
  - test-packages/device-testing/scripts/run-mirror-body.ts
  - test-packages/device-testing/src/runners/substrate.ts
modified_files:
  - test-packages/device-testing/src/capabilities.ts
  - test-packages/device-testing/src/capabilities.test.ts
  - test-packages/device-testing/scripts/run-mirror-body.ts
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
- [x] #1 The device-substrate capability reflects the substrate the selection resolver picks, Lima or ssh
- [x] #2 A reachable remote substrate is reported available and its cells are not listed as uncovered
- [x] #3 An unreachable one is still reported unavailable with a reason
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`probeDeviceSubstrate()` now probes the substrate the selection resolver picks: `resolveDeviceSubstrate()` + `probeSubstrate()`, the same path the VM preflight uses. It no longer runs `limactl list podkit-device`. The unused `PODKIT_DEVICE_SUBSTRATE` variable is gone. `probeCapabilities()` became async, and `run-mirror-body.ts` awaits it.

The probe never throws. A selection error (e.g. an unconfigured machine) becomes an unavailable capability whose reason is the resolver's own onboarding message. The resolver's fallback announcement is rendered with a `[quality]` prefix. Reasons name the remedy for each case:
- stopped → `bun run vm:up <id>`
- unreachable ssh substrate → the link description plus `vm:up`
- uncreated Lima instance → `bun run harness:setup`, since a bare instance has no contract, binaries or seal

Resolver and probe are injectable, so the unit tests no longer depend on this machine's substrate (the old `probeCapabilities` tests ran live `limactl`).

**Verified live** from the Linux dev host with `PODKIT_SUBSTRATE=deviceRemote`:
- substrate stopped → `✗ device substrate (deviceRemote) — not answering over ssh_config alias \`podkit-substrate\` — bun run vm:up deviceRemote`, all three vm cells listed uncovered
- after `vm:up` → `✓ device substrate (deviceRemote)`, no vm cell listed

The Lima cases (#1) are covered by unit tests against the real registry entry; they were not run live on a Mac. device-testing unit 430/430 before the last test was added, capabilities 12/12, typecheck and lint clean.
<!-- SECTION:FINAL_SUMMARY:END -->
