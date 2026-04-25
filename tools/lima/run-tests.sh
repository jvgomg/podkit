#!/usr/bin/env bash
#
# Run the podkit test suite inside Lima VMs.
#
# The repo is rsynced to a VM-local directory to avoid overwriting
# macOS native binaries (the Lima filesystem mount is shared).
#
# Usage:
#   ./tools/lima/run-tests.sh              # Both VMs
#   ./tools/lima/run-tests.sh debian       # Debian only
#   ./tools/lima/run-tests.sh alpine       # Alpine only
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LIMA_DIR="$REPO_DIR/tools/lima"
VM_WORK_DIR="/tmp/podkit-test"

ensure_vm() {
  local name=$1 config=$2

  if ! command -v limactl &>/dev/null; then
    echo "ERROR: limactl not found. Install with: brew install lima" >&2
    exit 1
  fi

  local status
  status=$(limactl list --format '{{.Status}}' "$name" 2>/dev/null || echo "NotFound")

  if [ "$status" != "NotFound" ]; then
    case "$status" in
      Running)
        echo "$name is already running."
        ;;
      Stopped)
        echo "Starting $name..."
        limactl start "$name"
        ;;
      *)
        # Broken/degraded state — recreate
        echo "$name is in state '$status', recreating..."
        limactl delete "$name" --force 2>/dev/null || true
        limactl start "$config" --name="$name"
        ;;
    esac
  else
    echo "Creating $name (this takes a few minutes on first run)..."
    limactl start "$config" --name="$name"
  fi
}

run_tests() {
  local name=$1
  echo ""
  echo "=== Running tests on $name ==="
  echo "Syncing repo to VM-local directory..."

  # rsync source to VM-local disk to avoid overwriting macOS native binaries.
  # Excludes node_modules and build artifacts — bun install runs fresh in the VM.
  limactl shell "$name" -- bash -c "
    set -e
    export PATH=\$HOME/.bun/bin:\$PATH

    mkdir -p $VM_WORK_DIR
    rsync -a --delete \
      --exclude node_modules \
      --exclude .turbo \
      --exclude dist \
      --exclude build \
      --exclude 'packages/*/dist' \
      --exclude 'packages/libgpod-node/build' \
      --exclude 'packages/libgpod-node/prebuilds' \
      --exclude 'packages/demo/bin' \
      --exclude 'packages/podkit-cli/bin' \
      --exclude 'bin/' \
      --exclude 'tools/gpod-tool/gpod-tool' \
      --exclude 'tools/gpod-tool/*.o' \
      '$REPO_DIR/' '$VM_WORK_DIR/'

    cd '$VM_WORK_DIR'
    rm -rf .turbo
    bun install

    # Build native tools and bindings (needed for integration tests)
    make -C tools/gpod-tool clean 2>/dev/null || true
    make -C tools/gpod-tool
    mkdir -p bin
    cp tools/gpod-tool/gpod-tool bin/
    export PATH=\$PWD/bin:\$PATH

    # Build libgpod-node native binding for this platform
    cd packages/libgpod-node && node-gyp rebuild && cd \$OLDPWD

    bun run test --filter @podkit/core
  "

  echo "=== $name: PASSED ==="
}

target="${1:-all}"

case "$target" in
  debian)
    ensure_vm "podkit-debian" "$LIMA_DIR/debian.yaml"
    run_tests "podkit-debian"
    ;;
  alpine)
    ensure_vm "podkit-alpine" "$LIMA_DIR/alpine.yaml"
    run_tests "podkit-alpine"
    ;;
  all)
    ensure_vm "podkit-debian" "$LIMA_DIR/debian.yaml"
    ensure_vm "podkit-alpine" "$LIMA_DIR/alpine.yaml"
    run_tests "podkit-debian"
    run_tests "podkit-alpine"
    echo ""
    echo "All Linux tests passed."
    ;;
  *)
    echo "Usage: $0 [debian|alpine|all]" >&2
    exit 1
    ;;
esac
