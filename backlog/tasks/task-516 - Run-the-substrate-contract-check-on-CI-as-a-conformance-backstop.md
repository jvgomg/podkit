---
id: TASK-516
title: Run the substrate contract check on CI as a conformance backstop
status: To Do
assignee: []
created_date: '2026-09-13 18:34'
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
