---
id: TASK-510
title: >-
  Backing-file synthesis fails ~1 run in 3 on a loaded host — cause still
  unknown, now self-reporting
status: To Do
assignee: []
created_date: '2026-09-13 15:19'
labels:
  - testing
  - vm
  - flakiness
  - concurrency
dependencies: []
references:
  - test-packages/device-testing/src/runners/lima-test-vm-backing-files.ts
  - test-packages/device-testing/src/vm/personas-baseline.e2e.test.ts
priority: high
type: bug
ordinal: 289000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`bun run test:vm` failed once out of three runs on the macOS harness host (Mavis) during TASK-508, in backing-file synthesis — before any daemon or enumeration is involved, so it is unrelated to TASK-504's change.

```
error: failed to synthesise partitioned FAT32 backing file for persona
  'ipod-5g-video-mbr-part' in podkit-device: exit=1: (no output, exit=1)
  at synthesisePartitionedFat32BackingFile (lima-test-vm-backing-files.ts:750:11)
(fail) VM: starter personas > (unnamed) [3790.77ms]
```

It failed inside a `beforeAll`, which is why the test reports as `(unnamed)`.

## Run conditions

| Run | Caches | Host load | Result |
|-----|--------|-----------|--------|
| 1 | normal | idle | green (38 + 238 tests) |
| 2 | `--force` | 6 busy loops / 12 cpus | **this failure** |
| 3 | `--force` | 6 busy loops / 12 cpus | green, and faster than run 1 |

So it is load-sensitive but not load-determined — one occurrence in two identical loaded runs.

## Why the error said nothing

The build script ran under `sudo sh -c` with `set -e`, and the two commands most likely to fail — `sfdisk` and `mkfs.vfat` — each ended `>/dev/null 2>&1`. Both streams were therefore empty on failure and the error could only report the exit status. TASK-508 fixed that (`loudOnFailure` in `lima-test-vm-backing-files.ts`): stdout stays clean for `parseBuildReport`, stderr is captured and echoed on failure. **The next occurrence will name the failing command and its message.** This task is to act on that.

## What was ruled out

Reproduction attempts inside the VM, all with stderr kept:

- 12 sequential `truncate` → `sfdisk` → `losetup --find --show --partscan` → `mkfs.vfat ${LOOP}p1` cycles: 0 failures. `${LOOP}p1` was present immediately every time, so the udev-async partition-node race is not obviously it.
- 3 concurrent workers × 15 cycles, host idle: 0 failures, 0 leaked loop attachments.
- The same 3 × 15 with 10 host busy loops on 12 cpus: 0 failures, 0 leaked attachments.
- Not disk space: `/` was at 15% (17G free) throughout.

The real run differs from the repro in one way worth pursuing: turbo runs `@podkit/device-testing#test:vm` and `@podkit/e2e-vm-tests#test:vm` in parallel and **both** call `prepare()`, so two host processes drive synthesis concurrently over ~10 personas each. The scratch-path race between them is already closed by the `$$` suffix (see the comment at `lima-test-vm-backing-files.ts:359`), but `losetup --find --show` remains a find-then-claim across processes, which is racy by construction.

## Next step

Do not guess further — wait for a run that reproduces it with the message attached, or drive the two-package concurrent `prepare()` shape directly rather than the simplified in-VM loop. If it does turn out to be `losetup --find`, the fix is `losetup` with an explicitly allocated device or a retry around the claim, not a sleep.

Relevant to TASK-506: this is a genuine flake cause in the VM lane that retry is currently hiding.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A reproduction is captured with the `loudOnFailure` message attached, naming which command failed and why
- [ ] #2 The cause is identified rather than inferred — in particular, whether concurrent `prepare()` from the two test packages races on `losetup --find --show`
- [ ] #3 The fix removes the race rather than widening a timeout or adding a sleep
- [ ] #4 `bun run test:vm` runs green across at least 3 consecutive loaded runs on the macOS harness host
- [ ] #5 TASK-506 is updated with whether this was a retry-hidden flake in the VM lane
<!-- AC:END -->
