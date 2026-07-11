---
id: TASK-462
title: >-
  dummy-hcd-daemon: serve DEVICE-recipient (0xC0) SIE vendor read via
  FUNCTIONFS_ALL_CTRL_RECIP
status: Done
assignee: []
created_date: '2026-07-11 11:03'
updated_date: '2026-07-11 11:23'
labels:
  - testing
  - functionfs
  - vm
  - ipod-firmware
milestone: m-22
dependencies: []
references:
  - test-packages/device-testing-daemon/src/descriptors.ts
  - test-packages/device-testing-daemon/src/__tests__/descriptors.test.ts
  - documents/architecture/device/identity-support-matrix.md
  - test-packages/device-testing-daemon/src/protocol.ts
priority: high
ordinal: 222000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Why

TASK-443's in-container verification concluded that Linux FunctionFS "cannot serve DEVICE-level USB vendor reads" — the real iPod SysInfoExtended inquiry uses `bmRequestType=0xC0` (recipient=DEVICE), and the kernel appeared to STALL it before the daemon's ep0 saw a SETUP event. This blocked Tier-5 (TASK-451) AC#2 ("USB inquiry → SIE write through the image") and was recorded as settled fact in `documents/architecture/device/identity-support-matrix.md` §5.

That conclusion is **falsified**. The daemon's descriptor table set `flags = HAS_FS | HAS_HS` (0x03) but omitted `FUNCTIONFS_ALL_CTRL_RECIP` (bit 6, 0x40). The kernel's `ffs_func_req_match()` only forwards INTERFACE/ENDPOINT-recipient control requests to ep0 unless that flag is set; with it, the `default:` (RECIP_DEVICE) branch returns `user_flags & FUNCTIONFS_ALL_CTRL_RECIP` and the function claims the DEVICE-recipient vendor request, routing the SETUP to userspace.

## Proof (in podkit-device-harness VM, ipod-nano-4g-black persona, PID 0x1263)

Decisive A/B via a zero-dep `USBDEVFS_CONTROL` ioctl probe firing exactly `bmRequestType=0xC0, bRequest=0x40, wValue=0x02, wIndex=0, wLength=4096`:

- flags `0x03` (no flag): `RESULT=STALL errno=32` (EPIPE); daemon journal shows BIND+ENABLE but no SETUP.
- flags `0x43` (ALL_CTRL_RECIP): `RESULT=OK bytes=4096`, daemon served the persona's real SysInfoExtended `<?xml … <plist>` payload back over the DEVICE-recipient read.

Only the one-line flag OR changed between runs. The returned XML can only originate from `protocol.ts`'s handler, which runs only if the SETUP reached ep0.

## What changed (code done, uncommitted)

- `test-packages/device-testing-daemon/src/descriptors.ts`: add `FUNCTIONFS_ALL_CTRL_RECIP = 1 << 6` constant + OR it into the descriptor head flags (0x03 → 0x43), with a comment explaining the kernel routing.
- `test-packages/device-testing-daemon/src/__tests__/descriptors.test.ts`: pin flags to 0x43. 46 daemon unit tests green.

## Still to do

- Correct `documents/architecture/device/identity-support-matrix.md` §5 (remove the "FunctionFS cannot serve DEVICE-level" limitation note; the harness now serves the USB inquiry path).
- Feeds TASK-451 (Tier-5 AC#2 now achievable over real USB inquiry, no disk-SIE workaround) and reframes TASK-424/425 (SCSI VPD path is orthogonal, not the only harness route to inquiry coverage).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 descriptors.ts sets FUNCTIONFS_ALL_CTRL_RECIP; flags byte = 0x43
- [x] #2 descriptors.test.ts pins 0x43; daemon unit tests green
- [x] #3 In-VM A/B recorded: 0x03 STALLs, 0x43 serves SIE XML over 0xC0 (done)
- [x] #4 identity-support-matrix.md §5 corrected to reflect DEVICE-level reads now work in the harness
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Code + test + doc all done and green (46 daemon unit tests pass). Uncommitted — leaving Done until the user commits per their workflow. Experiment artifacts (probe script, one-off sidecar generator) were scratch/removed; only descriptors.ts + descriptors.test.ts + doc §5 remain as the change.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Resolved the FunctionFS DEVICE-level blocker that TASK-443 believed required infra work: the dummy-hcd-daemon's descriptor flags omitted FUNCTIONFS_ALL_CTRL_RECIP (bit 6). Without it the kernel routes only INTERFACE/ENDPOINT-recipient control requests to ep0 and STALLs DEVICE-recipient (bmRequestType=0xC0) vendor reads; with it, the recipient=DEVICE path claims the request and the SETUP reaches the daemon. One-line fix (flags 0x03 -> 0x43).

Proven by an in-VM A/B (ipod-nano-4g-black persona, PID 0x1263) with a zero-dep USBDEVFS_CONTROL ioctl probe firing bmRequestType=0xC0/bRequest=0x40/wValue=0x02: flags 0x03 -> STALL/EPIPE (no SETUP); flags 0x43 -> 4096 bytes = the persona's real SysInfoExtended XML. Only the flag OR changed between runs.

Changed: descriptors.ts (constant + flags + comment), descriptors.test.ts (pins 0x43), identity-support-matrix.md §4 test-harness note (corrected the falsified 'FunctionFS cannot serve DEVICE-level reads' claim). 46 daemon unit tests green. Sonnet-reviewed (SHIP); two nits fixed (branch-agnostic comment wording; removed a leaked task ID from the arch doc).

Impact: unblocks TASK-451 (Tier-5 AC#2 over real USB inquiry, no disk-SIE workaround) and reframes TASK-424/425 (SCSI VPD is now an independent transport, not the only route to inquiry coverage). No changeset — device-testing-daemon is a private test package.
<!-- SECTION:FINAL_SUMMARY:END -->
