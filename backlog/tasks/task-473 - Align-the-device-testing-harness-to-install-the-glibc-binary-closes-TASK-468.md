---
id: TASK-473
title: Align the device-testing harness to install the glibc binary (closes TASK-468)
status: Done
assignee: []
created_date: '2026-08-04 15:17'
updated_date: '2026-08-04 16:33'
labels:
  - vm
  - build
  - libgpod-node
milestone: m-23
dependencies:
  - TASK-469
  - TASK-470
references:
  - adr/adr-026-dual-libc-linux-distribution.md
  - doc-057
  - test-packages/device-testing/scripts/harness.ts
  - test-packages/device-testing/scripts/build-linux-binary.sh
  - test-packages/device-testing/src/runners/lima-test-vm.ts
priority: medium
ordinal: 233000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The Debian harness VM (`podkit-device-harness`) runs a glibc host, so it must install the **glibc** binary. With TASK-469 (libc-explicit prebuild selection) and TASK-470 (the glibc build) landed, the harness install path embeds the glibc `.node` correctly, so the harness runs the same artifact Debian/Homebrew users get — and TASK-468 closes.

Verify `harness.ts` / `build-linux-binary.sh` / `lima-test-vm.ts` resolve + install the glibc artifact onto the Debian harness VM, and that a full `harness:setup` + `test:vm` yields no `libc.musl-*.so.1` binding-load failure (the DB-dependent VM tests — save-failure matrix, pre-sync-sweep, sysinfo-modelnum-mismatch — pass). This is the harness half of TASK-468.

Depends on TASK-469 + TASK-470.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 harness:setup installs a glibc binary that loads the libgpod binding on the Debian harness VM (no libc.musl error)
- [x] #2 The DB-dependent VM tests pass: save-failure-matrix, pre-sync-sweep, doctor-sysinfo-modelnum-mismatch
- [x] #3 TASK-468 is closed (its ACs satisfied by this + TASK-469)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Verify-only — no harness code change needed. harness.ts / build-linux-binary.sh / lima-test-vm.ts already build in the pinned glibc podkit-linux-builder VM and install the bare-name (glibc) artifact; the musl artifact path is Docker-only. With TASK-469 landed, compile.sh selects the glibc .node on the builder, so the harness binary embeds glibc. Confirmed on a from-scratch harness:setup + full test:vm: no libc.musl-*.so.1 binding-load error; the DB-dependent suites (save-failure-matrix, pre-sync-sweep, doctor-sysinfo-modelnum-mismatch) all pass. TASK-468 closed by TASK-469 + this. Full test:vm = 274/275 pass; the single failure was an unrelated USB-enumeration hook-timeout flake in discovery-reconciliation (no libgpod path, same domain as recent de-flaking commits cd851a53/5556e966).
<!-- SECTION:FINAL_SUMMARY:END -->
