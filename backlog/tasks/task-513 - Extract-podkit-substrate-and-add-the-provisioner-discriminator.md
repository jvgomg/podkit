---
id: TASK-513
title: Extract @podkit/substrate and add the provisioner discriminator
status: To Do
assignee: []
created_date: '2026-09-13 18:33'
labels:
  - testing
  - infrastructure
  - refactor
  - ready-for-agent
milestone: m-20
dependencies:
  - TASK-493
references:
  - >-
    backlog/docs/doc-060 -
    Portable-device-substrate-—-contract-provisioners-and-arch-decoupled-builds.md
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
  - CONTEXT.md
priority: high
type: enhancement
ordinal: 272500
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 2 of doc-060. Behaviour-neutral extraction — nothing changes about how anything runs today.

A package named `lima` is about to own SSH substrates, a Proxmox API client and a provisioner-agnostic contract. That is the same mislabelling ADR-028 refuses for the `limaTestVmRunner` singleton, and it has to be fixed *with* the discriminator rather than after it: a registry that already speaks `provisioner: 'ssh'` while living in `lima/` will not get moved later.

**Create `@podkit/substrate`**, owning the VM registry, the provisioner dispatch, the substrate-selection resolver, the target-arch resolver, and (as later slices land) the `SubstrateLink`, the doctor/provision scripts, the renderers, the PVE client and the remote lock. **`@podkit/lima` shrinks to the Lima provisioner**, keeping its lifecycle, staging, advisory-lock and `limactl` internals.

**Registry entries gain a provisioner discriminator** (`lima` | `ssh`). For `ssh` entries the registry carries the *name* of an ssh_config `Host` alias and never a hostname — the repo declares capability, the machine declares connection. Note the registry's existing lazy `yamlPath` getter exists so importing the module never anchors on disk (the FunctionFS daemon bundles it); an `ssh` entry has no YAML at all, so the shape must tolerate its absence rather than resolve a path that will never exist.

**Substrate selection becomes explicit configuration**, read from the gitignored env file, with a committed example. With nothing set, selection falls back to the Lima substrate when `limactl` is present — *announcing that it did so* — and errors naming the configuration step otherwise. Platform is not consulted: a macOS developer's existing zero-config onboarding keeps working because `limactl` is there, not because the code branched on `darwin`.

Also lift the pinned Debian point release to a single constant here. Three Lima YAMLs pin it today with a "bump all three in sync" comment; the cloud-init template would make four. One constant, rendered into the template and asserted by the doctor.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 @podkit/substrate exists and owns the VM registry; @podkit/lima depends on it rather than the reverse
- [ ] #2 Registry entries carry a provisioner discriminator, and ssh entries carry an ssh_config alias name with no hostname anywhere in committed source
- [ ] #3 The registry shape tolerates an entry with no Lima YAML without resolving a path
- [ ] #4 A substrate-selection resolver reads the env file, falls back to Lima when limactl is present while announcing the fallback, and errors naming the config step otherwise
- [ ] #5 Selection never branches on process.platform
- [ ] #6 The pinned Debian point release is a single exported constant, and the bump-in-sync comments referencing it are removed
- [ ] #7 A committed example env file documents every machine-specific value
- [ ] #8 test:vm, harness:setup and every vm:* verb behave identically to before on macOS
<!-- AC:END -->
