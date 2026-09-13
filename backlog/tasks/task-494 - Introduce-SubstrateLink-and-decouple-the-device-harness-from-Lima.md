---
id: TASK-494
title: Introduce SubstrateLink and decouple the device harness from Lima
status: Done
assignee: []
created_date: '2026-09-07 23:35'
updated_date: '2026-09-13 22:20'
labels:
  - testing
  - infrastructure
  - refactor
  - ready-for-agent
milestone: m-20
dependencies:
  - TASK-493
  - TASK-513
references:
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
  - docs/adr/adr-027-lima-vm-substrate-consolidation.md
  - docs/architecture/testing/taxonomy.md
  - CONTEXT.md
  - >-
    backlog/docs/doc-060 -
    Portable-device-substrate-—-contract-provisioners-and-arch-decoupled-builds.md
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
- [x] #1 SubstrateLink interface exists with exec, copyIn and spawn, with limactl and ssh implementations
- [x] #2 The wrapCommand duplication between transport.ts and lima-test-vm.ts is eliminated, not extended
- [x] #3 Persona, backing-file, systemd and daemon helpers take a SubstrateLink instead of a vmName string
- [x] #4 exec() distinguishes link failure from guest command failure, and the four call sites relying on the old conflation are corrected
- [x] #5 The singleton is renamed away from 'lima' and away from 'runner', and selects its implementation inside its factory via @podkit/substrate's selection resolver
- [x] #6 No test's assertions about harness behaviour change; construction sites and typed-error expectations may, and no assertion is weakened or dropped
- [x] #7 pre-sync-sweep's long-lived process case works through spawn() rather than a raw limactl escape hatch
- [x] #8 The ssh link reads connection detail from the registry's ssh_config alias, and isAvailable()/prepare() dispatch on the provisioner discriminator rather than assuming a Lima YAML
- [x] #9 The substrate-contract driver (copy/provision/doctor) runs over SubstrateLink instead of calling runLimactl directly
- [x] #10 The selection resolver's fallback announcement is rendered to the developer by the link factory or its caller, not dropped
- [x] #11 test:vm passes on macOS via Lima
- [x] #12 taxonomy.md's vm-binary definition is updated to say 'device substrate'
- [x] #13 Link-failure classification is verified against output the tools actually emit under capture, not against invented fixtures
- [x] #14 The ssh link quotes argv so that a command behaves identically over both links
<!-- AC:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: claude
created: 2026-09-13 18:34
---
Specced in doc-060 as slice 3; scope unchanged. Two adjustments from that spec:

- The registry and the SubstrateLink now land in `@podkit/substrate` (TASK-513), not in `@podkit/lima` — added as a dependency. AC #8's "registry carries a provisioner discriminator" is satisfied by 513; this task consumes it.
- Connection detail is an ssh_config `Host` alias name held in the registry, with the machine's hostname/user/key in the developer's own ssh config — not the env var ADR-028 §3 assumed. The repo must contain no hostname.

Sequenced before build decoupling (TASK-514) deliberately: this task's ACs are already written and it is the largest de-risking step, and it can be developed against Lima on macOS exactly as today.
---

author: claude
created: 2026-09-13 20:39
---
Acceptance criteria amended before starting, because TASK-513 landed and two of them no longer described reality.

- The old #8 said "the registry carries a provisioner discriminator; connection detail comes from an env var". The discriminator is done — 513 shipped it — and connection detail is an **ssh_config alias name** held in the registry, not an env var (ADR-029 §2). What is left for this task is the half 513 could not do: `isAvailable()`/`prepare()` dispatching on the discriminator instead of assuming a Lima YAML.
- The old #5 said the singleton "selects its implementation by env var inside its factory". 513 shipped `resolveSubstrateSelection`, so the factory consumes that rather than reading an env var itself.

Three criteria added:

- The substrate-contract driver (`copySubstrateScripts` / `provisionSubstrate` / `runSubstrateDoctor`) currently calls `runLimactl` directly. It was written during 493 as the shortest thing that worked, and it is precisely the shape this task generalises — copy files in, execute as root. Leaving it on limactl would mean the Proxmox path cannot apply its own contract.
- The selection resolver returns a fallback announcement as data and nothing renders it yet. An announcement nobody prints is worse than no announcement, because the code reads as though the user was told.
- Splitting the old #9 (`test:vm` passes on macOS via Lima **and on Linux via the Proxmox substrate**). Only the macOS half is verifiable now: the Proxmox half needs amd64 binaries on the substrate, which needs TASK-514. Keeping both in one criterion would have forced either a false tick or a task that cannot close.
---

author: claude
created: 2026-09-13 22:00
---
**AC #6 amended: the criterion was wrong, not the work.**

It read "No test file changes are required" — inherited from ADR-028's estimate. Two independent reviews agree it is structurally unmeetable alongside #3, #4 and #7, and the contradiction is not a matter of effort:

- #3 changes helper signatures from `{ vmName, subprocess }` to `{ link }`, and unit tests construct those helpers. The only way to avoid touching them is to keep `vmName` on the opts — which is the leak #3 exists to remove.
- #4 is an instruction to stop conflating link and guest failure, so the three tests that asserted the conflation had to invert.
- #7 names a test file as the thing to change.

The honest form, which is what actually happened, is now the criterion: *no test's assertions about harness behaviour change; construction sites and typed-error expectations may, and no assertion is weakened or dropped.*

Review verified that against the diff rather than taking it on trust: zero `expect` lines changed across all 20 files in `e2e-vm-tests/src/` and all 4 in `device-testing/src/vm/`; `transport.test.ts` untouched and still green, which independently pins that the rewrite preserved argv and error vocabulary. Net test count −3, all `requires vmName` guards whose subject no longer exists, with their compound halves (`stateId is required`, `persona is required`) preserved. The three conflation rewrites each became a matched pair covering both sides — stronger than what they replaced. Three assertions were relaxed and every one gained a compensating assertion alongside it.

**AC #12 (docker-loopback on the substrate) removed and filed as TASK-517.** It is a different package, a different container runtime (host Docker/Podman vs the substrate's nerdctl/containerd) and a different image artifact (musl vs glibc). Migrating means re-homing image provenance, the privileged invocation, 64 mknods and fixture transfer across a package boundary — a task, not a criterion.

**Two criteria added**, both from defects review found by running the real tools rather than reading the code: classification must be verified against output the tools actually emit under capture, and the ssh link must quote argv. Both are recorded as criteria because both are the kind of thing that regresses invisibly.
---
<!-- COMMENTS:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`SubstrateLink` (`exec` / `copyIn` / `spawn`) sits beneath the harness with two implementations, limactl and SSH. The persona, backing-file, systemd, daemon, apply-state, UDC-slot, binary-transfer and substrate-contract helpers all take a link instead of a `vmName: string` — that parameter was the actual Lima leak, and it is gone. The singleton is `deviceHarness` (runner id `device-substrate`), selecting its implementation inside its factory via `@podkit/substrate`'s selection resolver, which this task is the first consumer of.

65 files, ~1900 lines each way. Verified by the lead: lint clean, typecheck 40/40, unit 44/44, integration 31/31, build 22/22, and `test:vm` green across forced runs.

**Two bugs found in review, both by running the real tools rather than reading the code.**

1. **The SSH link did not quote argv.** `limactl shell` shell-escapes each word; plain `ssh` joins argv with spaces and lets the remote login shell re-parse. `sh -c 'echo a b c | wc -w'` returned `3` over limactl and `0` over ssh — **exit 0 with garbage**, not a visible error. The `stageBackingFile` probe would have hashed empty stdin (`e3b0c442…`, the sha256 of nothing) and exited 0, so the harness would re-copy a multi-MiB image every run and never report a fault. Every sha probe, the UDC script, the synthesis recipes and every e2e test body had the same shape. The test had *pinned* the broken argv, reasoning it should match the limactl link's — exactly backwards, since identical argv is what made them behave differently. Fixed by quoting in both `exec` and `spawn`, verified by driving the real link against the live box.

2. **The Lima link's diagnostic tier never fired.** It matched `FATA[`, which logrus emits only on a TTY; under capture limactl writes `level=fatal msg="instance \"…\" is stopped"` — no `FATA[`, escaped quotes, and `is stopped` was absent from the alternation entirely. So the two canonical Lima link failures were classified as guest failures. The tests passed only because the fixtures were **invented rather than captured**. This mattered immediately: the device VM is known to go `stopped` after the Mac sleeps, so losing the substrate mid-run reported "the guest is broken" for an unreachable box. Fixed with an escape-tolerant instance-anchored pattern whose alternation was checked against limactl's own format strings — `is not running` was dropped because limactl 2.1.1 does not contain it. Captured strings replaced the invented fixtures, with a note to re-capture rather than edit them.

A third, smaller issue: the limactl tier had no stdout corroboration, harmless only by luck. The reviewer proposed gating it on stdout, or narrowing to `level=fatal`. Both were wrong, and the implementer established why by capture: `nerdctl` inside a healthy guest emits `level=fatal` with **no stdout**, so the gate would not have helped and the broader pattern would have fixed one bug by creating another. Tier 1 is instead narrowed to the one sentence only limactl can write — a verdict about a Lima instance — with the nerdctl line pinned as a negative test.

Also: `PODKIT_DEVICE_HARNESS_VM_NAME` removed as a second, undocumented selection mechanism, with a hard error naming `PODKIT_SUBSTRATE` so a developer who still exports it is told rather than silently retargeted. SSH timeouts now name the bound that fired instead of surfacing `execFile`'s anonymous "killed", with the timeout predicate lifted to one definition rather than duplicated. `harness.ts`'s `printf`/`tee`/raw-`spawnSync` dance replaced by a host temp file through the link, which behaves identically on both.

**AC #6 was amended, not met as written** — see comment #3. It required no test file changes, which is structurally impossible alongside #3, #4 and #7. Two independent reviews confirmed no test's behavioural assertions changed and nothing was weakened: zero `expect` lines changed across all 20 e2e VM test files, `transport.test.ts` untouched and still green, net −3 tests all being guards whose subject no longer exists, and every relaxed assertion paired with a compensating one.

**Deliberately out of scope**, each filed: docker-loopback's migration to the substrate (TASK-517 — different package, container runtime and libc), the `mkfs.vfat`/`loop0p1` concurrency flake (TASK-518 — pre-existing, evidenced byte-identical), and the `lima-test-vm*.ts` file renames (TASK-519 — pure motion, kept out to keep this diff legible).

The Proxmox half of `test:vm` is not claimed. It needs amd64 binaries on the substrate, which is TASK-514.
<!-- SECTION:FINAL_SUMMARY:END -->
