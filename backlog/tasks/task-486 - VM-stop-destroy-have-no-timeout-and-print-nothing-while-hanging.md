---
id: TASK-486
title: VM stop/destroy have no timeout and print nothing while hanging
status: In Progress
assignee: []
created_date: '2026-08-28 00:46'
updated_date: '2026-08-28 00:52'
labels:
  - testing
  - vm
  - reliability
dependencies: []
references:
  - test-packages/lima/src/lifecycle.ts
  - test-packages/lima/src/streaming-runner.ts
  - test-packages/lima/src/limactl.ts
priority: medium
ordinal: 265000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Observed live** during VM-harness stress testing on 2026-08-28: a `bun run vm:down device` collided with an in-flight VM boot (a test's `prepare()` racing to start `podkit-device` after it had been stopped). The `stop` call hung for **2m47s with zero output** before being killed manually, leaving the VM in `limactl list` as `Running` but with SSH refused — a genuine wedge, recovered with `vm:recover device` + `harness:setup`.

**Cause.** `test-packages/lima/src/lifecycle.ts`'s `stop()`, `destroy()`, `ensureExists()` and `ensureRunning()` never pass `timeoutMs` to `runLimactl`. That is deliberate and documented — these wrap genuinely open-ended work: a cold `limactl start` that downloads an image and runs cloud-init legitimately takes five to ten minutes, and a bound short enough to be useful for `stop` would abort a legitimate create.

The gap is what happens when the *underlying* `limactl` or hostagent wedges rather than merely being slow. There is then no bound at all and no output, so the operator sees an indefinitely hanging command with nothing to distinguish "provisioning a large image" from "wedged forever". The bounded-wait work elsewhere in the harness (`runInVm`, `runViaLimactl`, the enumeration polls) exists precisely to avoid that shape.

**Why a naive fix is wrong.** Simply adding a timeout to these four risks aborting legitimate long provisions, which is worse than the current behaviour — a killed `limactl start` can leave a half-created instance. Any fix has to distinguish "slow but progressing" from "wedged".

**Options worth weighing:**
1. **Progress-based liveness rather than a wall-clock bound.** `limactl start` streams hostagent output, and the substrate already has a streaming runner (`streaming-runner.ts`) used for `start`/`create`. A watchdog that fires only when *no output has arrived* for N minutes would catch a wedge without penalising a slow-but-working provision. This is the most promising direction.
2. **Asymmetric bounds.** `stop` and `destroy` are not open-ended in the same way a cold create is — they act on an existing instance and should complete in tens of seconds. A generous bound (2-3 min) on those two alone would have caught the observed case, while leaving `ensureExists`/`ensureRunning` unbounded.
3. **Heartbeat output.** Even without a bound, printing "still waiting on `limactl stop` (Nm elapsed)" every 30s turns a silent hang into something an operator can reason about. Cheap, and complements either of the above.

Option 2 is the smallest change that would have caught the real incident; option 1 is the more complete answer.

**Related:** the same investigation found two places that spawned `limactl` directly instead of via `runLimactl`, losing the descriptive timeout message — `runInVm` (fixed, `152c8128`) and `runViaLimactl` in `lima-test-vm.ts` (fixed). Those were about the *message*; this task is about there being no bound at all.
<!-- SECTION:DESCRIPTION:END -->
