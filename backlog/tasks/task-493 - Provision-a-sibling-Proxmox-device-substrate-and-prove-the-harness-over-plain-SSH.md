---
id: TASK-493
title: >-
  Provision a sibling Proxmox device substrate and prove the harness over plain
  SSH
status: To Do
assignee: []
created_date: '2026-09-07 23:35'
updated_date: '2026-09-13 18:35'
labels:
  - testing
  - infrastructure
  - ready-for-human
milestone: m-20
dependencies: []
references:
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
  - docs/adr/adr-016-linux-vm-test-harness.md
  - test-packages/lima/vms/podkit-device.yaml
  - >-
    backlog/docs/doc-060 -
    Portable-device-substrate-—-contract-provisioners-and-arch-decoupled-builds.md
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

Per doc-060 those invariants move into shared portable bash (`provision-substrate.sh`, `substrate-doctor.sh`) that both Lima and cloud-init call, rather than being re-encoded a second time in the template.

Deliver as a repo-owned cloud-init template plus a documented `qm create` recipe, run by hand. API-driven lifecycle is **not** deferred indefinitely as ADR-028 §3 had it — it is TASK-515 — but it is out of scope *here*: this slice is the hand-run proof, and every step it documents must be performable without a token.

**The manual proof:** `apply-state.sh` needs zero changes — it is portable Debian bash, and its only two Lima references are comments about `sg` permissions whose reasoning holds verbatim for SSH. So `scp apply-state.sh` + `ssh sudo ./apply-state.sh <state>`, then a persona bring-up and a `podkit device scan`, is a genuine end-to-end test of the whole premise before any refactor begins.

Host facts still to confirm on the PVE host: nested-virt availability, and whether the PVE kernel itself ships `dummy_hcd`.

Architecture note: the Mac is arm64 and the Linux box is amd64, so the substrate is amd64 and artifacts are per-arch. Host arch still implies target arch until TASK-514 decouples them, so an arm64 Mac cannot build for this substrate yet — drive the proof from the amd64 Linux box.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Debian 12 Proxmox VM exists with dummy_hcd (num=4), libcomposite, usb_f_fs, usb_f_mass_storage, sg loaded at boot and configfs mounted
- [ ] #2 The cloud-init template and qm create recipe are committed to the repo
- [ ] #3 podkit-device.yaml's provisioning invariants are preserved, including the assertion that no toolchain or -dev packages are present
- [ ] #4 apply-state.sh runs unmodified in the substrate via scp + ssh
- [ ] #5 A persona can be brought up and observed by podkit device scan over SSH, with no limactl involved
- [ ] #6 Findings on PVE nested-virt and host dummy_hcd availability are recorded
- [ ] #7 provision-substrate.sh and substrate-doctor.sh exist as portable Debian bash, and the Lima device YAML calls them instead of inlining the invariants
- [ ] #8 The doctor passes on the Lima substrate and on the Proxmox substrate, and its negative assertions fail on a non-conforming box naming the offending package
- [ ] #9 The pveum least-privilege recipe is committed, including the storage and SDN.Use grants
- [ ] #10 An environments playbook is committed in idempotent change-log style, stating the trusted-network security posture
- [ ] #11 No hostname, pool, storage, bridge or credential appears in any committed file
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: claude
created: 2026-09-13 18:34
---
Specced in doc-060. Scope is unchanged — this remains the hand-run proof, deliberately small enough to actually perform — but it now also ships the shared contract scripts, since the cloud-init template and the Lima YAML would otherwise encode the same invariants twice and drift.

Triage is `ready-for-human`, not `ready-for-agent`: the PVE-console steps (pveum recipe, qm create, snippet placement) need credentials an agent does not have. Everything downstream of first SSH is agent-workable.
---
<!-- COMMENTS:END -->
