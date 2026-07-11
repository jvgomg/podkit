---
id: TASK-425
title: 'Tier-3: light up doctor SIE repair tests when daemon VPD lands'
status: To Do
assignee: []
created_date: '2026-06-14 07:38'
updated_date: '2026-07-11 11:23'
labels:
  - testing
  - vm-coverage
  - tier-3
  - follow-up
milestone: m-20
dependencies:
  - TASK-424
references:
  - test-packages/e2e-vm-tests/src/doctor-sysinfo-repair.e2e.test.ts
  - documents/architecture/testing/vm-testing.md
  - >-
    packages/podkit-core/src/diagnostics/checks/sysinfo-consistency-repair.test.ts
  - packages/podkit-core/src/diagnostics/checks/sysinfo-extended.test.ts
priority: low
ordinal: 140000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

`test-packages/e2e-vm-tests/src/doctor-sysinfo-repair.e2e.test.ts` carries two `it.skip` blocks today:

- `'stale on-disk FireWireGUID: --repair sysinfo-consistency rewrites on-disk SIE from USB truth — BLOCKED on daemon SCSI VPD 0xC0 scaffold'`
- `'fresh iPod with no iTunesDB: --repair sysinfo-extended succeeds (no DB-open gate) — BLOCKED on daemon SCSI VPD 0xC0 scaffold'`

Both depend on TASK-424 (`dummy-hcd-daemon` SCSI VPD page 0xC0 support). Once TASK-424 lands, both bodies should be filled in (the comments inside each skipped block sketch the test) and the blocks switched from `it.skip` to `it`.

## What

1. Un-skip the two blocks in `doctor-sysinfo-repair.e2e.test.ts`.
2. Fill in the bodies per the comment sketches.
3. Verify both pass against a daemon with SCSI VPD 0xC0 support.
4. Close out the deferred-coverage open work in `documents/architecture/testing/vm-testing.md` §7.

For Bug 1 (stale GUID):

- Use persona `ipod-5g-stale-guid` (already authored).
- `mountPersona`, `gpod-tool init MA446`.
- Run `doctor --scope device --json`, assert `sysinfo-consistency` check is `fail` with FireWireGUID detail.
- Run `doctor --repair sysinfo-consistency --json`, assert success envelope.
- Re-run doctor, assert `sysinfo-consistency` now passes.
- Optionally `cat <mount>/iPod_Control/Device/SysInfoExtended | grep FireWireGUID` for byte-level confirmation that the stale `BAADBAADBAADBAAD` was replaced with `000A27001605D1A0`.

For Bug 2 (no DB):

- Use existing `ipod-video-5g-iflash-1tb` persona (DB-less by default).
- `mountPersona` but DO NOT run `gpod-tool init` (that's the point — proving the repair doesn't gate on DB).
- Run `doctor --repair sysinfo-extended --json`, assert `success: true`.
- Assert `details.source === 'usb'` (not `'existing'`) so a future persona acquiring an SIE overlay doesn't silently false-pass.

## Closes out

This task closes the `it.skip` block accumulation in `doctor-sysinfo-repair.e2e.test.ts` and the corresponding open-work item in the architecture doc. After this lands, TASK-341 AC #7 is fully covered end-to-end at the CLI surface.

## References

- TASK-341 AC #7 — original behaviour set (unit-pinned, partially Tier-3-pinned today).
- TASK-350 — landed Tier-3 coverage for Bug 3 + Bug 4 of the same set.
- `documents/architecture/testing/vm-testing.md` §5.6, §7 — gap documentation.
- `packages/podkit-core/src/diagnostics/checks/sysinfo-consistency-repair.test.ts` — unit pin for Bug 1.
- `packages/podkit-core/src/diagnostics/checks/sysinfo-extended.test.ts:57-66` — unit pin for Bug 2.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Both `it.skip` blocks in `doctor-sysinfo-repair.e2e.test.ts` are converted to `it` and pass against the updated daemon
- [ ] #2 Bug 1 test asserts: detect (sysinfo-consistency fail/warn) → repair (success envelope, checkId='sysinfo-consistency') → re-detect (sysinfo-consistency pass)
- [ ] #3 Bug 2 test asserts: --repair sysinfo-extended succeeds, details.source === 'usb' (guard against false-pass)
- [ ] #4 TASK-341 AC #7 marked checked
- [ ] #5 `documents/architecture/testing/vm-testing.md` §7 'Daemon SCSI VPD page 0xC0' bullet is closed (or rewritten to capture residual gaps)
- [ ] #6 Tier-3 baseline remains GREEN
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
UPDATE (2026-07-11, TASK-462): the hard dependency on TASK-424 has softened. The two skipped doctor-repair tests use a SCSI-fallback persona (ipod-5g-stale-guid / ipod-video-5g) because SCSI VPD was thought to be the only in-harness inquiry route. Now that USB DEVICE-level inquiry works (TASK-462), these doctor SIE-repair behaviours could alternatively be lit up over REAL USB inquiry against a USB-mode persona (e.g. ipod-nano-4g-black) — decoupling from TASK-424. Design choice for the implementer: keep the SCSI-path variant (needs 424, tests SCSI-fallback realism) and/or add a USB-path variant now (needs only 462). The USB-path variant is the faster unblock.
<!-- SECTION:NOTES:END -->
