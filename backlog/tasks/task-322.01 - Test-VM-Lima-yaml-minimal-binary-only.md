---
id: TASK-322.01
title: 'Test VM Lima yaml (minimal, binary-only)'
status: To Do
assignee: []
created_date: '2026-05-12 08:18'
updated_date: '2026-05-12 11:58'
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
