---
id: TASK-534
title: >-
  Save-failure matrix bounds a whole `podkit sync` by the 10s warm-command
  timeout
status: Done
assignee: []
created_date: '2026-10-03 15:39'
updated_date: '2026-10-03 18:54'
labels:
  - testing
  - flaky
  - vm
milestone: m-20
dependencies: []
references:
  - test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts
  - test-packages/device-testing/src/vm/vm-runtime-setup.ts
modified_files:
  - test-packages/device-testing/src/vm/vm-runtime-setup.ts
  - test-packages/device-testing/src/index.ts
  - test-packages/e2e-vm-tests/src/save-failure-matrix.e2e.test.ts
  - test-packages/e2e-vm-tests/src/pre-sync-sweep.e2e.test.ts
  - test-packages/e2e-vm-tests/src/vm-docker/image.docker-dist.test.ts
  - test-packages/e2e-vm-tests/src/vm-docker/daemon.docker-dist.test.ts
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
- [x] #1 Every matrix call that runs a real sync uses a bound sized for the work, not VM_WARM_TIMEOUT_MS, with the figure's reasoning stated once where it is defined
- [x] #2 Other e2e-vm call sites that run a sync or transcode under VM_WARM_TIMEOUT_MS are checked and either fixed or listed as fine with a reason
- [x] #3 Repeated forced test:vm runs with both VM suites in parallel show no `timed out after 10000ms` on a sync
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Measured on idle podkit-device (Lima, arm64), whole save-failure-matrix file: real syncs 216–1536 ms, dry runs 219–247 ms. The failing run pushed one sync past 10s.

New bound: `VM_WORK_TIMEOUT_MS = SUBSTRATE_ROUND_TRIP_TIMEOUT_MS + 15_000` (60s) in device-testing `vm/vm-runtime-setup.ts`, for in-VM commands that do real work over a fixture. Reasoning lives on the constant.

AC #2 sweep. Moved to the work bound:
- save-failure-matrix: `runSync`, `runDryRun`, `writeSourceTrack` (ffmpeg via `runScript`'s new `timeoutMs` param). The observe-all-cells hook budget becomes COLD + N×WORK.
- pre-sync-sweep: `runSync`, `runSyncDryRun`, `stageMp3Source`, `stageFlacSource` (ffmpeg). Test budgets are COLD + n×WORK, where n counts the work calls in each test (3, 1, 3, 2).
- vm-docker: the ffmpeg FLAC generation in image.docker-dist (1 site) and daemon.docker-dist (2 sites). Each enclosing hook becomes COLD + WORK.

Left on the warm bound, with reasons:
- save-failure-matrix `remountClean`: a 5 MiB truncate plus mkfs.ext4, fixed size, not proportional to the payload.
- matrix `stageConfig` / `walkMount` / rm / mkdir: short commands.
- mass-storage-binding: a 64M sparse truncate plus mkfs.vfat, fixed size.
- vm-docker-loopback harness: already has its own 60s/120s bounds.
- docker-dist in-container sync: `CONTAINER_STEP_TIMEOUT_MS` is 180s.
- daemon.docker-dist:877: 4s FLACs already at 180s.
- matrix `runDoctor`: already COLD with retries.
- pre-sync-sweep `spawnPausedSync`: spawned, so no bound applies.

Separately, VM_WARM_TIMEOUT_MS (10s) is below SUBSTRATE_ROUND_TRIP_TIMEOUT_MS (45s, "one round trip on a busy host"), so any warm call can trip under heavy load. Not changed here: 335 call sites, and they are a sizing decision of their own.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added `VM_WORK_TIMEOUT_MS` (one busy-host round trip + 15s = 60s) for in-VM commands that do real work over a fixture: a `podkit sync`, its dry run, or an ffmpeg source-track build. Every such call that was on the 10s `VM_WARM_TIMEOUT_MS` now uses it:
- save-failure matrix: sync, dry run, track generation
- pre-sync-sweep: sync, dry run, mp3/flac staging
- docker-dist: three FLAC generation steps

The enclosing hook and test budgets were raised to cover their work calls, so an outer timeout cannot fire before the per-call bound.

Sites left on the warm bound are listed with reasons in the notes.

Verification:
- Idle measurement: matrix syncs take 0.2–1.5s.
- 6 forced `test:vm` runs with both suites in parallel, 3 on Lima `device` and 3 on the remote substrate: all green (39 + 194 pass each), with zero `timed out after` lines.
- docker-dist (where three sites changed): 5/6 pass with the change, identical to a HEAD control run. The failing cell fails the same way at HEAD and is filed as TASK-535.
- One earlier docker-dist run hit a separate intermittent build defect, filed as TASK-536.
<!-- SECTION:FINAL_SUMMARY:END -->
