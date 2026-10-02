---
id: TASK-533
title: >-
  docker-dist fails on the remote amd64 substrate: in-container USB inquiry
  stalls, drain+Apprise sync outruns its wait
status: Done
assignee: []
created_date: '2026-09-30 21:16'
updated_date: '2026-10-02 01:34'
labels:
  - testing
  - infrastructure
milestone: m-20
dependencies: []
references:
  - test-packages/e2e-vm-tests/src/vm-docker/image.docker-dist.test.ts
  - test-packages/e2e-vm-tests/src/vm-docker/daemon.docker-dist.test.ts
modified_files:
  - test-packages/device-testing-daemon/src/functionfs.ts
  - test-packages/device-testing-daemon/src/__tests__/functionfs.test.ts
  - test-packages/e2e-vm-tests/src/vm-docker/daemon.docker-dist.test.ts
  - test-packages/e2e-vm-tests/src/vm-docker/image.docker-dist.test.ts
priority: medium
type: bug
ordinal: 303000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while closing TASK-530. This was the first run of `test:e2e:docker-dist` on the remote Proxmox substrate (`deviceRemote`, Debian 12 amd64, 2 vCPU). It ran from an arm64 Mac with podman. The result was 4 pass and 2 fail. The same suite passes 6/6 on the Lima substrate (arm64) with podman, so podman is not implicated there. Nerdctl never existed on the remote, so there is no before/after runtime comparison for it.

**1. `image.docker-dist` — SysInfoExtended is never written (reproducible, 3/3 runs).**
- The shipped image runs `device add` in the container with `--device <usbNode> --device <blockDevice>`, and the gadget node opens.
- The USB firmware inquiry then fails with:
  `Failed to read SysInfoExtended from USB: Could not read device identity from USB: USB: controlTransfer failed on page 0: LIBUSB_TRANSFER_STALL`
- `add` proceeds with "USB identity only" and writes no SIE, so the test's `SysInfoExtended` stat reads `MISSING`.
- The `/ipod` bind of the FAT mount is visible and writable in the container (confirmed with `findmnt` inside it).
- Still to investigate: does the host (`vm-binary`) inquiry work against the same persona on this substrate? `test:vm` passes there, which suggests it does. If so, compare the container path (x64 musl binary plus its usb prebuild) with the Lima arm64 container path, where the inquiry succeeds.

**2. `daemon.docker-dist` · "delivers a sync-complete Apprise notification after a full sync" (1 run).**
- The 120-track FLAC→AAC sync had started ("Running sync … dryRun:false") but had not completed within `SYNC_WAIT_TIMEOUT_MS` (90 s).
- On Lima the same test takes about 34 s.
- The 2-vCPU amd64 guest transcodes more slowly. The fix is either a budget derived from the substrate, or a smaller track set for the Apprise half (the drain half needs the long sync; Apprise does not).

**Side observation (see the Draft task filed alongside):** after the failed inquiry, `add --json` still reported `"verification":"verified"`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The in-container USB inquiry on the remote substrate either succeeds, or its failure is explained and the cell is scoped accordingly
- [x] #2 The Apprise case completes on the remote substrate without a timing budget tuned only for Apple Silicon
- [x] #3 `bun run test:e2e:docker-dist` passes on the remote substrate
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Outcome

Commits `fix(device-testing-daemon): land each ep0 reply before reading again` and `test(docker-dist): stop tuning the daemon cells to one substrate's disk and speed`. All runs below were driven from an amd64 Linux host against `deviceRemote`.

## 1. In-container USB inquiry STALL — a race in the persona daemon, not the container path

**Rate before the fix:** 1 failure in 5 full `test:e2e:docker-dist` runs. A manual repro using the exact Sep-30 image and persona-daemon binaries succeeded.

**Cause, captured by new diagnostics** in the persona daemon journal:
- `served page 0`, `served page 1`
- `ep0 read error: EL2HLT`
- `ep0 write failed for page 2: ESRCH`

**Mechanism:**
- The daemon fired the page `write()` without awaiting it and looped straight back into `read()`.
- FunctionFS treats a read on ep0 while an IN SETUP is pending as userspace asking to STALL it (`__ffs_ep0_stall` → `-EL2HLT`). So whenever the read reached the kernel first, the host saw `LIBUSB_TRANSFER_STALL`, and the daemon's ep0 loop exited.
- The container path, the x64 musl binary and the usb prebuild are not implicated. The race lives in the persona daemon, which the host path shares.

**Fix:**
- The loop is now `serveEp0` behind an `Ep0` seam. It does one operation at a time.
- An `EL2HLT` read is a stall the kernel performed, so the loop continues instead of exiting.
- Each served page is logged.
- Unit-tested in `__tests__/functionfs.test.ts`.

**Diagnostics:** the image cell now fails with the `add` output and the persona journal when SysInfoExtended is missing.

**Not attributed: the Sep-30 page-0 variant.**
- The daemon of that era logged nothing for served pages, but it did log read errors.
- The Sep-30 journal (boot -1) has no ep0 errors at all, and the daemon stayed alive until SIGTERM. So those stalls never reached userspace, which is a different path from the race fixed here.
- It did not recur in any run this session. If it does, the new served-page log plus the journal dump will show it.

## 2. Apprise "timeout" — the task's diagnosis was wrong

- The Sep-30 journal shows the 120-track sync **completed in 53.1 s**, inside the 90 s budget, logging `Sync cycle completed successfully for sdb`.
- The test waited for `/for sda/`. On the remote the boot disk is `sda`, so the persona enumerates as `sdb` and the wait could never match.
- Fix: derive the disk name from the resolved node, and give the Apprise case its own 3-track set. It needs a sync to finish, and 53 s of a 90 s budget is thin.

## 3. A third timing assumption surfaced: the SIGTERM-drain fixed dwell

- After the fix, one run failed with only 8 tracks preserved; the test needs at least 10. The cause was the fixed 4 s dwell before SIGTERM.
- The test now polls the daemon's own mount (`podman exec … find`) until 12 tracks have landed, bounded by the sync budget.

## Validation (remote, final code)

- `test:e2e:docker-dist` 5/5 green (30/30 tests).
- `test:vm` green with the new daemon (232 pass).
- Daemon unit tests 58/58.

**Not re-run:** Lima (arm64). It can't be reached from this host. The daemon change only removes concurrency, but Lima `test:vm` / docker-dist should be confirmed on the Mac.

**Unrelated, observed:** `@podkit/substrate`'s TLS-posture test hit its 5 s timeout on `git grep` under full `test:unit` load. It passes alone.
<!-- SECTION:NOTES:END -->
