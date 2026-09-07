---
id: TASK-494
title: Introduce SubstrateLink and decouple the device harness from Lima
status: To Do
assignee: []
created_date: '2026-09-07 23:35'
labels:
  - testing
  - infrastructure
  - refactor
dependencies:
  - TASK-493
references:
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
  - docs/adr/adr-027-lima-vm-substrate-consolidation.md
  - docs/architecture/testing/taxonomy.md
  - CONTEXT.md
priority: high
type: enhancement
ordinal: 273000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 3 of ADR-028 — the refactor. Do this only after task-493 has proven a Proxmox substrate works by hand.

Introduce `SubstrateLink` — `exec(cmd)`, `copyIn(host, guest)`, `spawn(cmd) → ChildHandle` — beneath the harness, with two implementations (`limactl` and SSH). Inject it through the existing `subprocess?: SubprocessRunner` DI channel that already threads through every helper. The persona, backing-file, systemd and daemon free functions take a link instead of a `vmName: string` — that parameter is the actual Lima leak.

**Do not widen `TestRuntime` instead.** That has already been tried here and failed: `local-linux` implements all five interface members and still cannot run a single persona test, because the capability lives in free functions that reach past the interface to `limactl` directly.

**Scope:** ~13 production files, ~46 call sites, estimated 1–2 days. **No test files change.**

| File | sites |
|---|---|
| `runners/lima-test-vm.ts` | 12 |
| `runners/lima-test-vm-backing-files.ts` | 11 |
| `runners/lima-test-vm-systemd.ts` | 5 |
| `scripts/harness.ts` | 5 |
| `runners/lima-test-vm-binary.ts` | 4 |
| `runners/lima-test-vm-state.ts` | 3 |
| `vm/persona-fixture.ts` | 3 |
| `runners/lima-test-vm-udc-slots.ts`, `src/preflight.ts`, `scripts/vm-doctor.ts` | 1 each |

**Reuse what exists.** `@podkit/lima`'s `transport.ts:91` `runInVm()` and `:128` `copyOut()` are already the right shape, and its `wrapCommand` env/cwd logic is duplicated verbatim in `lima-test-vm.ts:673-688`. De-duplicate rather than write a third copy. All transfers are host→guest — there is no `copyOut` consumer anywhere in device-testing — so the SSH implementation needs one-way `scp` only.

**Known awkward spots:**

1. **Exit-code conflation, 4 sites** (`lima-test-vm-binary.ts:168`, `lima-test-vm-systemd.ts:160`, `lima-test-vm.ts:249`, `lima-test-vm-backing-files.ts:472`). `limactl shell` returns the guest's exit code, so transport and guest failure are indistinguishable; the comments there assert a distinction the code cannot make. Per ADR-028 §2, `exec()` must throw distinctly on link failure — this is what makes "substrate unreachable → skip" separable from "guest command failed → fail". Also `preflight.ts:135` renders a message about being "reachable to limactl but SSH is refusing", which is meaningless for direct SSH.
2. **The module-scope singleton.** `lima-test-vm.ts:622` constructs `limaTestVmRunner` at import time with no options, and 29 files import it by name. Select the implementation by env var inside the factory rather than threading a runtime through 29 files — but **rename it**: a name saying "Lima" for something that may be an SSH connection to Proxmox is how the next reader gets misled. Do not pick another "runner" name (see CONTEXT.md §Test environments, known overload).
3. **One background process the interface must express.** `e2e-vm-tests/src/pre-sync-sweep.e2e.test.ts:281` raw-`spawn`s `limactl` to hold a handle on a long-lived guest process, then SIGKILLs it, relying on limactl's SIGHUP-on-teardown. SSH differs — this is why `spawn` is on the interface. The test already has `killPodkitDebugInVm` (`:299`) as a workaround.
4. **`getVm(vmName) → VmDefinition`** at `lima-test-vm.ts:514` passes a Lima-only shape (`yamlPath`, `category`, `archRelevance`) to `ensureRunning`. An SSH substrate has no YAML; `isAvailable()`/`prepare()` need to dispatch on the provisioner.
5. **`stdin` is not actually unavailable.** `harness.ts:422` notes limactl cannot pipe stdin, forcing a `printf` → `/tmp` → `sudo install` dance at every transfer. SSH can do stdin — don't inherit the constraint needlessly.

**Registry:** substrate identity and purpose stay in the VM registry, which gains a provisioner discriminator (`lima` | `ssh`). Machine-specific connection detail (host, key path) comes from an env var. Note there is currently **no** env override for the substrate name — `LIMA_DEVICE_HARNESS_VM_NAME` is a TypeScript constant (`registry.ts:171`), never read from the environment.

**Docs to update in the same PR:** `docs/architecture/testing/taxonomy.md:62` — `vm-binary` is redefined as "the binary inside the device substrate", not renamed. Also fold `docker-loopback` onto the substrate.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 SubstrateLink interface exists with exec, copyIn and spawn, with limactl and ssh implementations
- [ ] #2 The wrapCommand duplication between transport.ts and lima-test-vm.ts is eliminated, not extended
- [ ] #3 Persona, backing-file, systemd and daemon helpers take a SubstrateLink instead of a vmName string
- [ ] #4 exec() distinguishes link failure from guest command failure, and the four call sites relying on the old conflation are corrected
- [ ] #5 The singleton is renamed away from 'lima' and away from 'runner', and selects its implementation by env var inside its factory
- [ ] #6 No test file changes are required
- [ ] #7 pre-sync-sweep's long-lived process case works through spawn() rather than a raw limactl escape hatch
- [ ] #8 The VM registry carries a provisioner discriminator; connection detail comes from an env var
- [ ] #9 test:vm passes on macOS via Lima and on Linux via the Proxmox substrate
- [ ] #10 docker-loopback runs on the substrate
- [ ] #11 taxonomy.md's vm-binary definition is updated to say 'device substrate'
<!-- AC:END -->
