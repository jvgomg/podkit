# Linux Test VMs (Lima)

Lima VMs for running the podkit test suite against Linux from macOS.

| VM | Distro | Libc | Purpose |
|----|--------|------|---------|
| `podkit-tests-debian-glibc` | Debian 12 | glibc | General Linux test environment (matches Homebrew Linux users) |
| `podkit-tests-alpine-musl` | Alpine 3.23 | musl  | Docker image parity (published image is Alpine-based) |
| `virtual-ipod`       | Debian 12 | glibc | USB gadget host for the virtual iPod demo (not used for tests) |

## Prerequisites

```bash
brew install lima
```

## Running tests

The mise wrappers handle VM lifecycle (create on first run, start if stopped, recreate if broken):

```bash
mise run test:linux               # Both VMs
mise run test:linux:debian        # Debian only
mise run test:linux:alpine        # Alpine only
mise run test:linux:stop          # Stop both VMs (preserves state + turbo cache)
mise run test:linux:destroy       # Delete both VMs entirely
mise run test:linux:cache:clear   # Clear turbo cache without deleting VMs
```

Under the hood, `tools/lima/run-tests.sh`:

1. Ensures the VM exists, is running, and isn't in a degraded state.
2. Rsyncs the repo to `/tmp/podkit-test` inside the VM with aggressive excludes — host node_modules, build outputs, native binaries, fixtures, and docs are all stripped so the VM rebuilds cleanly against its own libc.
3. Runs `bun install`, builds `gpod-tool` and the `libgpod-node` native binding, then runs `bun run test --filter @podkit/core`.
4. Turbo cache lives at `$HOME/.cache/podkit-turbo` inside the VM — outside the source tree so `rsync --delete` cannot touch it. The cache survives `limactl stop/start` and is only wiped by `test:linux:destroy` or `test:linux:cache:clear`.

## Interactive shell

For ad-hoc work inside a VM:

```bash
limactl shell podkit-tests-debian-glibc
limactl shell podkit-tests-alpine-musl
```

The macOS filesystem is mounted under your home directory inside the VM, so you can `cd` into the repo. **Do not** run `bun install` against the mounted source — it recompiles the `libgpod-node` native binding for Linux and overwrites your macOS binary. Rebuild on macOS afterward:

```bash
cd packages/libgpod-node
bun run build:native
```

The mise wrappers avoid this pitfall by rsyncing into `/tmp/podkit-test` instead.

## Virtual iPod VM

The `virtual-ipod` VM is a separate concern — it provides USB gadget kernel modules for the virtual iPod demo. It is not used by the test suite.

```bash
mise run vipod:create
mise run vipod:start
mise run vipod:shell
```

See `tools/lima/podkit-virtual-ipod.yaml` and `tools/demo/README.md` for details.

## VM specs

| | Debian | Alpine | Virtual iPod |
|---|--------|--------|--------------|
| Base | Debian 12 (Bookworm) | Alpine 3.23 | Debian 12 (Bookworm) |
| CPUs | 4 | 4 | 2 |
| Memory | 4 GiB | 4 GiB | 2 GiB |
| Disk | 20 GiB | 10 GiB | 20 GiB |

Both test VMs include: Bun (primary), Node.js 22 LTS, FFmpeg, libgpod-dev + GLib (native addon compilation), build tools (gcc, g++, make, python3, pkg-config), util-linux (`lsblk`), git, curl.

## Troubleshooting

### Native modules fail to build

Inside the VM:

```bash
cd /tmp/podkit-test/packages/libgpod-node
npx node-gyp rebuild
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
