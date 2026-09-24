---
id: TASK-527
title: >-
  Seal the baseline hash where the hypervisor can read it, so recover rarely has
  to guess
status: To Do
assignee: []
created_date: '2026-09-24 22:49'
labels:
  - testing
  - infrastructure
milestone: m-20
dependencies:
  - TASK-526
references:
  - test-packages/substrate/src/pve/lifecycle.ts
  - test-packages/substrate/src/pve/client.ts
  - test-packages/device-testing/scripts/substrate-seal.ts
  - test-packages/lima/src/cli-ssh.ts
  - docs/architecture/testing/vm-testing.md
  - docs/environments/device-substrate-proxmox.md
priority: medium
type: enhancement
ordinal: 297000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Left over from TASK-526, which made `vm:recover`'s wrong answer *safe* without making it *rare*.

TASK-526 stopped a stopped guest being destroyed: a sealed hash that could not be read is now `unknown` rather than `absent`, and `unknown` rolls back to `podkit-provisioned` instead of rebuilding. That is the right fallback, but it is still a fallback. The verdict on a stopped guest — the ordinary state of this substrate, which deliberately has no `onboot` — is always `unknown`, so the repair verb never actually compares anything. It rolls back because it does not know, not because it checked. The live run closing TASK-526 confirmed the guess was correct, which is reassuring and is not the same as being right.

**The hash is sealed in exactly one place the decision cannot reach.** `/var/lib/podkit-device-harness/baseline-hash` is on the guest's disk, so reading it needs sshd, so it needs the guest up. Meanwhile `pveRecover` already calls `listSnapshots` over the API — on a stopped guest, without a link — at the exact moment it chooses. The evidence is one field away from the decision and is not being used.

**Most of the plumbing already exists, and disagrees with itself.** `PveSnapshot.description` is parsed and returned by the client (`client.ts:54-60`). `substrate-seal.ts:64` already writes a hash into it:

```ts
await pveSealSnapshot(resolved.binding, `podkit baseline ${combinedSha.slice(0, 12)}`);
```

So a truncated hash is *already* in hypervisor-readable metadata, and nothing reads it. Worse, the other seal call site writes something else entirely — `cli-ssh.ts:260`, the `snapshot` verb:

```ts
await pveSealSnapshot(binding, 'podkit: substrate contract applied');
```

Two commands take the same snapshot under the same name and describe it differently, one carrying a 12-character hash and one carrying none. A snapshot whose description has no hash is precisely the "restore point nothing vouches for" that `docs/environments/device-substrate-proxmox.md` warns about, and today nothing notices.

**The privilege posture rules out the obvious alternative.** Reading the file through the guest agent needs `VM.GuestAgent.Unrestricted`, which `pveum-recipe.sh` deliberately withholds (only `VM.GuestAgent.Audit` is granted, for `network-get-interfaces`). So "ask the agent to cat the file" is closed by design and should not be reopened. The token does hold `VM.Audit`, `VM.Snapshot` and `VM.Config.Options`, which is what makes snapshot descriptions — or guest `description`/`tags` — the viable surfaces.

**What has to stay true.** The hypervisor-side hash is a *claim written alongside* the snapshot by the command that sealed it, not an independent measurement of the disk. Someone rolling back or re-snapshotting by hand through `qm` can make it lie. So it is good enough to choose a recovery strategy with, and it must not displace the in-guest seal, which is what `vm:doctor` verifies against a box that is actually running. Two sources of the same truth is a new way for them to diverge; the design needs to say which one wins where, and report rather than silently prefer one when they disagree.

**Worth weighing before writing anything.**

- Snapshot description vs. guest `description` vs. `tags`. The snapshot description binds the hash to the restore point it describes, which is the thing being chosen. A guest-level field survives the snapshot being deleted, which may be a feature or a lie.
- Full hash or truncated. 12 hex characters is 48 bits, ample against accident, but the truncation exists for no recorded reason and makes the two sides not-obviously-comparable.
- A parseable form, not prose. `podkit baseline <sha>` is currently a sentence that happens to contain a hash; anything reading it wants a field.
- What a missing hash in the description should mean. It is not drift, and it is not a matching seal. It is another `unknown` — and TASK-526 already established what `unknown` costs.

Lima substrates take no snapshots and are unaffected; this is the ssh/Proxmox branch only.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The provisioning snapshot carries the full sealed baseline hash in a parseable field, not embedded in prose
- [ ] #2 `vm:recover` against a stopped guest reaches `match` or `drifted` on hypervisor-readable evidence alone, with no link involved
- [ ] #3 A snapshot sealed without a hash is distinguishable from one whose hash does not match, and does not read as drift
- [ ] #4 The two `pveSealSnapshot` call sites cannot write different description formats
- [ ] #5 The in-guest seal remains what `vm:doctor` verifies; where it and the hypervisor-side hash disagree, that is reported rather than silently resolved
- [ ] #6 Exercised against the real remote substrate from a stopped start: recover reports a compared verdict rather than `unknown`, and the result recorded
<!-- AC:END -->
