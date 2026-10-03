---
id: TASK-518
title: >-
  Partitioned FAT32 backing file races mkfs.vfat against /dev/loop0p1 under
  concurrency
status: Done
assignee: []
created_date: '2026-09-13 21:57'
updated_date: '2026-10-03 15:39'
labels:
  - testing
  - flaky
  - ready-for-agent
milestone: m-20
dependencies: []
references:
  - test-packages/device-testing/src/runners/
  - docs/adr/adr-016-linux-vm-test-harness.md
modified_files:
  - test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts
  - test-packages/device-testing/src/runners/lima-test-vm-backing-files.test.ts
  - test-packages/device-testing/src/vm/backing-file-content.e2e.test.ts
  - test-packages/device-testing/src/personas/types.ts
  - >-
    test-packages/device-testing/src/personas/ipod-5g-video-mbr-part/provenance.md
priority: medium
type: bug
ordinal: 273600
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Observed during TASK-494, on 2 of 5 real `test:vm` executions:

```
failed to synthesise partitioned FAT32 backing file for persona 'ipod-5g-video-mbr-part':
mkfs.vfat: unable to open /dev/loop0p1: No such file or directory
```

This is the same surface commit `65874a2e` fixed earlier. That fix added a wait loop which closes the udev-lag race — the node not existing *yet* — but not the case where the node exists at the check and is gone by the time `mkfs` opens it.

The suspected trigger is concurrency rather than timing alone: turbo runs `@podkit/device-testing#test:vm` and `@podkit/e2e-vm-tests#test:vm` in parallel, and both `prepare()` paths synthesise the same persona, so two loop-device setups can contend for the same `/dev/loop0` and tear each other's partition nodes down.

**Evidence it is not caused by the SubstrateLink refactor:** the generated build script is byte-identical across that change, the argv reaching the guest is byte-identical, and the suite passes when run alone. Two forced full `test:vm` runs after the refactor were both green, so the rate is well under 100% and absence in a short run proves nothing.

A bounded retry around the `mkfs` is the obvious mitigation, but the better fix may be to stop two suites synthesising the same persona concurrently, or to allocate a distinct loop device per synthesis. Diagnose before patching — a retry that hides a genuine contention bug will hold until the next person adds a third parallel suite.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The race is reproduced deliberately rather than by waiting for it
- [x] #2 The fix addresses whether two suites may synthesise the same persona concurrently, not only the symptom at mkfs
- [ ] #3 test:vm is green across repeated forced runs with both VM suites in parallel
- [x] #4 If a retry is used, its bound and its rationale are stated where the next reader will find them
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Diagnosis (podkit-device, Debian 12, systemd 252, kernel 6.1):
- Concurrency is not the trigger: 8 workers x 40 concurrent runs of the exact partitioned build script = 0/320 failures.
- `udevadm monitor` during one build shows `add loop0p1`, then `remove loop0p1` + `add loop0p1` ~1ms later. With systemd-udevd stopped the remove/re-add disappears. Source: 60-block.rules sets OPTIONS+="watch" on `loop*`, so losetup closing /dev/loop0 (opened O_RDWR) makes udevd synthesise a change and issue BLKRRPART, which drops and re-adds every partition node.
- devtmpfs creates `${LOOP}p1` synchronously inside losetup, so the 65874a2e wait loop almost always returns on its first check and never covered this window. The window is the gap between check and mkfs's open(), and the rescan's remove→add gap grows with partition-table I/O latency on a loaded host.
- Deliberate repro: a root loop running `blockdev --rereadpt /dev/loop0` during the real build script gives 2/40 failures with the exact production error `mkfs.vfat: unable to open /dev/loop0p1: No such file or directory`.

Fix: no loop device. `mkfs.vfat --invariant -F 32 -n <label> --offset 2048 -h 2048 -I <file>` formats the partition region in place. Verified byte-identical to the loop-built image (sha256 a851ac3b0a4b45e5818972632d3ba8d17377aa88d90b1fbbe1f161d6f4b4e23c for ipod-5g-video-mbr-part); `-h 2048` is required for identity (hidden sectors), the block count is not.

Re-running the repro (inside the device VM): extract the build script by calling `ensureBackingFile` with a link stub whose `exec` prints `argv[2]`, copy it in as /tmp/build.sh, then run a root rescan loop alongside it:
```
sudo sh -c 'while [ ! -e /tmp/stop ]; do blockdev --rereadpt /dev/loop0 2>/dev/null; done' &
for i in $(seq 40); do sh /tmp/build.sh >/dev/null 2>>/tmp/err || echo FAIL; done; touch /tmp/stop
```
The loop-device script fails ~2/40 with the production error; the in-place script fails 0/40 (it has no node to lose). The rescan loop stands in for udevd's watch-triggered BLKRRPART, which on an idle VM lands before the shell's check and on a loaded one can land between check and open.

Concurrency (AC #2): with no loop device, two builds of one persona share nothing but the final `mv` target; both write identical bytes and `mv` is atomic, so concurrent synthesis needs no serialisation. Stated on the build-script comment.

Not in scope, noted: `packages/virtual-ipod-server/src/image.ts` / `mount.ts` use `losetup --partscan` then mount `${loop}p1`, and could hit the same p1 flap at mount time. It has not been observed failing.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Root cause was udev, not two suites racing. 60-block.rules puts `watch` on `loop*`, so when losetup closes /dev/loopN, udevd issues BLKRRPART, which removes and re-adds `${LOOP}p1`. A mkfs that opens the node in that gap fails with `unable to open /dev/loop0p1`. devtmpfs creates the node synchronously, so the earlier wait loop never covered this window.

Fix: the partitioned image no longer touches a loop device. `mkfs.vfat --invariant -F 32 -n <label> --offset 2048 -h 2048 -I "$TMP"` formats the partition in place in the image file. The image is byte-identical to the loop-built one (sha256 a851ac3b…).

Tests:
- Unit: the build script attaches no loop device and formats at the offset with matching hidden sectors.
- VM: `ensureBackingFile(ipod5gVideoMbrPart)` is pinned to the sha256. Mutation-checked: removing `-h` turns it red.

Evidence:
- Deliberate repro (BLKRRPART loop): old script 2/40 failures, new script 0/40.
- 3 forced `test:vm` runs on the Lima `device` substrate, both suites in parallel: no synthesis failure in any run.
- Runs 1 and 3 were fully green. Run 2 failed one save-failure-matrix cell on a 10s sync timeout, which is unrelated and filed as TASK-534.

AC #3 is left unchecked: test:vm was not green in all three runs. The one red was TASK-534, not this bug.

The remote substrate was not exercised; it was locked by another run on otto.
<!-- SECTION:FINAL_SUMMARY:END -->
