#!/usr/bin/env bash
#
# Turbo task: @podkit/device-testing#build:linux-prebuild
#
# Runs on the macOS host. Boots/uses the Lima `builder` VM and invokes the
# shared script tools/prebuild/build-linux-glibc.sh inside it to produce a
# linux-${arch} libgpod-node prebuild at:
#
#   packages/libgpod-node/prebuilds/linux-x64/...node
#
# Build strategy: rsync the repo into a VM-local tree under /tmp, run the
# build there, then copy the resulting prebuild back to the host. This
# mirrors the pattern in build-linux-binary.sh (its sibling script).
#
# Why VM-local instead of building in the host-mounted source tree:
#   node-gyp writes absolute paths into build/*.d dep files and config.gypi
#   — paths like /Users/.../node_modules/.bun/node-gyp@<hash> (host) and
#   /tmp/prebuildify/node/<ver> (VM). When build/ lives on the host-mounted
#   FS, those baked paths reference filesystems that don't exist on the
#   other side, and `--force` reruns hit stale-state link failures. A
#   VM-local tree keeps the dep graph internally coherent and makes every
#   rerun reproducible.
#
# Turbo hashes the inputs declared in turbo.json (libgpod-node native +
# binding.gyp + tools/prebuild/** + podkit-builder-glibc.yaml) and skips this entire
# step on a cache hit.
#
# The builder VM is created on first use and left running between
# invocations — the host's turbo cache is what speeds things up; the VM
# is just where the compiler lives.

set -euo pipefail

VM_NAME="${BUILDER_VM_NAME:-podkit-builder-glibc}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PODKIT_VM=(bun "$REPO_ROOT/test-packages/lima/src/cli.ts")

log() { echo "==> [build:linux-prebuild] $1"; }

if ! command -v limactl >/dev/null 2>&1; then
  echo "ERROR: limactl not found. Install with: brew install lima" >&2
  exit 1
fi

# Create-or-start the builder VM. `ensure` holds the shared cross-process
# advisory lock across the whole check-then-act, so a concurrently-scheduled
# turbo task that needs the same instance (gpod-testing#build:linux-binary)
# waits rather than racing the hostagent pidfile — and, because ensure CREATES
# when the instance is absent, either task may legitimately be the first to
# reach a cold host.
"${PODKIT_VM[@]}" ensure "$VM_NAME"

# VM-local build tree. Note: /tmp inside the VM is VM-local tmpfs (or ext4
# on /), NOT a host mount. Anything written here is invisible to macOS until
# we explicitly copy it back via the host-mounted prebuilds dir.
VM_SRC=/tmp/podkit-libgpod-build
HOST_PREBUILDS="$REPO_ROOT/packages/libgpod-node/prebuilds"

# Host-side variables are passed into the single-quoted heredocs via the
# `bash -c '...' _ "$VAR" ...` positional-arg pattern. Inside the heredoc
# they bind to $1, $2, etc. — keeping the in-VM script body single-quoted
# means every $VAR inside expands in the VM realm without host/VM confusion.
# Matches the style of build-linux-binary.sh.

# The shared exclude floor (node_modules, .turbo, dist, .git, host bin dirs,
# libgpod-node/build, ...) lives in @podkit/lima's stageSourceTree. The one
# exclude specific to a PREBUILD run is prebuilds/ itself: the whole point of
# this rebuild is to start clean and copy the fresh artefact back.
"${PODKIT_VM[@]}" stage "$VM_NAME" \
  --src "$REPO_ROOT" \
  --dest "$VM_SRC" \
  --exclude "packages/libgpod-node/prebuilds"

log "running build-linux-glibc.sh inside '$VM_NAME'..."
limactl shell --workdir "$VM_SRC" "$VM_NAME" bash -c '
  set -euo pipefail
  HOST_PREBUILDS=$1
  export PATH="/usr/local/bin:$HOME/.bun/bin:$PATH"
  # Static-deps cache lives in the user home (NOT in the build tree) so it
  # survives rsync --delete and is reused across rebuilds. WORK_DIR likewise.
  export STATIC_DEPS_DIR="${STATIC_DEPS_DIR:-$HOME/.cache/podkit-static-deps}"
  export WORK_DIR="${WORK_DIR:-$HOME/.cache/podkit-prebuild-work}"
  mkdir -p "$STATIC_DEPS_DIR" "$WORK_DIR"

  case "$(uname -m)" in
    x86_64)  arch=x64 ;;
    aarch64) arch=arm64 ;;
    *)
      echo "ERROR: unsupported builder arch $(uname -m)" >&2
      exit 1
      ;;
  esac

  # bun install in-VM so node_modules/.bun/node-gyp@<hash> + node-addon-api
  # paths baked into the build are VM-local and consistent with the compile
  # environment. --ignore-scripts skips libgpod-node postinstall (we do the
  # native build explicitly via build-linux-glibc.sh next).
  bun install --frozen-lockfile --ignore-scripts

  bash tools/prebuild/build-linux-glibc.sh

  # Copy the finished prebuild from the VM-local build tree back to the
  # host-mounted source tree. The host mount is reachable from inside the
  # VM at the same path Lima provides. Only the *final artifact* crosses
  # the realm boundary — the build/ intermediates (the source of the
  # stale-state link failures explained above) stay VM-local.
  mkdir -p "$HOST_PREBUILDS/linux-$arch"
  cp -fv "packages/libgpod-node/prebuilds/linux-$arch"/*.node \
    "$HOST_PREBUILDS/linux-$arch/"

  echo "==> [build:linux-prebuild-vm] copied to $HOST_PREBUILDS/linux-$arch/"
' _ "$HOST_PREBUILDS"

log "done"
