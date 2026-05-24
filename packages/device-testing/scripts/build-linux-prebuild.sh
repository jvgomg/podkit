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
# Turbo hashes the inputs declared in turbo.json (libgpod-node native +
# binding.gyp + tools/prebuild/** + podkit-linux-builder.yaml) and skips this entire
# step on a cache hit.
#
# The builder VM is created on first use and left running between
# invocations — the host's turbo cache is what speeds things up; the VM
# is just where the compiler lives.

set -euo pipefail

VM_NAME="${BUILDER_VM_NAME:-podkit-linux-builder}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
BUILDER_YAML="$REPO_ROOT/tools/device-testing/lima/podkit-linux-builder.yaml"

log() { echo "==> [build:linux-prebuild] $1"; }

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
    limactl start --name="$VM_NAME" "$BUILDER_YAML"
    ;;
  *)
    log "builder VM '$VM_NAME' in state '$status'; recreating..."
    limactl delete "$VM_NAME" --force 2>/dev/null || true
    limactl start --name="$VM_NAME" "$BUILDER_YAML"
    ;;
esac

# Resolve the absolute path of the repo inside the VM. Lima mounts $HOME
# transparently, so the host path is reachable as-is from inside the VM.
# NOTE: Lima 2.x requires `--workdir` to appear BEFORE the instance name, and
# does NOT use `--` as a separator (it would be passed to the command and
# bash would reject it as an invalid option).
log "running build-linux-glibc.sh inside '$VM_NAME'..."
limactl shell --workdir "$REPO_ROOT" "$VM_NAME" bash -c '
  set -euo pipefail
  export PATH="/usr/local/bin:$PATH"
  export STATIC_DEPS_DIR="${STATIC_DEPS_DIR:-$HOME/.cache/podkit-static-deps}"
  export WORK_DIR="${WORK_DIR:-$HOME/.cache/podkit-prebuild-work}"
  mkdir -p "$STATIC_DEPS_DIR" "$WORK_DIR"
  bash tools/prebuild/build-linux-glibc.sh
'

log "done"
