---
id: TASK-322.05.01
title: FunctionFS descriptor handshake — close USB synthesis loop (live-VM)
status: To Do
assignee: []
created_date: '2026-05-14 19:22'
labels:
  - testing
  - vm-coverage
  - tier-3
  - functionfs
milestone: m-19
dependencies:
  - TASK-322.05
  - TASK-333
parent_task_id: TASK-322.05
priority: high
ordinal: 455
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Closes the deferred AC #5 from TASK-322.05 by implementing the FunctionFS descriptor handshake so the dummy-hcd-daemon presents a real USB device inside `podkit-test-vm`. Without this work the daemon mounts FunctionFS and opens ep0 but never publishes descriptors, so `dummy_hcd` never enumerates a device — `podkit device scan` sees nothing.

This must be done with a live test VM because the descriptor binary layout cannot be validated on macOS (no `dummy_hcd`, no FunctionFS).

**Work in scope:**

1. **Write the FunctionFS descriptor + strings tables to ep0** at the top of `runFunctionFs()` in `tools/device-testing/dummy-hcd/src/functionfs.ts`. The handshake is a plain `write(ep0_fd, buffer)` — NO ioctl. Buffer layout:
   - First 4 bytes: `FUNCTIONFS_DESCRIPTORS_MAGIC_V2 = 0x00000003` (little-endian)
   - Then `struct usb_functionfs_descs_head_v2` (length, flags, fs_count, hs_count, ss_count, possibly os_count)
   - Then full-speed endpoint descriptors, high-speed endpoint descriptors, super-speed endpoint descriptors as appropriate (we can ship FS+HS to start)
   - Second write: strings table (`FUNCTIONFS_STRINGS_MAGIC = 0x00000002`, `struct usb_functionfs_strings_head`, language-tagged strings)
2. **Block `runFunctionFs` on FUNCTIONFS_BIND** — the current scaffold returns the handle as soon as ep0 opens. The correct sequence is: write descriptors → wait for `FUNCTIONFS_BIND` event on ep0 → return. The latent-blocker comment in `functionfs.ts:100-104` already documents the requirement.
3. **Existing event-packet decoding is correct** — the 12-byte `usb_functionfs_event` parsing landed in 322.05's review sweep. This task just makes it actually fire by getting the kernel to send events.
4. **Verify in-VM end-to-end:** `mise run device-testing:build-linux` + `mise run device-testing:transfer-binary` + `mise run device-testing:transfer-daemon` (or equivalent), then from inside `podkit-test-vm`:
   - `sudo systemctl start dummy-hcd-daemon@ipod-video-5g-iflash-1tb`
   - `cat /sys/class/udc/dummy_udc.0/state` should be `configured`
   - `lsusb` should show the synthesized iPod (vendor=05ac, product=1209)
   - `podkit device scan --json` should list it
5. **Strengthen TASK-322.06 assertions:** replace the "well-formed JSON" check on `device scan` with the persona-vendor/product lookup documented in the TODO comment in `personas-baseline.tier3.test.ts`. Add a doctor-vs-state assertion once TASK-333 (system-only doctor mode) is also landed.

**Out of scope:**
- `FUNCTIONFS_IOCTL_STALL` for unrecognised requests (Bun cannot issue ioctls without FFI; a request that times out is acceptable for a test harness)
- Multiple personas attached simultaneously (one daemon = one persona, one gadget)

**References:**
- `tools/device-testing/dummy-hcd/src/functionfs.ts` — handshake TODO at lines ~100-115; event-packet decoding ready
- `tools/device-testing/dummy-hcd/src/main.ts` — `attachUdc` call order will need to wait for the BIND ready-signal
- `tools/device-testing/dummy-hcd/src/protocol.ts` — page-serving logic; already complete
- `packages/ipod-firmware/src/inquiry/usb.ts` lines ~340-410 — client-side vendor read shape
- `packages/virtual-ipod-server/src/gadget.ts` — existing configfs/dummy_hcd setup pattern (off-limits to modify; useful as reference)
- Kernel docs: `Documentation/usb/functionfs.rst`, `<linux/usb/functionfs.h>`
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 FunctionFS descriptor handshake is written via plain write() to ep0; no ioctl involved
- [ ] #2 runFunctionFs() does not return until the FUNCTIONFS_BIND event is observed on ep0 (or a documented timeout fires)
- [ ] #3 Inside podkit-test-vm: starting dummy-hcd-daemon@<persona> causes /sys/class/udc/dummy_udc.0/state to read 'configured' and lsusb to list the synthesized device with the persona's vendor/product IDs
- [ ] #4 podkit device scan --json inside the VM lists the synthesized persona; vendor/product match the persona's usbDescriptor
- [ ] #5 TASK-322.06's device-scan assertion is strengthened from 'well-formed JSON' to 'finds persona by vendor/product'; corresponding TODO comment is removed
- [ ] #6 Once TASK-333 lands: a doctor-vs-state assertion is added in TASK-322.06's tier3 file to compare `podkit doctor --scope system --json` to the SystemState fixture
- [ ] #7 Stopping the daemon cleanly unbinds the gadget; /sys/class/udc/dummy_udc.0/state returns to 'not attached'
- [ ] #8 All three starter personas (ipod-video-5g-iflash-1tb, ipod-nano-7g-space-gray, echo-mini) enumerate correctly
- [ ] #9 FunctionFS descriptor + strings buffer layout has a unit test on the host (verifies magic, length fields, endpoint counts) so regressions don't require a VM
<!-- AC:END -->
