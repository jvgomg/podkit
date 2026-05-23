---
id: TASK-346
title: 'Test VM: load sg kernel module + verify daemon mass-storage gadget path'
status: Done
assignee: []
created_date: '2026-05-17 14:41'
updated_date: '2026-05-18 18:57'
labels:
  - vm-testing
  - tier-3
  - infrastructure
  - scsi-synthesis
milestone: m-19
dependencies: []
priority: high
ordinal: 100
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Close a gap in the Tier-3 test VM: SCSI synthesis was never wired in, so `/dev/sg*` nodes never appear and `podkit doctor`'s `inquiry-methods` check warns on a "healthy" VM. The `dummy-hcd` daemon already supports mass-storage gadget composition (`bindFfs && bindMassStorage` flags in `tools/device-testing/dummy-hcd/src/gadget.ts`) — what's missing is (a) the `sg` kernel module is not loaded at boot and (b) no smoke test verifies the daemon's mass-storage path end-to-end.

This task lays the infrastructure layer. **TASK-A2 (sibling)** uses it to migrate iPod personas onto mass-storage backing.

## Background

The Tier-3 test VM (`podkit-test-vm`, see `tools/device-testing/lima/test-vm.yaml`) was designed in TASK-322.* to synthesize USB devices via `dummy_hcd` + a custom FunctionFS daemon. FunctionFS handles the vendor-control-transfer path (SCSI VPD page 0xC0 inquiry that podkit uses to read iPod SysInfoExtended). The SCSI-block path (kernel-side `/dev/sg*`, mountable block device) was an unplanned omission — the daemon code anticipated it but the VM provisioning never loaded `sg` and no persona ever exercised it.

Consequence: today's `personas-baseline.tier3.test.ts` fails because the `healthy` SystemState fixture expects `inquiry-methods: pass, /dev/sg* present` but the VM cannot produce that state for any persona.

## Scope

1. **`tools/device-testing/lima/test-vm.yaml`** — extend `/etc/modules-load.d/podkit-test-vm.conf` to include `sg`. Verify the module is present in Debian 12.10's stock kernel (it is — `sg` is part of `linux-image-amd64`).
2. **`tools/device-testing/scripts/apply-state.sh`** — add `sg` to `HEALTHY_MODULES` so state restoration preserves it across resets.
3. **Smoke test** — new file (e.g. `tools/device-testing/dummy-hcd/src/__tests__/mass-storage-binding.tier3.test.ts` OR fold into existing Tier-3 baseline). Hand-craft a 64MB FAT32 image inside the VM via `mkfs.vfat`, invoke `bindGadget({ bindFfs: false, bindMassStorage: true, persona: <synthetic> })`, assert:
   - `/dev/sg<N>` appears for the synthesised gadget
   - `lsblk -J /dev/sd<N>` reports the block device
   - The FAT32 partition is mountable
   - `unbindGadget` removes both nodes; no orphan configfs entries
4. **No persona changes** — that's TASK-A2's job.
5. **No fixture changes** — the `healthy` fixture stays as-is; this task makes the VM able to satisfy it.

## Out of scope

- Migrating iPod personas to use mass-storage backing (TASK-A2).
- Loading `usb_f_mass_storage` — already loaded per `test-vm.yaml`.
- HFS+ support — TASK-317.12 refuses HFS+ on Linux; we only synthesize FAT32.

## References

- `adr/adr-016-linux-vm-test-harness.md` — VM test harness architecture
- `tools/device-testing/dummy-hcd/src/gadget.ts` lines 62–72, 121–133 — existing `bindMassStorage` implementation
- `packages/podkit-core/src/diagnostics/checks/inquiry-methods.ts` — the check that surfaces the gap
- `packages/device-testing/src/system-states/healthy.ts` — fixture this enables
- `backlog/tasks/task-322 - Phase-3-Linux-VM-test-harness.md` — parent design
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 sg kernel module loaded at VM boot — `limactl shell podkit-test-vm -- lsmod | grep -E '^sg '` returns non-empty
- [x] #2 sg module survives `apply-state.sh base-healthy` restore (still loaded after state flip)
- [x] #3 Smoke test: daemon binds a synthetic FAT32 mass-storage gadget → /dev/sg* and /dev/sd* appear → unbind → both nodes cleaned up
- [x] #4 Smoke test: synthesized FAT32 image is mountable via `mount -t vfat /dev/sd<N> /mnt` (read + write OK)
- [x] #5 Smoke test: no orphan configfs entries under /sys/kernel/config/usb_gadget/ after teardown
- [x] #6 No regressions: existing Tier-3 USB-only tests (`personas-baseline.tier3.test.ts`) continue to pass for personas where `massStorageBackingFile === null`
- [x] #7 `bun run typecheck --filter @podkit/device-testing` + `bun run build --filter @podkit/device-testing` + `bun run test --filter @podkit/device-testing` pass
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## 2026-05-18 — landed

Landed across two work sessions. Infrastructure half was finished by a previous worker; this session added the smoke test.

### Infrastructure (previous worker)

- `tools/device-testing/lima/test-vm.yaml` — added `sg` to `/etc/modules-load.d/podkit-test-vm.conf`, plus a provisioning `modprobe sg` loop. Added `dosfstools` to the apt list for `mkfs.vfat`.
- `tools/device-testing/scripts/apply-state.sh` — added `sg` to `HEALTHY_MODULES` so state restoration preserves it.
- `tools/device-testing/dummy-hcd/src/main.ts` — fixed a Bun event-loop drain bug on the mass-storage-only branch (`bindFfs=false, bindMassStorage=true`). Without an open file descriptor (FunctionFS ep0 was the implicit anchor), Bun drains the loop ~16ms after `attachUdc()` and exits, leaving the gadget bound but the daemon process gone. Fix: a 1-hour `setInterval` keep-alive that the signal handler clears during teardown. Documented inline in main.ts.

### Smoke test (this session)

- New file: `packages/device-testing/src/tier3/mass-storage-binding.tier3.test.ts`
- Co-locates with `personas-baseline.tier3.test.ts` so the same `resolveTier3Availability` gating applies.
- Builds a 64MB FAT32 image inside the VM via `truncate` + `mkfs.vfat`. Writes a synthetic sidecar to `/tmp/smoke-sidecar.json` (NOT the shared `/var/device-testing/personas.json` — see test header for why). Starts the daemon via `nohup sudo /usr/local/bin/dummy-hcd-daemon ...`. Polls `/sys/class/scsi_generic/` for an sg node whose backing USB device has matching `idVendor=05ac`/`idProduct=1209`. Mounts the resulting `/dev/sd<N>`, round-trips a byte, unmounts, SIGTERMs the daemon, polls for cleanup, asserts no orphan configfs tree.
- Daemon-stop uses `ps -C dummy-hcd-daemon -o pid=` (basename match), NOT `pkill -f` (full-cmdline match). `pkill -f` matched the test's own `sh -c "..."` wrapper inside `limactl shell` and killed its own parent shell, surfacing as exit 255. Documented inline.
- Idempotent cleanup in `beforeAll` + `finally` purge any lingering daemon/configfs state from a prior failed run.

### Quality gates (all green)

- `bun run typecheck --filter @podkit/device-testing` — pass
- `bun run build --filter @podkit/device-testing` — pass
- `bun run test --filter @podkit/device-testing` — 271 pass, 14 skip, 0 fail (Tier-3 skipped on default run)
- `PODKIT_DEVTEST_RUN_TIER3=1 bun test src/tier3/mass-storage-binding.tier3.test.ts` — 1 pass, 15 expect() calls, ~7s
- `PODKIT_DEVTEST_RUN_TIER3=1 bun test src/tier3` — smoke test green; the 4 pre-existing failures in `personas-baseline.tier3.test.ts` remain (TASK-348 is the fix for those).

### Notes for TASK-348

- The smoke test path is independent of TASK-348's persona schema work — they can land in any order.
- When migrating a starter persona onto mass-storage backing, the daemon's mass-storage-only path is verified working. The Bun keep-alive interval also covers the compound `bindFfs=true && bindMassStorage=true` case (no harm, the interval is just dead weight when FFS holds the loop open).
- The smoke test asserts the kernel produces `/dev/sg*` AND `/dev/sd*` simultaneously — TASK-348's persona migration can rely on both being present for the FAT32-backed personas.
<!-- SECTION:NOTES:END -->
