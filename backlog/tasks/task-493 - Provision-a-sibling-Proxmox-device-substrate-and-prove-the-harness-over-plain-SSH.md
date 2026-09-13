---
id: TASK-493
title: >-
  Provision a sibling Proxmox device substrate and prove the harness over plain
  SSH
status: In Progress
assignee: []
created_date: '2026-09-07 23:35'
updated_date: '2026-09-13 19:38'
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
- [x] #1 A Debian 12 Proxmox VM exists with dummy_hcd (num=4), libcomposite, usb_f_fs, usb_f_mass_storage, sg loaded at boot and configfs mounted
- [x] #2 The cloud-init template and qm create recipe are committed to the repo
- [x] #3 podkit-device.yaml's provisioning invariants are preserved, including the assertion that no toolchain or -dev packages are present
- [x] #4 apply-state.sh runs unmodified in the substrate via scp + ssh
- [ ] #5 A persona can be brought up and observed by podkit device scan over SSH, with no limactl involved
- [x] #6 Findings on PVE nested-virt and host dummy_hcd availability are recorded
- [x] #7 provision-substrate.sh and substrate-doctor.sh exist as portable Debian bash, and the Lima device YAML calls them instead of inlining the invariants
- [x] #8 The doctor passes on the Lima substrate and on the Proxmox substrate, and its negative assertions fail on a non-conforming box naming the offending package
- [x] #9 The pveum least-privilege recipe is committed, including the storage and SDN.Use grants
- [x] #10 An environments playbook is committed in idempotent change-log style, stating the trusted-network security posture
- [x] #11 No hostname, pool, storage, bridge or credential appears in any committed file
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: claude
created: 2026-09-13 18:34
---
Specced in doc-060. Scope is unchanged — this remains the hand-run proof, deliberately small enough to actually perform — but it now also ships the shared contract scripts, since the cloud-init template and the Lima YAML would otherwise encode the same invariants twice and drift.

Triage is `ready-for-human`, not `ready-for-agent`: the PVE-console steps (pveum recipe, qm create, snippet placement) need credentials an agent does not have. Everything downstream of first SSH is agent-workable.
---

author: claude
created: 2026-09-13 18:59
---
Repo half landed in c58d1fd1. What is done and proven:

- The contract is three portable bash files: `substrate-contract.sh` (values), `provision-substrate.sh` (apply), `substrate-doctor.sh` (assert). `podkit-device.yaml` drops 253 → 74 lines and now only produces a plain Debian box.
- Doctor passes 22/22 on the Lima device VM the *old* YAML provisioned — so the extraction is lossless — and fails on the builder VM with 13 named failures, including every `-dev` package by name.
- `harness:setup` applies the contract and gates on the doctor before installing binaries. Full `test:vm` green: device-testing 38/38, e2e-vm-tests 194/194.
- Proxmox reference recipe committed: minimal cloud-init template, `pveum` recipe (privsep token scoped to one pool, including the `SDN.Use` and `Datastore.AllocateTemplate` grants that otherwise 403 late), and the environments playbook.

AC #7 is ticked but its wording is now wrong: Lima's `provision:` entries take an inline `script` or inline `content` and cannot reference a file, so the YAML does not *call* the scripts — `harness:setup` does, post-boot, which is the same two steps the Proxmox path runs. That symmetry is the better outcome and is why the YAML shrank so far.

AC #8 is deliberately left unticked: the Lima half and the negative assertions are proven, the Proxmox half is not — it needs the box.

Two design defects the work surfaced, both fixed:

1. Re-provisioning was destructive. An unconditional `rmmod dummy_hcd` tore down live UDCs, and since `harness:setup` now provisions every run, one person's setup could kill another's test run on a shared substrate. It now reloads only when the UDC count is actually wrong. This matters more for the remote substrate than for Lima.
2. Drift detection tracked the YAML because the invariants lived there. It now tracks the three contract scripts, and `vm:doctor` recommends `harness:setup` rather than destroying the VM — post-boot provisioning is idempotent, so a destroy costs a full image boot to fix nothing extra.

One deviation from doc-060, recorded deliberately: the doctor asserts the Debian MAJOR version hard and reports a differing point release as drift rather than failing it. The builder VM demonstrated why live — it reports 12.15 against a YAML pinning the 12.10 image, because apt moved it. `--strict` makes it fatal for template validation.

Remaining, all needing the PVE host: AC #1, #4, #5, #6, and the Proxmox half of #8.
---

---
author: claude
created: 2026-09-13 20:45
---

author: claude
created: 2026-09-13 19:38
---
Reviewed the fstab fix and re-ran the Lima half against it. The fix is right; three things came out of verifying it.

**The Lima VM was carrying the same bad line.** `configfs /sys/kernel/config configfs defaults 0 0`, with `CONFIG_CONFIGFS_FS=m` and the generated mount unit `RequiredBy=local-fs.target` and no `nofail` — structurally the same exposure. The new doctor assertion caught it, which is AC #8's Lima re-run.

**But Lima has been booting fine with it.** Boot at 15:55, `local-fs.target` active, zero failed units. So the failure is environment-dependent, not universal — Proxmox exposed it, arm64 Lima did not. I softened the doctor's message accordingly: it said the box *does* boot to emergency, which is a claim the first person to check on macOS would find false, and a doctor that overstates gets ignored. It now says "risks booting to emergency.target", with the measured asymmetry recorded in the comment above it. The assertion itself stays hard — the failure mode is unreachable-with-no-diagnostic and the fix costs nothing.

**Repaired and reboot-tested the Lima box.** This mattered because adding `x-systemd.after=` to a box whose mount already worked could have introduced the very failure being fixed. Re-provision rewrote the line (one line, no duplicate), then `vm:down` + `vm:up`: fresh boot, `local-fs` and `multi-user` active, zero failed units, and configfs now mounted *at boot* rather than by provisioning. Then `test:vm` green — 38/38 and 194/194.

Two robustness fixes to the rewrite itself: `grep -v` exits 1 when it selects no lines, which under `set -eu` would abort mid-rewrite on an fstab holding nothing else; and `mv` handed `/etc/fstab` whatever mode the umask produced, now an explicit `install -m 0644 -o root -g root`.

AC #8 ticked: doctor passes on both substrates, negatives verified on the builder VM naming every offending package.

Playbook gained an operational section for two facts worth not losing: pin the address before writing an ssh alias (a DHCP lease is not an identity, and the alias outlives the lease), and leave `onboot` off with start/shutdown over ssh — which is most of what TASK-515 replaces.

AC #5 is the only one left, and needs amd64 podkit + dummy-hcd-daemon + gpod-tool built and landed on the substrate.
---
<!-- COMMENTS:END -->
