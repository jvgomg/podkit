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
| `src/debian-image.ts` | The pinned Debian cloud image, as one constant. |
| `src/paths.ts` | `repoRoot()` — the repo anchor the registry resolves YAML paths against. |

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
