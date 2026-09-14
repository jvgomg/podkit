---
id: TASK-520
title: Builder contract and a Proxmox builder VM
status: To Do
assignee: []
created_date: '2026-09-14 19:47'
labels:
  - testing
  - infrastructure
  - ready-for-human
milestone: m-20
dependencies:
  - TASK-494
references:
  - docs/adr/adr-029-portable-device-substrate.md
  - docs/environments/device-substrate-proxmox.md
  - test-packages/device-testing/scripts/substrate-contract.sh
priority: high
type: task
ordinal: 273800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The device substrate answered "where do the tests run". This answers "where do the artifacts get built", for a developer whose only other hardware is a hypervisor.

**The builder is a guest, not a second machine.** A Mac plus a Proxmox host should be enough to exercise an amd64 substrate — no third box. The builder is a second VM on the same hypervisor, a sibling of the substrate, provisioned from the same cloud-init family and reached over the same `SubstrateLink`. Any amd64 machine a contributor already owns can fill the role instead; the repo declares the role, the machine fills it.

**It carries the inverse of the substrate contract.** The substrate's defining assertion is that no toolchain and no `-dev` packages are present — precisely what lets it catch static-linkage regressions in a binary that claims to need none. A builder needs exactly those packages. So this is a **second profile**: `provision-builder.sh` plus `builder-doctor.sh`, mirroring the substrate pair rather than extending it.

Do not merge the two contracts or give them a shared base of "common" packages. The day they share a definition is the day a toolchain can reach the box whose entire job is to prove one is not needed. Shared *mechanism* (copy the scripts in, run them as root, exit code is the verdict) is the thing to reuse — not shared package lists.

**Sizing and lifecycle.** The existing Lima builder runs 4 GiB / 4 vCPU; the substrate is 2 GiB. On a modest hypervisor they will not generally coexist, so the builder is persistent but **stopped when idle** — started for a build, shut down after. Until TASK-515 lands that is `qm start` / `qm shutdown` by hand, which is friction worth measuring rather than assuming: if it proves intolerable, that is the argument for prioritising 515 over further build work.

What the builder must be able to produce: the glibc `podkit` binary, the `podkit-debug` build, the daemon, `gpod-tool`, and the native `libgpod-node` prebuild that `compile.sh` embeds. The musl artifacts come from an Alpine container **on** the builder rather than from a second VM.

Deliverables mirror TASK-493: the two scripts, a cloud-init variant, the `qm create` recipe, and a playbook section. Registry gains a builder entry carrying its ssh alias name and its `(arch, libc)`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 provision-builder.sh and builder-doctor.sh exist as portable Debian bash, sharing the substrate scripts' mechanism but not their package lists
- [ ] #2 builder-doctor.sh asserts the toolchain the builder needs, and does not assert the substrate's no-toolchain invariant
- [ ] #3 A Proxmox builder VM exists, passes its doctor, and survives a reboot
- [ ] #4 The registry carries a builder entry with an ssh alias name and its arch and libc, and no hostname
- [ ] #5 The builder produces the glibc podkit binary, podkit-debug, the daemon, gpod-tool and the libgpod-node prebuild
- [ ] #6 musl artifacts are produced by an Alpine container on the builder rather than a second VM
- [ ] #7 The playbook documents provisioning it, and its start-for-a-build / stop-after operating mode
- [ ] #8 No hostname, pool, storage, bridge or credential appears in any committed file
<!-- AC:END -->
