---
id: TASK-515
title: Proxmox substrate lifecycle over a pool-scoped API token
status: To Do
assignee: []
created_date: '2026-09-13 18:34'
updated_date: '2026-09-14 19:48'
labels:
  - testing
  - infrastructure
  - ready-for-agent
milestone: m-20
dependencies:
  - TASK-513
references:
  - >-
    backlog/docs/doc-060 -
    Portable-device-substrate-—-contract-provisioners-and-arch-decoupled-builds.md
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
  - test-packages/lima/src/cli.ts
priority: high
type: feature
ordinal: 275000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 5 of doc-060. ADR-028 deferred PVE API automation; doc-060 un-defers it, because start/stop/recreate is most of the value of having the substrate be a VM at all.

**Scoping is the point.** Access is a **privilege-separated API token** whose ACL is confined to a dedicated pool. A privsep token's effective permissions are the *intersection* of its user's and its own, so a token ACL'd only on the pool is genuinely pool-confined even when its user holds broader rights — podkit's automation cannot reach other VMs or host settings. The dedicated user is a single revocation point and defence in depth, not the confinement mechanism. This was verified against a live PVE 9.1.4 host: reads of out-of-pool guests and storages return 403.

**The `pveum` recipe is committed and tested** — dedicated user, dedicated pool, custom role on the pool, datastore rights on the named storages, `SDN.Use` on the bridge. Four defects found by running it on a real host are already fixed (see comments); the ones worth carrying forward as design facts:

- `PODKIT_PVE_STORAGE` is a **list**. Disks sit on LVM-thin while the cloud-init snippet and the qcow2 sit on a directory storage, and a token granted only one 403s on `Datastore.Audit` for the other — breaking `--cicustom` resolution and image import. This, not `SDN.Use`, is the late opaque 403 to warn people about.
- `VM.GuestAgent.Audit` is the guest-agent privilege to hold — it is what reads `network-get-interfaces`, i.e. how this task discovers a freshly-booted substrate's address. `VM.Monitor` no longer exists on PVE 9. `VM.GuestAgent.Unrestricted` is guest-exec and is deliberately not taken.
- Creation privileges must sit on a pool or on all VMs, since a not-yet-existing VMID cannot be ACL'd. That is why the pool is the scoping unit.

**Client is hand-rolled over `fetch`**: one auth header, six endpoints (create, start, stop, status, destroy, snapshot/rollback). A dependency for six calls is supply-chain surface for nothing. **TLS rejects by default** and accepts a pinned fingerprint from the local env file — no blanket insecure flag is added, because one that ships in a public repo gets copied into someone's production automation.

**Verbs extend the existing `podkit-vm` CLI**, dispatching on the provisioner discriminator — same verbs, same single advisory-lock chokepoint. A parallel `substrate:*` family is how you end up with two lifecycles that are each 80% correct.

**Absent token degrades gracefully.** Doctor, install and every test suite still work over the link; only the lifecycle verbs are unavailable, and they print the manual `qm` equivalent. A contributor with a hand-built box stays on the same code path.

**Recreate reuses the drift machinery.** Extend the baseline hash to cover the provisioning script, the doctor, the cloud-init template and the image pin, so the drift check reports "substrate drifted from template" and names the recovery command. `vm:recover` prefers rolling back to a post-provision snapshot and falls back to a full recreate when the template hash changed — rolling back a template change would restore the stale box, which is the trap. Provisioning-level snapshots only: per-test state stays `apply-state.sh`, and ADR-028's rejection of snapshot-based *state layering* is untouched.

Also add the **remote advisory lock**: held in the substrate for the duration of a run, contention waits with a short timeout then fails naming the holder's host, user, pid and start time, with a documented force flag for a stale lock. The existing advisory lock is host-local and structurally cannot see another machine; blocking indefinitely on remote contention is indistinguishable from a hang.

**Known unproven surface.** Create/start/stop/destroy are proven with the token. Snapshot and rollback are **not** — and AC #8 depends on them, so verify those before building recover on top. Clone, API console and API-driven image import are also untested; a template-based clone flow likely needs `Datastore.AllocateTemplate` on both storages.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A rendered pveum recipe creates a dedicated user, pool and custom role, and includes the storage and SDN.Use grants
- [ ] #2 The API client is hand-rolled over an injectable fetch and covers create, start, stop, status, destroy and snapshot/rollback
- [ ] #3 TLS verification is on by default and accepts a pinned fingerprint; no insecure flag exists anywhere in the codebase
- [ ] #4 Lifecycle verbs are served by the existing podkit-vm CLI via the provisioner discriminator, not a parallel command family
- [ ] #5 With no token configured, doctor/install/test still work and lifecycle verbs print the manual qm equivalent instead of failing
- [ ] #6 A 403 from PVE is reported as the missing privilege and the path it was needed on
- [ ] #7 The baseline hash covers the provision script, doctor, cloud-init template and image pin, and drift names the recovery command
- [ ] #8 vm:recover rolls back to the post-provision snapshot, and falls back to full recreate when the template hash changed
- [ ] #9 A remote advisory lock is held for the run; contention times out and names the holder's host, user, pid and start time
- [ ] #10 Per-test state still runs through apply-state.sh with no snapshot involvement
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: claude
created: 2026-09-13 19:45
---
Deferred by decision, not by blocker. Nothing depends on 515, and writing a PVE client against an API nobody has authenticated to means guessing at exactly the parts unit tests cannot check — real error shapes and task-polling semantics. Picked up once `pveum-recipe.sh` has been run on the host and the token is in `.env.local`.

When it is picked up: the `destroy` and `recreate` verbs act on real VMs. They get built and unit-tested against an injected fetch, and the first real destroy is driven by a human, not an agent.
---

author: claude
created: 2026-09-13 19:59
---
`pveum-recipe.sh` was tested against a live PVE 9.1.4 host (kernel 6.17.4-2-pve), including a full create → start → stop → destroy cycle of a throwaway VM using the token alone. The security argument held — a privsep token ACL'd to one pool is genuinely confined, verified by reading guests and storages outside it and getting 403 — but the script as committed did not run on PVE 9, and the token it produced could not complete the documented workflow. Four defects, all now fixed in the repo:

1. **`VM.Monitor` does not exist on PVE 9.** The first `pveum role add` aborted with `invalid privilege 'VM.Monitor'`. Replaced with `VM.GuestAgent.Audit`, which is the privilege behind `network-get-interfaces` — i.e. how lifecycle automation will discover a freshly-booted substrate's address, which this task needs. Deliberately NOT `VM.GuestAgent.Unrestricted`: that is guest-exec, and would make the token strictly more powerful than the ssh access the substrate already grants.
2. **One storage grant is not enough.** Disks live on LVM-thin while the snippet and qcow2 live on the directory storage, so a single grant 403s on `Datastore.Audit` for the other — breaking both `--cicustom` resolution and image import. `PODKIT_PVE_STORAGE` is now a space-separated list, looped over for both the user and token ACLs.
3. **`Pool.Audit` was missing**, so the token could not address the pool it is confined to (`GET /pools/<pool>` → 403), even though listing guests worked — that path is audit-filtered and needs no pool right. Added.
4. **The script's own verification command was broken.** `pveum user permissions <user> --token <id>` is not valid on PVE 9; the form is `pveum user permissions '<user>!<token>'`. This mattered more than a typo: it is the command that proves the confinement, and its parse error reads like a broken token.

Also corrected a claim I had written from the docs rather than from a host: **`SDN.Use` was never the source of the late 403.** The grant works exactly as the recipe claimed; the late failure was the storage one. The comment and the playbook note both said otherwise and now say what was measured.

**Untested, and therefore unproven for this task's ACs:** snapshot and rollback (AC #8 depends on them), clone, API console, and API-driven image import — the last being what would make playbook steps 3–4 automatable rather than manual. Clone likely also needs `Datastore.AllocateTemplate` on both storages for a template-based flow.

The evidence tables live in the test report; the operative conclusions are all folded into `pveum-recipe.sh` and the playbook, which are the artefacts that get read.
---

author: claude
created: 2026-09-14 19:48
---
Priority raised to High, and the reason has changed.

515 was filed as a convenience — start/stop/recreate rather than opening the Proxmox UI. The builder-VM decision (ADR-029 §4, TASK-520) makes it closer to a dependency. A substrate at 2 GiB and a builder at 4 GiB will not generally coexist on a modest hypervisor, so the operating mode is start-for-a-build and stop-after. Without the API that is `qm start` / `qm shutdown` by hand around every build — friction on the hot path of the local loop, which is the thing ADR-028's decision drivers protect.

Still blocked on the same thing: the token in `.env.local`. And the verification order now matters more than it did — snapshot and rollback remain unproven on the host, and AC #8 builds recover on top of them.
---
<!-- COMMENTS:END -->
