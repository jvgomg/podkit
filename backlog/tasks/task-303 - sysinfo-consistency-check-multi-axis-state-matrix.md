---
id: TASK-303
title: 'sysinfo-consistency check: multi-axis state matrix'
status: To Do
assignee: []
created_date: '2026-05-08 07:22'
updated_date: '2026-05-14 19:22'
labels:
  - testing
  - doctor
  - sysinfo
  - vm-coverage
milestone: m-19
dependencies:
  - TASK-322.05.01
priority: medium
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Verify the redesigned `sysinfo-consistency` check across the full matrix of on-disk file state × live device identity. The check has two independent axes — FireWireGUID and model generation — each of which can pass, fail, or be skipped. The overall result is a fold of the per-axis results: any axis fail → check fails (repairable); no fails and ≥1 pass → check passes; everything skipped → check skips.

Today this is covered by injected-fs unit tests. We need integration coverage that runs the real check against fixtures whose on-disk file content and live USB descriptor are programmable, so we can be confident the resolution path through `resolveUsbDeviceFromPath`, `extractFromPlist`, `identify()`, and the axis comparator behaves correctly on real OS-level USB enumeration.

For every test, run `podkit doctor --device <fixture> --json --no-system` and assert on the `sysinfo-consistency` entry in `checks[]`: `status`, `summary`, `repairable`, `details.axes` (array of per-axis results), `details.onDiskGuid`, `details.onDiskModel`.

---

**Harness note (TASK-321.08 sweep):** Tests implementing this task must use the `@podkit/device-testing` package:
- **T1 (unit):** import `personas` from `@podkit/device-testing`; use `DevicePersona.sysInfoExtendedXml` and `usbDescriptor` fields as the injectable fake data for the two axes
- **T3 (integration):** tests tagged `*.linux.tier3.test.ts` run inside the `lima-test-vm` runner; the iPod personas (`ipod-video-5g-fresh`, `ipod-nano-7g-populated`) supply the live USB descriptor via the FunctionFS daemon
- See `agents/device-testing.md` and ADR-016/ADR-017 for the full harness architecture

### m-19 harness integration (Phase 1 foundations)

Use the test harness landed in TASK-321 (Phase 1):

- **Fixtures** live in `@podkit/device-testing` — `DevicePersona` for device-facing state, `SystemState` for host-environment state. See `agents/device-testing.md` and `packages/device-testing/README.md`.
- **Tier 1** unit tests inject `SubprocessRunner` (from `@podkit/device-types`) and `TestRuntime` fakes wired up against persona/state fixtures. Default runner is `defaultSubprocessRunner` from `@podkit/core`; tests substitute `ReplaySubprocessRunner` from `@podkit/device-testing`.
- **Tier 3** integration tests run inside the `lima-test-vm` runner (lands in TASK-322.04) against synthesised USB gadgets.
- **Native subprocess tests** follow the `*.darwin.test.ts` / `*.linux.test.ts` tagging convention — see `agents/testing.md` §"Per-OS Test Tagging".
- Capture fresh subprocess fixtures with `PODKIT_SNAPSHOT_CAPTURE=1 PODKIT_SNAPSHOT_DIR=<dir>`; replay with `PODKIT_SNAPSHOT_REPLAY=1 PODKIT_SNAPSHOT_DIR=<dir>`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 File missing → status=skip, repairable=false, summary mentions --repair sysinfo-extended
- [ ] #2 File present + valid + GUID matches live + model matches live → status=pass, summary names both verified axes
- [ ] #3 File present + valid + GUID matches + live model unavailable → status=pass, model axis status=skip with reason
- [ ] #4 File present + valid + GUID matches + on-disk model unresolvable (e.g. unknown ModelNumStr and unknown serial suffix) → status=pass, model axis status=skip
- [ ] #5 File present + valid + GUID mismatches + model matches → status=fail, summary names FireWireGUID mismatch with both values
- [ ] #6 File present + valid + GUID matches + model mismatches (different generation) → status=fail, summary names model mismatch with both displayNames
- [ ] #7 File present + valid + both axes mismatch → status=fail, summary lists both mismatches
- [ ] #8 File present + valid + no live identity at all → status=skip, summary explains no live data available
- [ ] #9 File present but XML invalid → status=fail+repairable, summary mentions parse failure
- [ ] #10 File present but missing required identity fields (FireWireGUID/SerialNumber/FamilyID) → status=fail+repairable, summary mentions missing fields
- [ ] #11 File present but unreadable (permissions error) → status=fail+repairable, summary surfaces the I/O error
- [ ] #12 FireWireGUID comparison is case-insensitive and zero-pad-tolerant (lowercase live vs uppercase on-disk; short live vs padded on-disk)
- [ ] #13 Model comparison happens at generationId granularity (USB-derived live model carries no capacity/color, so finer comparisons would false-negative)
- [ ] #14 Repair (--repair sysinfo-consistency) overwrites the on-disk file from live USB; subsequent doctor run reports pass
- [ ] #15 Repair --dry-run prints planned action without modifying the file
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Dependency notes (added 2026-05-14):** The sysinfo-consistency check compares on-disk persona data to **live** USB descriptor data — Tier-3 assertions here need TASK-322.05.01 (FunctionFS descriptor handshake) so the live USB layer actually returns a descriptor for the synthesised persona. Tier-1 fake-injected coverage is independent and can land first.
<!-- SECTION:NOTES:END -->
