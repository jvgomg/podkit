---
id: TASK-516
title: Run the substrate contract check on CI as a conformance backstop
status: In Progress
assignee: []
created_date: '2026-09-13 18:34'
updated_date: '2026-09-15 23:29'
labels:
  - testing
  - infrastructure
  - ci
  - ready-for-agent
milestone: m-20
dependencies:
  - TASK-493
references:
  - >-
    backlog/docs/doc-060 -
    Portable-device-substrate-—-contract-provisioners-and-arch-decoupled-builds.md
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
priority: medium
type: task
ordinal: 276000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 6 of doc-060. Small, and it is what makes the "a substrate is anything that passes the contract" claim credible rather than aspirational.

Run `provision-substrate.sh` followed by `substrate-doctor.sh` on a standard Linux CI runner and require exit zero. GitHub runners are full VMs and can `modprobe dummy_hcd`, so a runner plausibly satisfies the contract already — and if it does not, that is exactly the finding worth having, because it means the contract has quietly become "whatever one maintainer's box happens to be".

Also exercise the doctor's **negative** assertions: a runner with a toolchain installed must fail the check, and must fail it by naming the offending package rather than reporting a generic error. A doctor whose failure path is never exercised is a doctor that passes everything.

Note this is a **backstop**, in the sense CONTEXT.md defines: it is judged on what it stops from escaping, never on being the place work gets verified. Running the USB-synthesis cells on CI stays open — ADR-028 leaves it open deliberately and this task does not decide it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 CI provisions a standard Linux runner with the shared provisioning script and runs the doctor, requiring exit zero
- [ ] #2 The doctor's negative assertions are exercised against a deliberately non-conforming environment and name the offending package
- [ ] #3 The job is labelled as a conformance backstop, not as the gate
- [ ] #4 Findings are recorded if a stock CI runner cannot satisfy the contract
- [ ] #5 usb-synth on CI remains undecided and is not enabled by this task
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
The task's premise — "GitHub runners are full VMs and can `modprobe dummy_hcd`", restated from ADR-028 §6 — is the thing under test, and the prior evidence says it is false: Ubuntu does not enable `CONFIG_USB_DUMMY_HCD` in any kernel flavour, so no `linux-modules-extra` package carries it. So the workflow is built to *produce* that finding rather than assume either outcome.

**1. A premise job, informational, never gating.** Run `substrate-doctor.sh` unmodified on a bare `ubuntu-latest` and publish the verdict to the step summary. This is AC #4's finding generated continuously by CI rather than asserted from a blog post: it names exactly which contract assertions a stock hosted runner fails, and it flips to PASS on its own if GitHub ever ships the module.

**2. A conformance job that can actually reach exit zero.** Boot the repo's already-pinned Debian 12 generic cloud image (`@podkit/substrate`'s `substrateDebianImageUrl`, resolved with `bun -e` so nothing is restated) under QEMU/KVM on the runner, seeded by the *committed* `cloud-init.user-data.yaml`, then `scp` the three contract scripts in and run `provision-substrate.sh` followed by `substrate-doctor.sh` over plain SSH. That is the contract's own definition of a substrate — an SSH-reachable Debian box — and it is the same two steps the Proxmox path and `harness:setup` run, so it validates the cloud-init recipe as a side effect. KVM needs the documented udev rule; the runner is not in the `kvm` group by default.

**3. Negative assertions in the same guest, after it has passed.** Install `build-essential` and `npm` into the conforming box, re-run the doctor, and require exit 1 *plus* the literal strings `build-essential`, `libc6-dev` and `node` in its output. Asserting the names rather than the exit code is the point: a doctor that fails generically passes everything that matters.

**Shape.** A separate `substrate-conformance.yml`, deliberately not wired into `ci-passed` (AC #3), paths-filtered to the contract scripts on PRs plus a weekly schedule — a backstop against the contract drifting into "whatever one maintainer's box happens to be" is worth running on a clock, not on every push. QEMU bring-up lives in `test-packages/device-testing/substrate/ci/boot-substrate.sh`, a third provisioner recipe beside `substrate/proxmox/`, so it is shellcheck-linted and runnable by hand.

**Honesty about the gap.** If the premise job fails, conformance is proven on a guest *on* the runner, not on the runner. The hardware and hypervisor are still nobody's in this project, and the cloud-init recipe still gets exercised — but "a standard Linux CI runner passes the contract" would be false, and the workflow header must say so rather than imply otherwise.

**No new tests (AC deliberately not manufactured).** doc-060 Seam 4 makes `substrate-doctor.sh` the executable assertion and says explicitly that no new harness is introduced for it. The only new logic is shell glue whose assertion *is* the doctor's exit code.

**usb-synth stays undecided (AC #5).** Booting a Debian guest with `dummy_hcd` on a runner makes the usb-synth cells newly *possible*, which is exactly the decision this task must not make. Stated in the header; no usb-synth cell is run.
<!-- SECTION:PLAN:END -->
