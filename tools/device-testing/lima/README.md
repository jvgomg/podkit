# Builder & test VMs (Lima)

Lima VMs that produce and verify Linux glibc binaries from macOS. These are
the **VMs introduced by [ADR-016](../../../adr/adr-016-linux-vm-test-harness.md)**
and are separate from `tools/lima/` (the cross-platform test environment) and
`tools/lima/virtual-ipod.yaml` (the demo VM, off-limits).

## Builder VM vs test VM

ADR-016 mandates a physical split between the VM that compiles binaries and
the VM(s) that exercise them:

| VM | Yaml | Role | Contents |
|----|------|------|----------|
| **Builder** | `builder.yaml` | Compile `@podkit/libgpod-node` prebuilds + the podkit standalone binary | Bun, Node 22, build-essential, `libglib2.0-dev`, `libgdk-pixbuf-2.0-dev`, `libplist-dev`, cmake, meson, ninja, autoconf, libtool, intltool, perl XML::Parser |
| **ABI verify** (spike-only) | `abi-verify.yaml` | Smoke-check that the binary loads on stock Debian with `ldd` showing only system libs | Stock Debian 12.10 + `ffmpeg` and `binutils`. **No `-dev` packages, no Bun, no Node, no source tree.** |
| **Test VM** (lands in TASK-322.01) | `test-vm.yaml` (future) | Run Tier 3 device-integration tests against the compiled binary | Stock Debian 12.10 + kernel modules (`dummy_hcd`, `libcomposite`, `usb_f_mass_storage`, `usb_f_fs`), `ffmpeg`, FunctionFS daemon, `gpod-tool`. **No dev tools.** |

The dev-library separation prevents binaries with hidden dynamic linkage from
passing tests on dev hosts that happen to have `libgpod.so` available — a bug
class ADR-016 §"Builder/test VM split" was created to catch.

## Quick start

```bash
brew install lima

# 1) Boot the builder VM (first run ~5 min)
limactl start tools/device-testing/lima/builder.yaml --name builder

# 2) Produce a Linux x64 binary via turbo (cached on the host)
bunx turbo run @podkit/device-testing#build:linux-binary
# Output: packages/podkit-cli/bin/podkit-linux-x64

# Or via the mise wrapper:
mise run device-testing:build-linux

# 3) (Optional) Verify ABI on a stock Debian VM
limactl start tools/device-testing/lima/abi-verify.yaml --name abi-verify
limactl copy packages/podkit-cli/bin/podkit-linux-x64 abi-verify:/tmp/podkit
limactl shell abi-verify -- sudo install -m 0755 /tmp/podkit /usr/local/bin/podkit
limactl shell abi-verify -- ldd /usr/local/bin/podkit
limactl shell abi-verify -- /usr/local/bin/podkit --version
```

## Build pipeline (single source of truth)

```
turbo task
    ↓
@podkit/device-testing#build:linux-prebuild
    ↓ (host)
packages/device-testing/scripts/build-linux-prebuild.sh
    ↓ (limactl shell builder)
tools/prebuild/build-linux-glibc.sh    ←──── SHARED with .github/workflows/prebuild.yml
    ↓
tools/prebuild/build-static-deps.sh    ←──── SHARED with prebuild.yml + build-platform.yml
    ↓
npx prebuildify --napi --strip
    ↓
packages/libgpod-node/prebuilds/linux-${arch}/*.node
    ↓
@podkit/device-testing#build:linux-binary
    ↓ (limactl shell builder)
bun build --compile (via packages/podkit-cli/scripts/compile.sh)
    ↓
packages/podkit-cli/bin/podkit-linux-${arch}
```

The Lima builder VM and `.github/workflows/prebuild.yml` (the `linux-x64` /
`linux-arm64` glibc jobs) both invoke `tools/prebuild/build-linux-glibc.sh`.
There is no duplicated native-build logic between local development and CI.

The **musl/Alpine** path in `prebuild.yml` (`prebuild-musl-x64`,
`prebuild-musl-arm64`) and the Alpine jobs in `build-platform.yml` are
deliberately untouched — they run inside `alpine:3.21` containers, target
musl, and have their own static-link nuances. ADR-016 explicitly scopes the
builder VM to glibc.

## Turbo caching

`turbo.json` declares the inputs for these tasks:

- `@podkit/device-testing#build:linux-prebuild` — hashes
  `packages/libgpod-node/native/**`, `binding.gyp`, `tools/prebuild/**`, and
  `tools/device-testing/lima/builder.yaml`. Cache hit = no VM invocation.
- `@podkit/device-testing#build:linux-binary` — depends on the prebuild task
  plus the TypeScript source set.

To clear: `bunx turbo run @podkit/device-testing#build:linux-binary --force`.

## Option (a) vs (b)

ADR-016 §"Builder VM / test VM split" left the implementation strategy open:

- **(a)** Extract a thin glibc-specific wrapper that both the Lima VM and
  the GHA workflow call.
- **(b)** Expose the turbo task from CI itself (`bunx turbo run ...` in CI).

We picked **(a)**: `tools/prebuild/build-linux-glibc.sh`. Rationale:
- CI does not have a bun workspace already installed at the point where
  prebuilds run (Bun is set up after caching decisions). Adding `bunx turbo`
  in front of the prebuild step would slow down CI by an `apt install` + a
  full workspace install before the prebuild even starts.
- The script form is callable from any context (host, builder VM, CI, a
  rescue shell on a stock Debian box), with no Node/Bun dependency at the
  outer layer.
- Single bash file is easier for the next maintainer to read than a
  cross-cutting turbo + script setup.

## Troubleshooting

### `limactl: command not found`
```bash
brew install lima
```

### Cache miss every run
Verify the inputs glob in `turbo.json` actually matches your sources:
```bash
bunx turbo run @podkit/device-testing#build:linux-prebuild --dry-run=json | jq '.tasks[].inputs'
```
Common culprits: editing files inside the inputs set, or stale `.turbo` directories.

### `ldd` shows libgpod / libglib / libgdk-pixbuf
The static-link path is broken. Inspect `tools/prebuild/build-static-deps.sh`
for the relevant `--enable-static` / `--disable-shared` / `-fPIC` flags and
the `STATIC_DEPS_DIR/lib/*.a` checks that the script's verify phase performs.

### Builder VM is degraded / won't start
```bash
mise run device-testing:builder:destroy
mise run device-testing:build-linux  # recreates on first run
```

### Version mismatch (different Debian point release)
Both `builder.yaml` and `abi-verify.yaml` pin Debian 12.10 via explicit
cloud-image URLs. If you bump one, bump both, and run the ABI spike again to
confirm the build artefacts still load.

### Native binding fails to load inside the binary
Re-run with verification skipped, then inspect the .node file:
```bash
SKIP_VERIFY=1 limactl shell builder -- bash tools/prebuild/build-linux-glibc.sh
limactl shell builder -- ldd packages/libgpod-node/prebuilds/linux-*/*.node
```
Any `libgpod`, `libgdk_pixbuf`, `libglib`, or `libplist` line indicates a
build regression in `build-static-deps.sh`.

## References

- [ADR-016](../../../adr/adr-016-linux-vm-test-harness.md) §"Builder VM /
  test VM split" — why these VMs exist.
- [ADR-016](../../../adr/adr-016-linux-vm-test-harness.md) §"Build tooling:
  one implementation, two callers" — the single-source-of-truth invariant.
- `tools/lima/README.md` — the cross-platform test VMs (different concern).
- `tools/lima/virtual-ipod.yaml` — the demo VM (off-limits per ADR-016).
- `.github/workflows/prebuild.yml` — the CI workflow that shares
  `build-linux-glibc.sh` with this VM.
