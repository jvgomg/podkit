---
title: 'ADR-029: Portable Device Substrate'
description: Amends ADR-028. A substrate is defined by an executable contract rather than by the Proxmox VM that ADR-028 assumed; connection detail moves from an environment variable to an ssh_config alias; PVE lifecycle stops being deferred; host architecture stops implying target architecture; and provisioning-level snapshots come into scope while per-test snapshots stay rejected.
sidebar:
  order: 30
---

# ADR-029: Portable Device Substrate

## Status

**Accepted** (2026-09-13)

Amends [ADR-028](./adr-028-substrate-agnostic-device-harness.md). Everything in
ADR-028 not listed below stands unchanged — in particular §1 (`SubstrateLink`
beneath the harness), §2 (transport failure distinguishable from guest failure),
§4 (container cells split by privilege), §5 (unavailable substrate skips loudly,
gate still fails) and §7 (vocabulary).

The full design, including the alternatives rejected along the way, is
`backlog/docs/doc-060`. This ADR records only what changes in the decision log.

## Context

ADR-028 was written for one machine: a workstation whose owner has a Proxmox
host, knows its pool and bridge names, and can put its hostname in an
environment variable. That is a correct answer for that machine and does not
generalise, for four reasons that only became visible while implementing it.

**The substrate was defined by its provisioner.** ADR-028 §3 says "the substrate
is a sibling Proxmox VM". A contributor with a spare Debian box, a libvirt guest,
a cloud VM or a CI runner had no way to establish whether their machine
qualified, because the requirements existed as prose plus 253 lines of Lima
provisioning script.

**The requirements would have existed twice.** The gadget module stack,
`dummy_hcd num=4`, the configfs mount, the runtime-only package set and the
no-toolchain assertion were encoded in `podkit-device.yaml`. A Proxmox cloud-init
template would have re-encoded all of them with nothing comparing the two.

**Host architecture implied target architecture.** One function mapped
`process.arch` to a binary filename suffix and seven resolvers called it, so an
arm64 macOS host could not produce artifacts for an amd64 substrate at all. This
silently pinned every host to a substrate of its own architecture — a constraint
nobody chose.

**The repository is public.** ADR-028 §3 puts the substrate's hostname in an
environment variable, which keeps it out of git by asking contributors to
remember. Pool, storage and bridge names have the same problem, and an API token
would be worse.

## Decision

### 1. A substrate is defined by an executable contract

A substrate is any SSH-reachable Debian host that passes `substrate-doctor.sh`.
Proxmox is the reference recipe; a Lima VM, a libvirt guest, a cloud VM, a spare
box and a CI runner are equally legitimate if they pass.

The contract lives in three portable Debian bash files that no provisioner knows
it is running under — `substrate-contract.sh` declares the invariants as values,
`provision-substrate.sh` applies them, `substrate-doctor.sh` asserts them and
makes its exit code the verdict. `apply-state.sh` joins them unchanged.

This replaces ADR-028 §3's "the substrate is a sibling Proxmox VM". Sibling-not-
nested still holds, and for the reason ADR-028 gave: the kernel requirements are
*guest* kernel requirements, which is why they are satisfiable by provisioners
ADR-028 never considered.

Lima's `provision:` entries take an inline script or inline content and cannot
reference a file, so provisioning runs **post-boot** rather than at first boot.
Both provisioners therefore reduce to the same two steps — copy the scripts in,
execute them as root — which is what makes the Proxmox path a drop-in rather
than a parallel implementation.

### 2. Connection detail is an ssh_config alias, not an environment variable

The registry carries the *name* of an ssh_config `Host` alias. Hostname, user,
key and any jump host live in the developer's own `~/.ssh/config`.

This replaces ADR-028 §3's "machine-specific connection detail lives in an
environment variable". The repo then contains no infrastructure detail by
construction rather than by vigilance, and a Tailscale or bastion route works
without the repo modelling it. An environment variable is retained as an
override for CI, which has no `~/.ssh/config`.

Machine-specific *selection* — which substrate this host uses — is explicit
configuration in a gitignored env file, never inferred from `process.platform`.
With nothing configured, selection falls back to Lima when `limactl` is present
and says that it did so.

### 3. PVE lifecycle is no longer deferred

ADR-028 §3 defers PVE API automation as "a real project buying an operation run
roughly twice a year". That undercounted: start and stop are not twice-a-year
operations on a substrate that costs 2 GB on a shared hypervisor, and recreate
is how a drifted box gets fixed.

Access is a **privilege-separated API token** whose ACL is confined to a
dedicated pool. A privsep token's effective rights are the intersection of its
user's and its own, so a token ACL'd only on the pool is confined to that pool
even when its user holds more. Creation privileges cannot be attached to a VMID
that does not exist yet, which is why the pool — not per-VM ACLs — is the
scoping unit.

Absent a token, everything except the lifecycle verbs still works and those
verbs print the manual `qm` equivalent. A contributor with a hand-built box
stays on the same code path as one with automation.

### 4. Host architecture no longer implies target architecture

Target architecture is resolved from the selected substrate, with host
architecture only as the default when no substrate is selected. It becomes a
declared build-task input, because the artifact filenames already carry the arch
but the cache key did not — and that failure is a silently wrong artifact rather
than an error.

"Builder" becomes a role reached over the same link as a device substrate: a
Proxmox builder VM, an existing amd64 machine, or localhost. glibc and musl move
together, since the libc the Docker image actually ships is the one that would
otherwise be left least covered.

This supersedes ADR-028's Consequences note that "artifact caches must key on
architecture" — necessary but not sufficient, because `binary-paths.ts` could not
name a foreign target architecture at all.

### 5. Provisioning-level snapshots are in scope; per-test snapshots remain rejected

ADR-028's Alternatives rejects "Proxmox snapshot/rollback instead of
`apply-state.sh`" because rollback is a multi-second VM operation against a
sub-2-second forward mutation. **That rejection stands**, and is about *per-test
state layering*.

Provisioning-level snapshots are a different question and are adopted: a
`provisioned` snapshot taken once after the doctor passes turns recreate from
minutes into seconds. Recreate prefers rollback and falls back to a full rebuild
when the template hash changed — rolling back a template change would restore
the stale box.

Stated explicitly because the two look identical at a glance, and a later reader
comparing this ADR with ADR-028's Alternatives would otherwise score it as a
reversal.

## Consequences

**Positive.** The contract is satisfiable by machines nobody in this project
provisioned, and CI can prove that. The invariants exist once, so Lima and
Proxmox cannot drift. A macOS host can drive an amd64 substrate. Nothing about
anyone's infrastructure can reach a public repository by accident.

**Cost.** A new `@podkit/substrate` package owns the registry, the link, the
contract and the provisioner dispatch; `@podkit/lima` shrinks to the Lima
provisioner. The move happens with the discriminator rather than after it — a
registry already speaking `provisioner: 'ssh'` from a package named `lima` would
not get moved later.

**Neutral.** Post-boot provisioning means a freshly created Lima VM is not a
substrate until `harness:setup` runs. That was already the documented first-time
path, and `vm:doctor` already gates `test:vm`.

**Discovered while implementing.** Two defects the extraction surfaced, both
recorded here because they are properties of the design rather than of the code:
re-provisioning must be non-disruptive (it runs on every setup, so an
unconditional module reload lets one person's setup destroy another's test run
on a shared substrate), and drift detection must track the contract scripts
rather than the Lima YAML, which no longer carries the invariants.

**Still deferred.** `usb-synth` on CI, which ADR-028 leaves open. A second
concurrent substrate to remove the phase-2 serialisation in the mirror run.
