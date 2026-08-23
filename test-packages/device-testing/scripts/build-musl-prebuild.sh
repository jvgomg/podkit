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
BUILDER_YAML="$REPO_ROOT/test-packages/lima/vms/podkit-builder-musl.yaml"

log() { echo "==> [build:musl-prebuild] $1"; }

if ! command -v limactl >/dev/null 2>&1; then
  echo "ERROR: limactl not found. Install with: brew install lima" >&2
  exit 1
fi

# Ensure the builder VM exists and is running.
status=$(limactl list --format '{{.Status}}' "$VM_NAME" 2>/dev/null || echo "NotFound")
case "$status" in
  Running)
    log "builder VM '$VM_NAME' already running"
    ;;
  Stopped)
    log "starting builder VM '$VM_NAME'..."
    limactl start "$VM_NAME"
    ;;
  NotFound)
    log "creating builder VM '$VM_NAME' (first run takes 5-10 min)..."
    limactl start --tty=false --name="$VM_NAME" "$BUILDER_YAML"
    ;;
  *)
    log "builder VM '$VM_NAME' in state '$status'; recreating..."
    limactl delete "$VM_NAME" --force 2>/dev/null || true
    limactl start --tty=false --name="$VM_NAME" "$BUILDER_YAML"
    ;;
esac

# VM-local build tree (VM-local tmpfs/ext4, NOT a host mount). Only the final
# prebuild artifact crosses back to the host via the host-mounted prebuilds dir.
VM_SRC=/tmp/podkit-musl-libgpod-build
HOST_PREBUILDS="$REPO_ROOT/packages/libgpod-node/prebuilds"

log "rsyncing source to '${VM_NAME}:${VM_SRC}'..."
# Excludes mirror build-linux-prebuild.sh. Exit 24 ('some files vanished') is a
# benign race with macOS-side processes; tolerate 24, fail any other non-zero.
limactl shell --workdir "$REPO_ROOT" "$VM_NAME" bash -c '
  set -uo pipefail
  REPO_ROOT=$1
  VM_SRC=$2
  mkdir -p "$VM_SRC"
  rsync -a --delete \
    --exclude node_modules \
    --exclude .turbo \
    --exclude dist \
    --exclude .git \
    --exclude "packages/libgpod-node/build" \
    --exclude "packages/libgpod-node/prebuilds" \
    --exclude "packages/podkit-cli/bin" \
    --exclude "packages/demo/bin" \
    --exclude "packages/ipod-db/fixtures/databases" \
    --exclude "tools/libgpod-macos/build" \
    --exclude "*.bun-build" \
    --exclude "*.img" \
    --exclude "src-tauri/target" \
    "$REPO_ROOT/" "$VM_SRC/"
  rc=$?
  if [ "$rc" -ne 0 ] && [ "$rc" -ne 24 ]; then exit "$rc"; fi
' _ "$REPO_ROOT" "$VM_SRC"

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
