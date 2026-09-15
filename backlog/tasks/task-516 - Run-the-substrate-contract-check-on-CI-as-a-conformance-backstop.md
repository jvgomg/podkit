---
id: TASK-516
title: Run the substrate contract check on CI as a conformance backstop
status: In Progress
assignee: []
created_date: '2026-09-13 18:34'
updated_date: '2026-09-15 23:47'
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
- [x] #3 The job is labelled as a conformance backstop, not as the gate
- [x] #4 Findings are recorded if a stock CI runner cannot satisfy the contract
- [x] #5 usb-synth on CI remains undecided and is not enabled by this task
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed in `bf948bcb` (plus review fixes). Status stays **In Progress**, not Done: three of the five ACs are satisfied by the committed artefacts, but AC #1 and AC #2 are evidenced only by construction — the workflow has never run. It has no `push` trigger, so the first run needs `workflow_dispatch` (or a PR touching the contract files). Tick those two off that run, not off this note.

**The premise the task was written on does not hold, and that is the main finding.** The description says "GitHub runners are full VMs and can `modprobe dummy_hcd`, so a runner plausibly satisfies the contract already" — restating ADR-028 §6. They cannot. Ubuntu does not enable `CONFIG_USB_DUMMY_HCD` in any kernel flavour, so no `linux-modules-extra-*` package carries the module; the runner *is* a full VM and that turns out not to be the binding constraint. A stock runner additionally fails on its base OS (Ubuntu reports the Debian testing branch it forked from, never `12.x`) and on every negative assertion at once, since the runner image ships bun, node, npm and dozens of `-dev` packages by design — which is the clearest available demonstration that "a machine that can build podkit" and "a machine that can prove podkit's binary needs nothing to run" are different machines.

Recorded in `docs/environments/device-substrate-ci.md` §Findings, with a correction blockquote on ADR-028 §6 (precedent: ADR-010's in-place "superseded in part" note). Both are explicit that the finding is currently **researched, not measured** — read off Ubuntu's kernel config and package archive. The `premise` job exists to convert it into a standing claim: it runs the doctor on the bare runner every run, publishes the verdict, and never fails, so it flips on its own if GitHub ever ships the module.

**How AC #1 was read, and where that reading is a stretch.** Taken literally — doctor on the runner itself, exit zero — it is unsatisfiable, for the reason above. It is implemented as doc-060's stated intent instead: "proof that the contract is satisfiable by a substrate nobody in this project provisioned". The conformance job boots the already-pinned Debian 12 generic cloud image under QEMU/KVM on the runner, seeded by the *committed* `cloud-init.user-data.yaml`, and runs `provision-substrate.sh` then `substrate-doctor.sh` over plain ssh — the same two steps `harness:setup` and the Proxmox playbook run. The hardware and hypervisor are still nobody's here, and the cloud-init template gets exercised for the first time outside a hand-run on a PVE host. But it is **not** "a hosted runner passes the contract", and the workflow header, the environments doc and this note all say so rather than letting the AC read as met. If that substitution is unacceptable, AC #1 is the thing to rewrite — not the implementation.

**Deviation from the recorded plan.** The plan said the negative assertion would require the doctor to name `build-essential`, `libc6-dev` and `node`. It requires `npm` instead of `node`: Debian's nodejs packaging has moved `/usr/bin/node` in and out of the `nodejs` package across releases, so asserting on it would fail for a reason unrelated to the doctor. The three names still cover both negative code paths and both branches of the dpkg sweep — a forbidden command on PATH, a forbidden package matched by name, and one matched by the `-dev` suffix rule rather than by any list.

**What was verified locally, and what was not.** Verified: shellcheck and prettier clean; full unit+integration suite green (69/69 turbo tasks); the cloud-init render against a key containing `&` and `/`; the ssh/scp argv construction against stub binaries; and all four paths of `assert-doctor-rejects.sh` — pass, doctor-exits-zero, generic-failure-without-names, and baseline-already-broken — with the name matching checked against real `substrate-doctor.sh` output. Not verified: the QEMU boot path and the KVM udev rule. The Linux dev box is an unprivileged LXC with no `/dev/kvm`, no `/lib/modules` and no QEMU — the same structural gap ADR-028 §Context describes, which is part of why this backstop exists at all.

**Review fixes applied after the first commit.** The environments doc showed `--no-install-recommends` on the QEMU install where the workflow deliberately omits it, while claiming "the workflow *is* this document executed" — following it by hand would have hit exactly the trap the workflow avoids, and `cloud-image-utils` has the same exposure (`cloud-localds` gets its ISO builder through Recommends, so stripping them yields a `cloud-localds` on PATH that cannot build a seed). The Preconditions table implied assertions nothing performs and now marks the one row that is actually checked. The ADR note claimed measurement that has not happened. The awk-substitution comment claimed the replacement text is never interpreted, which holds for sed's `/` and `&` but not for backslashes in `awk -v`. And the QEMU bring-up was framed as "the third provisioner recipe", which reads as shipping a supported provisioner — doc-060 puts that out of scope, so it is now framed as what it is: CI glue, runnable by hand only so a CI failure can be reproduced.

**usb-synth stays undecided (AC #5).** No cell runs and nothing presumes one. Worth flagging for whoever picks the question up: a Debian guest on a runner *does* have `dummy_hcd`, so the open question is now cost — the 3-10 minute floor per iteration ADR-028 weighed against rapid local loops — rather than capability. That changes the argument, not the decision.
<!-- SECTION:NOTES:END -->
