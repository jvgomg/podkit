---
id: TASK-528
title: >-
  vm:up cannot start a paused guest — every lifecycle path treats PVE status as
  running/stopped/missing
status: To Do
assignee: []
created_date: '2026-09-25 17:25'
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
- [ ] #1 `PveGuestStatus` names the states PVE can actually report, and the `(string & {})` escape hatch no longer lets an unhandled state type-check silently
- [ ] #2 The client exposes `resume`, and `pveEnsureRunning` resumes a paused guest rather than issuing a start PVE will reject
- [ ] #3 `waitForRunning` reaches `running` from a paused start, not just from a stopped one
- [ ] #4 `pveRecover` against a paused guest is measured and given a defined verdict, rather than inheriting the non-running -> 'stopped' collapse at lifecycle.ts:331-333
- [ ] #5 `stopSubstrate` stops a paused guest instead of no-opping on it
- [ ] #6 A unit test pins each transition from `paused` (ensure, recover, stop) against a scripted PVE client, so the state cannot regress to unhandled
- [ ] #7 Exercised against the real remote substrate from a genuinely paused start, and the result recorded
- [ ] #8 Lima substrates are unaffected
<!-- AC:END -->
