---
id: TASK-513
title: Extract @podkit/substrate and add the provisioner discriminator
status: Done
assignee: []
created_date: '2026-09-13 18:33'
updated_date: '2026-09-13 20:36'
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
- [x] #1 @podkit/substrate exists and owns the VM registry; @podkit/lima depends on it rather than the reverse
- [x] #2 Registry entries carry a provisioner discriminator, and ssh entries carry an ssh_config alias name with no hostname anywhere in committed source
- [x] #3 The registry shape tolerates an entry with no Lima YAML without resolving a path
- [x] #4 A substrate-selection resolver reads the env file, falls back to Lima when limactl is present while announcing the fallback, and errors naming the config step otherwise
- [x] #5 Selection never branches on process.platform
- [x] #6 The pinned Debian point release is a single exported constant, and the bump-in-sync comments referencing it are removed
- [x] #7 A committed example env file documents every machine-specific value
- [x] #8 test:vm, harness:setup and every vm:* verb behave identically to before on macOS
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Behaviour-neutral extraction. `@podkit/substrate` owns the registry (now discriminated `lima | ssh`), substrate selection, the pinned Debian image and `repoRoot()`; `@podkit/lima` is the Lima provisioner and re-exports the registry, so no call site outside `lima/src/` changed.

Three details later slices need to know:

1. **`@podkit/substrate` must stay `--external` in `@podkit/lima`'s `bun build`.** Bundling it inlines the substrate code into `lima/dist/index.js`, whose path carries no `test-packages/substrate/` marker, so `repoRoot()` can no longer anchor and every dist-mode caller throws.

   Review established empirically that this *is* caught today — `@podkit/device-testing`'s `baseline-hash.test.ts` fails against a bundle built without the flag, because `deviceBaselineFiles()` reaches `deviceVm().yamlPath` through the cross-package import, which resolves via `"main": "./dist/index.js"`. But that guard was accidental and lived in a third package, so a refactor of `baseline-hash.ts` could have removed the only protection with nobody knowing. A deliberate local guard was added.
2. **`getVm` is overloaded.** A literal id in `LIMA_VM_IDS` narrows to `LimaVmDefinition`; a runtime `string` returns the union. Adding a Lima VM means adding its id to `LIMA_VM_IDS` as well, or `getVm('<id>').yamlPath` will not compile. `registry.test.ts` pins the list against the registry so the narrowing cannot become a lie — review traced every call site and found no path where the compile-time promise and the runtime shape disagree.
3. **Editing a comment in `podkit-device.yaml` or `substrate-contract.sh` trips baseline drift**, because both are baseline-tracked. Run `bun run harness:setup` before `test:vm`.

Absent `yamlPath` is expressed as a discriminated union rather than an optional field: an optional that reads `undefined` invites `vm.yamlPath!` at a call site, while a missing field does not type-check there.

Selection lands unwired by design. `resolveSubstrateSelection` is pure `(env, substrates, limactlAvailable) => selection` and returns its fallback announcement as data rather than printing it — library code does not own a TTY. `limactlAvailable` is an input rather than a probe so the no-limactl branch is reachable from a unit test on a machine that has Lima. TASK-494's link is the first consumer and owns rendering the announcement.

Selection candidates are restricted to `category: 'device'`, and the Lima fallback refuses to guess when the registry holds anything other than exactly one Lima device substrate. `podkit-vm` and `lifecycle.ts` reject a non-`lima` entry explicitly — otherwise `vm:status` on an ssh substrate would ask Lima about a box it has never heard of and confidently print `missing`. Both rejection branches were untested on first delivery and have since been covered against the registry's real `deviceRemote` entry.

On the pinned image: three YAMLs and `substrate-contract.sh` keep their literals (a YAML cannot read TypeScript, and a substrate has no TypeScript on it by contract); an agreement test reads all four back and fails on disagreement, and also asserts the negative half — that the test-runner and virtual-iPod VMs do *not* acquire a pin. The Proxmox playbook carries the same URL in a `curl` recipe and is deliberately not covered, being prose a human runs once rather than a file a provisioner reads — fold it in when TASK-515 renders the cloud-init template, at which point it becomes a copy that *is* machine-read.

`.env.example` documents the Proxmox token values ahead of TASK-515 deliberately: one local file for every machine-specific value is the point, and splitting it across slices would leave contributors editing it twice.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`@podkit/substrate` exists and owns the VM registry, substrate selection, the pinned Debian image and `repoRoot()`. `@podkit/lima` is now the Lima provisioner and depends on it, re-exporting the registry so all 48 call sites outside `lima/src/` resolve unchanged. Behaviour is identical on macOS.

Verified by the lead, not just reported: lint clean (56 CLI files, 32 shell scripts, 19 bunfig), typecheck 40/40, unit 44/44, integration 31/31, build 22/22, and `test:vm` green at 23/23 turbo tasks with 38/38 in device-testing.

**On AC #6, read the tick honestly.** The pinned image is a single exported constant, but three Lima YAMLs and `substrate-contract.sh` still carry the literal URL — a YAML cannot read TypeScript, and a substrate has no TypeScript on it by contract. An agreement test reads all four back and fails on disagreement, and asserts the negative half too (the test-runner and virtual-iPod VMs must not acquire a pin). So the bump-in-sync rule moved from a comment enforced by memory to an assertion enforced by the machine, which was the intent — but "single definition" it is not.

Two review findings were fixed before closing:

1. The `--external @podkit/substrate` build flag had only an accidental guard, in a third package. A deliberate local guard now re-derives the real `bun build` invocation from `package.json`, bundles to a temp directory, imports the result and asserts `getVm('device').yamlPath` still resolves. Proven by removing the flag and watching it fail with the predicted anchor error.
2. The two provisioner-rejection branches — `cli.ts`'s `main()` and `lifecycle.ts`'s `resolve()` — were untested. Both are now covered against the registry's real `deviceRemote` entry, including that the advisory lock is never taken on the rejected path.

One drive-by fix worth knowing about: `@podkit/lima` had **no `test:integration` script**, so the pre-existing `lock.integration.test.ts` was never run by the gate — only by hand. Adding the script was necessary to make the new build guard count, and it brings the lock test into CI for the first time.

The selection resolver ships unwired by design; TASK-494's link is its first consumer and owns rendering the fallback announcement.
<!-- SECTION:FINAL_SUMMARY:END -->
