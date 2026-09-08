---
title: 'ADR-028: Substrate-Agnostic Device Harness'
description: Decouple the device-testing harness from Lima by putting a SubstrateLink (exec/copyIn/spawn) beneath it, so the substrate can be a Lima VM on macOS or a sibling Proxmox VM reached over SSH on Linux. Lima is demoted from substrate to provisioner. Honours the Linux dispatch ADR-016 promised and never delivered.
sidebar:
  order: 29
---

# ADR-028: Substrate-Agnostic Device Harness

## Status

**Accepted** (2026-09-07)

Extends [ADR-016](./adr-016-linux-vm-test-harness.md) by finally delivering the
Linux dispatch it promised, and revises part of
[ADR-027](./adr-027-lima-vm-substrate-consolidation.md): `@podkit/lima` remains
the owner of Lima orchestration, but stops being the only way to reach a
substrate. Neither ADR's physical builder/test/device VM separation is touched.
Vocabulary is recorded in [CONTEXT.md](../../CONTEXT.md) §Test environments.

## Context

podkit's quality gate is a local-machine affair. `bun run quality` drives six
E2E surface cells ([ADR-025](./adr-025-canonical-test-taxonomy.md)), and four of
them require either a container runtime or a privileged Linux kernel. No CI
workflow runs any test: `pr-checks.yml` builds the docs site, and every other
workflow only builds and publishes. So an environment that cannot run the suite
does not merely inconvenience one developer — it means the suite does not run.

A second development machine (an unprivileged Proxmox LXC container, Linux,
x86_64) joined an existing macOS workstation. It cannot run four of the six
cells, and the reasons are structural rather than configuration:

- **No `/lib/modules`.** An unprivileged LXC shares the host kernel and cannot
  load modules, so `dummy_hcd` — the basis of the whole `usb-synth` device
  surface — is unreachable by construction.
- **No `/dev/loop*` and no `CAP_SYS_ADMIN`.** The `loopback-fat` surface needs
  `losetup`, `mkfs.vfat` and `mount`; `apply-state.sh` needs root plus
  `modprobe` and `udevadm`.
- **No `/dev/kvm`.** Running Lima there would mean QEMU under software
  emulation.
- **No container runtime**, though user namespaces, `/etc/subuid` and native
  `overlay` are all present.

Underneath the environment problem sat an architectural one. The harness is
written against Lima specifically, in a way that had already been recognised and
half-fixed:

- **The abstraction exists and is bypassed.** `TestRuntime`
  (`test-packages/device-testing/src/runtime.ts`) is the "run this test body in
  some Linux environment" seam, with a `local-linux` implementation whose
  `isAvailable()` is literally `process.platform === 'linux'`. ADR-016 §"Opt-in
  detection" promises the dispatch. But **no code calls `getRunner()` outside
  its own unit test**: all 20 VM test files import the `limaTestVmRunner`
  singleton by name, and `preflight.ts` unconditionally probes the Lima instance
  and exits non-zero.
- **The interface abstracts the wrong layer.** `TestRuntime` exposes execution
  (`run`) but not file transfer, while the persona, backing-file, systemd and
  daemon helpers are **free functions taking `vmName: string`** that reach past
  the interface to `limactl` directly. That parameter is the actual leak.
  `local-linux` implements all five interface members and still cannot run a
  single persona test, because none of the capability lives behind the
  interface.
- **The funnel exists, unused, and duplicated.** `@podkit/lima`'s
  `transport.ts` already has `runInVm()`/`copyOut()` in the right shape, and its
  `wrapCommand` env/cwd logic is duplicated verbatim in `lima-test-vm.ts`.
  device-testing imports neither; it hand-assembles `['shell', vm, '--', …]` at
  39 sites.

The diagnosis is that Lima was treated as *the substrate* rather than as one way
of *obtaining* a substrate. `local-linux` rotted because it was written as a
second, parallel implementation of the whole harness rather than the same
harness over a different connection.

## Decision drivers

- The full quality gate must be runnable **from** the Linux box, which is not
  the same as running **on** it — no framework change reaches `usb-synth` from
  an unprivileged container.
- macOS keeps working. The machines join; neither replaces the other, so Lima
  cannot be deleted.
- Rapid local loops matter more than parity. Cells that *can* run locally must
  stay local and fast.
- One harness code path, not two. A second parallel implementation would rot the
  way the first one did.
- A partial run must never be mistakable for a passing gate.
- Test files should not have to change.

## Decision

### 1. `SubstrateLink` beneath the harness, not `TestRuntime` widened

Introduce `SubstrateLink` — `exec(cmd)`, `copyIn(host, guest)`,
`spawn(cmd) → ChildHandle` — injected through the existing
`subprocess?: SubprocessRunner` DI channel that already threads through every
helper. The free functions take a link instead of a `vmName: string`. Two
implementations: `limactl` and SSH.

Widening `TestRuntime` was rejected because it has already been tried in this
codebase and failed: the Lima knowledge is not behind the interface, it is in the
free functions, so a wider interface would have left `local-linux` exactly as
unable to run a persona test as it is today.

All transfers are host→guest (there is no `copyOut` anywhere in the package), so
the SSH implementation needs one-way `scp` only.

### 2. Transport failure is distinguishable from guest failure

`exec()` throws a distinct `TransportError`-equivalent on link failure and
returns a `RunResult` otherwise. Today `limactl shell` returns the *guest's*
exit code, and four call sites carry comments asserting a distinction the code
cannot make. The distinction is load-bearing for §5: "the substrate is
unreachable" must be a skip, and "the guest command failed" must be a failure.

### 3. Sibling Proxmox VM, not nested Lima

On Linux the substrate is a **sibling** Proxmox VM reached over SSH — a peer of
the development box, not a hypervisor nested inside it. The harness's kernel
requirements (`dummy_hcd num=4`, `libcomposite`, `usb_f_fs`,
`usb_f_mass_storage`, `sg`, configfs) are *guest kernel* requirements that stock
Debian 12 cloud kernels already satisfy; they are not nested-virtualisation
requirements. Nesting would buy source compatibility and pay for it with a
hypervisor inside a hypervisor.

Lima is demoted to a **provisioner**: on macOS its job shrinks to creating the
box and reporting how to reach it (`limactl show-ssh` already emits an ssh
config). The Proxmox substrate is provisioned from a repo-owned cloud-init
template plus a documented `qm create` recipe, run by hand. Full PVE API
automation is deliberately deferred — it is a real project buying an operation
run roughly twice a year.

The substrate's *identity and purpose* stay in the existing VM registry, which
gains a provisioner discriminator; machine-specific *connection* detail
(hostname, key path) lives in an environment variable.

### 4. Container cells split by privilege, not by name

The two Docker surfaces share a prefix and nothing else:

- `test:e2e:docker` (`docker-source`) is one unprivileged, digest-pinned
  Navidrome container with a bind mount and a published port. It stays **local**,
  via a new `PODKIT_CONTAINER_RUNTIME` environment variable (default `docker`)
  replacing the literal `'docker'` hardcoded at four call sites, with rootless
  Podman on Linux.
- `test:e2e:docker-loopback` runs `--privileged` and `mknod`s 64 loop devices.
  It goes to the substrate and can never run in a container.

### 5. Unavailable substrate skips loudly; the gate still fails

Cells whose substrate is unavailable report as **skipped with a reason**, and
the gate summary names them — but `quality` exits **non-zero**. A green gate that
silently tested four of six surfaces is worse than no gate. This replaces the
current behaviour on both sides: `preflight.ts` hard-exits, and the Docker suite
throws in `beforeAll`, which is why a machine without Docker reports failures
where it should report skips.

### 6. CI becomes a backstop

`ubuntu-latest` runs Unit, Integration, `host-binary`·`local-dir`·`dir` and
`docker-sidecar` on push. `usb-synth` on CI is technically reachable — GitHub
runners are full VMs that can `modprobe dummy_hcd` — and is deliberately left
open rather than decided here.

### 7. Vocabulary

**Substrate**, **provisioner**, **substrate link**, **harness** — defined in
[CONTEXT.md](../../CONTEXT.md). Notably the interface is *not* called a
transport: that word already denotes how podkit reaches an iPod's firmware
(USB vs SCSI), 53 times in `packages/`, and both meanings would otherwise appear
in files like `inquiry-usb-transport-down.e2e.test.ts`.

[ADR-025](./adr-025-canonical-test-taxonomy.md)'s `vm-binary` and
`vm-docker-image` Runtime values are **redefined, not renamed** — "the device
substrate" rather than "the `podkit-device` Lima VM". The labels stay accurate;
only one definition line changes.

## Alternatives considered

- **Move the LXC to a privileged container, or bind-mount `/dev/kvm` and
  `/dev/fuse` in.** Unblocks Docker; never unblocks `usb-synth`, because
  configfs USB gadget state is not namespaced and module loading is not
  available. Solves the smaller half of the problem and leaves the
  architecture untouched.
- **Nested Lima on a Linux host** (make `vmType: 'vz'` host-conditional and
  otherwise change nothing). Smallest diff, and genuinely tempting: nothing in
  TypeScript branches on the driver, and the pin is one YAML line. Rejected for
  running a hypervisor inside a hypervisor on 4 vCPUs, and for keeping the
  harness tied to a provisioner.
- **Wire up `local-linux` as designed.** This is the ADR-016 plan. Rejected:
  it is a *parallel* implementation, and the persona/backing-file/daemon
  capability lives in free functions it does not have. Completing it means
  writing the harness twice and keeping both correct — the failure mode that
  produced today's dead code.
- **Push-to-CI for the hard cells.** A 3–10 minute floor per iteration, against
  an explicit requirement for rapid local loops. Retained as a backstop (§6),
  rejected as the primary mechanism.
- **Proxmox snapshot/rollback instead of `apply-state.sh`.** Rollback is a
  multi-second VM operation plus a boot; `apply-state.sh` is a sub-2-second
  forward mutation (ADR-016 §"Test speed strategy"). It would make the loop
  slower *and* fork behaviour between platforms.

## Consequences

**Positive.** The harness stops knowing what a hypervisor is. `usb-synth` and
`loopback-fat` become reachable from a Linux box that structurally cannot host
them. macOS is unaffected in capability. The repo gains its first CI that runs
tests. `apply-state.sh` needs **zero** changes — its only two Lima references are
comments about `sg` permissions whose reasoning ("sessions arrive over ssh, not
via a console seat, so uaccess doesn't fire") holds verbatim for plain SSH.

**Cost.** Roughly 13 production files and ~46 call sites, estimated 1–2 days;
**no test files change**. The `limaTestVmRunner` singleton is constructed at
module scope and imported by name in 29 files, so the implementation is selected
by environment variable inside its factory rather than threaded through — and the
singleton is renamed, because a name saying "Lima" for something that may be an
SSH connection to Proxmox is how the next reader gets misled. One test
(`pre-sync-sweep`) holds a long-lived child process handle and relies on
limactl's SIGHUP-on-teardown; SSH differs, which is why `spawn` is on the
interface. macOS gains an SSH hop where it had `limactl shell`.

**Neutral.** Linux hosts build glibc artifacts natively and musl artifacts in an
Alpine container rather than in builder VMs — which tightens musl parity, since
the shipped image is `FROM alpine:3.21`. Host architectures now differ (arm64
Mac, amd64 Linux and substrate), so artifact caches must key on architecture;
`binary-paths.ts` currently assumes host arch equals guest arch.

**Deferred.** `usb-synth` on CI. PVE API lifecycle automation. A second
concurrent substrate to remove the phase-2 serialisation in `run-mirror-body.ts`.
Renaming the pre-existing `SubprocessRunner`/`registerRunner` overload — recorded
in CONTEXT.md instead.

**Assumption verified (2026-09-07).** Rootless Podman 5.4.2 runs the real
digest-pinned Navidrome workload on the unprivileged LXC. The absence of
`/dev/fuse` does not matter: kernel 6.17 mounts native overlay inside a user
namespace, so no fuse-overlayfs is needed. Two Docker/Podman differences surfaced
and are recorded on task-492: Podman rejects `-p 0:<port>` (use `-p <port>`,
which means "random host port" in both runtimes), and `restart` fails under the
default `pasta` rootless network backend because the outgoing process has not
released the host port (use `slirp4netns`, or stop-then-recreate). Separately,
Proxmox's default `/etc/subuid` allocates IDs outside an unprivileged LXC's own
user namespace and must be reallocated inside it — a machine-setup step for
Linux contributors, not repo work.
