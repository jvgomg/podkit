---
id: TASK-483
title: >-
  VM persona-daemon lifecycle flakes under host load — dangling daemon blocks
  next gadget bind, /dev/sg* never enumerates
status: To Do
assignee: []
created_date: '2026-08-23 21:45'
updated_date: '2026-08-24 00:32'
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
<!-- SECTION:NOTES:END -->
