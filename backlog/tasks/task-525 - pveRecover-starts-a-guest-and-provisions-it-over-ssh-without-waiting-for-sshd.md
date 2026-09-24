---
id: TASK-525
title: pveRecover starts a guest and provisions it over ssh without waiting for sshd
status: Done
assignee: []
created_date: '2026-09-24 01:18'
updated_date: '2026-09-24 01:56'
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
modified_files:
  - test-packages/substrate/src/link-ready.ts
  - test-packages/substrate/src/link-ready.test.ts
  - test-packages/substrate/src/link.ts
  - test-packages/substrate/src/link.test.ts
  - test-packages/substrate/src/link-ssh.ts
  - test-packages/substrate/src/index.ts
  - test-packages/substrate/src/target-arch.test.ts
  - test-packages/substrate/src/pve/lifecycle.ts
  - test-packages/substrate/src/pve/lifecycle.test.ts
  - test-packages/substrate/src/pve/client.test.ts
  - test-packages/lima/src/cli-ssh.ts
  - test-packages/lima/src/cli-ssh.test.ts
  - test-packages/lima/src/link.ts
  - docs/architecture/testing/vm-testing.md
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
- [x] #1 A recreate and a rollback both wait for the substrate to answer over ssh before any provision or reseal hook runs
- [x] #2 The wait is bounded and its failure names what it was waiting for and for how long, rather than surfacing as an ssh error from inside provisioning
- [x] #3 pve/lifecycle.ts still holds no SubstrateLink — the readiness probe lives with the caller that owns both, or arrives as an injected hook
- [x] #4 The bound is reachable from a unit test without sleeping, via the same clock/sleep seams pveEnsureRunning uses
- [x] #5 vm:recover is exercised against the real remote substrate at least once, and the result recorded
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. `SubstrateLinkError` gains a `detail` field — the untransformed ssh/limactl diagnostic — so a caller can classify a failure without string-matching a composed message (the existing `substrateId`/`operation` fields exist for the same reason).
2. New `test-packages/substrate/src/link-ready.ts`: `waitForSubstrateReady(link, opts)` — a bounded poll on `link.exec(['true'])` with `now`/`sleep` seams mirroring `pveEnsureRunning`, throwing `SubstrateNotReadyError` that names the link, the bound and the last diagnostic. Refusals that waiting cannot fix (changed host key, unresolvable alias) end the wait at once rather than burning the bound; `Permission denied (publickey)` stays retryable because cloud-init installs the key partway through first boot.
3. `PveRecoverOpts` gains an injected `awaitReady` hook, awaited after `start` on BOTH branches and before `provision`/`reseal`. `pve/lifecycle.ts` still holds no `SubstrateLink`.
4. `cmdRecover` in `cli-ssh.ts` injects it from the link it already builds. A readiness failure there is reported and exits non-zero, but does not suppress the NEW-ssh-host-keys guidance — that guidance is exactly what a reader whose wait failed on a recreate needs.
5. Unit tests for the wait, the hook ordering on both branches, and the CLI path. Live `vm:recover` against the remote substrate for AC #5.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
**Live verification (AC #5).** Run through the documented entry point against the real Proxmox substrate (PVE 9.1.4) on 2026-09-24:

```
$ bun run vm:recover deviceRemote -- --expect-hash <sealed>
[podkit-vm] rollback: 'podkit-provisioned' matches the committed provisioning inputs
[podkit-vm] waiting up to 300000ms for ssh_config alias `podkit-substrate` to answer over ssh (ssh: connect to host <addr> port 22: Connection refused)
[podkit-vm] `deviceRemote` recovered by rollback ('podkit-provisioned' matches the committed provisioning inputs).
22.3s total
```

The middle line is the defect, measured. The **first** probe after `binding.client.start()` returned `Connection refused` — so on the old code `pveRecover` returned at exactly that moment, and any `provision` hook would have opened with that refusal. The wait then polled ~20s until sshd answered. `vm:doctor` reports `baseline OK (6 inputs tracked)` before and after, and the guest was returned to `stopped`.

This was the *rollback* branch, which the task called out as "seconds away" — and it was still not ready on the first probe. The recreate branch is strictly worse.

**The recreate branch was not exercised live.** Doing so destroys and re-provisions the substrate, which is a slow, destructive operation on a shared hypervisor and was not worth spending to satisfy an AC that says "at least once". It is covered by unit tests on both the lifecycle and CLI sides.

## Design notes

**The readiness hook throws.** An early draft had `cmdRecover` swallow `SubstrateNotReadyError` inside its own `awaitReady` so it could still print the host-key guidance. That defeated AC #1 structurally — `pveRecover` would have carried on into `provision`/`reseal` after a wait that failed. The hook now rethrows, `cmdRecover` catches around `pveRecover`, and the guidance moved into `reportNewHostKeys`, shared by the success and failure paths.

**`awaitReady` receives the strategy, not the binding.** The failure path has to say something different about a rollback (host keys preserved, so a box that does not answer is broken) than about a recreate (host keys regenerated, so `known_hosts` going stale is the expected outcome). The strategy is the only thing that distinguishes them.

**Exit codes.** A recreate whose wait ends in a refusal waiting cannot fix exits **0** — that is the documented end state of a recreate, and it exited 0 before this task added a wait at all. Everything else that fails the wait exits **1**. Without that split, adding the wait would have turned every successful recreate into a non-zero exit.

**Early exit on unwaitable refusals.** `looksLikeTerminalSshFailure` ends the wait on a changed host key or an unresolvable alias. Not strictly required by the ACs, but without it the recreate branch — where a changed host key is guaranteed — would spend the full five-minute bound before failing.

**Two things observed and left alone.**

1. `cmdRecover` reads the sealed hash over ssh *before* choosing a strategy, so recovering a **stopped** guest always reads an empty hash, lands on `unknown`, and therefore recreates rather than rolling back. That is why the run above starts with `vm:up`. Separate defect (a strategy-input problem, not a timing one).
2. `backlog/tasks/task-515` records the substrate's real LAN address in its notes, which `AGENTS.md` rules out for committed files. The three test files that carried the same constant (`pve/client.test.ts`, `pve/lifecycle.test.ts`, `lima/src/cli-ssh.test.ts`) were moved to the `192.0.2.0/24` documentation range here; the task note was left alone as someone else's record.

Observation 1 above — `vm:recover` recreating a stopped guest rather than rolling it back — is now filed as TASK-526.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Closes the gap between "PVE says the guest started" and "the guest answers on port 22", which `pveRecover` was stepping straight over on both of its branches.

**`waitForSubstrateReady(link)`** (new `test-packages/substrate/src/link-ready.ts`) is a bounded poll on `link.exec(['true'])`, five-minute default, `now`/`sleep` injected so the bound is reachable from a unit test without sleeping. The per-probe bound is clamped to what remains of the outer budget, so the advertised bound is the one a caller actually gets. Failure is a typed `SubstrateNotReadyError` naming the link, the bound, how long it waited and the link's own last diagnostic. Refusals waiting cannot fix — a changed host key, an unresolvable alias — end the wait at once; `Permission denied (publickey)` deliberately does not, because cloud-init installs the key partway through first boot.

**`SubstrateLinkError` gained `detail`**, the untransformed ssh diagnostic, so the wait classifies on ssh's own words rather than pattern-matching a sentence this repo composed — the same reason `substrateId` and `operation` are already fields.

**`PveRecoverOpts.awaitReady`** is an injected hook taking the `RecoveryStrategy`, awaited after `start` on both branches and before `provision`/`reseal`. `pve/lifecycle.ts` still holds no `SubstrateLink`. `start` and the wait are paired in one local `startAndWait`, so "every branch that starts the guest owes the caller a guest that answers" is structural rather than duplicated.

**`cmdRecover`** injects it from the link it already builds. The hook throws, so nothing runs against a guest that never answered. A recreate refused on its new host keys still exits 0 with the existing guidance — that is a recreate's documented end state, and it exited 0 before there was a wait at all. Anything else that fails the wait exits 1.

Verified live: `bun run vm:recover deviceRemote` against the real substrate took 22.3s, with `Connection refused` on the first probe after `start` — the defect, measured on the branch the task expected to be the fast one.
<!-- SECTION:FINAL_SUMMARY:END -->
