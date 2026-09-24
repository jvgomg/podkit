---
id: TASK-525
title: pveRecover starts a guest and provisions it over ssh without waiting for sshd
status: To Do
assignee: []
created_date: '2026-09-24 01:18'
labels:
  - testing
  - infrastructure
  - ready-for-agent
milestone: m-20
dependencies:
  - TASK-515
references:
  - test-packages/substrate/src/pve/lifecycle.ts
  - test-packages/lima/src/cli-ssh.ts
  - docs/environments/device-substrate-proxmox.md
priority: medium
type: bug
ordinal: 295000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while closing TASK-493 AC #5, and left unfixed there deliberately — the sibling defect in `pveEnsureRunning` was on that task's path and this one is not.

`pveRecover` (`test-packages/substrate/src/pve/lifecycle.ts`) calls `binding.client.start(vmid)` and then, on the recreate branch, invokes its `provision` hook immediately:

```ts
await pveDestroy(binding, { report });
await createGuest(binding);
await binding.client.start(binding.vmid);
if (opts.provision) await opts.provision(binding);
if (opts.reseal) await opts.reseal(binding);
```

Both hooks go over ssh. The start call waits for PVE's UPID task, but that task completes when QEMU has been launched — sshd is minutes away on a freshly created guest, and seconds away on a rollback. The rollback branch has the same shape.

**Why it has not bitten yet.** A recreate is followed by cloud-init, so in practice the first `provision` attempt is late enough by accident. That is not a guarantee, and it is exactly the kind of accident that turns into an intermittent failure on a faster hypervisor or a warm image.

**The wait this needs is not the one `pveEnsureRunning` got.** That one polls the hypervisor until the guest reports `running`, which is the right precondition for *reporting status* and the wrong one here: `running` means QEMU is up, not that anything will answer on port 22. This needs ssh readiness, which is a probe on the link rather than on the API — a different wait at a different layer, which is why it was not folded into the same fix.

`pve/lifecycle.ts` deliberately holds no link (`binding` carries a `PveClient` and nothing else), so the readiness wait either belongs to the caller that owns both — `cmdRecover` in `test-packages/lima/src/cli-ssh.ts`, which already builds a link via `linkFor` — or arrives as an optional hook on `PveRecoverOpts` alongside `provision` and `reseal`. Decide which before writing it; putting a link inside the lifecycle module would undo a boundary ADR-029 §2 draws on purpose.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A recreate and a rollback both wait for the substrate to answer over ssh before any provision or reseal hook runs
- [ ] #2 The wait is bounded and its failure names what it was waiting for and for how long, rather than surfacing as an ssh error from inside provisioning
- [ ] #3 pve/lifecycle.ts still holds no SubstrateLink — the readiness probe lives with the caller that owns both, or arrives as an injected hook
- [ ] #4 The bound is reachable from a unit test without sleeping, via the same clock/sleep seams pveEnsureRunning uses
- [ ] #5 vm:recover is exercised against the real remote substrate at least once, and the result recorded
<!-- AC:END -->
