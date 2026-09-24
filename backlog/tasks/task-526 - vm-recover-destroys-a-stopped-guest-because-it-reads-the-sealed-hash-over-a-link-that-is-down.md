---
id: TASK-526
title: >-
  vm:recover destroys a stopped guest, because it reads the sealed hash over a
  link that is down
status: Done
assignee: []
created_date: '2026-09-24 01:56'
updated_date: '2026-09-24 22:44'
labels:
  - testing
  - infrastructure
  - ready-for-agent
milestone: m-20
dependencies:
  - TASK-525
references:
  - test-packages/lima/src/cli-ssh.ts
  - test-packages/substrate/src/pve/lifecycle.ts
  - docs/environments/device-substrate-proxmox.md
priority: high
type: bug
ordinal: 296000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found while closing TASK-525, which needed `vm:up` in front of every live `vm:recover` to exercise the branch it was actually about. That workaround is hiding a defect with a much larger blast radius than the one it was working around.

`cmdRecover` (`test-packages/lima/src/cli-ssh.ts`) reads the guest's sealed baseline hash **over ssh, before** handing anything to `pveRecover`:

```ts
const sealed = await readSealedHash(link).catch(() => '');
const verdict = templateHashVerdict(sealed, expected);
```

`readSealedHash` reaches the guest through the link. A **stopped** guest answers nothing, the `.catch` turns that into `''`, and `templateHashVerdict('', expected)` returns `'unknown'`. `chooseRecoveryStrategy` then reads `'unknown'` as *"nothing is sealed in this guest, so there is no provisioning state to roll back to"* and returns `recreate`.

So `bun run vm:recover deviceRemote` on a stopped guest **destroys and rebuilds it**, discarding a perfectly good `podkit-provisioned` snapshot that the hypervisor could have reported without ssh at all. The operator then owes themselves a full re-provision, a re-seal, and a manual host-key verification from the PVE host — the expensive half of `docs/environments/device-substrate-proxmox.md` — for a guest whose only fault was being switched off.

**The verdict is being sourced from the wrong place.** `'unknown'` is supposed to mean *"this guest carries no sealed claim"*, which is a fact about the guest's disk. What the code actually measures is *"nothing answered on port 22 just now"*, which is a fact about the guest's power state. Those coincide on a running box and diverge on a stopped one, and the strategy chooser cannot tell the two apart because the distinction is destroyed before it is called.

Note the asymmetry with the snapshot listing beside it: `pveRecover` already reads `listSnapshots` over the **API**, which works on a stopped guest. Only the hash read needs the guest to be up.

**Options worth weighing before writing anything.** Do not just add a `vm:up` to the front of the verb — that starts a guest in order to decide whether to destroy it, which is a strange thing for a repair verb to do and still recreates if sshd is slow.

- Distinguish *unreadable* from *absent*. `readSealedHash` currently collapses a `SubstrateLinkError` and an empty file into the same `''`. A third verdict — the guest could not be asked — could refuse to recreate rather than guessing, and say why.
- Refuse rather than choose. A recover that cannot read the guest's claim arguably has no business picking a strategy at all; printing what it would have done and exiting non-zero is defensible for a verb this destructive.
- Seal somewhere the hypervisor can read. Out of scope here, but worth a sentence in whatever ADR this lands against.

Whichever is chosen, `recreate` is the destructive branch and should be reachable only from evidence, never from the absence of it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `vm:recover` against a stopped guest that carries a matching sealed hash does not destroy it
- [x] #2 A sealed hash that could not be READ is distinguishable from one that is genuinely ABSENT, and only the latter can reach the recreate branch
- [x] #3 When recover cannot establish the guest's sealed claim, it says so in terms of what it could not read — not as a bare 'unknown' verdict
- [x] #4 The stopped-guest path is covered by a unit test that does not need a hypervisor
- [x] #5 Exercised at least once against the real remote substrate from a stopped start, and the result recorded
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Agreed with the user before writing anything (design tree, four rounds collapsed to one pass):

1. **Disposition.** A verdict that establishes nothing does NOT refuse and does NOT recreate — it **rolls back** to `podkit-provisioned` where that snapshot exists, because the snapshot is evidence the API supplies without the link. Recreate only where there is no snapshot, which is itself positive evidence. Rationale: the two mistakes are not symmetric. A needless rollback costs a restart and the next `vm:doctor` catches it; a needless recreate costs a re-provision, a re-seal and a manual host-key verification from the PVE host. Refusal was rejected because a running guest with a wedged sshd reads as unreadable too, and that is the headline case `vm:recover` exists for.

2. **Source the verdict from the right place.** `cmdRecover` reads `pveStatus` over the **API first** and only reaches for the link when the guest reports `running`. The hook alternative (`templateHash` as a callback `pveRecover` invokes once it knows the status) was rejected: it turns a data field into a callback for one caller, and the "what could not be read" sentence has to be composed by the CLI regardless — only it holds the link's `description` and the ssh error's `detail`.

3. **Four verdict cases, not three.** `'absent'` is new and means *the guest answered and carries no seal* — the only new route to recreate. `'unknown'` keeps its name but flips to its plain-English meaning, *no comparison was possible*, and never recreates. Modelled as a discriminated union so an `'unknown'` without a stated cause is unrepresentable; the alternative (a sibling `hashDetail?: string`) leaves the invariant as a convention, which is how the original defect was shaped.

4. **`expected === undefined` joins the same bucket.** Nobody passed `--expect-hash` in production, so *every* `vm:recover` recreated — running guest or stopped. The stopped-guest path in this task was one of two ways into the same wrong branch. Absence of a host-side hash is absence of evidence, and gets the same non-destructive treatment.

5. **Close the `--expect-hash` gap here.** `@podkit/lima` cannot compute the hash (`substrateBaselineInputs` lives in `@podkit/device-testing`, which depends on lima, not the reverse). A ~60-line `scripts/vm-recover.ts` composes it and delegates to the CLI; `package.json`'s `vm:recover` points at it. Without this, AC #1 could only be satisfied in the weak sense — never destroying, but never actually comparing either.

6. **`--recreate`, but not `--rollback`.** Operator intent is its own evidence, and it is what the fallback message can name as the way forward. `--rollback` was deliberately left out: rollback is already the fallback, so the only thing it would override is `'drifted'` — the one trap `chooseRecoveryStrategy` exists to prevent.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## What changed

**`TemplateHashVerdict` is a discriminated union, and `'unknown'` no longer recreates.** Five cases: `match`, `drifted`, `absent` (the guest answered and carries no seal), `unknown` (no comparison was possible — carries `because`), `not-sought` (the caller pre-empted the question — carries `because`). `absent` is the only *new* route to recreate; `unknown` rolls back.

**`chooseRecoveryStrategy` orders the branches by evidence.** `not-sought` → recreate (intent). `drifted` → recreate. `absent` → recreate. No snapshot → recreate, and when the verdict was `unknown` the reason *leads* with what could not be read, because that is the one remaining path that deletes a guest nobody could question. Otherwise `unknown` → rollback, naming the gap and pointing at `vm:doctor`.

**`cmdRecover` sources the verdict over the API first.** `establishTemplateHash` reads `pveStatus` and only reaches for the link when the guest reports `running`. A stopped guest never has its link touched — pinned by a test whose fake link *would* have answered with a matching hash.

**`readSealedHash` returns `SealedHashRead`,** distinguishing "the guest answered" (`hash`, possibly empty) from "nobody could ask" (`detail`, the ssh diagnostic). `cmdDoctor` consumes the same distinction and now reports an unreachable link as a fact about the link rather than as a missing seal.

**`--recreate`** rebuilds outright without consulting the guest. `--rollback` was deliberately not added.

**`test-packages/device-testing/scripts/vm-recover.ts`** computes the host-side baseline hash and passes `--expect-hash`; `package.json`'s `vm:recover` points at it. It adds one argument and delegates — usage, registry errors and the terminal stay `podkit-vm`'s.

## The second half of the bug

The task describes a stopped guest. Tracing the callers showed `--expect-hash` had **no producer at all**: `package.json` mapped `vm:recover` straight at `podkit-vm`, and the flag appeared only in `cli-ssh.ts` and its tests. So `expected` was always `undefined`, `templateHashVerdict` returned `'unknown'` on that alone, and *every* `vm:recover` recreated — running guest or stopped. The stopped-guest path was one of two ways into the same wrong branch. `@podkit/lima` cannot compute the hash (`substrateBaselineInputs` lives in `@podkit/device-testing`, which depends on lima), which is why the wrapper exists.

## Review findings acted on

- **Defect narration in comments** (AGENTS.md §Comments). Three comments described what a previous version did; rewritten to carry the constraint only.
- **The asymmetry argument was written out three times.** It now lives once, in `docs/architecture/testing/vm-testing.md`; `lifecycle.ts` and the Proxmox playbook link to it.
- **`--recreate` signalled through two channels** — a `forceRecreate` boolean *and* a synthesised verdict that was never read, whose fallback meaning was rollback, i.e. the opposite of the request. Collapsed to one: `{ verdict: 'not-sought', because }`. That also removed `forceRecreate` from both `ChooseRecoveryInput` and `PveRecoverOpts`, where `pveRecover` was only forwarding it.
- **AC #3 was partial on the destructive path**: `unknown` + no snapshot recreated while reporting only the missing snapshot. The cause now leads that reason, with tests at both seams.
- Test fixture `rollbackRoutes` → `recoverRoutes`; it is the guest's route table, not a rollback's.

Kept deliberately: the duplicate `pveStatus` read (`cmdRecover` and `pveRecover` each read it — one cheap round-trip, and both branches re-read status anyway), and the `cmdDoctor` improvement, which follows necessarily from the `SealedHashRead` signature.

## Verification

`bun run lint`, `bun run typecheck` (40 tasks), `bun run test:unit` (44 tasks) and `bun run test:integration` (31 tasks) all clean. 63 tests across the two touched files, 12 of them new.

## AC #5 — live run against the real remote substrate

Run by the operator from a stopped start (the implementing session's own attempt was blocked by a sandbox policy). VMID 9000, `stopped`, carrying `podkit-provisioned`, host hash `73a79d88…` — the exact shape the old code destroyed.

```
$ bun run vm:recover deviceRemote
[podkit-vm] rollback: VMID 9000 is stopped, so its sealed hash could not be read over
  ssh_config alias `podkit-substrate`, so 'podkit-provisioned' is the only evidence
  available — rolling back rather than rebuilding a guest nothing has shown to be stale.
  Re-check with `bun run vm:doctor`
[podkit-vm] waiting up to 300000ms for ssh_config alias `podkit-substrate` to answer over
  ssh (ssh: connect to host 192.168.10.213 port 22: No route to host)
[podkit-vm] `deviceRemote` recovered by rollback (…)
```

**Rollback, not recreate.** The reason names the stopped guest rather than reporting a bare verdict, and the first readiness probe after `start` refused with `No route to host` — the TASK-525 wait doing its job on this branch too.

Verified afterwards:

```
$ bun run vm:doctor
[vm:doctor] baseline OK (73a79d889b39...; 6 inputs tracked).
```

That is the same hash the host sources compute, so the guest the fallback restored was in fact a `match` — the conservative branch guessed right, confirmed after the fact rather than assumed. Under the old code this run would have destroyed the guest and left a re-provision, a re-seal and a manual host-key verification to do.

**One wording defect the live run exposed**, invisible to the unit tests because each asserts on a fragment: the stopped-guest `because` ended in a clause with `so`, and `chooseRecoveryStrategy` appends another, giving `… is stopped, so its sealed hash could not be read over X, so 'podkit-provisioned' is the only evidence …`. Changed to `, and its sealed hash …`; the no-snapshot recreate reason now joins with `;` rather than a third `and`.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`vm:recover` chose between rolling a guest back and destroying it on a sealed hash read over ssh, and collapsed every failure of that read into an empty string. A stopped guest, a wedged sshd and a genuinely unsealed disk all arrived at `chooseRecoveryStrategy` as `'unknown'`, which read that as "no provisioning state to roll back to" and answered with a full destroy-and-rebuild.

Two facts were conflated: whether the guest answered on port 22, and what is on its disk. `TemplateHashVerdict` now separates them — `absent` is the guest answering with no seal, `unknown` is no comparison being possible and carries its reason, `not-sought` is a caller pre-empting the question. Only facts reach the destructive branch: drift, an empty seal, a missing snapshot, a missing guest, an explicit `--recreate`. A verdict that establishes nothing rolls back to `podkit-provisioned`, which the API reports on a stopped guest without the link. `cmdRecover` reads `pveStatus` over the API first and reaches for the link only when the guest is `running`.

Tracing the callers found the other half: `--expect-hash` had no producer, so `expected` was always undefined and *every* recover recreated, stopped or not. `scripts/vm-recover.ts` in `@podkit/device-testing` now composes the hash and delegates.

Proven live from a stopped start: rollback rather than recreate, with `vm:doctor` afterwards reporting the restored guest's hash identical to the host sources — the conservative branch was correct, confirmed rather than assumed.
<!-- SECTION:FINAL_SUMMARY:END -->
