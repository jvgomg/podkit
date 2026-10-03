---
id: TASK-534
title: >-
  Save-failure matrix bounds a whole `podkit sync` by the 10s warm-command
  timeout
status: To Do
assignee: []
created_date: '2026-10-03 15:39'
labels:
  - testing
  - flaky
  - vm
milestone: m-20
dependencies: []
references:
  - test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts
  - test-packages/device-testing/src/vm/vm-runtime-setup.ts
priority: medium
type: bug
ordinal: 304000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed in 1 of 3 forced `test:vm` runs on the Lima `device` substrate (2026-10-03, while verifying TASK-518). Runs 1 and 3 were fully green. Run 2 took 6m18s (run 1: 3m46s) and failed one cell:

```
Cell ipod-artwork / mp3 / prefer-copy / fast / itunesdb-readonly (pass=default) mismatched expectations:
  throwsClass: expected="DatabaseWriteError", observed=null
  partialDeviceState: expected="database-stale", observed="no-files-landed"
  debug: {"observeError":"... sync -d ... -vv timed out after 10000ms. The VM is not answering — it may be starved of host CPU/memory, or its SSH session may be wedged. ..."}
```

The cause is the bound, not the VM. `save-failure-matrix.e2e.test.ts` runs the real sync (`podkit ... sync -d <name> -vv`, ~line 760) and its `--dry-run --json` sibling (~line 768) with `timeoutMs: VM_WARM_TIMEOUT_MS`. That is the 10s bound for a short command that does no work. A full sync with transcode/copy plus the DB write does real work, and on a loaded run (both VM suites in parallel) it overruns 10s. The link then reports it as an unreachable VM, which is misleading.

The harness elsewhere separates "round trip" bounds from "work proportional to the payload" bounds (see the wall-clock section of `lima-test-vm-backing-files.ts`). The matrix's sync calls should take a work-sized bound.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every matrix call that runs a real sync uses a bound sized for the work, not VM_WARM_TIMEOUT_MS, with the figure's reasoning stated once where it is defined
- [ ] #2 Other e2e-vm call sites that run a sync or transcode under VM_WARM_TIMEOUT_MS are checked and either fixed or listed as fine with a reason
- [ ] #3 Repeated forced test:vm runs with both VM suites in parallel show no `timed out after 10000ms` on a sync
<!-- AC:END -->
