---
id: TASK-526
title: >-
  vm:recover destroys a stopped guest, because it reads the sealed hash over a
  link that is down
status: To Do
assignee: []
created_date: '2026-09-24 01:56'
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
- [ ] #1 `vm:recover` against a stopped guest that carries a matching sealed hash does not destroy it
- [ ] #2 A sealed hash that could not be READ is distinguishable from one that is genuinely ABSENT, and only the latter can reach the recreate branch
- [ ] #3 When recover cannot establish the guest's sealed claim, it says so in terms of what it could not read — not as a bare 'unknown' verdict
- [ ] #4 The stopped-guest path is covered by a unit test that does not need a hypervisor
- [ ] #5 Exercised at least once against the real remote substrate from a stopped start, and the result recorded
<!-- AC:END -->
