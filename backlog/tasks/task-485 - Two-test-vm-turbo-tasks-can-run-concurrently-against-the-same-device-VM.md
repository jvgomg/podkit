---
id: TASK-485
title: 'Two test:vm turbo tasks can run concurrently against the same device VM'
status: To Do
assignee: []
created_date: '2026-08-24 21:43'
labels:
  - testing
  - vm
  - ci
  - flaky
dependencies: []
references:
  - turbo.json
  - test-packages/device-testing-daemon/src/gadget.ts
  - test-packages/device-testing/src/runners/lima-test-vm-systemd.ts
priority: medium
ordinal: 264000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`@podkit/device-testing#test:vm` and `@podkit/e2e-vm-tests#test:vm` both declare `dependsOn: []` in `turbo.json`, so turbo is free to schedule them **at the same time against the same `podkit-device` VM**. Both start and stop persona `dummy-hcd-daemon@<persona>.service` units and both mutate in-VM state (backing files, SystemStates via `apply-state.sh`, udev rules).

Nothing prevents the overlap. The `@podkit/lima` advisory lock does not apply — it guards VM *start*, not in-VM test activity, and by the time either suite runs the VM is already up and neither holds anything.

**Why this matters.** `attachUdc` picks the lowest-numbered free controller by a read-then-write that is explicitly **not** atomic — its own docblock notes that "two daemons racing the window could both pick the same UDC" and that callers must serialise their `systemctl start` invocations. Each suite *does* serialise its own starts, but nothing serialises one suite against the other. Two suites interleaving persona lifecycles on one VM can therefore collide on a controller, and can also apply conflicting SystemStates underneath each other.

This is a plausible independent contributor to the flakiness investigated under TASK-483. That work bounded the waits and made setup reap crash-stranded gadget state, which removes the pathological multi-minute timeouts and the permanent leaks — but it does not stop two suites racing for the same controller in the first place.

**Not yet observed directly.** Turbo's scheduling may happen to order them in practice today (the device-testing suite is much shorter, and both depend on `vm:install`/`vm:doctor` which may serialise them incidentally). Worth confirming with `--dry=json` whether the two are genuinely eligible to run in parallel before designing a fix — if turbo already orders them for an incidental reason, that ordering is load-bearing and undocumented, which is its own problem.

**Fix options:**
1. Give the two an explicit ordering edge in `turbo.json` so one cannot start until the other finishes. Simplest, and honest about the fact that they share one VM.
2. Take a shared lock over the device VM for the duration of a VM test suite, reusing the `proper-lockfile` helper in `@podkit/lima`. More general — it would also cover a developer running `test:vm` while something else drives the VM — at the cost of a lock held for minutes.

Option 1 is likely right for the immediate problem; option 2 is the more complete answer if VM-driving surfaces keep multiplying.
<!-- SECTION:DESCRIPTION:END -->
