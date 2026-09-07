---
id: TASK-493
title: >-
  Provision a sibling Proxmox device substrate and prove the harness over plain
  SSH
status: To Do
assignee: []
created_date: '2026-09-07 23:35'
labels:
  - testing
  - infrastructure
dependencies: []
references:
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
  - docs/adr/adr-016-linux-vm-test-harness.md
  - test-packages/lima/vms/podkit-device.yaml
priority: high
type: task
ordinal: 272000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 2 of ADR-028 — prove the substrate by hand *before* refactoring 13 files against it.

Stand up a **sibling** Proxmox VM (a peer of the Linux dev box, not a nested hypervisor) that satisfies the device harness's kernel requirements, and drive the existing harness against it manually over `ssh` + `scp` to validate the premise.

**Why sibling, not nested:** the harness needs `dummy_hcd num=4`, `libcomposite`, `usb_f_fs`, `usb_f_mass_storage`, `sg` and configfs *in the guest kernel* — which stock Debian 12 cloud kernels ship. That is a guest-kernel requirement satisfied by any hypervisor, not a nested-virtualisation requirement.

**What to port:** `test-packages/lima/vms/podkit-device.yaml` is 253 lines of asserted invariants worth preserving — the module list (`:146-159`), `options dummy_hcd num=4` (`:169-173`), the configfs fstab entry (`:194-201`), the userland package set (`:127-136`), and the hard assertion that fails provisioning if `bun`, `node`, `npm` or any `-dev` package is present (`:240-253`). Note `mounts: []` (`:85`) is deliberate — no host mount, binaries arrive by explicit copy. That is what makes SSH a drop-in.

Deliver as a repo-owned cloud-init template plus a documented `qm create` recipe, run by hand. Full PVE API automation is deliberately deferred (ADR-028 §3).

**The manual proof:** `apply-state.sh` needs zero changes — it is portable Debian bash, and its only two Lima references are comments about `sg` permissions whose reasoning holds verbatim for SSH. So `scp apply-state.sh` + `ssh sudo ./apply-state.sh <state>`, then a persona bring-up and a `podkit device scan`, is a genuine end-to-end test of the whole premise before any refactor begins.

Host facts still to confirm on the PVE host: nested-virt availability, and whether the PVE kernel itself ships `dummy_hcd`.

Architecture note: the Mac is arm64 and the Linux box is amd64, so the substrate must be amd64 and artifacts are not interchangeable between machines.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Debian 12 Proxmox VM exists with dummy_hcd (num=4), libcomposite, usb_f_fs, usb_f_mass_storage, sg loaded at boot and configfs mounted
- [ ] #2 The cloud-init template and qm create recipe are committed to the repo
- [ ] #3 podkit-device.yaml's provisioning invariants are preserved, including the assertion that no toolchain or -dev packages are present
- [ ] #4 apply-state.sh runs unmodified in the substrate via scp + ssh
- [ ] #5 A persona can be brought up and observed by podkit device scan over SSH, with no limactl involved
- [ ] #6 Findings on PVE nested-virt and host dummy_hcd availability are recorded
<!-- AC:END -->
