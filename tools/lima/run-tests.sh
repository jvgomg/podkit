#!/usr/bin/env bash
#
# Run the podkit test suite inside Lima VMs.
#
# The repo is rsynced to a VM-local directory (/tmp/podkit-test) — host's
# macOS native binaries and node_modules are excluded so the VM rebuilds
# fresh against its own libc. Turbo cache lives outside the source tree
# at $HOME/.cache/podkit-turbo so it survives `limactl stop/start` and is
# never touched by `rsync --delete`. Only `limactl delete` (or
# `mise run test:linux:cache:clear`) wipes it.
#
# VM names:
#   linux-tests-debian — glibc, general Linux env
#   linux-tests-alpine — musl, Docker image parity check
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
VM_TURBO_CACHE='$HOME/.cache/podkit-turbo'

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

  # rsync is intentionally aggressive with excludes: only ship sources, configs,
  # and the few asset directories tests actually need. Everything build-related
  # is rebuilt inside the VM. Turbo cache lives at $HOME/.cache/podkit-turbo
  # (outside this directory) so --delete cannot touch it.
  limactl shell "$name" -- bash -c "
    set -e
    export PATH=\$HOME/.bun/bin:\$PATH
    export TURBO_CACHE_DIR=$VM_TURBO_CACHE
    mkdir -p \$TURBO_CACHE_DIR

    mkdir -p $VM_WORK_DIR
    rsync -a --delete \
      --exclude '.git/' \
      --exclude 'node_modules/' \
      --exclude '.turbo/' \
      --exclude '.claude/' \
      --exclude '.changeset/.cache/' \
      --exclude 'dist/' \
      --exclude 'build/' \
      --exclude 'bin/' \
      --exclude 'packages/*/dist/' \
      --exclude 'packages/*/build/' \
      --exclude 'packages/*/bin/' \
      --exclude 'packages/*/.turbo/' \
      --exclude 'packages/libgpod-node/prebuilds/' \
      --exclude 'packages/gpod-testing/templates/' \
      --exclude 'packages/ipod-db/fixtures/databases/' \
      --exclude 'packages/demo/demo.gif' \
      --exclude 'packages/docs-site/' \
      --exclude 'tools/gpod-tool/gpod-tool' \
      --exclude 'tools/gpod-tool/*.o' \
      --exclude 'tools/libgpod-macos/' \
      --exclude 'docs/' \
      --exclude 'adr/' \
      --exclude 'backlog/' \
      --exclude 'devices/' \
      --exclude 'test/manual-collection/' \
      '$REPO_DIR/' '$VM_WORK_DIR/'

    cd '$VM_WORK_DIR'
    bun install

    # Build native tools and bindings (needed for integration tests).
    # Turbo will skip these on cache hit when sources are unchanged.
    make -C tools/gpod-tool clean 2>/dev/null || true
    make -C tools/gpod-tool
    mkdir -p bin
    cp tools/gpod-tool/gpod-tool bin/
    export PATH=\$PWD/bin:\$PATH

    cd packages/libgpod-node && node-gyp rebuild && cd \$OLDPWD

    # Run the full suite (unit + integration across every workspace package).
    # Turbo's content-hashed cache (at \$TURBO_CACHE_DIR) means unchanged
    # packages are skipped on re-runs.
    bun run test
  "

  echo "=== $name: PASSED ==="
}

target="${1:-all}"

case "$target" in
  debian)
    ensure_vm "linux-tests-debian" "$LIMA_DIR/debian.yaml"
    run_tests "linux-tests-debian"
    ;;
  alpine)
    ensure_vm "linux-tests-alpine" "$LIMA_DIR/alpine.yaml"
    run_tests "linux-tests-alpine"
    ;;
  all)
    ensure_vm "linux-tests-debian" "$LIMA_DIR/debian.yaml"
    ensure_vm "linux-tests-alpine" "$LIMA_DIR/alpine.yaml"
    run_tests "linux-tests-debian"
    run_tests "linux-tests-alpine"
    echo ""
    echo "All Linux tests passed."
    ;;
  *)
    echo "Usage: $0 [debian|alpine|all]" >&2
    exit 1
    ;;
esac
