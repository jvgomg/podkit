#!/usr/bin/env bash
#
# Run the podkit test suite inside Lima VMs.
#
# Usage:
#   ./tools/lima/run-tests.sh              # Both VMs
#   ./tools/lima/run-tests.sh debian       # Debian only
#   ./tools/lima/run-tests.sh alpine       # Alpine only
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LIMA_DIR="$REPO_DIR/tools/lima"

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
  limactl shell "$name" -- bash -c "export PATH=\$HOME/.bun/bin:\$PATH && cd '$REPO_DIR' && bun install --frozen-lockfile && bun run test --filter @podkit/core"
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
