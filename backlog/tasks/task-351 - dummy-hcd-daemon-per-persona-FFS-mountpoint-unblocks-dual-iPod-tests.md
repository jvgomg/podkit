---
id: TASK-351
title: 'dummy-hcd-daemon: per-persona FFS mountpoint (unblocks dual-iPod tests)'
status: Done
assignee: []
created_date: '2026-05-23 15:52'
updated_date: '2026-05-24 09:25'
labels:
  - vm-testing
  - tier-3
  - infrastructure
  - follow-up
  - dummy-hcd
milestone: m-19
dependencies: []
priority: medium
ordinal: 10200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Daemon hardcodes `/dev/ffs-podkit` mountpoint. Second daemon for different persona fails:

```
mount: /dev/ffs-podkit: already mounted
systemctl: dummy-hcd-daemon@<id>.service exited 4
```

Blocks:
- TASK-311 AC #6: multiple iPods simultaneously
- TASK-341 AC #2: dual-iPod discovery scenarios (partial defer)
- Future multi-iPod doctor flows

## Scope
1. Replace hardcoded `/dev/ffs-podkit` with per-persona path (e.g. `/dev/ffs-podkit-<personaId>`)
2. Update systemd template `dummy-hcd-daemon@.service` to pass persona id as mountpoint suffix
3. Update daemon CLI + gadget.ts + functionfs.ts to honour new flag
4. Extend mass-storage-binding.tier3.test.ts smoke test for dual-daemon lifecycle
5. Verify TASK-341 AC #2 dual-persona + TASK-311 AC #6 unblocked

## References
- `tools/device-testing/dummy-hcd/src/main.ts` — hardcoded FFS_MOUNT
- `tools/device-testing/dummy-hcd/dummy-hcd-daemon@.service` — systemd template
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Daemon accepts per-persona FFS mountpoint (CLI flag + systemd template arg)
- [x] #2 Two concurrent dummy-hcd-daemon@<id> services start cleanly with distinct mountpoints
- [x] #3 Smoke test verifies dual-daemon lifecycle (start two, both /dev/sg appear, stop both, no orphan configfs)
- [x] #4 TASK-311 AC #6 + TASK-341 AC #2 dual-iPod scenarios unblocked
- [x] #5 Tier-3 baseline remains GREEN
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Replaced hardcoded `/dev/ffs-podkit` mountpoint and `podkit-test` gadget name in `dummy-hcd-daemon@.service` with per-persona derivations via `--gadget-name podkit-%i --ffs-mount /dev/ffs-podkit-%i`. CLI already accepted both flags; no daemon code changes needed for the flag-plumbing itself.

Side fixes the change exposed:
- `attachUdc` (gadget.ts) — walked `/sys/kernel/config/usb_gadget/*/UDC` to skip already-claimed UDCs so the second daemon picks a free one. Uses the configfs UDC value (authoritative) rather than `/sys/class/udc/<n>/state` (latches at `configured` on dummy_hcd, never goes back). Read-then-write is NOT atomic — relies on callers serialising `systemctl start`.
- `runFunctionFs` (functionfs.ts) — drains any leftover lazy-unmounted FFS instance at the mountpoint before mounting fresh. A previous daemon's `umount -l` survives if the bun process was SIGKILLed, and stacking mounts is silent corruption.
- `test-vm.yaml` — added `/etc/modprobe.d/podkit-test-vm-dummy-hcd.conf` with `options dummy_hcd num=4`. Without this, only one virtual UDC exists and the second daemon's attachUdc throws. Boot-time modprobe + a one-shot `rmmod dummy_hcd && modprobe dummy_hcd num=4` during provisioning flush any stale `num=1` instance.

Smoke test: `packages/device-testing/src/tier3/dual-daemon-lifecycle.tier3.test.ts` boots echo-mini (mass-storage) + ipod-video-5g-iflash-1tb (FFS+mass-storage) concurrently, asserts both configfs trees + ≥+2 `/dev/sg*` nodes, then verifies clean teardown. Defensive `sweepOrphanGadgets()` in beforeAll papers over an EPERM in destroyGadget for `mass_storage.0/lun.0` (tracked separately in TASK-353).

Comment refreshes in discovery.tier3.test.ts and discovery-reconciliation.tier3.test.ts — dual-iPod is no longer "infrastructure-blocked", just left as a follow-up scope decision.

Files:
- tools/device-testing/dummy-hcd/dummy-hcd-daemon@.service
- tools/device-testing/dummy-hcd/src/cli.ts (clarifying comment)
- tools/device-testing/dummy-hcd/src/functionfs.ts
- tools/device-testing/dummy-hcd/src/gadget.ts
- tools/device-testing/lima/test-vm.yaml (modprobe.d num=4)
- packages/device-testing/src/tier3/discovery.tier3.test.ts (comment)
- packages/device-testing/src/tier3/discovery-reconciliation.tier3.test.ts (comment)
- packages/device-testing/src/tier3/dual-daemon-lifecycle.tier3.test.ts (new)

Verification:
- VM has 4 UDCs at `/sys/class/udc/dummy_udc.{0..3}`
- Tier-3 (dual-daemon-lifecycle): 1 pass / 0 fail / 9.4s
- Tier-3 baseline (personas-baseline + mass-storage-binding): 10 pass / 0 fail / 36.5s

Follow-up: TASK-353 (destroyGadget EPERM on mass_storage.0/lun.0 rmdir).
<!-- SECTION:NOTES:END -->
