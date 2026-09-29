---
id: TASK-527
title: >-
  Seal the baseline hash where the hypervisor can read it, so recover rarely has
  to guess
status: Done
assignee: []
created_date: '2026-09-24 22:49'
updated_date: '2026-09-29 21:34'
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
modified_files:
  - test-packages/substrate/src/pve/lifecycle.ts
  - test-packages/substrate/src/pve/lifecycle.test.ts
  - test-packages/substrate/src/index.ts
  - test-packages/lima/src/cli-ssh.ts
  - test-packages/lima/src/cli-ssh.test.ts
  - test-packages/device-testing/scripts/substrate-seal.ts
  - test-packages/device-testing/scripts/vm-doctor.ts
  - docs/environments/device-substrate-proxmox.md
  - docs/architecture/testing/vm-testing.md
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
- [x] #1 The provisioning snapshot carries the full sealed baseline hash in a parseable field, not embedded in prose
- [x] #2 `vm:recover` against a stopped guest reaches `match` or `drifted` on hypervisor-readable evidence alone, with no link involved
- [x] #3 A snapshot sealed without a hash is distinguishable from one whose hash does not match, and does not read as drift
- [x] #4 The two `pveSealSnapshot` call sites cannot write different description formats
- [x] #5 The in-guest seal remains what `vm:doctor` verifies; where it and the hypervisor-side hash disagree, that is reported rather than silently resolved
- [x] #6 Exercised against the real remote substrate from a stopped start: recover reports a compared verdict rather than `unknown`, and the result recorded
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. One formatter/parser pair for the provisioning snapshot description: `podkit-baseline-hash=<64 hex>` or `=none`; `pveSealSnapshot` takes `{ baselineHash }` instead of free prose, so the two call sites cannot diverge. Full hash, validated.
2. `snapshotHashVerdict(snapshots, expected)` in @podkit/substrate: match / drifted from the claim; no snapshot, an explicit `none`, or an unrecognised (legacy prose) description are each `unknown` with their own reason — never drift.
3. cli-ssh `establishTemplateHash`: the snapshot claim decides where it exists (it describes the restore point a rollback restores); the in-guest read is the fallback where it does not. When both are readable and disagree, report it.
4. `vm:snapshot` verb reads the in-guest seal over the link and records it; `harness:seal` records the full combined sha.
5. Live: re-seal deviceRemote, stop it, recover -> compared verdict.
<!-- SECTION:PLAN:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
**Surface: the snapshot description.** It binds the claim to the restore point a rollback restores, and dies with it; a guest-level field would outlive the snapshot it vouched for. Format, written by one private formatter: `podkit provisioning snapshot; podkit-baseline-hash=<64 hex>` or `=none`. `pveSealSnapshot(binding, { baselineHash })` takes the claim, not prose, so the two call sites cannot diverge (AC #4); a non-full hash throws `PveBaselineHashFormatError` before any snapshot call. Full hash — the 12-char truncation had no recorded reason.

**Reading it.** `snapshotHashVerdict(snapshots, expected)` → match / drifted from the claim; no snapshot, `=none`, and an unrecognised description (the old `podkit baseline 73a79d889b39` prose, deliberately *not* prefix-matched) are each `unknown` with their own reason — never drift (AC #3). `baselineDisagreement(snapshots, guestHash)` names a mismatch and prefers neither side.

**Which wins where (AC #5).** `recover` chooses on the snapshot claim when there is one — it describes what a rollback restores — and falls back to the in-guest seal (the old path) when there is not. `vm:doctor` still verifies the in-guest seal and its verdict is unchanged; both it and `recover` report a disagreement when both sides are readable. Doctor's check is best-effort and only runs with a token configured.

**`vm:snapshot`** reads the guest's seal over the link and records it; with nothing readable it records `=none` and says `harness:seal` is the command that seals and snapshots together.

**AC #6 — live, deviceRemote (VMID 9000).**
- Before: description `podkit baseline 73a79d889b39`; recover from paused → `unknown` naming the unrecognised description, rolled back.
- `harness:seal` → `podkit provisioning snapshot; podkit-baseline-hash=73a79d889b39cf61…0825` (round-trips through PVE intact). `vm:snapshot` wrote the identical string.
- `vm:down`, then `vm:recover` from **stopped** → `rollback: 'podkit-provisioned' matches the committed provisioning inputs`. Compared, not guessed; no link involved in the verdict.
- Disagreement: overwrote the in-guest seal with `b…b`. `vm:doctor` → drift + `note: the provisioning snapshot and the guest disagree … claims 73a79d889b39…, the guest's seal holds bbbbbbbbbbbb…`. `vm:recover` reported the same, chose the snapshot, rolled back; `vm:doctor` → `baseline OK` afterwards. Guest left stopped.

**Caveat:** a compared verdict needs `--expect-hash`, which `vm-recover.ts` supplies; `podkit-vm recover` invoked directly still reads `unknown`.

`vm:doctor`'s remediation text no longer says "expect a recreate": recover now rolls back when the snapshot's recorded hash still matches.
<!-- SECTION:FINAL_SUMMARY:END -->
