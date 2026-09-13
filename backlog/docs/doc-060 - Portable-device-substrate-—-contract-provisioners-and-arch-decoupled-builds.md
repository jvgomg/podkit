---
id: doc-060
title: 'Portable device substrate — contract, provisioners, and arch-decoupled builds'
type: specification
created_date: '2026-09-13 18:32'
tags:
  - testing
  - infrastructure
  - rfc
  - adr-028
---
> Spec for the work that ADR-028 opened and left half-specified. Supersedes the
> single-Proxmox-box assumption in ADR-028 §3. The amendments this spec makes to
> ADR-028's recorded decisions are to be lifted into **ADR-029** once accepted;
> everything else in ADR-028 stands.
>
> Slices: TASK-493 (proof), TASK-494 (SubstrateLink), plus the four filed alongside this doc.

## Problem Statement

podkit's quality gate only runs on a machine that can host a privileged Linux
kernel. Four of the six E2E surface cells need `dummy_hcd`, configfs USB gadget
state, loop devices and `modprobe` — none of which exist in an unprivileged
container, and none of which a macOS host provides without a VM. No CI workflow
runs any test, so a developer whose machine cannot host a substrate is not
merely inconvenienced: for them, the suite does not run at all.

ADR-028 answered this with "a sibling Proxmox VM reached over SSH", and that
answer is correct for exactly one machine — the one whose owner has a Proxmox
host, knows its pool and bridge names, and can put its hostname in an
environment variable. Four things block that from generalising:

1. **The substrate is defined by its provisioner, not by what it provides.** A
   contributor with a spare Debian box, a libvirt host, a cloud VM or a CI
   runner has no way to know whether their machine qualifies, because the
   requirements live in prose and inside one Lima YAML's provisioning scripts.
2. **The requirements exist twice and will drift.** The module list, the
   `dummy_hcd num=4` option, the configfs mount, the runtime-only package set
   and the "no toolchain, no `-dev` packages" assertion are encoded as Lima
   provisioning steps. A Proxmox cloud-init template re-encodes all of them, and
   nothing compares the two.
3. **Build target arch is derived from host arch.** One function maps
   `process.arch` to the binary filename suffix, and seven resolvers call it. A
   macOS arm64 host therefore cannot produce artifacts for an amd64 substrate at
   all — not slowly, but not at all. This silently restricts every host to a
   substrate of its own architecture.
4. **This is an open-source repository.** Any design where the substrate's
   hostname, pool, storage, bridge or credentials reach a committed file is
   unshippable, and a design that relies on contributors remembering not to
   commit them is the same design with extra steps.

Downstream, the harness itself is still written against Lima specifically —
free functions take a VM name and reach `limactl` directly — which is TASK-494's
subject and is presupposed, not re-argued, here.

## Solution

**A substrate is defined by a contract, and the contract is executable.**

A substrate is any SSH-reachable Debian host that passes `substrate-doctor.sh`.
Proxmox is the reference recipe. A libvirt guest, a cloud VM, a spare box, a
Lima VM and a GitHub Actions runner are all first-class if they pass. Lima is
demoted from "the substrate" to "one provisioner", exactly as CONTEXT.md
already defines the vocabulary.

Three portable Debian bash files own the whole contract —
`provision-substrate.sh`, `substrate-doctor.sh` and the existing
`apply-state.sh`. Neither provisioner knows it is running under a provisioner:
Lima's provisioning blocks call the same scripts that cloud-init's `runcmd`
does. The Lima device YAML collapses to a thin wrapper around them.

**The repo declares capability; the machine declares choice.** Committed: the VM
registry (which substrates exist, and how each is provisioned), the cloud-init
template, the `pveum` least-privilege recipe, and an example environment file.
Local and never committed: an ssh_config `Host` alias holding hostname, user,
key and any jump host — the repo stores only the alias *name* — and a gitignored
environment file holding the substrate selection, the Proxmox API token and the
TLS fingerprint. Infra detail stays out of git by construction rather than by
vigilance, and a Tailscale or bastion route works without the repo knowing it
exists.

**Builds decouple from host architecture.** Target arch becomes an explicit,
substrate-derived axis rather than a reading of `process.arch`, and "builder"
becomes a *role reached over the same SSH link* as the device substrate. A
macOS host can then drive an amd64 substrate, and an amd64 Linux box that
cannot host a substrate can still serve as one host's builder.

**Proxmox lifecycle is automated with a scoped token.** Create, start, stop,
destroy, snapshot and rollback run over the PVE API using a
privilege-separated token confined to a dedicated pool. Without a token
everything except the lifecycle verbs still works, and those verbs print the
manual `qm` equivalent instead of failing.

## User Stories

1. As a contributor with no Proxmox host, I want a written definition of what a device substrate must provide, so that I can tell whether a machine I already own qualifies.
2. As a contributor, I want to run one script against a candidate machine and get a pass/fail verdict, so that I do not have to interpret prose requirements by hand.
3. As a contributor whose machine fails the check, I want the failure to name the specific missing module, mount, package or forbidden package, so that I know what to fix rather than that "something is wrong".
4. As a maintainer, I want the substrate requirements to exist in exactly one place, so that a Lima substrate and a Proxmox substrate cannot silently diverge.
5. As a maintainer, I want the "no Bun, no Node, no npm, no `-dev` packages" invariant enforced by the same script on every substrate, so that the binary-linkage regressions it exists to catch cannot hide on one substrate type.
6. As a macOS developer, I want my existing onboarding to keep working with no new configuration, so that this change costs me nothing on the day it lands.
7. As a macOS developer, I want to be told when a default substrate was chosen for me, so that a run that went somewhere other than I expected explains itself.
8. As a Linux developer on a container that cannot host a substrate, I want to run the full gate against a remote substrate, so that my machine's limitations stop meaning the suite does not run.
9. As a developer with a Proxmox host, I want a repo-owned cloud-init template, so that I do not hand-write provisioning and hand-verify it afterwards.
10. As a developer with a Proxmox host, I want the exact `qm` commands printed for me with my own values substituted in, so that the manual step is copy-paste rather than translation.
11. As a developer setting up for the first time, I want an ordered checklist of only the steps a human must perform, so that I can see the whole commitment before starting.
12. As a developer, I want that checklist written to files rather than shown in a TTY wizard, so that I can paste it into a chat, diff it, or hand it to an agent.
13. As an open-source maintainer, I want no hostname, pool name, storage name, bridge name or credential in any committed file, so that publishing the repo does not publish my infrastructure.
14. As a developer behind a VPN or bastion, I want connection detail expressed as an ssh_config alias, so that jump hosts and private networks work without the repo modelling them.
15. As a developer, I want one local file to hold every machine-specific value, so that setup is one file to create and one example to copy.
16. As a developer, I want to choose which substrate a run targets explicitly, so that I can reproduce an amd64-only failure from my arm64 machine.
17. As a developer, I want target architecture derived from the substrate rather than from my host, so that the artifacts I build are the artifacts that get tested.
18. As a developer, I want a run to fail loudly when artifact architecture and substrate architecture disagree, so that a mismatch is a named error rather than an exec-format failure in the middle of a test.
19. As a developer, I want the build cache keyed on target architecture, so that a cached arm64 binary is never handed to an amd64 run.
20. As a developer, I want glibc and musl builds to use the same build-host mechanism, so that there is not a third build path to keep correct.
21. As a maintainer, I want the musl path to migrate in the same change as glibc, so that the libc the Docker image actually ships is not the least-covered one.
22. As a developer with an amd64 Linux box, I want it usable as my Mac's build host, so that decoupling builds does not require standing up another VM.
23. As a Proxmox owner, I want an API token scoped to a dedicated pool, so that podkit's automation cannot touch my other VMs or my host settings.
24. As a Proxmox owner, I want the least-privilege role given as exact `pveum` commands, so that I do not over-grant while guessing which privileges are needed.
25. As a Proxmox owner, I want the recipe to include the privileges that are easy to miss, so that VM creation does not fail with an opaque 403 after everything else is configured.
26. As a Proxmox owner, I want a dedicated API user rather than a token on an admin account, so that revoking one user revokes everything at once.
27. As a developer, I want to start and stop the substrate from the repo's CLI, so that I do not open the Proxmox UI for routine work.
28. As a developer, I want to recreate the substrate from the repo's CLI, so that a wedged or drifted box is a single command to replace.
29. As a developer, I want recreate to be fast in the common case, so that rebuilding is not a reason to tolerate a broken substrate.
30. As a developer, I want to be told when my substrate has drifted from the committed template, so that I find out before a test fails strangely.
31. As a developer, I want drift detection to cover the provisioning scripts and pinned image, so that a template change I pulled from git is reported rather than silently ignored.
32. As a developer without an API token, I want everything except lifecycle to keep working, so that a hand-built substrate is not a second-class path.
33. As a developer without an API token, I want lifecycle commands to print the manual equivalent, so that I can perform the action myself instead of being blocked.
34. As a developer, I want the same verbs for every substrate regardless of provisioner, so that there is one CLI to learn.
35. As a developer, I want the repo to refuse a self-signed certificate by default and accept a pinned fingerprint, so that automating against my own host does not teach me to disable TLS verification.
36. As a maintainer, I want no blanket insecure-TLS flag to exist, so that nobody copies it into production automation.
37. As a developer sharing a substrate, I want concurrent runs to be prevented rather than interleaved, so that two runs cannot corrupt each other's personas and gadget state.
38. As a developer blocked by a lock, I want to be told which host and user holds it and since when, so that I can go and ask them.
39. As a developer blocked by a stale lock, I want a documented way to break it, so that a crashed run does not wedge the substrate indefinitely.
40. As a developer, I want lock contention to time out rather than block forever, so that waiting is distinguishable from hanging.
41. As a maintainer, I want the package that owns the registry and the link to be named for what it does, so that a package called "lima" does not end up owning SSH and a Proxmox client.
42. As a maintainer, I want the contract documented where architecture lives and the recipes documented where environment setup lives, so that neither is looked for in the wrong place.
43. As a maintainer, I want none of this in the user-facing docs site, so that people syncing iPods do not read a Proxmox playbook.
44. As a developer provisioning a substrate, I want its security posture stated plainly, so that I do not put a box that is root-compromised by its own test suite on a public address.
45. As a maintainer, I want CI to run the contract check, so that the contract is proven satisfiable by a machine nobody in this project provisioned.
46. As a maintainer, I want the pinned base image expressed once, so that adding a fourth artifact does not add a fourth copy to a bump-in-sync rule enforced by memory.
47. As a maintainer, I want the image pin verified by the contract check, so that an out-of-date substrate is reported rather than assumed.
48. As an agent picking up this work, I want the design decisions and their rejected alternatives recorded, so that I do not re-litigate settled ground or reverse a deliberate choice.

## Implementation Decisions

### The contract and its scripts

- **`substrate-doctor.sh`** is the definition of "substrate". Portable Debian bash, runnable over any link, exit code is the verdict. It asserts the positives (`dummy_hcd` loaded with four UDCs, `libcomposite`, `usb_f_fs`, `usb_f_mass_storage`, `sg`, configfs mounted, the runtime-only package set present, the pinned Debian point release) and the negatives (no Bun, Node or npm on `PATH`; no installed package matching `-dev`, `build-essential` or `pkg-config`). Failures name the specific assertion.
- **`provision-substrate.sh`** performs the provisioning those assertions describe. Portable Debian bash. Neither script knows which provisioner invoked it.
- **`apply-state.sh`** is unchanged. Its only two Lima references are comments about `sg` permissions whose reasoning holds verbatim for plain SSH.
- The Lima device VM's provisioning blocks are reduced to calling the shared scripts, so the YAML stops being a second encoding of the invariants.
- The pinned Debian image is expressed once as a constant in the substrate package, rendered into the cloud-init template and asserted by the doctor — replacing the current "bump these YAMLs in sync" comment.

### Packaging and ownership

- A new **`@podkit/substrate`** package owns: the VM registry, the `SubstrateLink` interface and its implementations, the doctor and provisioning scripts, the cloud-init and `pveum` renderers, the PVE client, the remote lock, and provisioner dispatch.
- **`@podkit/lima`** shrinks to *the Lima provisioner*, keeping its own lifecycle, staging, advisory-lock and `limactl` internals.
- The registry move happens in the same slice that adds the provisioner discriminator. A registry that already speaks `provisioner: 'ssh'` while living in a package named `lima` will not be moved afterwards.

### Registry and configuration

- Registry entries gain a **provisioner discriminator** (`lima` | `ssh`) and, for `ssh` entries, the *name* of an ssh_config `Host` alias — never a hostname.
- Machine-specific values live in a gitignored environment file (auto-loaded by the runtime), with a committed example: substrate selection, Proxmox API token id and secret, TLS fingerprint, and optional build-host selection.
- **Substrate selection** is explicit configuration, not platform inference. With nothing configured, selection falls back to the Lima substrate when `limactl` is present — announcing that it did so — and errors naming the configuration step otherwise.

### Substrate link

- `SubstrateLink` is `exec`, `copyIn`, `spawn`, per ADR-028 §1, injected through the existing subprocess-runner DI channel. Implementations over `limactl` and over `ssh`/`scp`. Transfers are host→guest only. Details and call-site inventory are TASK-494's.
- `exec` distinguishes link failure from guest-command failure, which is what makes "substrate unreachable → skip" separable from "guest command failed → fail".

### Build decoupling

- The host-arch-derived binary-suffix function is replaced by a **substrate-derived target arch**, resolved from the substrate's reported machine type, with host arch only as the default when no substrate is selected.
- Target arch becomes a **declared build-task input** so the artifact cache cannot serve a foreign-arch binary. This is the load-bearing detail: without it the failure is a silently wrong artifact, not an error.
- An **artifact-arch equals substrate-arch assertion** runs before transfer, as the backstop for a cache key that is wrong anyway.
- **Builder is a role over the same link.** A build host may be a Proxmox builder VM, an existing amd64 machine, or localhost. Source staging is rsync over the link; the device substrate keeps its no-host-mount invariant and receives artifacts only.
- **glibc and musl migrate together.** The build-host role carries `(arch, libc)`; musl on a remote builder means an Alpine container on that build host.

### Proxmox lifecycle

- Access is a **privilege-separated API token** whose ACL is confined to a dedicated pool. Because a privsep token's effective permissions are the intersection of the user's and the token's, a token ACL'd only on the pool is genuinely pool-confined.
- The committed `pveum` recipe creates a dedicated user, a dedicated pool, and a custom role granting VM allocate/config/power/snapshot/audit/console **on the pool**, plus space allocation (and template allocation, for the cloud-init snippet) on the named storage and `SDN.Use` on the named bridge. The last two are the ones that produce late, opaque 403s if omitted; PVE 8 requires `SDN.Use` to attach a NIC where 6 and 7 did not.
- Creation privileges must be granted on a pool or on all VMs — a not-yet-existing VMID cannot be ACL'd — which is why the pool is the scoping unit rather than per-VM entries.
- The **client is hand-rolled** over `fetch`: one auth header, six endpoints (create, start, stop, status, destroy, snapshot/rollback). A dependency for six calls is supply-chain surface for nothing.
- **TLS rejects by default** and accepts a pinned fingerprint from local config. No blanket insecure flag is added.
- **Lifecycle verbs extend the existing VM CLI**, dispatching on the provisioner discriminator — not a parallel command family. Same verbs, same single advisory-lock chokepoint.
- **Absent token degrades gracefully**: doctor, install, and the test suites all still work over the link; only lifecycle verbs are unavailable, and they print the manual `qm` equivalent.

### Drift and recreate

- The existing baseline-hash mechanism extends to cover the provisioning script, the doctor, the cloud-init template and the image pin. The drift check reports "substrate drifted from template" and names the recovery command.
- **Recover** prefers rolling back to a post-provision snapshot, and falls back to a full recreate when the template hash changed — rolling back would otherwise restore the *stale* box, which is the trap.
- Provisioning-level snapshots only. Per-test state remains `apply-state.sh`'s sub-two-second forward mutation; ADR-028's rejection of snapshot-based *state layering* is unchanged and must be restated as such in ADR-029 so the two are not read as a contradiction.

### Concurrency

- A **remote advisory lock** lives in the substrate and is held for the duration of a run. Contention waits with a short timeout and then fails, naming the holder's host, user, pid and start time. A documented force flag breaks a stale lock.
- Blocking indefinitely is wrong here precisely because remote contention may be another machine or another person holding for the length of a full run, which is indistinguishable from a hang.

### Onboarding and docs

- Running the substrate's bring-up on an unconfigured machine **prints an ordered checklist**, writes the rendered cloud-init and `pveum` commands to files, and exits. No interactive wizard: a printed plan is diffable, assertable, CI-safe and pasteable.
- The **contract** is documented with the testing architecture docs; the **recipes** are documented as an idempotent change-log-style environment playbook alongside the existing Linux dev-host one. Neither goes to the user-facing docs site.
- The playbook states the security posture plainly: a substrate is a trusted-network appliance that its own test suite roots by design, and is not hardened.
- The cloud-init template takes the user's public key as a render parameter, disables password auth, and creates a fixed unprivileged account with sudo. No key is ever committed.

### CI

- CI runs the doctor on a standard Linux runner as a **conformance check** — proof that the contract is satisfiable by a substrate nobody in this project provisioned, and a guard against the contract quietly becoming "whatever one maintainer's box happens to be".
- Running the USB-synthesis cells on CI remains open, as ADR-028 already leaves it.

## Testing Decisions

A good test here asserts **externally observable behaviour**: the command that
was issued, the file that was rendered, the decision that was reached, the exit
code the contract check returned. It does not assert how a function reached
that result. Four seams, three of which already exist.

**Seam 1 — the subprocess-runner DI channel (existing, primary).** Everything
that shells out rides it: both `SubstrateLink` implementations, the remote lock,
doctor invocation, and source staging. Tests inject a recording runner and
assert the argv and any shell body handed to it, with no real substrate
involved. Prior art: the Lima transport tests and the several
`lima-test-vm-*` runner tests, all of which already use exactly this pattern.

**Seam 2 — pure resolution functions (existing, primary).** Substrate selection
from environment plus registry (including the announced Lima fallback and the
no-substrate error), target-arch resolution, cloud-init rendering, `pveum`
recipe rendering, and baseline-hash inputs. All `(env, registry) → value` with
no I/O. Prior art: the registry, binary-paths and baseline-hash unit tests.

**Seam 3 — an injectable `fetch` on the PVE client (new, and the only new seam).**
The API client is the one component talking to a network service rather than a
subprocess, so it cannot ride Seam 1. A single `fetch` option on the client
factory mirrors the existing subprocess-runner option. Tests assert request
path, auth header shape, body, and the mapping of PVE error responses into
actionable messages — in particular that a 403 names the missing privilege and
the path it was needed on. Collapsing this into Seam 1 by shelling out to a HTTP
client was considered and rejected: six JSON calls expressed as argv is worse
code, and it would turn fingerprint pinning into a command-line flag rather than
a typed option.

**Seam 4 — the doctor as its own executable assertion (existing, integration).**
`substrate-doctor.sh` *is* the contract test. It is run and expected to exit
zero on the Lima substrate from macOS, on the Proxmox substrate as TASK-493's
hand-run proof, and on a CI runner as the conformance check. Its negative
assertions are exercised by running it against a deliberately non-conforming
environment. No new harness is introduced for it.

**End-to-end proof.** The existing VM test suite passing on both a Lima
substrate and a Proxmox substrate is the integration evidence that the
abstraction holds. Per ADR-028 and TASK-494, **no test file changes** as part of
this work — a test file that needed editing would be evidence the seam is in the
wrong place.

**Not unit-tested:** the cloud-init template's runtime behaviour and the
provisioning script's effects. Those are asserted by the doctor on a real
substrate, which is the whole point of making the contract executable.

## Out of Scope

- **Running the USB-synthesis cells on CI.** ADR-028 leaves this deliberately open; the conformance check does not decide it.
- **Snapshot-based per-test state layering.** ADR-028 rejected it in favour of `apply-state.sh` and that rejection stands. Only provisioning-level snapshots are in scope.
- **A second concurrent substrate** to remove the existing phase-2 serialisation in the mirror run.
- **Rewriting TASK-493's scope.** It remains the hand-run proof; its value is being small enough to actually perform.
- **An interactive TTY provisioning wizard.**
- **Publishing any of this to the user-facing docs site.**
- **Hardening the substrate.** It is a trusted-network appliance by design.
- **Provisioner support beyond Proxmox and Lima as shipped recipes.** Other provisioners are legitimate by virtue of passing the contract; the repo is not obliged to ship a recipe for each.
- **Replacing the SSH-key-based link with an agent or API-based one.**
- **Renaming the pre-existing subprocess-runner overload**, already recorded as deferred.

## Further Notes

- **Slice order.** (1) TASK-493, the hand-run proof, shipping the shared scripts, the cloud-init template, the `pveum` recipe and the playbook, with no TypeScript. (2) The `@podkit/substrate` extraction and provisioner discriminator, behaviour-neutral. (3) TASK-494, the `SubstrateLink` refactor, developed against Lima exactly as today. (4) Build decoupling. (5) Proxmox lifecycle. (6) CI conformance. Slice 3 precedes slice 4 deliberately: 494's acceptance criteria are already written and it is the largest de-risking step, while slice 4 carries the unknown cost — cache keying and the per-arch native prebuild path are where it will bite — and benefits from landing on a stable link.
- **Two host facts are still unconfirmed** and belong to TASK-493: whether the PVE host offers nested virtualisation, and whether the PVE host kernel itself ships `dummy_hcd`. Neither blocks the design — the substrate's requirements are guest-kernel requirements satisfied by stock Debian cloud kernels — but both are recorded as findings.
- **ADR-029 carries only the amendments** to ADR-028: the contract replaces "a Proxmox box"; PVE lifecycle is no longer deferred; connection detail is an ssh_config alias rather than an environment variable; host architecture no longer implies target architecture; and provisioning-level snapshots are in scope while per-test snapshots remain rejected. That last one must be stated explicitly or a later reader will score it as a reversal.
- **The privsep intersection rule is the reassuring part** of the token design and is easy to misread: a token ACL'd only on the pool is confined to the pool even when its user holds broader rights. The dedicated user is defence in depth and a single revocation point, not the mechanism of confinement.
