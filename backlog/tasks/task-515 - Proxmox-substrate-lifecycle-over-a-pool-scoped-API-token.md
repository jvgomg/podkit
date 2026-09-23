---
id: TASK-515
title: Proxmox substrate lifecycle over a pool-scoped API token
status: In Progress
assignee: []
created_date: '2026-09-13 18:34'
updated_date: '2026-09-23 23:08'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Five decisions this task had to make, then the build.

**D1 — `PODKIT_PVE_API_URL`, a full base URL.** Not a hostname plus an assumed `:8006`, not an ssh_config alias. An alias is resolved by a file with no bearing on an HTTPS connection. Added to `.env.example` alongside `PODKIT_PVE_POOL` (default `podkit`).

**D2 — the node is discovered, not configured.** `GET /pools/<pool>` returns vmid, name, status AND node for every member in one call (comment #6). So there is no `PODKIT_PVE_NODE` key: the pool listing is both the `status` implementation and the vmid→node resolver, and it is the one call `Pool.Audit` exists to permit.

**D3 — TLS pin narrows the trust anchor; it does not disable verification.** Probe the cert over `node:tls`, compare SHA-256 against the pin, then issue every request with that exact certificate as the `ca` and a `checkServerIdentity` that re-checks the fingerprint. With no pin configured, plain system-CA `fetch` — unchanged, still verifying. There is no branch anywhere that turns verification off.

**D4 — keep `--cicustom`; recreate does not invent a snippet.** PVE's upload endpoint has no `snippets` content type, so a token cannot place one. The alternative (native `--ciuser`/`--sshkeys`) was rejected: the snippet also brings `qemu-guest-agent`, and a recreate that quietly dropped it would produce a guest whose address the token can no longer read — a quieter failure than a named "re-run phase 1". Create therefore reuses the snippet phase 1 placed and names `bootstrap-pve.sh` when it is absent.

**D5 — the host-key story is that the token cannot tell you the key.** Guest-exec is `VM.GuestAgent.Unrestricted` and is deliberately not granted, so the playbook's `qm guest exec … ssh-keygen -lf` instruction is unavailable to the very principal that makes recreate routine. What the token *can* do is bind an IP to a VMID via `network-get-interfaces`. Recreate prints that binding and names the two privileged ways to read the key; the playbook stops claiming otherwise.

Build order:

1. `src/pve/{config,errors,tls,client,qm,lifecycle}.ts` in `@podkit/substrate` — hand-rolled over an injectable `fetch`, six endpoints, 403 → privilege + path.
2. `src/remote-lock.ts` — advisory lock held IN the substrate over `SubstrateLink`, `mkdir`-atomic, metadata naming host/user/pid/start, short timeout, documented force.
3. `podkit-vm` dispatches on the provisioner instead of refusing non-Lima; absent config degrades to the printed `qm` equivalent.
4. Baseline hash extends to the cloud-init template and the image pin (a literal, not a file), and drift names the recovery command per substrate.
5. Playbook + `.env.example` + ADR-029 amendments.
<!-- SECTION:PLAN:END -->

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

author: claude
created: 2026-09-23 17:38
---
Three findings from TASK-522 (phase-1 bootstrap) that change what this task has to build.

**1. Address guests by VMID, not by name — and take the VMID from the env.** PVE's API is `/nodes/{node}/qemu/{vmid}/status/start`; there is no name-addressed form. Resolving a name to a VMID via the pool is possible but pointless, and it would tempt the client into the registry's `instanceName` — which does NOT match what the playbooks create (`podkit-device-remote` vs `--name podkit-substrate`). I nearly "fixed" that mismatch before noticing it does not matter: a VMID is a fact about someone's hypervisor, so it belongs in `.env.local` beside the token, by the same argument that keeps the ssh alias out of the repo. `PODKIT_PVE_VMID_DEVICE_REMOTE` / `PODKIT_PVE_VMID_BUILDER_REMOTE` are now documented in `.env.example`. The registry declares the role; the env declares which guest fills it. Nothing needs to change in `registry.ts`.

**2. Recreate cannot be fully token-driven unless `--cicustom` goes.** PVE's storage-upload endpoint accepts `iso`, `vztmpl` and `import` content — not `snippets` — so a token holder cannot place or update a cloud-init snippet at all. Two consequences for AC #8's recreate path: with the current `--cicustom` design, recreate works only because phase 1 already left the snippet on the host, and any change to it (a second developer's key, say) needs root again. The alternative is to drop `--cicustom` for PVE's native `--ciuser` / `--sshkeys` / `--ipconfig0`, which `VM.Config.Cloudinit` *does* cover — the shared template only really buys NOPASSWD sudo and `qemu-guest-agent`, and both could move into the provisioning scripts. That is a real design choice this task should make deliberately rather than inherit.

**3. Phase 1 is now one command, so the blocker is smaller than it was.** `bootstrap-pve.sh` runs the grant, both snippets and the pinned image, from the PVE host or over ssh from anywhere, with `--print-only` for the by-hand path. This task's stated blocker — "the token in `.env.local`" — is now a single command away rather than a document to follow.

Unchanged and still worth honouring: snapshot and rollback remain unproven on the host and AC #8 builds recover on top of them, so verify those before writing recover. And the first real destroy is still driven by a human, not an agent.
---

author: claude
created: 2026-09-23 18:59
---
Unblocked: the token, its secret, the TLS fingerprint and both VMIDs are now in `.env.local` on the Linux dev box, and both guests exist (9000 substrate, 9001 builder).

**One key is still missing, and it is my omission from TASK-522.** `.env.example` documents `PODKIT_PVE_TOKEN_ID`, `PODKIT_PVE_TOKEN_SECRET`, `PODKIT_PVE_TLS_FINGERPRINT` and the two VMIDs — but **nothing names the PVE host itself**. There is no address, hostname or base URL for the client to connect to, in either the example or the local file. The API client cannot be written until that key exists.

Left for this task to name rather than guessed at now, because the shape is a real decision: a bare hostname plus an assumed `:8006`, or a full base URL, are not the same thing once someone puts the API behind a reverse proxy or a non-default port. Whichever it is, it is machine-specific and belongs in `.env.local` beside the token, never in the repo.

Worth deciding at the same time: whether it should instead be an **ssh_config alias** like the guests use. The argument for is consistency — one mechanism for "where is this machine", already documented, already keeping addresses out of the repo. The argument against is that this is an HTTPS endpoint rather than an ssh target, so an alias would be a name resolved by a file that has no bearing on the connection actually being made. I lean to a plain `PODKIT_PVE_API_URL` for that reason, but it is this task's call.

**Also note the dev box cannot currently reach either guest** — no `~/.ssh/config`, and neither name resolves. That does not block the API half (which talks to the hypervisor, not the guests), but it does block AC #5's "doctor/install/test still work over the link" being verified from here.
---

author: claude
created: 2026-09-23 19:07
---
**The low-privilege half is demonstrated end to end**, by hand, from the unprivileged Linux dev box — an LXC that is a peer of the guests and has no PVE root. Sequence, all with the pool-scoped token alone:

1. TLS: fetched the live cert, compared its SHA-256 against `PODKIT_PVE_TLS_FINGERPRINT` — match, *before* the token was sent anywhere. This is the shape AC #3 wants.
2. `GET /version` → 9.1.4. `GET /nodes` → one node, `rae`.
3. `GET /pools/podkit` → both guests, both `stopped`. Note this single call returns vmid, name, status and node for every pool member — it is a better `status` implementation than per-VM polling, and it is the one call the pool ACL exists to permit (`Pool.Audit`).
4. `POST /nodes/rae/qemu/{9000,9001}/status/start` → both returned UPIDs and reached `running` within 3s.
5. sshd on both guests answered 3s later.

So nothing about the design needs revisiting; what is missing is only the ergonomics this task builds.

**Two findings for the implementation.**

**`PODKIT_PVE_API_URL` — a full base URL.** Confirmed necessary: nothing in `.env.local` named the endpoint, and it cannot be derived. A URL rather than a hostname so a non-default port or a proxy needs no second key. Not an ssh_config alias — an alias is resolved by a file with no bearing on an HTTPS connection, so it would look like configuration while doing nothing.

**The documented host-key verification is unavailable to the token that needs it.** `device-substrate-proxmox.md` tells the reader to verify a regenerated SSH host key out of band with `qm guest exec <vmid> -- ssh-keygen -lf …`. The token cannot: guest-exec is `VM.GuestAgent.Unrestricted`, which `pveum-recipe.sh` deliberately does not grant, because it would make the token strictly more powerful than the ssh access it is meant to complement. Measured: `Permission check failed (/vms/9000, VM.GuestAgent.Unrestricted)`.

That is a genuine gap rather than a doc typo, because this task makes recreate routine and recreate is what regenerates host keys. What the token *can* do is `network-get-interfaces` (`VM.GuestAgent.Audit`), which binds an IP to a VMID — confirmed 9000 → 192.168.10.213 — and so rules out an impostor at that address on the LAN without proving the key itself.

So this task needs a host-key story: either accept that the privileged half of the workflow is where a changed key gets verified and say so in the playbook, or have recreate capture the new fingerprint through a path the token holds and write it into the caller's `known_hosts`. The second is the one that makes recreate actually unattended.
---
<!-- COMMENTS:END -->
