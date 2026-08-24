# Linux test-suite runner (Lima)

This directory holds the **runner** for the cross-libc Linux test suites —
`run-tests.sh` and this README. It holds no VM configuration.

Every Lima VM config in the repo lives in one place:
[`test-packages/lima/vms/`](../../test-packages/lima/vms), behind the typed
registry in [`@podkit/lima`](../../test-packages/lima). Lifecycle (create,
start, stop, destroy) goes through the `podkit-vm` CLI, which holds the shared
advisory lock — see
[`test-packages/lima/README.md`](../../test-packages/lima/README.md).

| VM | Distro | Libc | Purpose |
|----|--------|------|---------|
| `podkit-test-glibc` | Debian 12 | glibc | General Linux test environment (matches Homebrew Linux users) |
| `podkit-test-musl` | Alpine 3.23 | musl | Docker image parity (the published image is Alpine-based) |

Both are `test-runner` entries in the registry (`testGlibc` / `testMusl`). They
are distinct from the builder VMs that compile release artefacts and from the
device VM that runs USB-gadget tests — see
[ADR-016](../../adr/adr-016-linux-vm-test-harness.md) and
[ADR-027](../../adr/adr-027-lima-vm-substrate-consolidation.md).

## Prerequisites

```bash
brew install lima
```

## Running tests

The mise wrappers handle VM lifecycle (create on first run, start if stopped):

```bash
mise run test:linux               # Both VMs
mise run test:linux:debian        # glibc only
mise run test:linux:alpine        # musl only
mise run test:linux:stop          # Stop both VMs (preserves state + turbo cache)
mise run test:linux:destroy       # Delete both VMs entirely
mise run test:linux:cache:clear   # Clear turbo cache without deleting VMs
```

Under the hood, `run-tests.sh`:

1. Calls `podkit-vm ensure <instance>` — the one locked start path every VM
   starter in the repo shares, so a `mise run test:linux` racing a builder task
   or a `bun run vm:up` cannot double-start an instance.
2. Calls `podkit-vm stage` to rsync the repo to `/tmp/podkit-test` inside the
   VM. Staging applies the shared exclude floor from `@podkit/lima` (host
   `node_modules`, `.turbo`, `dist`, native build intermediates, …) plus the
   extra prunes this run wants — docs, generated fixtures and every build output
   the VM is about to regenerate — so the VM rebuilds cleanly against its own
   libc.
3. Runs `bun install`, builds `gpod-tool` and the `libgpod-node` native binding,
   compiles the single-file binary and drives it through the shared runtime
   smoke script, then runs the full `bun run test` suite.
4. Turbo cache lives at `$HOME/.cache/podkit-turbo` inside the VM — outside the
   staged tree so `rsync --delete` cannot touch it. The cache survives
   `limactl stop/start` and is only wiped by `test:linux:destroy` or
   `test:linux:cache:clear`.

## Interactive shell

For ad-hoc work inside a VM:

```bash
bun run vm:shell testGlibc
bun run vm:shell testMusl
```

The macOS filesystem is mounted under your home directory inside the VM, so you
can `cd` into the repo. **Do not** run `bun install` against the mounted source
— it recompiles the `libgpod-node` native binding for Linux and overwrites your
macOS binary. Rebuild on macOS afterward:

```bash
cd packages/libgpod-node
bun run build:native
```

The mise wrappers avoid this pitfall by staging into `/tmp/podkit-test` instead.

## VM specs

| | `podkit-test-glibc` | `podkit-test-musl` |
|---|--------|--------|
| Base | Debian 12 (Bookworm) | Alpine 3.23 |
| CPUs | 4 | 4 |
| Memory | 4 GiB | 2 GiB |
| Disk | 14 GiB | 12 GiB |

Both include: Bun (primary), Node.js 22 LTS, FFmpeg, libgpod-dev + GLib (native
addon compilation), build tools (gcc, g++, make, python3, pkg-config),
util-linux (`lsblk`), git, curl.

## Troubleshooting

### Native modules fail to build

Inside the VM:

```bash
cd /tmp/podkit-test/packages/libgpod-node
bunx node-gyp rebuild
```

### Bun not available on Alpine

Bun's musl support is experimental. Fallback:

```bash
npm install -g bun
```

### Cache seems stale

```bash
mise run test:linux:cache:clear
```

If turbo cache corruption is suspected, destroy and rebuild the VM:

```bash
mise run test:linux:destroy
mise run test:linux:debian
```

### A VM is wedged or won't start

```bash
bun run vm:recover testGlibc   # destroy → recreate → start
```

## Related

- [`test-packages/lima/README.md`](../../test-packages/lima/README.md) — the VM
  registry, the `podkit-vm` CLI, the advisory lock, and source staging.
- [ADR-016](../../adr/adr-016-linux-vm-test-harness.md) — why builder, test and
  device VMs are physically separate.
- [ADR-027](../../adr/adr-027-lima-vm-substrate-consolidation.md) — why the VM
  configs and lifecycle live in one package.
