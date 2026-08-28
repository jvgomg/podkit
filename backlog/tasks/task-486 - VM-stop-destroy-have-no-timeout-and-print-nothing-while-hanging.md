---
id: TASK-486
title: VM stop/destroy have no timeout and print nothing while hanging
status: In Progress
assignee: []
created_date: '2026-08-28 00:46'
updated_date: '2026-08-28 01:26'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Chosen mechanism: options 2 + 3 in full, option 1 for the create path

The instruments are asymmetric by operation, because the operations differ in kind.

**Wall-clock bounds** (`test-packages/lima/src/lifecycle.ts`) on the operations that act on an instance that already exists:

| Operation | Constant | Value | Basis |
|---|---|---|---|
| `stop` | `STOP_TIMEOUT_MS` | 180s | Two systemd `DefaultTimeoutStopSec` stop-jobs (90s each on Debian) + hypervisor teardown |
| `destroy` | `DESTROY_TIMEOUT_MS` | 90s | `delete --force` awaits no guest shutdown; dominant term is unlinking a multi-GB diffdisk |
| `ensureRunning`, warm `start <name>` | `WARM_START_TIMEOUT_MS` | 600s | Lima re-runs every `mode: system`/`mode: user` provision script on **every** boot, so a warm start repeats the device VM's `apt-get` work — a cold create minus the image download |

**Progress-based liveness** (`streaming-runner.ts`) on the cold create, which gets **no** wall-clock bound: `PROVISIONING_IDLE_TIMEOUT_MS` = 15 min of *no output*, rearmed by every chunk. Sized deliberately above the whole documented 5–10 min cold create, so a slow-but-progressing provision can never trip it. A lifecycle test pins the absence of a `timeoutMs` on both create paths and says why.

**Heartbeat** (`progress.ts`) — `still waiting on \`limactl stop podkit-device\` (2m30s elapsed)` every 30s, with `, Ns since last output` added for streamed calls (the same number the watchdog acts on). Wired only in `cli.ts` and `harness.ts`; library modules pass no sink and start no timer.

Rejected: a uniform bound on all four (would abort legitimate creates — the stated hazard); a bound derived only from the observed 2m47s hang (fits the symptom, not the mechanism); taking the advisory lock in `stop`/`destroy` (would have *prevented* the collision, but widens the lock's documented contract and is an ADR-level decision — filed separately).

## Latent bug fixed

`streaming-runner.ts`'s `finish()` cleared `killTimer`, which had just been armed one line earlier in the timeout path — so the SIGTERM→SIGKILL escalation was cancelled the instant it was scheduled and a child that ignored SIGTERM ran on forever. `killTimer` is now cleared only on the child's `close`/`error`. A test proves it via a marker file a `trap "" TERM` shell would write if it survived.

`runLimactl` also now recognises the streaming runner's timeout rejection (a plain `Error`, no `killed`/`signal`), so both runners reach the same descriptive `timed out after Nms` message.

## Verification

- 156 unit tests pass in `@podkit/lima`, including new coverage for the idle watchdog (fires on silence, does NOT fire on a slow-but-noisy child), the SIGKILL escalation, the heartbeat rendering, the per-operation bounds, and lock release after an aborted start.
- Live shim runs (a `limactl` PATH shim; no VM touched): a wedged `stop` failed at exactly 180s with the bound named, after five heartbeat lines; a 4m35s cold create with 55s silent gaps completed **exit 0**, not aborted.
- Lock: `withVmLock`'s `finally` releases on the bounded abort (`isVmLocked` false, a `retries: 0` contender acquires immediately); `proper-lockfile`'s exit hook removes the lockfile even when the CLI is SIGTERM'd mid-start.

## Follow-up worth filing

`stop`/`destroy` are not lock-guarded, which is why a `vm:down` could collide with an in-flight boot at all. Bounding it makes the symptom diagnosable; serialising it would prevent the collision. That widens the lock's documented "guards VM starts" contract, so it belongs in its own task.

Post-review additions (sonnet review of the diff):

- `cmdEnsure` migrated onto the shared `reportLifecycleFailure` reporter it had duplicated, so all four failing verbs report in one voice.
- New `limactl.test.ts` composes the REAL streaming runner with `runLimactl` (substituting `sh` for `limactl`) to exercise the newly-added timeout-recognition branch. Verified it fails when the branch is removed — the pre-existing tests all faked the `execFile` shape and never reached it.
- CLI failure-path tests added for `destroy` and `recover`, which previously had none.
- Pinned `WARM_START_TIMEOUT_MS < PROVISIONING_IDLE_TIMEOUT_MS`. A warm start is a `start` subcommand, so the provisioning runner arms both bounds; keeping the wall clock strictly tighter is what makes the reported message ("timed out after Nms") match the situation rather than the watchdog's "aborted as wedged".
- Guarded `terminate()` against double-escalation and the idle watchdog against re-arming after the promise settles.

Deliberately out of scope, worth their own task: `transport.ts`'s `copyOut`/`stageSourceTree` and most of `docker-image.ts` still pass no `timeoutMs` and get no heartbeat. Some of those (rsync staging, `nerdctl build`) are genuinely open-ended and covered by the wrapper's documented carve-out, but the short ones (`systemctl start`, `mkdir -p`, `chmod`, `nerdctl system prune`) can hang in exactly the shape this task fixed.

## Resolved: per-operation treatment, because the operations differ in kind

All three sketched options were used, matched to what each call actually is.

**Wall-clock bounds** on operations against an instance that already exists:

| Operation | Value | Basis |
|---|---|---|
| `stop` | 180s | Two systemd stop-jobs at Debian's 90s `DefaultTimeoutStopSec` plus hypervisor teardown. One hung unit costs exactly 90s, so a shorter bound would abort shutdowns that were always going to succeed. |
| `destroy` | 90s | `delete --force` awaits no guest shutdown; the dominant term is unlinking a multi-GB diffdisk. One stop-job of headroom covers a driver that falls back to a polite stop. |
| warm `start <name>` | 600s | **Not** merely a boot: Lima re-runs every `mode: system`/`mode: user` provision script on every boot, so a warm start of the device VM repeats its `apt-get` work. Legitimate worst case is a cold create minus the image download. |

**Progress-based liveness** on the cold create, which deliberately gets no wall-clock bound: 15 minutes of *no output*, rearmed on every chunk from the streaming runner. The threshold is sized above the total duration of the slowest legitimate cold create — that inequality is the safety argument, and a test asserts it, so a slow-but-progressing provision cannot trip it however slow it gets.

**Heartbeat** every 30s for any invocation: `still waiting on `limactl stop podkit-device` (2m30s elapsed)`, with `, 45s since last output` on streamed calls — the same number the watchdog acts on. Wired only in the CLI and harness entry points; library modules pass no sink and start no timer.

**Rejected:** a uniform bound on all four (the stated hazard); a bound reverse-engineered from the observed 2m47s (fits the symptom, not the mechanism); and taking the advisory lock in `stop`/`destroy` — that would have *prevented* the original collision rather than merely diagnosing it, but it widens the lock's documented "guards VM starts" contract and is an ADR-level decision, so it was flagged rather than smuggled in.

## Latent bug found and fixed — in the escalation added days earlier

`finish()` cleared `killTimer`, which the timeout path had armed one line earlier. The SIGTERM->SIGKILL escalation was therefore cancelled the instant it was scheduled, so a `limactl` that ignored SIGTERM would have run forever — exactly the runaway the escalation exists to prevent. Settling the promise means we stopped waiting; it does not mean the child died. `killTimer` is now cleared only when the child actually closes, and `terminate()` is idempotent because the deadline and the idle watchdog can both reach it. A test proves it via a marker file that a `trap "" TERM` shell writes only if it survives; reintroducing the bug fails that test.

## Lock behaviour on an aborted call — measured, not argued

- Bounded abort: a live `ensure` against a hanging `limactl` shim failed at exactly 600000ms; immediately after, `lockfile exists=false isVmLocked=false`. `withVmLock`'s `finally` releases.
- Operator kill: SIGTERM to the CLI mid-start left the lockfile gone within 3s — `proper-lockfile`'s exit hook fires, so it does not even wait out the 30s stale window.

No leak on either path. Incidentally confirmed the lock is held across a full 4m35s cold create and a contender correctly waits.

## Verification

A PATH shim shadowing `limactl` exercised both directions without touching a real VM:
- **Wedge caught:** `podkit-vm stop` emitted five heartbeats at 30s intervals then failed at 180s naming the bound and the `recover` remedy.
- **Slow create NOT aborted:** a 4m35s create with 55s silent gaps exited 0, heartbeats showing idle climbing to 50s and resetting on each hostagent line. This is the case where a mistake would do real damage, so it was proven positively rather than argued.

lima 165 tests, device-testing 333, typecheck 38/38, lint 0/0.

A review pass closed four further gaps: `cmdEnsure` still duplicated the new shared error reporter; the new timeout-recognition branch in `runLimactl` was never exercised (a new `limactl.test.ts` composes the real streaming runner with the wrapper, and was verified to fail when the branch is removed); `destroy`/`recover` failure paths had no CLI tests; and the warm-start-arms-both-bounds ordering was unpinned.

## Not verified

Whether `limactl` 2.1.1 actually unwinds its hostagent on SIGTERM — the 15s kill grace assumes it tries. And whether a real cold `harness:setup` keeps its output gaps under 15 minutes; the shim modelled 55s gaps, while the real silent stretch is cloud-init's `apt-get install`. If a real cold setup ever trips the watchdog, the threshold is a single constant with its derivation written beside it.
<!-- SECTION:NOTES:END -->
