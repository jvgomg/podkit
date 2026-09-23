---
id: TASK-520
title: Builder contract and a Proxmox builder VM
status: Done
assignee: []
created_date: '2026-09-14 19:47'
updated_date: '2026-09-23 18:47'
labels:
  - testing
  - infrastructure
milestone: m-20
dependencies:
  - TASK-494
references:
  - docs/adr/adr-029-portable-device-substrate.md
  - docs/environments/device-substrate-proxmox.md
  - test-packages/device-testing/scripts/substrate-contract.sh
priority: high
type: task
ordinal: 273800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The device substrate answered "where do the tests run". This answers "where do the artifacts get built", for a developer whose only other hardware is a hypervisor.

**The builder is a guest, not a second machine.** A Mac plus a Proxmox host should be enough to exercise an amd64 substrate — no third box. The builder is a second VM on the same hypervisor, a sibling of the substrate, provisioned from the same cloud-init family and reached over the same `SubstrateLink`. Any amd64 machine a contributor already owns can fill the role instead; the repo declares the role, the machine fills it.

**It carries the inverse of the substrate contract.** The substrate's defining assertion is that no toolchain and no `-dev` packages are present — precisely what lets it catch static-linkage regressions in a binary that claims to need none. A builder needs exactly those packages. So this is a **second profile**: `provision-builder.sh` plus `builder-doctor.sh`, mirroring the substrate pair rather than extending it.

Do not merge the two contracts or give them a shared base of "common" packages. The day they share a definition is the day a toolchain can reach the box whose entire job is to prove one is not needed. Shared *mechanism* (copy the scripts in, run them as root, exit code is the verdict) is the thing to reuse — not shared package lists.

**Sizing and lifecycle.** The existing Lima builder runs 4 GiB / 4 vCPU; the substrate is 2 GiB. On a modest hypervisor they will not generally coexist, so the builder is persistent but **stopped when idle** — started for a build, shut down after. Until TASK-515 lands that is `qm start` / `qm shutdown` by hand, which is friction worth measuring rather than assuming: if it proves intolerable, that is the argument for prioritising 515 over further build work.

What the builder must be able to produce: the glibc `podkit` binary, the `podkit-debug` build, the daemon, `gpod-tool`, and the native `libgpod-node` prebuild that `compile.sh` embeds. The musl artifacts come from an Alpine container **on** the builder rather than from a second VM.

Deliverables mirror TASK-493: the two scripts, a cloud-init variant, the `qm create` recipe, and a playbook section. Registry gains a builder entry carrying its ssh alias name and its `(arch, libc)`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 provision-builder.sh and builder-doctor.sh exist as portable Debian bash, sharing the substrate scripts' mechanism but not their package lists
- [x] #2 builder-doctor.sh asserts the toolchain the builder needs, and does not assert the substrate's no-toolchain invariant
- [x] #3 A Proxmox builder VM exists, passes its doctor, and survives a reboot
- [x] #4 The registry carries a builder entry with an ssh alias name and its arch and libc, and no hostname
- [x] #5 The builder produces the glibc podkit binary, podkit-debug, the daemon, gpod-tool and the libgpod-node prebuild
- [x] #6 musl artifacts are produced by an Alpine container on the builder rather than a second VM
- [x] #7 The playbook documents provisioning it, and its start-for-a-build / stop-after operating mode
- [x] #8 No hostname, pool, storage, bridge or credential appears in any committed file
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Mirror TASK-493's split: the agent lands the repo half, the PVE-console steps stay with the human.

1. **Contract trio** (`test-packages/device-testing/scripts/`): `builder-contract.sh` (values), `provision-builder.sh` (apply), `builder-doctor.sh` (assert). Same three-file mechanism as the substrate trio, zero shared values — neither contract sources the other.
2. **Inverse, proven by test.** The builder's required commands/packages must be a superset of the substrate's forbidden ones, and the builder doctor must carry no no-toolchain block. Pinned by a unit test so "merge the two contracts" fails red.
3. **musl via a container, not a VM** (AC#6): `builder/musl/Containerfile` pinned to the Docker base's Alpine, plus a container runtime in the builder contract. A test asserts its apk list agrees with `podkit-builder-musl.yaml`.
4. **Registry** (AC#4): `SshVmDefinition` gains a declared `targetArch`; a `builderRemote` entry carries `sshAlias` + `targetArch` + `archRelevance: glibc`. Existing "no hostname" test covers the negative.
5. **Agreement tests**: builder contract's Debian pin vs `debian-image.ts`; its apt list vs `podkit-builder-glibc.yaml`.
6. **Playbook** `docs/environments/builder-proxmox.md` (AC#7): qm recipe, the shared cloud-init template, start-for-a-build / stop-after.
7. CONTEXT.md gains a **Builder** term; `.env.example` gains the builder selection note.

Deliberately NOT done here: the build-driver refactor that runs `compile.sh` on a builder reached over `SubstrateLink`. That is TASK-514 half 2, which its own notes already record as depending on this task.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Repo half landed; the PVE-console half stays with the human

Same split TASK-493 used. Ticked: #1, #2, #4, #7, #8. Left open: #3, #5, #6 — all three need the hypervisor.

### The contract trio

`builder-contract.sh` (values) / `provision-builder.sh` (apply) / `builder-doctor.sh` (assert), the same three-file mechanism as the substrate trio and none of its values.

**Proven on a real Debian 12, not just linted.** Ran the pair end to end inside a `debian:12` container on the dev box:

- provisioning succeeded, then succeeded again unchanged — the meson/Node/Bun steps each report "already satisfies" on the second pass
- the doctor **PASSED unprivileged, including `--strict`** — 71 `ok` lines, zero failures
- the point-release note fired exactly as designed: the base image is 12.15, the provenance stamp says 12.10, `--strict` still passed because it compares the stamp rather than the running release — which is the fix TASK-493 comment #6 asked for, arriving for free by copying the mechanism
- the "Containerfile not copied" path warns and skips rather than failing, as intended

Also ran the doctor on the amd64 dev box itself, which is *not* a builder (Debian 13, partial toolchain). It failed 26 assertions and named every one — including the glibc-floor message on the major-version check. The assertions are not vacuous.

### Two things the implementation had to get right that the substrate's did not

**The doctor must run unprivileged, and that is now load-bearing.** Its staging-directory assertions are about the user a build actually runs as; running it as root passes them on a box nobody can build on. Documented in the script header and in the playbook step.

**Package presence needed a `Provides` fallback.** The substrate's list is all concrete runtime packages, so plain `dpkg-query -W` suffices there. The builder's contains `-dev` metapackages that a distribution may ship as virtual names — apt installs them happily and `dpkg-query -W <name>` then reports them missing. This is the one deliberate divergence from the substrate doctor's mechanism, and it carries its reason inline.

### musl without a second VM (the mechanism half of #6)

`test-packages/device-testing/builder/musl/Containerfile`, pinned to the same Alpine minor `packages/podkit-docker/Dockerfile` is `FROM`. Built with podman and smoke-tested: musl libc, gcc 14.2, meson 1.6.1, bun 1.4.2, node 22, every pkg-config module resolving, and `libglib-2.0.a` present. Containers run as root — rootless podman on a cloud image needs subuid ranges cloud-init does not write, and that failure reads like a podman bug.

### The anti-merge guard

`builder-contract.test.ts` asserts the property ADR-029 §4 cares about and review cannot see: the builder **requires** every command and package the substrate **forbids**, neither script sources the other's contract, and `builder-doctor.sh` carries no `SUBSTRATE_FORBIDDEN_*` block. Mutation-checked both ways — dropping `bun` from the builder's required commands, and dropping a package from the Lima YAML without touching the contract, each fail red.

### Deviation from the stated deliverables: there is no builder cloud-init variant

The description asks for "a cloud-init variant". There is deliberately **not** one. The substrate's template is already contract-free — it makes a plain Debian box with your key on it and stops — so a builder copy would differ only in the hostname the caller substitutes, while being free to drift. The builder playbook uses the existing template with a different `__HOSTNAME__`, and the template's header now says it serves both profiles and why there is no second copy.

Left where it is under `substrate/proxmox/` rather than moved somewhere neutral: `substrate/ci/boot-substrate.sh` reads it by relative path, and renaming a directory to fix a noun is not worth breaking the CI backstop. Noted in the file.

### Registry

`SshVmDefinition` gained a declared `targetArch`, required on the `ssh` variant only. The asymmetry is the argument: a Lima entry is this host's architecture by construction, while an `ssh` entry names a foreign machine whose CPU nothing local can infer — and "can this builder produce the artifact I want?" is asked before there is a link to probe `uname -m` over. Declared, not authoritative: `probeSubstrateMachine` and `assertArtifactArch` still decide at the point it costs something.

`builderRemote` carries `sshAlias: 'podkit-builder'`, `targetArch: 'x64'`, `archRelevance: 'glibc'` — the libc of the *box*, not of everything it can produce, since the Alpine container makes musl reachable from a glibc builder.

### Verification

lint (oxlint + shellcheck 40 scripts + CLI stderr + retry policy) clean · typecheck 40/40 · unit 44/44 · integration 31/31 · build 22/22 · e2e 37/37.

### What is left, and what it needs

- **#3** — create the VM, run the doctor, reboot, run it again. Playbook step 4–5.
- **#5** — needs #3 plus TASK-514 half 2, which is the build driver that runs `compile.sh` on a builder over `SubstrateLink`. That task's own notes already record it as depending on this one; the artifacts and their build commands are tabulated in the playbook so the driver has a target to hit.
- **#6** — the container and its toolchain are proven; what is unproven is a musl *artifact* coming out of it on a real builder, which needs the same driver.
<!-- SECTION:NOTES:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: claude
created: 2026-09-23 09:45
---
Code review (standards + spec axes) found one thing I had genuinely got wrong and seven worth fixing. All actioned; notes updated.

**The real error: ADR-029 §4 was cited for a decision it does not contain.** Six files attributed "musl comes from an Alpine container on the builder, not a second VM" to §4. §4 settles builder-as-a-role and the inverse contract, and on libc says only that glibc and musl move together — its *decided fallback* for a contributor without a hypervisor is an emulated Lima builder, not a container. The container decision is real, but it lives in `backlog/docs/doc-060` ("musl on a remote builder means an Alpine container on that build host") and in this task's description. ADR-029 explicitly delegates the full design to doc-060, so the fix is repointing the citations rather than writing a new ADR. Every one of the six now names doc-060, and two of them say out loud which half of §4 they are *not* claiming — the conflation is easy to repeat.

**A guard that pinned less than it looked like it did.** The apt agreement test compared package *names* against the Lima YAML, while provisioning installed them *with* recommends where the YAML uses `--no-install-recommends`. Equal names, unequal closures — two boxes that are supposed to produce interchangeable artifacts. Provisioning now uses `--no-install-recommends` too; the rationale I had written for the divergence was post-hoc and is gone.

**A doctor assertion that could pass silently.** `meson --version` producing nothing left `awk` with no input, so its main block never ran and it exited 0 — reported as a pass, with a blank version printed beside it. Now an explicit empty check.

**One path, stated twice.** `provision-builder.sh`'s header promises it declares nothing itself, then hardcoded the Containerfile location while the contract's `BUILDER_MUSL_CONTAINERFILE_REL_PATH` went unread by anything but the test. They answer different questions — the script runs on a box with no repo on it, the test needs to find the file in a checkout — so the contract now declares the shared tail once and composes the repo-relative form from it.

That composition broke the test reader, which was a regex and handed back `$BUILDER_MUSL_CONTAINERFILE_SUBPATH` unexpanded: a string that is not any path, compared against a real one, passing. Replaced with `shell-contract.ts`, which **sources** the contract in bash and reads the values the consuming scripts actually get. Side benefit worth the extra file: both contracts promise in their headers to be free of side effects because a doctor sources them, and this now exercises that promise instead of trusting it. `debian-image.test.ts`'s private regex reader is gone in favour of it.

**Two smaller ones.** The Containerfile's `ARG BASE_IMAGE` default — the value a bare `podman build` uses, i.e. the path provisioning does *not* take — was unguarded and could have drifted to a different Alpine unnoticed; now pinned. And `BUILDER_MESON_MIN_VERSION` was the one value copied from the Lima YAML with no agreement test. It is deliberately *not* equal to the YAML's pip floor — 1.2.0 is what glib requires and what the doctor asserts, 1.4.0 is what that YAML installs — so the test asserts the relation that matters: the floor must stay at or below what the Lima builder installs, or the doctor would start rejecting boxes macOS builds on happily.

Also fixed a comment in `registry.ts` that contradicted the diff ten lines below it (`VmArchRelevance` still said architecture "is never a config axis"), and tightened `packagesFromInstallBlock` so its command-word filter only applies to the first line — a package named `install` would otherwise have vanished from a comparison silently.

**Declined:** bundling `targetArch` + `archRelevance` into one `(arch, libc)` type. It is a fair Data Clump reading and `registry.test.ts` all but names it, but the consumer that would justify the type is TASK-514 half 2. Introducing it now is a shape guessed ahead of its only caller.

Every guard added or changed was mutation-checked: pointing the subpath at a missing file, drifting the ARG default, dropping `bun` from the builder's required commands, and removing a package from the Lima YAML each fail red. Re-ran provisioning end to end on real Debian 12 afterwards — Containerfile located rather than skipped this time, `--no-install-recommends` closure still satisfies every pkg-config assertion, doctor exit 0 unprivileged under `--strict`.

Gate re-run clean: lint · typecheck 40/40 · unit 44/44 · integration 31/31 · build 22/22.
---

author: claude
created: 2026-09-23 17:43
---
## Handoff to an agent with PVE access

Everything that can be done without a hypervisor is done and committed. What is left is #3, #5 and #6, and the order below matters.

**Read first:** `docs/environments/README.md` (the three privilege phases), then `docs/environments/builder-proxmox.md`.

### Do NOT start by destroying the substrate

The existing `podkit-substrate` guest works and passes its doctor. Nothing in this task needs it gone, and losing it costs the one proven substrate on the host.

Build the **builder** first — it is a new guest at a new VMID, so it risks nothing that currently works:

1. `bash test-packages/device-testing/substrate/proxmox/bootstrap-pve.sh --print-only` — read it before running it.
2. Run it for real. Idempotent; on a host that already has the substrate it adds `podkit-builder.yaml` and changes nothing else. Note it **rewrites `podkit-substrate.yaml`** — harmless if the authorised key is unchanged, worth checking if it is not.
3. `qm create` per builder-proxmox.md step 4 (VMID 9001, 4 GiB, 4 cores, 40 G).
4. Apply the contract per step 5. Copy the `builder/` tree as well as the three scripts, or the musl image is skipped.
5. **Run the doctor unprivileged** — not under sudo. Several assertions are about the user a build actually runs as, and root passes them on a box nobody else can build on. Expect ~71 `ok` lines.
6. Reboot, run the doctor again. That closes **#3**.

Recreating the substrate from the new snippet is worth doing *after* that, as the first real exercise of the bootstrap → guest path, and it is the natural place to prove snapshot/rollback for TASK-515 AC #8. Optional for this task.

### What #5 and #6 still need

Neither is reachable by standing the box up. They need **TASK-514 half 2** — the build driver that runs `compile.sh` and the prebuild scripts on a builder reached over `SubstrateLink`. Nothing in the repo drives a build on a remote builder yet. The playbook tabulates the five artifacts and the command that produces each, and the musl one-liner, so the driver has a target to hit.

A useful intermediate that needs no new code: stage a checkout onto the builder by hand and run `tools/prebuild/build-linux-glibc.sh` and `compile.sh` in `/var/tmp/podkit-build`. If that produces a working amd64 binary, #5 is proven *as a capability of the box* even before the driver exists, and that is genuinely the risky unknown — the driver is mechanism.

### Verified here vs unverified on a host

| | Status |
|---|---|
| contract trio, provision + doctor | run end to end on real `debian:12`; doctor passes unprivileged under `--strict` |
| musl Containerfile | built with podman, toolchain smoke-tested |
| `bootstrap-pve.sh`, both modes | run against a **faked** PVE (stub `pveum`/`pvesh`/`pvesm`/`curl`) |
| `pvesh get /storage/<id>` path resolution | **unverified against a real host** — most likely thing to be wrong |
| snippets storage advertising `snippets` content | warned about, never observed |
| anything involving an actual guest | not done |

### Sending the secrets back

The token secret is printed **once** by phase 1 and cannot be re-read. It should go straight into `.env.local` on whichever machine will drive the lifecycle — that file is gitignored and is the only place it belongs.

Do not paste it into a task comment, a commit message or a chat transcript; those persist in ways a gitignored file does not. If it is lost, delete and recreate the token rather than hunting for it. What *can* safely be reported back here is everything non-secret: the VMIDs chosen, the pool/storage/bridge names used, the doctor's output, and whether the `pvesh` path resolution worked.
---

author: claude
created: 2026-09-23 18:47
---
## The builder exists, and it builds

Run on a real PVE host (9.1.4, 16 GiB, Intel i5-9500T). #3, #5 and #6 ticked on evidence; what follows is what was observed. The fixes the run produced landed in `f9520481`.

### The box (VMID 9001, pool `podkit`, storage `local-lvm`, bridge `vmbr0`)

`qm create` per the playbook — 4 GiB, 4 cores, 40 G — booted first time from the rendered `podkit-builder.yaml`, cloud-init `status: done`, guest agent up, root filesystem already grown to 40 G. Contract applied per step 5, with the `builder/` tree copied too, so the musl image built rather than being skipped.

**Doctor: 73 `ok`, zero failures, unprivileged. 74 under `--strict`.** The playbook's "~68" was an estimate; the measured number is now in it. Rebooted and re-ran with a fresh copy of the scripts — byte-identical output, and `/tmp` was indeed cleared, which is what the playbook warns about. **#3 closed.**

### The one thing that nearly cost the whole exercise

**A Proxmox guest created without `--cpu host` cannot run what podkit builds.** The default CPU model exposes no AVX2, and nothing says so usefully:

- on the builder, `bun --version`, `bun -e` and a trivial `bun install` all work; a real workspace `bun install` dies with `panic: a formatting trait implementation returned an error` and a bun.report URL, which reads as a Bun bug
- on the substrate, a binary from a correct builder does not fail at all — `podkit --version` spins at 100% CPU indefinitely with no output. It sat there ten minutes before I killed it. With `--cpu host`: 0.48s.

Measured both ways on the same guest by flipping `--cpu` and restarting. Both playbooks now carry the flag and the reasoning, and **both doctors assert `avx2` on x86-64** — the builder because bun needs it, the substrate because a hang is the one failure mode a box that only receives artifacts must not have. Mutation-checked: the builder doctor fails on `kvm64` and passes on `host`.

The existing substrate had this latent all along; it had simply never been asked to run a binary. It now has `--cpu host` and passes its doctor (24 `ok`).
---

author: claude
created: 2026-09-23 18:47
---
## #5 and #6 — the artifacts, and what the driver will hit

### #5 — all five glibc artifacts, by hand, with no new code

Staged a checkout into `/var/tmp/podkit-build` and built:

| Artifact | Result |
|---|---|
| `libgpod-node` prebuild | built; `ldd` shows libc/libm/libstdc++ only — libgpod, glib, gdk-pixbuf and plist all statically linked |
| `podkit` | 123 MB, ELF x86-64, `--version` → 0.6.0 |
| `podkit-debug` | built |
| `podkit-daemon` | built |
| `gpod-tool` | built, `--help` runs |

**Then the part that actually matters:** copied `podkit` to the substrate — a box with no gcc, no bun, no node — and ran it there. 0.48s, correct version, `device scan` reaching its typed "no devices found" message, and `ldd` listing only `libc`, `libm`, `libpthread`, `libdl`. The builder→substrate model is proven end to end, which is the thing the driver could not have told us.

### #6 — musl out of the container

`podkit-musl-builder:local`, built by provisioning, produced the musl prebuild and then a complete musl `podkit`: `interpreter /lib/ld-musl-x86_64.so.1`, `--version` → 0.6.0 inside the container. The `Error relocating … napi_* symbol not found` lines `ldd` prints are expected for an N-API addon — the host supplies those at runtime — and the script's own static-linkage check passes. No second VM involved.

### Staging gotchas TASK-514 half 2 will hit

Each produced a wrong result rather than an error, so each is now in the playbook:

1. `rsync -a` into `/var/tmp/podkit-build` exits **23** — `failed to set times on "."` — because the directory is root-owned and world-writable. The payload transfers; only the directory's own mtime fails. `--omit-dir-times` fixes it.
2. A stale macOS `gpod-tool` binary rsynced in with a newer mtime made `make` report `Nothing to be done for 'all'`, leaving a **Mach-O file on an amd64 builder**. Exclude build outputs from the staging.
3. `bun run build` is required before `compile.sh`, which otherwise fails with `Could not resolve: "@podkit/ipod-firmware". Maybe you need to "bun install"?` — which it does not.
4. Container builds write **root-owned files** into the staged tree, so the next unprivileged build cannot overwrite them.

### Snapshot / rollback, for TASK-515 AC #8

Snapshotted the builder, wrote a canary file, `qm rollback`, restarted: canary gone, guest otherwise intact, ssh host key unchanged. Note the verb stops the guest, so the lifecycle client must start it again.

### Bootstrap → guest, proven without risking the substrate

Rather than recreating `podkit-substrate` — the only proven substrate on the host — a throwaway guest was created at 9002 **from the rendered snippet** and destroyed afterwards. It booted, cloud-init completed, NOPASSWD sudo worked, and **both** authorised keys worked, verified by logging in from the second machine. That is the case the old single-key renderer would silently have broken, so it is the stronger test, and it cost nothing.

### Left as found

The builder is **stopped**, per the start-for-a-build / stop-after mode. Worth recording against the description's assumption: on this host the two guests coexisted comfortably (≈7 GiB still available with both running), so stopping it is a choice here rather than a necessity.
---
<!-- COMMENTS:END -->
