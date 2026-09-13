---
id: TASK-515
title: Proxmox substrate lifecycle over a pool-scoped API token
status: To Do
assignee: []
created_date: '2026-09-13 18:34'
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
priority: medium
type: feature
ordinal: 275000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 5 of doc-060. ADR-028 deferred PVE API automation; doc-060 un-defers it, because start/stop/recreate is most of the value of having the substrate be a VM at all.

**Scoping is the point.** Access is a **privilege-separated API token** whose ACL is confined to a dedicated pool. A privsep token's effective permissions are the *intersection* of its user's and its own, so a token ACL'd only on the pool is genuinely pool-confined even when its user holds broader rights — podkit's automation cannot reach other VMs or host settings. The dedicated user is a single revocation point and defence in depth, not the confinement mechanism.

**Ship the `pveum` recipe as rendered output**, not prose: dedicated user, dedicated pool, custom role granting VM allocate/config/power/snapshot/audit/console **on the pool**, plus space allocation (and template allocation, for the cloud-init snippet) on the named storage and `SDN.Use` on the named bridge. Those last two are the ones that produce a late, opaque 403 when omitted — PVE 8 requires `SDN.Use` to attach a NIC where 6 and 7 did not. Creation privileges must sit on a pool or on all VMs, since a not-yet-existing VMID cannot be ACL'd; that is why the pool is the scoping unit.

**Client is hand-rolled over `fetch`**: one auth header, six endpoints (create, start, stop, status, destroy, snapshot/rollback). A dependency for six calls is supply-chain surface for nothing. **TLS rejects by default** and accepts a pinned fingerprint from the local env file — no blanket insecure flag is added, because one that ships in a public repo gets copied into someone's production automation.

**Verbs extend the existing `podkit-vm` CLI**, dispatching on the provisioner discriminator — same verbs, same single advisory-lock chokepoint. A parallel `substrate:*` family is how you end up with two lifecycles that are each 80% correct.

**Absent token degrades gracefully.** Doctor, install and every test suite still work over the link; only the lifecycle verbs are unavailable, and they print the manual `qm` equivalent. A contributor with a hand-built box stays on the same code path.

**Recreate reuses the drift machinery.** Extend the baseline hash to cover the provisioning script, the doctor, the cloud-init template and the image pin, so the drift check reports "substrate drifted from template" and names the recovery command. `vm:recover` prefers rolling back to a post-provision snapshot and falls back to a full recreate when the template hash changed — rolling back a template change would restore the stale box, which is the trap. Provisioning-level snapshots only: per-test state stays `apply-state.sh`, and ADR-028's rejection of snapshot-based *state layering* is untouched.

Also add the **remote advisory lock**: held in the substrate for the duration of a run, contention waits with a short timeout then fails naming the holder's host, user, pid and start time, with a documented force flag for a stale lock. The existing advisory lock is host-local and structurally cannot see another machine; blocking indefinitely on remote contention is indistinguishable from a hang.
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
