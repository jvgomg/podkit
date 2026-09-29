---
id: TASK-528
title: >-
  vm:up cannot start a paused guest — every lifecycle path treats PVE status as
  running/stopped/missing
status: Done
assignee: []
created_date: '2026-09-25 17:25'
updated_date: '2026-09-29 21:34'
labels:
  - testing
  - infrastructure
milestone: m-20
dependencies:
  - TASK-515
references:
  - test-packages/substrate/src/pve/client.ts
  - test-packages/substrate/src/pve/lifecycle.ts
  - test-packages/lima/src/cli-ssh.ts
  - docs/environments/device-substrate-proxmox.md
modified_files:
  - test-packages/substrate/src/pve/client.ts
  - test-packages/substrate/src/pve/client.test.ts
  - test-packages/substrate/src/pve/lifecycle.ts
  - test-packages/substrate/src/pve/lifecycle.test.ts
  - test-packages/substrate/src/index.ts
  - test-packages/lima/src/cli-ssh.ts
  - test-packages/lima/src/cli-ssh.test.ts
  - docs/environments/device-substrate-proxmox.md
  - docs/architecture/testing/vm-testing.md
priority: medium
type: bug
ordinal: 298000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while trying to run `test:vm` against the remote substrate: the builder guest was **paused**, and nothing in the lifecycle layer can get a paused guest running again.

```
$ bun run vm:status builderRemote
paused

$ bun run vm:up builderRemote
[podkit-vm] starting VMID 9001
[podkit-vm] unexpected error: PVE task for POST /nodes/rae/qemu/9001/status/start
  finished as 'VM 9001 already running'.
error: script "vm:up" exited with code 1
```

Resuming by hand fixed it immediately — `POST /nodes/rae/qemu/9001/status/resume` returned 200 with a UPID, and the guest was ssh-reachable within ~10s. So the capability is there and the token already carries the privilege; the code simply never asks for it.

**Three places assume a three-valued status and none of them holds.**

- `client.ts:63` declares `PveGuestStatus = 'running' | 'stopped' | 'missing' | (string & {})`. The `(string & {})` tail means `paused` — and `suspended`, `prelaunch`, `internal-error` — type-check everywhere while being handled nowhere. The union documents an intent the compiler cannot enforce, which is why this got through.
- `pveEnsureRunning` (`lifecycle.ts:274`) returns early only on `running`, creates only on `missing`, and then unconditionally calls `client.start()`. For a paused guest that is the one request PVE is guaranteed to reject.
- `waitForRunning` (`lifecycle.ts:260`) polls `while (status === 'stopped' …)`, so a paused guest would fall straight through to the `status !== 'running'` throw even if the start had somehow succeeded.

There is also no `resume` on the client at all: `client.ts` has `start`, and `stop` (which picks `stop` vs `shutdown` on a flag), and nothing else.

**Worth checking in the same pass, because they read the same status.** `pveRecover` is the path TASK-525 and TASK-526 have already had to correct twice, and a paused guest is a fourth state it has never seen — `lifecycle.ts:331-333` collapses anything non-`running` to `'stopped'`, which is exactly the kind of lossy mapping TASK-526 established a cost for. Whether `recover` on a paused guest currently rolls back, rebuilds, or errors is unknown and should be measured rather than reasoned about. `stopSubstrate` (`lifecycle.ts:522`) force-stops only when `running`, so it silently no-ops on a paused guest too.

**How a guest ends up paused matters for the fix.** PVE pauses guests for reasons that are not user actions — a hypervisor-side snapshot with RAM, a storage hiccup, a host suspend. So this is not an exotic state a developer talked themselves into; it is one the substrate can land in on its own overnight, which is precisely when an unattended `test:vm` hits it.

Lima substrates are unaffected: this is the PVE/ssh branch only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `PveGuestStatus` names the states PVE can actually report, and the `(string & {})` escape hatch no longer lets an unhandled state type-check silently
- [x] #2 The client exposes `resume`, and `pveEnsureRunning` resumes a paused guest rather than issuing a start PVE will reject
- [x] #3 `waitForRunning` reaches `running` from a paused start, not just from a stopped one
- [x] #4 `pveRecover` against a paused guest is measured and given a defined verdict, rather than inheriting the non-running -> 'stopped' collapse at lifecycle.ts:331-333
- [x] #5 `stopSubstrate` stops a paused guest instead of no-opping on it
- [x] #6 A unit test pins each transition from `paused` (ensure, recover, stop) against a scripted PVE client, so the state cannot regress to unhandled
- [x] #7 Exercised against the real remote substrate from a genuinely paused start, and the result recorded
- [x] #8 Lima substrates are unaffected
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Close `PveGuestStatus` to the states the pool listing is measured/known to report, parse the raw string in the client (unrecognised -> 'unknown', raw kept on PveGuest.rawStatus).
2. One exhaustive classification (`guestPower`: executing / halted / wedged / off / absent / unknown) that every lifecycle verb switches on, with a `never` default so a new status cannot type-check unhandled.
3. `client.resume`; ensure resumes a halted guest; waitForRunning keeps polling through off/halted (the pool listing lags the power state).
4. stop/destroy/recover hard-stop a halted or wedged guest (it cannot take an ACPI shutdown); unknown is refused before any mutation.
5. Unit tests per transition from `paused` against the scripted client; live run from a genuinely paused start.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
**`PveGuestStatus` is a closed union and every power verb branches on one exhaustive mapping.** The client parses the pool listing's `status` into `running | stopped | paused | suspended | prelaunch | io-error | internal-error | guest-panicked | unknown` (plus `missing`); anything else parses as `unknown`. `guestPower()` maps that to executing / halted / wedged / off / absent / unknown with a `never` default, so a new status fails to compile until each verb handles it. Only `paused` is *measured* (PVE 9.1.4: pool listing says `paused`; `status/current` says `status: running, qmpstatus: paused`); the other named states are QMP run states a single-node substrate can plausibly reach, and the comment says so.

**Per verb.** `client.resume` added. `pveEnsureRunning`: halted → resume; wedged → refused, pointing at `vm:recover` (bouncing it would bury the crash); unknown → refused with the `qm status --verbose` to run. `waitForRunning` polls through off *and* halted, because the listing trails a resume exactly as it trails a start. `pveStop`: halted/wedged → hard stop with a reported reason (a paused guest cannot answer ACPI). `pveDestroy`: stops any live process first. `pveRecover`: refuses unknown before mutating; hard-stops a halted/wedged guest before rollback. One `readPower(binding, verb)` does the unknown refusal for all four.

**AC #4 — measured before the fix.** Old `vm:recover` on a paused guest *succeeded*: it skipped its own stop (status was not `running`), and PVE's rollback stopped the guest itself. The recreate branch had no such cover — `pveDestroy` would not have stopped it. Defined verdict now: a paused guest is `halted`; the hash verdict comes from the snapshot claim (TASK-527) since the link cannot be read; either branch hard-stops first.

**AC #7 — live, deviceRemote (VMID 9000), from a genuinely paused start (`POST status/suspend`).**
- Old code: `vm:up` → `PVE task … finished as 'VM 9000 already running'`, exit 1. `vm:down` → `is paused`, no-op.
- New: `vm:up` → `resuming VMID 9000, which is paused` → running in ~2s, ssh OK. `vm:down` → `VMID 9000 is paused and cannot take an ACPI shutdown; stopping it hard` → stopped. `vm:recover` → hard stop + rollback, ssh back in ~21s.

Lima code is untouched (AC #8).

**Also changed:** `does not return while the guest still reports stopped` flipped status after one microtask, so it broke when `readPower` added an await hop (hung out the real 60s bound). Rewritten to flip inside the injected `sleep` — same contract, no timing dependence.

**Noted, not changed:** `pveStop` reports `stopped` when the stop task finishes; the pool listing trails that by a few seconds, so an immediate `vm:status` can still say `running`. Pre-existing.
<!-- SECTION:FINAL_SUMMARY:END -->
