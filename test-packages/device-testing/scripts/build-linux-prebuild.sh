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
BUILDER_YAML="$REPO_ROOT/test-packages/lima/vms/podkit-builder-glibc.yaml"

log() { echo "==> [build:linux-prebuild] $1"; }

if ! command -v limactl >/dev/null 2>&1; then
  echo "ERROR: limactl not found. Install with: brew install lima" >&2
  exit 1
fi

# Ensure the builder VM exists and is running. The whole check-then-start is
# serialised by a cross-process lock so a concurrent turbo task (e.g.
# gpod-testing#build:linux-binary) can't start the same instance at the same
# moment and crash the hostagent. Read status INSIDE the lock so the decision
# is atomic with the action.
source "$SCRIPT_DIR/vm-builder-lock.sh"
acquire_vm_lock "$VM_NAME"
trap 'release_vm_lock "$VM_NAME"' EXIT
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
release_vm_lock "$VM_NAME"
trap - EXIT

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

log "rsyncing source to '${VM_NAME}:${VM_SRC}'..."
# Excludes match the macOS-side files that must NOT leak into the VM build:
#   - node_modules: contains host-arch native bindings + Bun's content-
#     addressed .bun/node-gyp@<hash> dirs — we run a fresh `bun install`
#     in-VM below so node-gyp paths are coherent for the VM realm.
#   - .turbo: host-arch task hashes are meaningless in the VM.
#   - build/ + prebuilds/: previous run's intermediates; the WHOLE POINT
#     of this rebuild is to start clean.
#   - dist/.git/bin/big test assets: weight without value to the build.
# Exit 24 ('some files vanished before they could be transferred') is a
# benign race with macOS-side processes touching files during rsync; tolerate
# 24, fail any other non-zero exit.
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
