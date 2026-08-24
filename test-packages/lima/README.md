# @podkit/lima

The Lima **substrate**: one package that owns every Lima VM config in the repo,
the idempotent lifecycle primitives, the single cross-process advisory lock that
serialises VM starts, generic in-VM transport, and the `podkit-vm` CLI that
shell scripts and mise tasks call.

It is deliberately thin on domain knowledge. Device personas, `SystemState`
fixtures, `apply-state.sh`, the FunctionFS gadget daemon and the runners that
reference those types stay in
[`@podkit/device-testing`](../device-testing), which consumes this package. The
dividing line: **anything that references a persona or a system state is domain;
pure Lima mechanics are substrate.**

Its only dependency is `@podkit/device-types` (for the `SubprocessRunner`
interface) — never `@podkit/core`, so the substrate cannot drag native bindings
or metadata libraries into a build script.

See [ADR-027](../../adr/adr-027-lima-vm-substrate-consolidation.md) for why this
package exists, and [ADR-016](../../adr/adr-016-linux-vm-test-harness.md) for
why the builder, test and device VMs are physically separate machines.

---

## The VM registry

`src/registry.ts` is the single source of truth for every Lima instance the repo
manages. Each entry pairs a clean TypeScript `id` with the concrete Lima
`instanceName`, a pointer to the declarative YAML under `vms/`, and a little
metadata.

| `id` | Lima instance | Category | Role |
|------|---------------|----------|------|
| `device` | `podkit-device` | `device` | USB-gadget synthesis (`dummy_hcd` + FunctionFS); runs `test:vm` and hosts in-VM Docker image builds. No Bun, no Node, no source tree, no `-dev` packages. |
| `builderGlibc` | `podkit-builder-glibc` | `builder` | Debian 12.10 + full dev toolchain; produces the glibc `libgpod-node` prebuild, the podkit/daemon binaries and the Linux `gpod-tool`. |
| `builderMusl` | `podkit-builder-musl` | `builder` | Alpine + dev toolchain; the musl equivalent, for Docker-image parity. |
| `testGlibc` | `podkit-test-glibc` | `test-runner` | Debian 12; runs the full suite against glibc (`mise run test:linux:debian`). |
| `testMusl` | `podkit-test-musl` | `test-runner` | Alpine 3.23; the same suite against musl (`mise run test:linux:alpine`). |
| `virtualIpod` | `podkit-virtual-ipod` | `demo` | The virtual-iPod demo VM. Config only lives here; its lifecycle stays with the `vipod:*` mise tasks and the in-VM `@podkit/virtual-ipod-server`. |
| `abiVerify` | `podkit-abi-verify` | `abi` | Stock Debian, no dev packages — a **manual, on-demand** check that a produced binary's `ldd` shows only stable system libraries. Wired into no CI job and no turbo task. |

`category` and `archRelevance` are metadata, not mechanism: they let a caller
filter the registry ("all builders") without string-matching instance names.
Architecture is a *runtime* in-VM concern (`uname -m`), never a config axis, so
it is deliberately absent.

### Never spell an instance name by hand

Look VMs up by `id`:

```ts
import { getVm, listVms, deviceVm } from '@podkit/lima';

const vm = getVm('builderGlibc'); // also accepts 'podkit-builder-glibc'
```

`getVm` throws a descriptive error listing the known ids when nothing matches, so
a typo fails loudly instead of silently no-opping. Everything downstream —
`ensureRunning`, the CLI, the shell wrappers — derives the instance string from
the registry, which is why a rename is a one-line edit rather than a
repo-wide grep. `LIMA_DEVICE_HARNESS_VM_NAME` exists for the same reason: call
sites that need the device VM's name by value read it from the registry.

### Adding a VM

1. Drop the Lima spec in `vms/podkit-<role>.yaml`. It stays native YAML —
   readable, `limactl validate`-able, no codegen.
2. Add a `defineVm({ … })` entry to `REGISTRY` in `src/registry.ts` with a clean
   `id`, the `podkit-`-prefixed instance name (the prefix avoids collisions with
   a developer's other Lima instances), the repo-relative YAML path, a
   `category`, an `archRelevance` and `trackedForBaseline`.
3. Extend `src/registry.test.ts`, which pins ids, instance names and the
   existence of every YAML on disk.
4. If a turbo task's cache should invalidate on that YAML, add it to the task's
   `inputs` **by filename** — never `vms/**`, which would make an unrelated
   demo-VM edit bust the whole VM suite's cache.

---

## `podkit-vm` — the CLI chokepoint

Every verb that can create or start a VM routes through the shared advisory
lock, so TypeScript callers, bash wrappers and mise tasks all funnel through
**one** lock code path.

```
podkit-vm <verb> <instance> [options]
```

| Verb | What it does |
|------|--------------|
| `ensure` | Create + start the VM if needed. Idempotent, locked. |
| `stage` | rsync the host source tree into a VM-local directory (`--dest`, `--src`, `--exclude`, `--sudo`). |
| `stage-path` | Print the VM-local path a declared staging area owns (`--area`). Prints the bare path so shell wrappers can capture it. |
| `status` | Print `running` \| `stopped` \| `missing`. |
| `stop` | Stop the VM; no-op if missing or already stopped. |
| `destroy` | Delete the VM (`--yes` to skip the confirmation prompt; refuses non-interactively without it). |
| `recover` | Destroy → recreate → start a wedged VM. |
| `shell` | Interactive shell inside the VM. |
| `install` | Generic precondition only: make sure the VM is running. Device-specific binary/unit staging belongs to the device-testing harness. |
| `doctor` | Report whether a baseline-tracked VM carries a sealed baseline hash. |

`<instance>` is a registry id *or* a Lima instance name.

At the repo root the verbs are exposed as thin wrappers:

```bash
bun run vm:up device          # ensure
bun run vm:down builderGlibc  # stop
bun run vm:status testGlibc
bun run vm:shell device
bun run vm:recover device
bun run vm:destroy device --yes
```

Shell callers that cannot use `bun run` (mise tasks, `tools/lima/run-tests.sh`,
the build wrappers) invoke `bun test-packages/lima/src/cli.ts <verb> …`
directly. Either way it is the same lock.

The CLI is the only module here that prints and sets an exit code; the library
modules stay quiet and throw.

---

## The advisory lock

`src/lock.ts`, backed by [`proper-lockfile`](https://www.npmjs.com/package/proper-lockfile),
keyed per instance name (so different VMs never contend).

### What it guards

**VM starts — the create/start decision and the `limactl` call that acts on
it.** Two independent processes must never create or start the same instance at
once; doing so crashes Lima's hostagent, which is the intermittent build failure
this lock exists to prevent. `ensureExists` and `ensureRunning` therefore read
the status **inside** the lock, so check-then-act is atomic across processes.

**It does not guard source staging.** Concurrent staging is kept safe by
construction instead — every VM-local destination has exactly one declared
owner in the [staging-area registry](#the-staging-area-registry), so no two
callers ever rsync into the same tree and there is nothing for a lock to
serialise. Do not assume the lock covers more than the start.

### Liveness and staleness

A live holder refreshes the lockfile's mtime every `DEFAULT_UPDATE_MS` (5s). A
holder that dies stops refreshing, and after `DEFAULT_STALE_MS` (30s) the lock
reads as stale and the next contender reclaims it. `isVmLocked` reports a stale
lock as unlocked, matching those reclaim semantics.

### The wait budget

A contender waits, it does not fail fast: `DEFAULT_RETRIES` (900) with a
200 ms → 2 s doubling backoff comes to roughly **half an hour**.

That looks absurd until you ask what it has to clear: the *slowest legitimate
hold*, not the typical one. A cold `limactl start` that downloads a cloud image
and runs cloud-init takes five to ten minutes, and the contender is usually a
sibling turbo task that must simply wait for it. Giving up early converts
"someone else is creating the VM" into a build failure — exactly the race the
lock was added to stop.

Waiting this long is safe **only because liveness bounds it**. If the holder
dies, the lock goes stale within 30 seconds and the contender proceeds; it never
actually waits out the full budget on a dead holder.

`lockRetryBudgetMs()` derives that number from the backoff constants rather than
restating it in a comment, and a test pins it. This is not decoration: an
earlier revision used `factor: 1`, which pins every retry at `minTimeout` and
makes `maxTimeout` dead config — the budget silently collapsed to a tenth of its
documented value, and a second starter gave up two minutes in while the first
was still provisioning. Change the backoff and the test tells you what you did.

---

## Lifecycle: `ensure*` is start-only

`src/lifecycle.ts` exposes `status`, `ensureExists`, `ensureRunning`, `stop`,
`destroy` and `recover`. Two rules matter:

- **`ensureRunning` never stops a VM.** It creates if missing, starts if
  stopped, no-ops if running. Nothing more.
- **There is no reference counting.** Only an explicit `stop` or `destroy` tears
  a VM down. Shared VMs are long-lived developer infrastructure; a task that
  finishes must not take the VM out from under a sibling that is still using it.

`recover` (destroy → recreate → start) takes optional `provision` and `reseal`
hooks. The substrate owns the mechanics; the caller owns what "provisioned"
means, because that is domain knowledge — the device VM's provisioning lives in
`@podkit/device-testing`.

Coordination between callers is **single-layer**: the lock, and nothing else.
There is deliberately no turbo `ensure:<vm>` ordering node — see ADR-027 for why
that approach was rejected.

---

## Transport and source staging

`src/transport.ts` provides three primitives, all routed through the injected
`SubprocessRunner` so they are unit-testable with scripted `limactl` output:

- `runInVm(vm, command, { cwd, env, timeoutMs })` — run a shell command inside a
  VM. A timeout surfaces as exit code 124.
- `copyOut({ vmName, vmPath, hostPath })` — copy a file out of a VM.
- `stageSourceTree({ vmName, hostSrc, vmDest, excludes, sudo })` — rsync the host
  source tree into a VM-local directory. `vmDest` comes from the
  [staging-area registry](#the-staging-area-registry), never from a literal.

### The exclude floor

`DEFAULT_STAGE_EXCLUDES` is the set of host artefacts that must never ride along
into a VM-local tree: `node_modules` (host-arch native bindings), `.turbo` (host
task hashes), `dist`, `.git`, node-gyp intermediates with absolute host paths
baked into their dep files, host binaries that would shadow the ones the VM is
about to produce, and a few large or transient artefacts. Each entry's reason is
documented next to it in the source — read that before adding or removing one.

Caller-supplied `excludes` **extend** the floor; they never replace it. A caller
can therefore only ever prune *more* than the floor, never accidentally less.
This is the point of centralising it: the per-script copies this replaced had
drifted, and one wrapper was shipping host build intermediates its sibling was
not.

One deliberate omission: `packages/libgpod-node/prebuilds` is **not** in the
floor. The prebuild wrappers exclude it (they are producing it and want a clean
tree); the binary wrappers must carry it in so `compile.sh` can embed it.
Callers state which they are.

rsync exit code 24 ("some files vanished before transfer") is tolerated in one
place here rather than restated in every wrapper — it is a benign race with host
processes touching files during the sync window.

Exit code **23** is deliberately *not* tolerated, and the distinction matters.
24 is a file disappearing on the **sending** side, which leaves the destination
consistent. 23 means the transfer could not complete in the **destination** —
the classic cause being a second `rsync --delete` writing the same tree — and
the staged tree really is inconsistent afterwards. Widening the tolerance to
cover 23 would convert a loud failure into a silently corrupt build.

### The staging-area registry

`src/staging.ts` declares every VM-local staging destination with exactly one
owner:

| Area | VM | Destination | Owner |
|------|----|-------------|-------|
| `glibcPrebuild` | `builderGlibc` | `/tmp/podkit-libgpod-build` | `@podkit/device-testing#build:linux-prebuild` |
| `glibcBinary` | `builderGlibc` | `/tmp/podkit-builder-src` | `@podkit/device-testing#build:linux-binary` |
| `glibcGpodTool` | `builderGlibc` | `/tmp/podkit-gpod-tool-src` | `@podkit/gpod-testing#build:linux-binary` |
| `muslPrebuild` | `builderMusl` | `/tmp/podkit-musl-libgpod-build` | `@podkit/device-testing#build:musl-prebuild` |
| `muslBinary` | `builderMusl` | `/tmp/podkit-musl-builder-src` | `@podkit/device-testing#build:musl-binary` |
| `testGlibc` | `testGlibc` | `/tmp/podkit-test` | `tools/lima/run-tests.sh` |
| `testMusl` | `testMusl` | `/tmp/podkit-test` | `tools/lima/run-tests.sh` |
| `virtualIpod` | `virtualIpod` | `/opt/podkit` | mise `vipod:install` |

It exists because the destinations used to be bare strings in five separate
shell wrappers, and two of them had drifted onto the same path: the CLI-binary
build and the gpod-tool build both staged into `/tmp/podkit-builder-src`, with
no ordering edge between their turbo tasks. On a warm tree both rsyncs finished
in under a second and rarely overlapped; on a cold builder both transferred over
a gigabyte and reliably collided with exit 23.

The invariant `findStagingCollision` enforces (pinned by `staging.test.ts`) is
that no two areas in the same VM share a directory **or nest** — a `--delete`
in a parent wipes a child just as thoroughly as a direct collision. The same
path in two different VMs is fine, which is why the check is keyed on
`(vm, dest)`.

Wrappers never spell a destination. They ask for it:

```bash
VM_SRC="$(bun test-packages/lima/src/cli.ts stage-path "$VM_NAME" --area glibcBinary)"
```

`stage-path` re-checks that the area really belongs to the VM you named, so a
musl wrapper pointed at a glibc area fails immediately rather than producing an
artefact linked against the wrong libc.

To add an area: add the entry, extend `staging.test.ts`, and have the caller
read it through `stage-path`. Prefer a **new** directory over reusing an
existing one — the disk cost of a second tree is small next to a corrupt build,
and a wrapper that only needs part of the repo should narrow its `--src` rather
than share someone else's tree (the gpod-tool build stages
`tools/gpod-tool` alone, a few hundred KB instead of a gigabyte).

---

## Two constraints that will bite you

### 1. Never resolve a repo path at module load

`paths.ts` anchors on the `test-packages/lima/` marker substring in
`import.meta.url`, which works from both `src/*.ts` and the flattened
`dist/index.js`. But **anything that calls `repoRoot()` at module-evaluation
time crashes the compiled FunctionFS daemon.** That daemon is a single-file
binary whose `import.meta.url` is `/$bunfs/root/…`, which carries no
`test-packages/lima/` marker to anchor on, and it transitively imports this
registry through the device-testing barrel.

So all path anchoring must stay **lazy, inside function bodies**. The registry's
`yamlPath` is a getter for exactly this reason: reading `instanceName` is a plain
property read and never trips path resolution, while `yamlPath` resolves only
when a host-side caller actually needs a YAML.

This one is nasty because nothing cheap catches it: unit tests, `typecheck`,
`lint` and human review all pass when it is broken. Only a real VM run fails.

### 2. The guests' `/bin/sh` is not bash

`runInVm` and `stageSourceTree` execute through `sh -c`, and that is dash on
Debian and busybox ash on Alpine. `set -o pipefail` is unavailable (dash rejects
it outright). Write portable POSIX shell for anything you send into a VM: `set -u`
plus explicit exit-code checks instead of pipefail.

---

## The manual ABI check

`podkit-abi-verify` is stock Debian with no dev tooling, no `-dev` packages and
no source-tree mount — a disposable environment for confirming by hand that a
produced glibc binary loads with no unresolved symbols and no dynamic dependency
on libgpod, glib, gdk-pixbuf or libplist. It is wired into no CI job and no turbo
task; run it when you want it:

```bash
bun run vm:up abiVerify
limactl copy packages/podkit-cli/bin/podkit-linux-<arch> podkit-abi-verify:/tmp/podkit
limactl shell podkit-abi-verify -- sudo install -m 0755 /tmp/podkit /usr/local/bin/podkit
limactl shell podkit-abi-verify -- ldd /usr/local/bin/podkit
limactl shell podkit-abi-verify -- /usr/local/bin/podkit --version
bun run vm:destroy abiVerify --yes   # optional teardown
```

The allowed and forbidden runtime-library lists are documented in the header of
`vms/podkit-abi-verify.yaml`. Anything on the forbidden list is a static-linking
regression, not a VM problem.

---

## Baseline hashing

`computeBaselineHash` takes an **explicit list of tracked files by absolute
path**, not a package root. That is not incidental: the device VM's provisioning
baseline spans two packages — its YAML lives here, `apply-state.sh` lives in
`@podkit/device-testing`. A single-root signature guarantees a throw the moment
those inputs stop sharing a parent.

The split of responsibility follows from that. This package owns the hashing
primitive and the in-VM hash location (`BASELINE_VM_HASH_PATH`); the package that
owns the non-YAML inputs composes the file list and performs the drift
comparison. `podkit-vm doctor` therefore reports only what it can see for itself
— whether a sealed hash exists — and points at `bun run vm:doctor` for the
comparison. Composing the list in both places would mean two silently divergent
copies of it.

Declaration order is part of the hash, so preserve it when editing the list.

---

## Testing

Every `limactl` call goes through an injected `SubprocessRunner`, so the
registry, lifecycle, transport, CLI dispatch and lock decisions are all unit
tested against scripted outputs with no VM anywhere (`src/*.test.ts`). Production
callers leave the seam unset and get the real `execFile`-backed runner from
`@podkit/device-types`.

The lock's actual two-process mutual exclusion cannot be faked, so it has a real
subprocess integration test (`src/lock.integration.test.ts` plus its worker).

```bash
bun run test:unit --filter @podkit/lima
```

---

## Other exports

- `src/instance-status.ts` — `running` \| `stopped` \| `missing` from
  `limactl list`.
- `src/binary-paths.ts` — host-side resolvers for the built podkit, daemon,
  `gpod-tool` and musl binaries.
- `src/streaming-runner.ts` — a `SubprocessRunner` that streams output live, so a
  multi-minute cold VM create shows its provisioning log and an operator can tell
  a slow VM from a wedged one. Status probes stay buffered.
- `src/docker-image.ts` — build/pull the podkit Docker image *inside* a VM (no
  persona or system-state coupling, so it belongs to the substrate).
