#!/usr/bin/env bash
#
# Turbo task: @podkit/device-testing#build:musl-prebuild
#
# Runs on the macOS host. Boots/uses the Lima Alpine `musl-builder` VM and
# invokes the shared script tools/prebuild/build-linux-musl.sh inside it to
# produce a linux-${arch}-musl libgpod-node prebuild at:
#
#   packages/libgpod-node/prebuilds/linux-arm64-musl/...node
#
# This is the musl sibling of build-linux-prebuild.sh — same VM-local rsync
# strategy, same reasoning (node-gyp bakes absolute paths, so a host-mounted
# build tree produces stale-state link failures on rerun). Only the VM name,
# builder yaml, VM-local dir, invoked script, and the `-musl` prebuild dir
# copied back differ.

set -euo pipefail

VM_NAME="${MUSL_BUILDER_VM_NAME:-podkit-builder-musl}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
PODKIT_VM=(bun "$REPO_ROOT/test-packages/lima/src/cli.ts")

log() { echo "==> [build:musl-prebuild] $1"; }

if ! command -v limactl >/dev/null 2>&1; then
  echo "ERROR: limactl not found. Install with: brew install lima" >&2
  exit 1
fi

# Create-or-start the musl builder VM through the shared advisory lock (the
# same one every other starter of this instance uses).
"${PODKIT_VM[@]}" ensure "$VM_NAME"

# VM-local build tree (VM-local tmpfs/ext4, NOT a host mount). Only the final
# prebuild artifact crosses back to the host via the host-mounted prebuilds dir.
VM_SRC=/tmp/podkit-musl-libgpod-build
HOST_PREBUILDS="$REPO_ROOT/packages/libgpod-node/prebuilds"

# Stage the source into the VM-local tree. Same shared exclude floor as the
# glibc prebuild; prebuilds/ is pruned because this run produces it.
"${PODKIT_VM[@]}" stage "$VM_NAME" \
  --src "$REPO_ROOT" \
  --dest "$VM_SRC" \
  --exclude "packages/libgpod-node/prebuilds"

log "running build-linux-musl.sh inside '$VM_NAME'..."
limactl shell --workdir "$VM_SRC" "$VM_NAME" bash -c '
  set -euo pipefail
  HOST_PREBUILDS=$1
  export PATH="/usr/local/bin:$HOME/.bun/bin:$PATH"
  # Static-deps cache lives in the user home (NOT the build tree) so it
  # survives rsync --delete and is reused across rebuilds. WORK_DIR likewise.
  export STATIC_DEPS_DIR="${STATIC_DEPS_DIR:-$HOME/.cache/podkit-static-deps-musl}"
  export WORK_DIR="${WORK_DIR:-$HOME/.cache/podkit-prebuild-work-musl}"
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
  # paths baked into the build are VM-local. --ignore-scripts skips
  # libgpod-node postinstall (native build is done explicitly next).
  bun install --frozen-lockfile --ignore-scripts

  bash tools/prebuild/build-linux-musl.sh

  # Copy the finished -musl prebuild back to the host-mounted source tree.
  mkdir -p "$HOST_PREBUILDS/linux-$arch-musl"
  cp -fv "packages/libgpod-node/prebuilds/linux-$arch-musl"/*.node \
    "$HOST_PREBUILDS/linux-$arch-musl/"

  echo "==> [build:musl-prebuild-vm] copied to $HOST_PREBUILDS/linux-$arch-musl/"
' _ "$HOST_PREBUILDS"

log "done"
