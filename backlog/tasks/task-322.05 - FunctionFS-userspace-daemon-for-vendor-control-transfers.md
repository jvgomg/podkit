---
id: TASK-322.05
title: FunctionFS userspace daemon for vendor control transfers
status: To Do
assignee: []
created_date: '2026-05-12 09:35'
updated_date: '2026-05-12 12:10'
labels:
  - testing
  - vm-coverage
  - tier-3
  - functionfs
milestone: m-19
dependencies: []
parent_task_id: TASK-322
priority: high
ordinal: 450
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the userspace daemon that synthesizes iPod-like USB device responses for the FunctionFS gadget inside the test VM.

**Location**: `tools/device-testing/dummy-hcd/` (separate from `packages/virtual-ipod-server/` which is the user-facing demo — off-limits).

**Protocol** (matches libgpod 0.8.3 vendor control transfer shape):
- `bmRequestType=0xC0` (device-to-host, vendor, device)
- `bRequest=0x40`
- `wValue=0x02`
- `wIndex=page` (iterates from 0 upward)
- Returns up to 4096 bytes per page; short read terminates iteration
- Concatenated payload = SysInfoExtended XML for the loaded persona

**Operation**:
1. Daemon accepts `--persona <id>` flag at startup
2. Loads the JSON sidecar produced by the `lima-test-vm` runner (serialised `@podkit/device-testing` registry)
3. Looks up the named persona, extracts `usbDescriptor` and `sysInfoExtendedXml`
4. Creates a FunctionFS endpoint at the configured path
5. Handles setup packets matching the vendor protocol; serves XML in 4096-byte pages
6. Exits cleanly on SIGINT/SIGTERM

**Language choice**: prefer Go or Rust for a single static binary that runs in the test VM without runtime deps. Avoid Node/Bun since the test VM is deliberately Node-free.

**Reference shape**: `packages/virtual-ipod-server/src/gadget.ts` shows the existing configfs/dummy_hcd setup pattern (mass-storage function); this daemon adds the vendor-control-transfer function.

**Reference protocol**: `packages/ipod-firmware/src/inquiry/usb.ts:350-400` shows the client-side shape we need to satisfy.

**Mass storage backing file:**

For mass-storage personas (e.g. `echo-mini-empty`), the persona's `massStorageBackingFile` field is set. When this field is present, the `lima-test-vm` runner:
1. During `prepare()`: stages the FAT32 image from the persona directory to a known backing-file path in the test VM (e.g. `/var/device-testing/backing.img`). The `usb_f_mass_storage` gadget function is configured to use this path as its `lun0/file`.
2. Between tests in the same SystemState group: resets the backing file using the persona's `resetStrategy`:
   - `copy`: copies the reference image to the backing-file path (simple; right for small images)
   - `swap`: atomically renames/swaps a reference copy to the active path (faster for large images)

The daemon does not manage the backing file lifecycle directly — it is the runner's responsibility. The daemon only configures the `usb_f_mass_storage` function to point at the known path. If no `massStorageBackingFile` is set (iPod personas), the mass-storage function is not configured.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Daemon source lives at tools/device-testing/dummy-hcd/ with a clear build process producing a static Linux binary
- [ ] #2 Daemon binary is included in the test VM at a documented path (e.g. /usr/local/bin/dummy-hcd-daemon)
- [ ] #3 Daemon accepts --persona <id> flag and loads the JSON registry sidecar produced by the lima-test-vm runner
- [ ] #4 Daemon handles vendor control transfer 0xC0/0x40/0x02 with paged SysInfoExtended XML; short read on final page terminates iteration
- [ ] #5 Integration test from the host: synthesise an `ipod-video-5g-fresh` device via the daemon, run `podkit device scan` from within the test VM, assert the device is identified as iPod 5G Video
- [ ] #6 Daemon process supervisor (systemd unit OR simple init script in the VM) restarts the daemon between tests cleanly
- [ ] #7 README documents the daemon protocol, the JSON sidecar format, and how to add a new persona handler
- [ ] #8 When a persona's massStorageBackingFile is set, the runner stages the FAT32 image to the test VM before the first test in the group
- [ ] #9 Backing file is reset between tests within the same SystemState group using the persona's resetStrategy (copy or swap)
- [ ] #10 Backing file lifecycle is managed by the runner, not the daemon; documented in the runner's source and the README
<!-- AC:END -->
