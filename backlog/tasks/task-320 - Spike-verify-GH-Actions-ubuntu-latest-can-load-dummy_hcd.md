---
id: TASK-320
title: 'Spike: verify GH Actions ubuntu-latest can load dummy_hcd'
status: Done
assignee: []
created_date: '2026-05-11 22:55'
updated_date: '2026-05-11 22:57'
labels:
  - testing
  - vm-coverage
  - spike
  - ci
milestone: m-19
dependencies: []
priority: high
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
De-risk spike: confirm GH Actions `ubuntu-latest` runners can load the kernel modules required by the Tier 3 test harness (`dummy_hcd`, `libcomposite`, `usb_f_mass_storage`, `usb_f_fs`), mount `configfs`, and create a USB gadget. If yes, CI is a first-class Tier 3 environment. If no, fall back to a self-hosted Linux runner.

Workflow: install `linux-modules-extra-$(uname -r)`, `modprobe` each module, mount configfs, create a minimal gadget, verify, tear down. Throwaway branch `spike/gha-dummy-hcd`. Do not merge.

The outcome feeds into TASK-290 (ADR 1) which references the spike result, and unblocks Phase 4 (CI matrix) tasks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Workflow file .github/workflows/spike-dummy-hcd.yml created on branch spike/gha-dummy-hcd
- [x] #2 Workflow runs on ubuntu-latest with workflow_dispatch trigger
- [x] #3 Workflow attempts modprobe of dummy_hcd, libcomposite, usb_f_mass_storage, usb_f_fs and reports each result
- [x] #4 Workflow mounts configfs and creates a minimal gadget via /sys/kernel/config/usb_gadget
- [x] #5 Spike workflow has been triggered and the result recorded in task notes (PASS/FAIL with output snippet)
- [x] #6 If FAIL: a fallback path is documented (self-hosted runner / kernel version pin / alternative module loader)
- [ ] #7 Branch and workflow file are removed (or repurposed) once the result is recorded — they are throwaway artefacts
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Spike result: FAIL.** GH Actions `ubuntu-latest` runs the `linux-azure` cloud kernel flavor (`6.17.0-1010-azure`), built without `CONFIG_USB_DUMMY_HCD`. The `linux-modules-extra-*-azure` package installs successfully but does not ship `dummy_hcd`, `libcomposite`, `usb_f_mass_storage`, or `usb_f_fs`. All four `modprobe` calls returned `FATAL: Module not found`. Not a privilege problem — a kernel-build-config problem.

**Verdict**: `ubuntu-latest` is NOT viable for Tier 3. Use one of:
1. **Self-hosted Linux runner** on a generic-kernel Debian/Ubuntu host (simplest; `tools/lima/virtual-ipod.yaml` already proves dummy_hcd works on stock Debian 12)
2. **Nested Lima/QEMU VM inside GH Actions** booting a generic-kernel Debian (slow ~3-5 min boot, keeps CI hosted, reuses `tools/lima/run-tests.sh`)
3. (Rejected) privileged container — won't help, host kernel itself lacks the module

Artefacts left in place for review:
- Workflow: `.github/workflows/spike-dummy-hcd.yml`
- Branch: `spike/gha-dummy-hcd` (not merged, no PR)
- Run: https://github.com/jvgomg/podkit/actions/runs/25702123559

Cleanup (user): `git branch -D spike/gha-dummy-hcd && git push origin --delete spike/gha-dummy-hcd`
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Spike confirmed GH Actions `ubuntu-latest` cannot host Tier 3 — Azure-flavor kernel lacks `dummy_hcd` and friends, and the `linux-modules-extra-azure` package doesn't ship them either. Recommendation: self-hosted Linux runner or nested Lima/QEMU inside CI. Decision is escalated to TASK-323 (Phase 4 CI matrix), which must adopt one of the two viable paths.
<!-- SECTION:FINAL_SUMMARY:END -->
