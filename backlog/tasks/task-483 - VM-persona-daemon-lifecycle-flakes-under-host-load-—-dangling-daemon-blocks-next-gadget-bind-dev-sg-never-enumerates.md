---
id: TASK-483
title: >-
  VM persona-daemon lifecycle flakes under host load — dangling daemon blocks
  next gadget bind, /dev/sg* never enumerates
status: Done
assignee: []
created_date: '2026-08-23 21:45'
updated_date: '2026-08-24 21:43'
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

## Correction: `state=configured` is not evidence of a leak — the earlier root-cause reading was wrong

The "ROOT CAUSE FOUND" note above reads `/sys/class/udc/*/state` as occupancy. It is not. On `dummy_hcd` that field **latches** at `configured` the first time any gadget binds and never returns to `not attached`. `gadget.ts#attachUdc` already documents this; the observation was taken without it.

Reproduced directly on a healthy VM. One clean start + clean stop of a single persona:

```
BEFORE:  dummy_udc.0=configured  .1=not attached  .2=not attached  .3=not attached   gadgets=[]
STARTED: dummy_udc.0=configured  ...   gadgets=[podkit-ipod-video-5g-iflash-1tb]  UDC=dummy_udc.0  /dev/sg0
AFTER:   dummy_udc.0=configured  ...   gadgets=[]  (no /dev/sg*)
```

Run two personas concurrently (the dual-daemon test does exactly this) and stop both cleanly:

```
AFTER STOP BOTH: dummy_udc.0=configured  dummy_udc.1=configured  .2=not attached  .3=not attached
gadgets: []
```

That is byte-for-byte the "two UDCs pinned in `configured` while configfs holds no gadgets at all" signature quoted as proof of a leak. It is what a **fully successful** run leaves behind. Both slots then re-bound immediately on the next start, so nothing was burnt. The escalating-severity story built on top of that reading ("leaks accumulate, each run starts with fewer usable slots") does not hold, and neither does "the leak is not recoverable in place".

The authoritative occupancy signal is the configfs side: a controller is claimed iff some `<gadget>/UDC` file names it. That file *is* cleared on unbind.

## A real leak does exist, with a different mechanism and a much narrower blast radius

Manufactured by starting a daemon outside systemd and `kill -9`ing it, so teardown is skipped exactly as a stop-timeout SIGKILL or an OOM kill would skip it.

- **FunctionFS personas** (`ipod-*`): the kernel unbinds the gadget when the dying process closes `ep0`, so the controller is released. What survives is the configfs tree and the FunctionFS mount — and that is enough to make the *same persona* unstartable forever: `mount -t functionfs` then fails `exit=32: already mounted or mount point busy`, and `Restart=on-failure` just loops on it.
- **Mass-storage-only personas** (`echo-mini`, `echo-mini-populated`): no ep0 exists, so the kernel never notices. Verified stranded state after `kill -9`, with no daemon alive:
  ```
  gadgets: [podkit-echo-mini]
    podkit-echo-mini UDC=[dummy_udc.0]
  /dev/sg0 still live
  ```
  That is a genuinely leaked controller: nothing in the system will ever release it.

So the fix directions in the previous note were right, for a reason that was partly wrong. Host memory pressure killing daemons mid-teardown remains the trigger; crash-unsafe setup (not teardown) is the mechanism.

## What landed

1. **Crash-safe reap on setup, not reorder on teardown.** Teardown already unbinds the UDC before removing the tree, so there is no window to reorder — and reordering could not help anyway, since the failure is a process that never ran teardown at all. `reapStaleGadget()` (`device-testing-daemon/src/gadget.ts`) releases any leftover tree at the daemon's own gadget name before `createGadget`. Covers SIGKILL, OOM and power loss; touches only its own gadget, so a concurrent persona is unaffected.
2. **Slot accounting + loud preflight failure.** New `runners/lima-test-vm-udc-slots.ts` reads controllers, claims and live units in one round trip and classifies a claim with no active unit as leaked. Wired into `preflight.ts` (once per suite, before anything binds) and into the enumeration-timeout messages. Verified against four manufactured leaks: the suite now aborts up front naming every leaked binding and the remediation, instead of timing out somewhere downstream.
3. **Bounded waits.** `runLimactl` gained an optional `timeoutMs`. The unbounded `limactl shell` was the source of the multi-minute hooks — the poll loops checked their deadline *between* iterations, which bounds nothing if one iteration never returns. Each probe is now bounded by its remaining deadline; daemon start/stop 45s; journal dump 15s; apply-state 5m.

Leaked slots are now recoverable in place: after burning all four and reaping, the VM was back to 4/4 free with no rebuild. `bun run test:vm` green (194 pass / 0 fail in e2e-vm-tests, all 22 turbo tasks successful), VM left with no gadgets, no mounts, no units.

# CORRECTION: the "leaked UDC" root cause above is WRONG. Read this before the sections above it.

**`/sys/class/udc/<n>/state` latches on dummy_hcd.** Once any gadget binds a controller, that field reads `configured` forever and never returns to `not attached`, even after a clean unbind. So "`configured` with an empty configfs" is the **normal, healthy** reading after any successful run — not evidence of a leak.

This is documented in the very file that manages the binding, `device-testing-daemon/src/gadget.ts:149`:

> We deliberately do NOT read `/sys/class/udc/<n>/state`: on dummy_hcd that field latches at `configured` once any gadget has bound the UDC and never goes back to `not attached`, even after an unbind. The UDC file in configfs IS reset to empty on unbind, so it is the only reliable source.

Demonstrated by a single clean start+stop of one persona reproducing the exact "leak" signature, and confirmed live: all four controllers currently read `configured` with configfs empty, all four demonstrably free, `test:vm` green.

**The authoritative signal is `<gadget>/UDC` in configfs**, which IS cleared on unbind.

What this invalidates: the accumulating-leak narrative, the "escalating severity across runs" explanation, and "the leak is not recoverable in place". The VM rebuild that appeared to fix things is confounded — it relieved host memory pressure at the same moment.

## What was actually wrong

**1. Nothing bounded the transport.** `runLimactl` accepted no timeout and `defaultSubprocessRunner` has no default, so any `limactl shell` could hang indefinitely. Worse, the poll loops (`waitForScsiGenericEnumeration`, `waitForUsbEnumeration`) checked their deadline *between* iterations — which bounds nothing if one iteration never returns. **That** is where 397s and 3.6M ms came from, not slot exhaustion. The 5s budget was never the problem.

**2. A real leak exists, with a narrower mechanism than I described.** Teardown is already in the safe order (unbind UDC -> shut down FFS -> destroy gadget), and `systemctl stop` sends SIGCONT with SIGTERM, so there is no window to reorder away. What strands state is the whole teardown being skipped — SIGKILL after `TimeoutStopSec=10`, OOM kill, power loss:
   - **FunctionFS personas**: the kernel unbinds when the dying process closes `ep0`, so the controller IS released — but the configfs tree and FunctionFS mount survive, which makes *that persona* permanently unstartable (`mount -t functionfs` fails `already mounted or mount point busy`, and `Restart=on-failure` loops on it).
   - **Mass-storage-only personas** (`echo-mini`, `echo-mini-populated`): no ep0, so the kernel never notices. Genuinely leaked controller with nothing to release it.

## Fix

- **`reapStaleGadget()`** in `gadget.ts`, called from `main.ts` before `createGadget`. Releases leftover state at the daemon's *own* gadget name only, so concurrent personas are untouched. Robust to SIGKILL/OOM/power-loss, which fixing teardown could never be. Verified: `kill -9` a mass-storage daemon -> controller leaked -> next start reaps it and binds. All four controllers were deliberately leaked and every one recovered by start/stop cycling, **no VM rebuild**.
- **Slot accounting** (`lima-test-vm-udc-slots.ts`), reading `<gadget>/UDC` and cross-checking live units — a claim with no daemon behind it is a leak; a claim with a live unit is another persona in flight. Wired into `preflight.ts` and into enumeration-timeout messages. With all four leaked the suite aborts immediately naming the remediation; with some leaked it warns and continues, since those self-heal on next start. Also flags a controller-count shortfall against the module's `num=`.
- **Real bounds**: `runLimactl` takes `timeoutMs` and reports `timed out after Nms` explicitly. Each enumeration probe gets the caller's remaining deadline floored at 2s; daemon start/stop 45s; journal dump 15s; preflight SSH and slot probes 30s; apply-state 5min.

## Verification

`test:vm` 194 pass / 44 skip / 0 fail, 22/22 turbo tasks. Unit: device-testing 322, daemon 54, lima 123, all green — 36 new tests (reap 8, slot accounting 19, wait bounds 7, lifecycle bounds 2). lint and typecheck (38/38) clean. No slots left leaked.

## Flagged, not fixed

`@podkit/device-testing#test:vm` and `@podkit/e2e-vm-tests#test:vm` both have `dependsOn: []`, so turbo may run them **concurrently against the same VM**, starting and stopping overlapping persona units. A plausible independent contributor to the original flakes, and nothing here addresses it.
<!-- SECTION:NOTES:END -->
