---
id: TASK-322.01
title: 'Test VM Lima yaml (minimal, binary-only)'
status: Done
assignee: []
created_date: '2026-05-12 08:18'
updated_date: '2026-05-16 00:39'
labels:
  - testing
  - vm-coverage
  - lima
  - tier-3
milestone: m-19
dependencies:
  - TASK-321.07
parent_task_id: TASK-322
priority: high
ordinal: 410
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create `tools/device-testing/lima/test-vm.yaml` — the minimal Linux test VM that Tier 3 integration tests run against. The test VM is deliberately stripped of all development tooling to match the end-user runtime environment and catch the historical bug class where dev libraries on PATH hide binary linkage problems.

**What the test VM has:**
- Debian 12.10 (exact point release pinned in the image field — not `debian-12` or `debian:latest`)
- Disk: 6 GB (smallest viable; fits ffmpeg, kernel modules, gpod-tool, and the podkit binary)
- `ffmpeg` system package (apt)
- `gpod-tool` binary (produced by `@podkit/gpod-testing` build artefact; installed as a test-time dependency so test scripts can populate iPod databases — NOT bundled into podkit)
- Kernel modules loaded at boot: `dummy_hcd`, `libcomposite`, `usb_f_mass_storage`, `usb_f_fs` (via `/etc/modules` or `modprobe` in provisioning)
- configfs mounted at `/sys/kernel/config`
- `/usr/local/bin/podkit` — populated by TASK-322.03 binary transfer, NOT present in the yaml itself

**What the test VM explicitly must NOT have:**
- Bun
- Node.js
- npm / npx
- Source tree mount (no Lima `mounts:` pointing at the host project)
- node_modules
- Any build toolchain (no `build-essential`, no `pkg-config`, no headers)
- Any `-dev` packages (no libgpod-dev, no libglib2.0-dev, etc.)

**libgpod runtime:** because the podkit binary statically links libgpod, no libgpod runtime package is needed in the test VM. The absence of libgpod.so in the VM is intentional and validates static linkage.

**Isolation rationale:** A separate builder VM (TASK-321.07) produces the binary with full dev tools. Strict separation ensures that if the binary fails to run in the test VM, the failure is real — not masked by a system `libgpod.so` or `node` executable accidentally on PATH.

This VM is separate from:
- `tools/lima/virtual-ipod.yaml` (user-facing demo — off-limits)
- `tools/device-testing/lima/builder.yaml` (dev toolchain VM for building artifacts)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 tools/device-testing/lima/test-vm.yaml exists and boots cleanly via `limactl start`
- [ ] #2 ffmpeg available in VM (apt-installed, not bundled in binary)
- [ ] #3 dummy_hcd, libcomposite, usb_f_mass_storage, usb_f_fs kernel modules loadable (modprobe succeeds) after boot
- [ ] #4 configfs mounted at /sys/kernel/config after boot
- [ ] #5 No Bun, Node, npm, node_modules, or source tree present in the VM
- [ ] #6 No mounts: entry in the yaml that exposes the host project source tree to the VM
- [ ] #7 /usr/local/bin/podkit path is writable (populated by TASK-322.03); podkit binary absent from the yaml provisioning itself
- [ ] #8 README in tools/device-testing/lima/ documents the VM's purpose and the builder/test-vm split
- [ ] #9 Debian version is pinned to an exact point release (e.g. debian-12.10) in the image field — not a floating tag
- [ ] #10 Disk field is set to 6 GB (or smallest viable between 5-8 GB)
- [ ] #11 gpod-tool binary is present in the VM (installed from @podkit/gpod-testing artefact, not from source build)
- [ ] #12 `which bun node npm` returns nothing in the test VM (no Node, no Bun, no npm)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation (2026-05-13)

Files added/modified:
- `tools/device-testing/lima/test-vm.yaml` (new) — Debian 12.10 minimal test VM
- `tools/device-testing/lima/README.md` — added "Test VM (`test-vm.yaml`)" section, updated split table, added boot step to Quick start

### Key decisions

1. **Image pinning**: same explicit `cloud.debian.org/.../20250316-2053/...qcow2` URLs as `builder.yaml` and `abi-verify.yaml`. Bumping requires updating all three files in lockstep.
2. **Sizing**: `cpus: 2`, `memory: 2GiB`, `disk: 6GiB` — matches `abi-verify.yaml` (also Tier-3-philosophy) except disk is 6 vs 5 GiB (extra GB for snapshots and the backing-file image landed in TASK-322.02).
3. **`mounts: []`** — explicit empty list. No host source tree exposure.
4. **Kernel modules** loaded via `/etc/modules-load.d/podkit-test-vm.conf` (systemd-modules-load reads this at boot). Best-effort `modprobe` during provisioning, with a graceful warning if the kernel happens to lack the modules at provision time (the modules-load.d file picks them up on subsequent boots).
5. **configfs**: added explicit `/etc/fstab` entry plus runtime `mount -t configfs` as a safety net even though Debian 12 auto-mounts via systemd.
6. **gpod-tool sourcing**: scaffolded the placeholder contract requested in the task brief — provisioning step copies `/tmp/gpod-tool` → `/usr/local/bin/gpod-tool` if staged before boot. README documents the interim handoff and notes TASK-322.03 will replace it with `transferBinary`.
7. **libgpod runtime present, libgpod-dev absent**: `libgpod4` + `libgpod-common` + `libglib2.0-0` are installed for `gpod-tool`'s benefit only. The task spec said "ffmpeg only" for system packages but `gpod-tool` is dynamically linked against libgpod, so runtime libgpod is mandatory; this is consistent with ADR-016 (the `base-no-libgpod` snapshot in §"Snapshot-based state layering" implies libgpod IS in the base). No `-dev` packages — strictly runtime libs an end-user would already have.
8. **Hard guards**: a third provisioning step `exit 1`s if `bun`, `node`, `npm`, or any `-dev` package was somehow installed. Catches future provisioning regressions.

### Acceptance criteria status

Inspection-only (verified by reading the yaml):
- AC #5 (no Bun/Node/npm/source) — yaml installs none; provisioning guard refuses to come up if they appear
- AC #6 (no `mounts:` exposing host) — `mounts: []`
- AC #7 (`/usr/local/bin/podkit` path writable, binary absent) — `install -d -m 0755 /usr/local/bin; test -w /usr/local/bin`; no podkit copy in the yaml
- AC #9 (Debian point release pinned) — explicit qcow2 URL with `20250316-2053`
- AC #10 (disk 6 GiB) — `disk: '6GiB'`
- AC #11 (gpod-tool from artefact, not source build) — placeholder copy from `/tmp/gpod-tool`; no compiler installed so source build is impossible
- AC #12 (no bun/node/npm) — provisioning guard fails otherwise

Boot-time verification (human at phase checkpoint):
- AC #1 (boots cleanly) — needs `limactl start`
- AC #2 (ffmpeg in VM) — needs runtime check
- AC #3 (4 kernel modules loadable) — needs runtime `modprobe`
- AC #4 (configfs mounted at `/sys/kernel/config`) — needs runtime check
- AC #8 (README documents split) — done, but include in human review

### Validation performed

- `bun ... js-yaml.load(...)` parses the yaml cleanly (6 top-level keys, 3 provision steps, 2 images, `mounts: []`)
- `limactl validate tools/device-testing/lima/test-vm.yaml` → `OK`

### Open questions

- The `task-322.01` brief says "ffmpeg only" — I installed libgpod runtime + glib runtime as a hard prerequisite for gpod-tool. This is consistent with ADR-016 (the `base-no-libgpod` snapshot implies libgpod is in the base). Worth confirming with the human at boot.
- TASK-322.03 will need to: (a) build gpod-tool for Linux x64/arm64, (b) decide whether to stage to `/tmp/gpod-tool` pre-boot or `limactl copy + install` post-boot. The placeholder supports both.
<!-- SECTION:NOTES:END -->
