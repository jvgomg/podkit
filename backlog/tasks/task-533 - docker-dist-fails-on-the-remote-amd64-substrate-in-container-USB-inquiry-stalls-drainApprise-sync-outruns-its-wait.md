---
id: TASK-533
title: >-
  docker-dist fails on the remote amd64 substrate: in-container USB inquiry
  stalls, drain+Apprise sync outruns its wait
status: To Do
assignee: []
created_date: '2026-09-30 21:16'
labels:
  - testing
  - infrastructure
milestone: m-20
dependencies: []
references:
  - test-packages/e2e-vm-tests/src/vm-docker/image.docker-dist.test.ts
  - test-packages/e2e-vm-tests/src/vm-docker/daemon.docker-dist.test.ts
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
- [ ] #1 The in-container USB inquiry on the remote substrate either succeeds, or its failure is explained and the cell is scoped accordingly
- [ ] #2 The Apprise case completes on the remote substrate without a timing budget tuned only for Apple Silicon
- [ ] #3 `bun run test:e2e:docker-dist` passes on the remote substrate
<!-- AC:END -->
