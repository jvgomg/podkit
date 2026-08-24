---
id: TASK-483
title: >-
  VM persona-daemon lifecycle flakes under host load — dangling daemon blocks
  next gadget bind, /dev/sg* never enumerates
status: To Do
assignee: []
created_date: '2026-08-23 21:45'
updated_date: '2026-08-24 21:03'
labels:
  - testing
  - vm
  - flaky
  - bug
dependencies: []
references:
  - test-packages/e2e-vm-tests/src/udev-usb-scope.e2e.test.ts
  - test-packages/e2e-vm-tests/src/doctor-output-contract.e2e.test.ts
  - test-packages/device-testing/src/runners/lima-test-vm-systemd.ts
priority: high
ordinal: 262000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Symptom:** `@podkit/e2e-vm-tests#test:vm` fails non-deterministically when run as part of the full `bun run quality` DAG, while passing reliably when run standalone via `bun run test:vm`.

Observed 2026-08-23 across two consecutive `quality` runs on the same tree, with a *different* failure set each time:
- run 1 — 4 failures: `discovery-reconciliation`, `doctor-sysinfo-modelnum-mismatch`, `inquiry-usb-transport-down`, `hfsplus-refusal`
- run 2 — 3 failures: `udev-usb-scope`, `doctor-output-contract`, + 1 more (185 pass / 3 fail)

The same suite passes **194/0** standalone, twice verified, on the same tree and the same VM.

**Signature.** Two failure shapes, both in persona-daemon lifecycle:
1. `a beforeEach/afterEach hook timed out for this test` with implausible durations — 72s, 80s, 139s, **282s** — each preceded by `killed 1 dangling process`.
2. `waitForScsiGenericEnumeration` fails: `limactl shell podkit-device -- sh -c ls /dev/sg* 2>/dev/null | head -n1` exits non-zero, i.e. no SCSI generic node ever appeared after the daemon started. Also preceded by `killed 1 dangling process`.

One run also showed `failed to synthesise partitioned FAT32 backing file for persona 'ipod-5g-video-mbr-part' in podkit-device: exit=1: (no output, exit=1)`.

**Hypothesised mechanism (needs confirming):** a cascade. A persona's FunctionFS daemon fails to shut down within its window under load, is reported as `killed 1 dangling process`, and its still-bound USB gadget prevents the *next* persona's gadget from binding — so `/dev/sg*` never enumerates, that test's hook times out, and its daemon in turn leaks. The first failure in a run is the real one; subsequent ones are collateral. The absurd hook durations suggest the teardown path waits on something with a very long or absent timeout rather than failing fast.

**Not attributable to the @podkit/lima P2 consolidation.** The Lima instance resolves correctly throughout (`limactl shell podkit-device` succeeds; only the in-guest `/dev/sg*` lookup fails), and the failures are load-dependent, non-deterministic, and vary run to run — a wrong instance name or yaml path would fail instantly and identically every time. Standalone `test:vm` is green at 232/0.

**Why this has not been seen recently:** `bun run quality` has been red at the host-e2e stage since 2026-08-18, so its `test:vm` stage has not run to completion in weeks. The interaction is likely long-standing rather than new.

**Suggested investigation:**
- Make daemon teardown fail fast and loudly rather than hanging — a 282s hook wait is never useful.
- Have `withPersona` verify the gadget is actually unbound before the next persona binds, and surface the leaked-process case as a clear error naming the culprit test rather than a generic timeout in the victim.
- Consider whether `test:vm` should be serialised against the rest of the `quality` DAG: a 2-CPU/2GiB VM doing image synthesis while the host runs a full parallel build is a thin margin. `quality` already hand-rolls `quality` vs `quality:rc` serialisation, and the @podkit/lima shared lock is noted in the design docs as a future replacement for that mechanism.

**Repro:** `bun run quality` on a tree where everything else is cached, so `test:vm` is the main remaining work. Failed on both attempts.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Evidence review — the cascade hypothesis in the description is NOT supported

Re-read both `quality` run logs side by side. The description hypothesises "the first failure is the real one and the rest are collateral". The logs do not support that, and anyone starting from it will be looking for the wrong thing.

**Test-file execution order is identical across both runs** (bun is deterministic here). Failure *positions* differ:

| # | file | run 1 | run 2 |
|---|---|---|---|
| 1 | parser-stderr-silence | pass | pass |
| 2 | doctor-device-types | pass | pass |
| 3 | discovery | pass | pass |
| 4 | unsupported-cascade | pass | pass |
| 5 | volume-uuid-defensive | pass | pass |
| 6 | system-state-cross-check | pass | pass |
| 7 | discovery-reconciliation | **FAIL** (synthesis exit=1) | pass |
| 8 | device-add-no-verify | pass | pass |
| 9 | udev-usb-scope | pass | **FAIL** (hook timeout 72s) |
| 10 | doctor-consistent-sections | pass | pass |
| 11 | doctor-output-contract | pass | **FAIL** (`ls /dev/sg*`) |
| 12 | doctor-scope-refactor | pass | pass |
| 13 | save-failure-matrix | pass | pass |
| 14 | doctor-sysinfo-modelnum-mismatch | **FAIL** (80s) | pass |
| 15 | inquiry-usb-transport-down | **FAIL** (282s) | pass |
| 16 | doctor-sysinfo-repair | pass | pass |
| 17 | pre-sync-sweep | pass | pass |
| 18 | hfsplus-refusal | **FAIL** (139s) | **FAIL** |

**What this rules out.** A strict cascade would mean everything after the first failure degrades. It does not: run 1 fails at #7 and then passes #8-#13 cleanly before failing again at #14; run 2 fails at #9, passes #10, fails #11, then passes #12-#17. The harness recovers between failures, so whatever leaks is being cleaned up — just not reliably or not fast enough.

**What survives as signal:**
- **Every** failure is immediately preceded by `killed 1 dangling process`. That message is the strongest lead: a process outlives its test and bun reaps it. Find who logs it and what it is killing.
- `hfsplus-refusal` (#18) failed in **both** runs — the only file that did. Either it is genuinely the most fragile, or being last makes it the most likely to inherit accumulated VM state. Worth checking whether it passes when run alone under the same host load.
- Failure durations are absurd (72s, 80s, 139s, 282s) against a 5s-ish expectation, so a teardown or wait path has a very long or absent timeout. Even once the root cause is fixed, those bounds should be tightened so a future failure surfaces in seconds rather than minutes.
- Two distinct failure shapes: hook timeouts, and `waitForScsiGenericEnumeration` finding no `/dev/sg*`. Run 1 also produced a backing-file synthesis `exit=1` with no output.

**Load is the differentiator, not code.** Standalone `test:vm` is 232/0 repeatedly on the same tree and the same VM; only the full `quality` DAG reproduces it. The device VM is 2 CPU / 2 GiB while the host runs a full parallel build.

## Reproduced OUTSIDE `quality`, and the mechanism is clearer than "persona-daemon lifecycle"

2026-08-24: a **standalone** `bun run test:vm` — no `quality`, nothing else running — failed **116 pass / 11 fail**, with hook timeouts of 92s, 150s, 168s, 229s, 331s and **397s**. That same command had been reliably 232/0 all day on the same tree.

The difference was host state, not code. I had left **four** Lima VMs running (device 2 GiB + builder-glibc 4 GiB + builder-musl 4 GiB + test-glibc 4 GiB ≈ 14 GiB committed on a 32 GiB host); every earlier green run had three. At failure time:

```
vm.swapusage: total = 5120.00M  used = 4333.44M  free = 786.56M
```

Swap was 85% consumed — the host was thrashing.

**The decisive observation:** the failures are NOT confined to gadget or persona setup. *Every* `limactl shell podkit-device` invocation was failing, including trivial ones with no USB involvement at all:

```
error: limactl shell podkit-device failed: Command failed: limactl shell podkit-device -- sh -c /usr/local/bin/podkit device scan --json
error: limactl shell podkit-device -- sh -c set -e; sudo mkdir -p '/var/device-testing/backing-files'; ... failed
```

So the broken thing is the **`limactl shell` transport itself under host memory pressure**, not daemon teardown. `/dev/sg*` never enumerating and backing-file synthesis returning `exit=1` with no output are both downstream of the same cause: the shell transport into the guest is unreliable, so in-guest commands do not complete.

Immediately afterwards, with the run finished, the VM was perfectly healthy — `limactl shell podkit-device -- uptime` returned instantly, load 0.23, 1.6 GB available, disk 22% used. Nothing was wrong *inside* the guest.

Stopping the two VMs the suite does not need (`vm:down testGlibc`, `vm:down builderMusl`) freed 8 GiB.

## What this changes about the fix

The "suggested investigation" in the description aims at the wrong layer. Revised:

1. **Fail fast and diagnose.** A 397-second hook wait is never useful. When a `limactl shell` fails or a wait loop stalls, the harness should surface *"the VM transport is failing — host may be under memory pressure"* with the host's swap/VM state, rather than a generic timeout in whichever test drew the short straw. The current output actively misleads: it looks like a persona bug.
2. **Bound the VM budget.** Four concurrent Lima VMs on a 32 GiB host is over-subscribed. Options: have `test:vm` stop VMs it does not need, warn when more than N are running, or check available memory in preflight and refuse with a clear message. Note `preflight.ts` already exists as the natural home and already hard-fails with remediation text for a down VM.
3. **Only then** look at daemon teardown — `killed 1 dangling process` still precedes failures and may be a real secondary leak, but it is likely a symptom of commands not completing rather than the root cause.

The earlier `quality` failures are almost certainly the same thing: `quality` saturates the host, and the VM transport degrades. That also explains why the failing *set* varied between runs while the file order did not — whichever test is running when pressure peaks is the one that fails.

## ROOT CAUSE FOUND: leaked UDC bindings exhaust the dummy_hcd slots

Inspecting the device VM directly after a bad run:

```
=== configfs gadgets ===
(empty)
=== UDC state ===
/sys/class/udc/dummy_udc.0: configured     <- leaked
/sys/class/udc/dummy_udc.1: configured     <- leaked
/sys/class/udc/dummy_udc.2: not attached
/sys/class/udc/dummy_udc.3: not attached
=== /dev/sg* ===
none
```

**Two UDCs are pinned in `configured` state while configfs contains no gadgets at all.** The gadget directories were torn down but the UDCs were never released. `dummy_hcd num=4` provides four slots; two were burnt.

This explains every observation that the earlier hypotheses did not:

- **Escalating severity across runs** (282s max -> 397s -> 3.6M ms / 60 min): leaks accumulate, so each run starts with fewer usable slots.
- **Recovery between failures within a run**: while free slots remained, the next persona could still bind. That is why the suite passed files #8-#13 after failing #7 — it was not "recovering", it was consuming the remaining slots.
- **`/dev/sg*` never appearing**: with no free UDC, the gadget never binds, so no SCSI generic node is created.
- **Why standalone `test:vm` was green all day and then was not**: the VM accumulated leaks over many runs.

**Host memory pressure is the trigger, not the mechanism.** Thrashing caused daemons to be killed mid-teardown; a daemon killed between "remove gadget from configfs" and "release the UDC" leaks a slot permanently. So the two observations are one story: pressure -> killed teardown -> leaked slot -> subsequent binds hang -> enormous timeouts.

**The leak is not recoverable in-place.** Reloading `usb_f_fs`, `usb_f_mass_storage`, `libcomposite` and `dummy_hcd` cleared `dummy_udc.0` but left `.1` still `configured`, and `.0` failed to re-register at all — leaving three slots where there should be four. A destroy + `harness:setup` is the reliable remediation.

## Revised fix directions

1. **Make teardown crash-safe.** Releasing the UDC must not depend on the daemon surviving to do it. Either unbind the UDC *before* removing the gadget from configfs, or — more robustly — have persona *setup* reap any orphaned gadget/UDC state idempotently before binding, so a killed teardown cannot poison the next test.
2. **Assert the slot budget and fail loudly.** `withPersona` (or `preflight.ts`) should count free UDCs and, on finding fewer than expected, fail immediately with something like *"2 of 4 dummy_hcd slots are leaked — run `bun run vm:recover device`"*. That converts a 60-minute mystery timeout into a one-line diagnosis. This is the single highest-value change.
3. **Bound the waits.** Nothing here should ever wait 60 minutes; a gadget bind either works in seconds or is not going to.
4. Only then consider host-pressure mitigation (fewer concurrent VMs, serialising `test:vm` within `quality`) — it reduces how often teardowns get killed, but crash-safe teardown is what actually fixes it.

**Not a regression from TASK-482 or TASK-484.** Both landed just before the bad runs, which made them look implicated. Ruled out: `transport.ts`'s only change since the last green run is the `graphify-out` exclude; the in-VM daemon binary sha256 matches the host build exactly; and the failures are in-guest gadget binding, which neither change touches.
<!-- SECTION:NOTES:END -->
