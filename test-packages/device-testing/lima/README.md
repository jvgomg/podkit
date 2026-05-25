# Builder & device-testing harness VMs (Lima)

Lima VMs that produce and verify Linux glibc binaries from macOS. These are
the **VMs introduced by [ADR-016](../../../adr/adr-016-linux-vm-test-harness.md)**
and are separate from `tools/lima/` (the cross-platform test environment) and
`tools/lima/podkit-virtual-ipod.yaml` (the demo VM, off-limits).

## Builder VM vs device-testing harness

ADR-016 mandates a physical split between the VM that compiles binaries and
the VM(s) that exercise them:

| VM | Yaml | Role | Contents |
|----|------|------|----------|
| **Builder** | `podkit-linux-builder.yaml` | Compile `@podkit/libgpod-node` prebuilds + the podkit standalone binary | Bun, Node 22, build-essential, `libglib2.0-dev`, `libgdk-pixbuf-2.0-dev`, `libplist-dev`, cmake, meson, ninja, autoconf, libtool, intltool, perl XML::Parser |
| **ABI verify** (spike-only) | `podkit-abi-verify.yaml` | Smoke-check that the binary loads on stock Debian with `ldd` showing only system libs | Stock Debian 12.10 + `ffmpeg` and `binutils`. **No `-dev` packages, no Bun, no Node, no source tree.** |
| **Device-testing harness** | `podkit-device-harness.yaml` | Run VM device-integration tests against the compiled binary | Stock Debian 12.10 + kernel modules (`dummy_hcd`, `libcomposite`, `usb_f_mass_storage`, `usb_f_fs`), `ffmpeg`, runtime libgpod4 (for `gpod-tool` helper only), FunctionFS daemon, `gpod-tool`. **No dev tools, no `-dev` packages, no Bun, no Node, no source tree.** |

The dev-library separation prevents binaries with hidden dynamic linkage from
passing tests on dev hosts that happen to have `libgpod.so` available — a bug
class ADR-016 §"Builder/test VM split" was created to catch.

## Device-testing harness (`podkit-device-harness.yaml`)

The test VM is the minimal Debian 12.10 environment that VM integration
tests run against (TASK-322.01). It mimics a stock end-user runtime so binary
linkage problems cannot be masked by dev libraries on PATH.

**Lima instance name:** `podkit-device-harness`.

### Start it

```bash
bun run harness:create   # one-time: registers the Lima instance
bun run harness:start    # boots / resumes it
```

(`bun run harness:setup` rolls both steps plus the binary install into one.) The scripts live in [`test-packages/device-testing/scripts/harness.ts`](../scripts/harness.ts); see [agents/device-testing.md §"Quick start"](../../../agents/device-testing.md#quick-start-developer).

The yaml provisions in three system steps:

1. `apt install` of `ffmpeg`, `libgpod4`, `libgpod-common`, `libglib2.0-0`,
   `ca-certificates`, `kmod`. Module-load config at
   `/etc/modules-load.d/podkit-device-harness.conf` for the USB gadget stack
   (`dummy_hcd`, `libcomposite`, `usb_f_mass_storage`, `usb_f_fs`); explicit
   `configfs` fstab line as a safety net.
2. `gpod-tool` install from `/tmp/gpod-tool` if staged (see "gpod-tool
   sourcing" below).
3. Hard guards that fail provisioning if `bun`, `node`, `npm`, or any `-dev`
   package was somehow installed.

### Verify the binary-only invariant

After boot, none of these should produce output:

```bash
limactl shell podkit-device-harness -- which bun node npm        # all empty
limactl shell podkit-device-harness -- dpkg -l | grep -E ' -dev ' # no -dev pkgs
```

`/usr/local/bin` is writable but starts empty for `podkit` — TASK-322.03
populates it via `limactl copy` from the host's turbo cache. There is no
`mounts:` entry, so the host source tree is invisible inside the VM.

### Why `ffmpeg` is system-installed but `libgpod` is not (for podkit)

The podkit binary statically links libgpod, gdk-pixbuf, glib, and libplist
(see `tools/prebuild/build-static-deps.sh` and the ABI verify VM). `ldd
/usr/local/bin/podkit` inside the test VM must show only stable system libs;
any libgpod / libglib / libgdk-pixbuf line is a regression.

`ffmpeg` is the one exception — it is invoked as a subprocess by podkit
(transcoding pipeline), not linked. Every podkit user installs `ffmpeg` from
their OS package manager. The test VM mirrors that.

The runtime `libgpod4` package present in the test VM is **for `gpod-tool`
only**, the test helper that populates iPod databases. It is not in podkit's
critical path. ADR-016 §"Snapshot-based state layering" describes a
`base-no-libgpod` snapshot — implying libgpod IS present in the base VM and
gets removed for that snapshot. TASK-322.02 lands the snapshot setter.

### gpod-tool sourcing

`gpod-tool` is built by `tools/gpod-tool/Makefile` and dynamically links
libgpod-1.0 + glib-2.0. The host-side Linux build artefact is not yet wired
up — TASK-322.03 will produce one from `@podkit/gpod-testing` build outputs
and transfer it into the VM via `limactl copy` alongside the podkit binary.

Interim handoff contract:

- The yaml's second provision step copies `/tmp/gpod-tool` →
  `/usr/local/bin/gpod-tool` if the file exists when the VM boots.
- Developers needing `gpod-tool` today can stage it before boot:
  ```bash
  cp /path/to/linux-built-gpod-tool /tmp/gpod-tool   # on the VM after boot
  limactl shell podkit-device-harness -- sudo install -m 0755 /tmp/gpod-tool /usr/local/bin/gpod-tool
  ```
- Or post-boot via `limactl copy`, then `install`.

This contract will be replaced by TASK-322.03's `transferBinary` helper.

### SystemState fixtures and the `no-libgpod` case

The `no-libgpod` `SystemState` fixture (`test-packages/device-testing/src/system-
states/`) is intentionally **unit-test only** — not a VM snapshot. Because
the podkit binary statically links libgpod, removing the runtime `libgpod4`
package from the test VM does not change what `podkit doctor` reports for
the binary itself. The fixture exists to exercise the doctor parsing /
classification code (unit-test mocks), not to simulate a runtime where podkit
would actually fail. The `base-no-libgpod` snapshot named in ADR-016 only
exercises gpod-tool absence, not podkit's own linkage.

### Snapshot lifecycle and reprovisioning

> **Apple Silicon note (TASK-322.02.01):** the test VM is pinned to
> `vmType: vz` in `podkit-device-harness.yaml`. Lima 2.x's `vz` driver does not implement
> `limactl snapshot` — every call returns `unimplemented`. The orchestrator
> in `lima-test-vm-snapshots.ts` detects this and silently degrades to
> running `apply-state.sh` for every group restore. Measured cost on
> aarch64 is sub-2-second per state flip (~740ms reinstall, ~860ms
> purge+install), which is acceptable at the current matrix size — see
> ADR-016 §"Test speed strategy" for the full decision record.
>
> When the harness eventually runs on a Linux host or a `vmType: qemu`
> VM, the snapshot fast path automatically takes over — the code path
> below describes that future-but-also-Linux-host behaviour.

The test VM uses **named QEMU snapshots** for state layering (ADR-016
§"Snapshot-based state layering" / TASK-322.02). One snapshot per registered
`SystemState`, tagged `base-<state-id>`:

| Snapshot tag | Backing `SystemState` |
|--------------|------------------------|
| `base-healthy` | All packages installed, modules loaded, configfs mounted, udev rules in place |
| `base-no-ffmpeg` | `ffmpeg` purged |
| `base-no-libgpod` | `libgpod4` + `libgpod-common` purged (exercises gpod-tool failures; podkit itself statically links libgpod) |
| `base-no-udev` | libgpod-shipped udev rules moved aside |
| `base-no-sg-perms` | `/dev/sg*` group-access udev rule removed; existing nodes chmod'd to 0600 |
| `base-corrupt-configfs` | `/sys/kernel/config` unmounted |

**How snapshots are created.** The TypeScript orchestrator in
`test-packages/device-testing/src/runners/lima-test-vm-state.ts` (`applyState`)
does this in three steps:

1. Probe whether `base-<state-id>` already exists via
   `limactl snapshot list <vm> --quiet`.
2. If missing: restore `base-healthy` as a starting point (if it exists),
   then `limactl copy` the in-VM mutator script
   (`test-packages/device-testing/scripts/apply-state.sh`) and execute it under
   `sudo` to apply the state's mutations (apt, chmod, modprobe, umount, …).
3. Capture the resulting state with `limactl snapshot create <vm> --tag
   base-<state-id>`.

Subsequent test runs hit the fast path — a single
`limactl snapshot apply <vm> --tag base-<state-id>` call, typically <1s.

**When to reprovision.** Snapshots are tied to a specific VM disk image,
which in turn is pinned to a specific Debian point release (currently
12.10, set in `podkit-device-harness.yaml`). Snapshots become stale when:

- The Debian point release is bumped in `podkit-device-harness.yaml`.
- `apply-state.sh` semantics change (e.g. a new package added to the
  healthy state).
- The `SystemState` registry adds, removes, or renames a state.
- The kernel module list in
  `/etc/modules-load.d/podkit-device-harness.conf` changes.

In any of those cases, drop the existing snapshots and let the orchestrator
recreate them on the next test run:

```bash
# Inspect what's currently stored
limactl snapshot list podkit-device-harness

# Drop all base-* snapshots so apply-state.sh runs fresh next time
for tag in $(limactl snapshot list podkit-device-harness --quiet | grep '^base-'); do
  limactl snapshot delete podkit-device-harness --tag "$tag"
done

# Or nuke the VM entirely (slower; full re-provision on next boot)
bun run harness:destroy --yes
bun run harness:setup
```

Snapshots are stored inside the Lima VM's disk image — there are no extra
files to clean up after deletion. They are NOT shared across hosts; each
developer's VM rebuilds them on first use.

**Idempotency.** `apply-state.sh <state-id>` is idempotent — running it a
second time with the same id leaves the VM in the same end state and emits
"already applied" log lines instead of erroring. This means a partial
snapshot-creation failure (e.g. `limactl snapshot create` fails after the
mutation succeeded) can be recovered by simply running `applyState` again.

## Quick start

```bash
brew install lima

# 1) Produce a Linux binary via turbo (cached on the host).
# The builder VM is auto-created + auto-started on first invocation;
# the build-linux-*.sh scripts handle the lifecycle.
bunx turbo run @podkit/device-testing#build:linux-binary
# Output: packages/podkit-cli/bin/podkit-linux-<arch>

# Or, to build everything (binary + daemon + libgpod-node prebuild) + transfer
# it into the device-harness VM in one go:
bun run harness:install

# 3) (Optional) Verify ABI on a stock Debian VM
limactl start test-packages/device-testing/lima/podkit-abi-verify.yaml --name podkit-abi-verify
limactl copy packages/podkit-cli/bin/podkit-linux-x64  podkit-abi-verify:/tmp/podkit
limactl shell podkit-abi-verify -- sudo install -m 0755 /tmp/podkit /usr/local/bin/podkit
limactl shell podkit-abi-verify -- ldd /usr/local/bin/podkit
limactl shell podkit-abi-verify -- /usr/local/bin/podkit --version

# 4) Bring up the device-testing harness VM (lives separately from the builder)
bun run harness:setup                                       # create + start + install + status
limactl shell podkit-device-harness -- which bun node npm   # must return empty
```

## Build pipeline (single source of truth)

```
turbo task
    ↓
@podkit/device-testing#build:linux-prebuild
    ↓ (host)
test-packages/device-testing/scripts/build-linux-prebuild.sh
    ↓ (limactl shell podkit-linux-builder)
tools/prebuild/build-linux-glibc.sh    ←──── SHARED with .github/workflows/prebuild.yml
    ↓
tools/prebuild/build-static-deps.sh    ←──── SHARED with prebuild.yml + build-platform.yml
    ↓
npx prebuildify --napi --strip
    ↓
packages/libgpod-node/prebuilds/linux-${arch}/*.node
    ↓
@podkit/device-testing#build:linux-binary
    ↓ (limactl shell podkit-linux-builder)
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
  `test-packages/device-testing/lima/podkit-linux-builder.yaml`. Cache hit = no VM invocation.
- `@podkit/device-testing#build:linux-binary` — depends on the prebuild task
  plus the TypeScript source set.

Both tasks hash the `PODKIT_HOST_ARCH` env var into the cache key so a remote
cache shared across arm64 and x86_64 hosts does not surface a wrong-arch
binary on cache hit. `bun run harness:install` sets this automatically from
`process.arch`. If invoking `bunx turbo` directly, export it first:

```bash
export PODKIT_HOST_ARCH=$(uname -m)
bunx turbo run @podkit/device-testing#build:linux-binary
```

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
bun run harness:builder:destroy
bun run harness:install               # recreates on first run
```

### Version mismatch (different Debian point release)
Both `podkit-linux-builder.yaml` and `podkit-abi-verify.yaml` pin Debian 12.10 via explicit
cloud-image URLs. If you bump one, bump both, and run the ABI spike again to
confirm the build artefacts still load.

### Native binding fails to load inside the binary
Re-run with verification skipped, then inspect the .node file:
```bash
SKIP_VERIFY=1 limactl shell podkit-linux-builder -- bash tools/prebuild/build-linux-glibc.sh
limactl shell podkit-linux-builder -- ldd packages/libgpod-node/prebuilds/linux-*/*.node
```
Any `libgpod`, `libgdk_pixbuf`, `libglib`, or `libplist` line indicates a
build regression in `build-static-deps.sh`.

## References

- [ADR-016](../../../adr/adr-016-linux-vm-test-harness.md) §"Builder VM /
  test VM split" — why these VMs exist.
- [ADR-016](../../../adr/adr-016-linux-vm-test-harness.md) §"Build tooling:
  one implementation, two callers" — the single-source-of-truth invariant.
- `tools/lima/README.md` — the cross-platform test VMs (different concern).
- `tools/lima/podkit-virtual-ipod.yaml` — the demo VM (off-limits per ADR-016).
- `.github/workflows/prebuild.yml` — the CI workflow that shares
  `build-linux-glibc.sh` with this VM.
