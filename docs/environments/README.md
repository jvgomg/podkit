---
title: Environment Playbooks
description: The map of podkit's machine-provisioning playbooks — which box does what, which document builds it, and which privileges each phase actually needs.
sidebar:
  order: 0
---

Provisioning playbooks for the machines podkit's test and build work runs on.

Audience: contributors and AI agents standing a machine up. Written as
idempotent change logs rather than prose so they can be lifted into Ansible.

Nothing here is published — these are internal, and they deliberately contain
no hostname, address, pool, storage, bridge or credential. Every one of those
lives on the machine that needs it (`~/.ssh/config`, `.env.local`), which is
what keeps a public repository free of anyone's infrastructure by construction
rather than by vigilance. See [ADR-029](../adr/adr-029-portable-device-substrate.md) §2.

---

## The four machines, and what each is for

| Playbook | Box | Provides | Must NOT have |
|---|---|---|---|
| [device-substrate-proxmox](./device-substrate-proxmox.md) | **substrate**, 2 GiB VM | a guest kernel with `dummy_hcd`, configfs and the gadget stack | any toolchain or `-dev` package |
| [builder-proxmox](./builder-proxmox.md) | **builder**, 4 GiB VM | the toolchain that compiles every Linux artifact | — |
| [device-substrate-ci](./device-substrate-ci.md) | throwaway CI substrate | the same substrate contract, on a runner | same as the substrate |
| [linux-dev-host](./linux-dev-host.md) | dev box (LXC is fine) | rootless Podman for the local e2e cells | — |

**The substrate and the builder are inverses and one box cannot be both.** The
substrate's defining assertion is the *absence* of a toolchain, because that
absence is what lets it catch a static-linkage regression in a binary claiming
to need none. The builder needs exactly those packages. Their two contracts
contradict each other on purpose and are never merged — a unit test
(`builder-contract.test.ts`) fails red if anyone tries.

A **dev host** is neither. It cannot host a substrate (an unprivileged LXC has
no `dummy_hcd`) and it is not a builder (nothing asserts its toolchain). It runs
the cells that need neither.

---

## The three phases, and the privileges each needs

This is the part worth reading before touching a hypervisor. The split is what
lets most work happen from a machine holding no privileged credential at all.

### Phase 1 — privileged, once

Run [`bootstrap-pve.sh`](../../test-packages/device-testing/substrate/proxmox/bootstrap-pve.sh),
either **on the PVE host** or **from a workstation with ssh to it**:

```bash
bash test-packages/device-testing/substrate/proxmox/bootstrap-pve.sh \
  --pve-host root@<pve-host>
```

Add `--print-only` to see the exact command sequence without running anything.
The runbook is generated from the file that automates it, so the two cannot
drift.

It does the three things — and only the three things — that need root on the PVE
host, because **no API token can do any of them**:

1. **The `pveum` grant.** That binary exists on no other machine, and creating
   roles, pools and tokens is a root operation by definition.
2. **The cloud-init snippets.** PVE's storage-upload API accepts `iso`,
   `vztmpl` and `import` content — *not* `snippets`. Placing one is a filesystem
   write on the host or nothing.
3. **The pinned Debian image.** `import-from=` reads a file on the host.

It deliberately creates **no VM**: that is inside the token's rights, so it
belongs to phase 2.

### Phase 2 — the pool-scoped token

Creating, starting, stopping, destroying and recreating guests. All of it is
covered by the privilege-separated token phase 1 produced, whose ACL is confined
to one pool — its effective rights are the *intersection* of its user's and its
own, so it cannot reach a guest outside that pool even if the user is later
granted more.

Today this is `qm` over ssh, or the API by hand. [TASK-515](../../backlog/tasks/)
replaces it with `bun run vm:up` / `vm:down` over the token. The `qm create`
recipes in the two playbooks are the current manual form.

### Phase 3 — just ssh

Applying the contract, running the doctor, installing binaries, and every test
suite. **No PVE rights at all** — only ssh to the guest, through an alias the
developer owns. This is the bulk of day-to-day work.

---

## Where the machine-specific values live

Nothing below is committed, and none of it should ever be pasted into a chat,
a commit message or an issue.

| Value | Lives in |
|---|---|
| substrate / builder address, user, key, jump host | your `~/.ssh/config`, under the alias the registry names |
| which substrate this machine drives | `PODKIT_SUBSTRATE` in `.env.local` |
| PVE token id, secret, TLS fingerprint | `.env.local` (gitignored) |
| PVE VMIDs | `.env.local` — PVE addresses guests by VMID, and a VMID is a fact about your hypervisor, not about podkit |

The repo declares the **role**; your machine declares which box fills it. See
[`.env.example`](../../.env.example) for every key with its reasoning.

---

## Related

- [ADR-029](../adr/adr-029-portable-device-substrate.md) — a substrate is an executable contract, not a VM; builder as a role
- [ADR-028](../adr/adr-028-substrate-agnostic-device-harness.md) — the substrate-agnostic harness this rests on
- [CONTEXT.md](../../CONTEXT.md) §Test environments — the vocabulary (substrate, provisioner, builder, harness)
