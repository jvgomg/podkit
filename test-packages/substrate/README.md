# @podkit/substrate

The provisioner-agnostic layer beneath the device harness.

A **substrate** is the Linux environment the device harness drives: a kernel
with `dummy_hcd`, configfs and a systemd userland, reachable over SSH. A
**provisioner** is whatever produced it — Lima on a developer's Mac, Proxmox
plus cloud-init on a hypervisor, or a human who installed Debian on a spare box.
This package owns what is true regardless of which one you have; `@podkit/lima`
is one provisioner and depends on this package. The dependency never points the
other way, and that is the point — see [ADR-029](../../docs/adr/adr-029-portable-device-substrate.md)
§1 and the vocabulary in [CONTEXT.md](../../CONTEXT.md) §"Test environments".

It is deliberately dependency-free. Packages that bundle into single-file
binaries import it, so nothing here may be heavy and nothing here may resolve a
path at module load — see [Two traps](#two-traps) below.

---

## What it owns

| Module | Owns |
|--------|------|
| `src/registry.ts` | The typed substrate registry and the `provisioner` discriminator. |
| `src/selection.ts` | Which substrate *this machine* drives, resolved from configuration. |
| `src/link.ts`, `src/link-ssh.ts` | The substrate link — how commands and files reach a substrate. |
| `src/debian-image.ts` | The pinned Debian cloud image, as one constant. |
| `src/target-arch.ts` | The architecture artifacts are built **for**, and the boundary between resolving one and asking a substrate for one. |
| `src/artifact-arch.ts` | Whether a compiled artifact can actually start on a given substrate. |
| `src/binary-paths.ts` | Host-side paths of the built Linux artifacts, named per target architecture. |
| `src/paths.ts` | `repoRoot()` — the repo anchor the registry resolves YAML paths against. |
| `scripts/turbo.ts` | `turbo`, with the target architecture materialised into the environment it hashes. |

---

## Target architecture

Host architecture used to imply target architecture: one function mapped
`process.arch` to a binary filename suffix and seven resolvers called it, so an
arm64 macOS host could not *name* an amd64 artifact, let alone produce one.
Target architecture is now resolved from the selected substrate, with host
architecture only as the default when no substrate was consulted
([ADR-029](../../docs/adr/adr-029-portable-device-substrate.md) §4).

Resolving it has two halves, and they are kept apart on purpose:

- **`targetArch()` is synchronous and never probes.** Every path resolver calls
  it, several of them inside turbo tasks where no link exists, and one of them
  runs before the command that *starts* the substrate. A hidden probe there
  would turn "where would this binary be?" into a network round trip that fails
  on a stopped box. It reads `PODKIT_TARGET_ARCH` and falls back to the host.
- **`primeTargetArchFromSubstrate()` is asynchronous and does probe.** It is
  called once, by an entry point that already holds a link, before any artifact
  path is resolved or any build is spawned, and it publishes the answer into the
  environment.

The environment variable is the carrier rather than a private cache because the
consumers are not all in this process: the turbo tasks that compile the binaries
are child processes, and the same value has to reach them **and** be hashed into
their cache key. `turbo.json` declares `PODKIT_TARGET_ARCH` as an input of every
task producing a Linux binary — without which turbo would replay an arm64
artifact into an amd64 run, and the artifact filenames already carrying the arch
means nothing errors. The failure is a silently wrong binary.

`assertArtifactArch()` is the backstop for that cache key being wrong anyway.
The binary transfer reads the artifact's ELF `e_machine` and the substrate's
`uname -m` in one probe and refuses the install, because the alternative symptom
is an `exec format error` partway through a test run, blamed on whichever test
invoked the binary first.

---

## The provisioner discriminator

Every registry entry declares a `provisioner`, and the two variants carry
genuinely different data:

- **`lima`** entries carry `yamlPath`, pointing at a declarative Lima YAML under
  `test-packages/lima/vms/`.
- **`ssh`** entries carry `sshAlias`: the *name* of a `Host` stanza in the
  developer's own `~/.ssh/config`, and nothing else. Never a hostname, never a
  user, never a key path, never a jump host.

That split is why this repository can be public without anyone remembering to
keep their infrastructure out of it. The repo declares capability; the machine
declares connection. A Tailscale address or a bastion hop is then something
`~/.ssh/config` already models and this repo never has to.

An `ssh` entry has **no** `yamlPath` — not an empty one, not one that throws.
There is no Lima YAML for a box Lima did not create, so the type says so and
`isLimaVm()` narrows before anything reads a path.

### Looking substrates up

```ts
import { getVm, listVms, deviceVm, isLimaVm } from '@podkit/substrate';

const vm = getVm('builderGlibc'); // also accepts 'podkit-builder-glibc'
```

`getVm` with a literal id from `LIMA_VM_IDS` returns the narrowed
`LimaVmDefinition`, so `getVm('device').yamlPath` type-checks without a runtime
dance. `getVm(someString)` returns the union, because a runtime string genuinely
could be either. `registry.test.ts` pins `LIMA_VM_IDS` against the registry, so
that narrowing cannot become a lie.

---

## Substrate selection

Which substrate this machine uses is **configuration**, read from
`PODKIT_SUBSTRATE` in a gitignored env file the runtime auto-loads. The
committed [`.env.example`](../../.env.example) documents it, along with every
other machine-specific value.

With nothing configured, selection falls back to the Lima substrate **when
`limactl` is on PATH**, and announces that it did so. With nothing configured
and no `limactl`, it errors and names the configuration step.

Two things about that are load-bearing:

- **Platform is never consulted.** A Mac keeps working with zero configuration
  because Lima is installed on it, not because anything special-cased `darwin`.
  A `process.platform` branch would answer a question nobody asked and could not
  be overridden; `selection.test.ts` asserts the source contains no such branch.
- **The fallback announces itself.** The failure it prevents is someone
  configuring a remote substrate, forgetting to select it, and reading a local
  result as a remote one. The announcement is *returned* as data rather than
  printed — this is library code and does not own a TTY (`docs/architecture/conventions.md`
  §1–2) — and callers must surface it.

---

## The pinned Debian image

ADR-016 requires the substrate's Debian point release to be pinned, so the
kernel version and module availability are reproducible. That pin is spelled out
in four files that cannot import a TypeScript constant: three Lima YAMLs and
`substrate-contract.sh`, which is sourced on a box the contract forbids a
toolchain on.

`debian-image.ts` is the one source of truth, and `debian-image.test.ts` reads
all four files back and fails when any of them disagrees. That is the whole
mechanism: it converts "bump all of these together" from a comment enforced by
memory into an assertion enforced by the build.

`device`, `builderGlibc` and `abiVerify` are pinned and must move together —
they are one experiment about one userland, and a skew between them makes the
ABI check vouch for a environment the harness does not have. `testGlibc`,
`testMusl` and `virtualIpod` deliberately float, and the test asserts that too:
a pin nobody chose is as much drift as a missing one.

**To bump:** edit the constants, run
`bun run test:unit --filter @podkit/substrate`, fix every file it names, then
re-run the manual ABI check.

---

## Two traps

### 1. Never resolve a repo path at module load

`paths.ts` anchors on the `test-packages/substrate/` marker substring in
`import.meta.url`, which works from both `src/*.ts` and the flattened
`dist/index.js`. But **anything that calls `repoRoot()` at module-evaluation
time crashes the compiled FunctionFS daemon.** That daemon is a single-file
binary whose `import.meta.url` is `/$bunfs/root/…`, which carries no marker to
anchor on, and it transitively imports this registry through the device-testing
barrel.

So all path anchoring stays **lazy, inside function bodies**. The registry's
`yamlPath` is a getter for exactly this reason: reading `instanceName` is a
plain property read and never trips path resolution, while `yamlPath` resolves
only when a host-side caller actually needs a YAML.

This one is nasty because nothing cheap catches it: unit tests, `typecheck`,
`lint` and human review all pass when it is broken. Only a real VM run fails —
which is why `registry.test.ts` asserts the property descriptor directly.

### 2. Nothing here may depend on `@podkit/lima`

The registry names `test-packages/lima/vms/*.yaml` as *strings*, and that is
deliberate: this package knows where the Lima provisioner keeps its specs
without importing it. An import in that direction would make the extraction
pointless, and would put a `limactl` wrapper in the dependency graph of every
package that only wanted to know a VM's name.
