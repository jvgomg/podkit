#!/usr/bin/env bash
#
# Run the podkit test suite inside Lima VMs.
#
# The repo is rsynced to a VM-local directory (declared in @podkit/lima's
# staging-area registry, one directory per VM) — host's
# macOS native binaries and node_modules are excluded so the VM rebuilds
# fresh against its own libc. Turbo cache lives outside the source tree
# at $HOME/.cache/podkit-turbo so it survives `limactl stop/start` and is
# never touched by `rsync --delete`. Only `limactl delete` (or
# `mise run test:linux:cache:clear`) wipes it.
#
# VM names:
#   podkit-test-glibc — glibc, general Linux env
#   podkit-test-musl — musl, Docker image parity check
#
# Usage:
#   ./tools/lima/run-tests.sh              # Both VMs
#   ./tools/lima/run-tests.sh debian       # Debian only
#   ./tools/lima/run-tests.sh alpine       # Alpine only
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
VM_TURBO_CACHE='$HOME/.cache/podkit-turbo'
PODKIT_VM=(bun "$REPO_DIR/test-packages/lima/src/cli.ts")

# Extra prunes on top of the shared exclude floor that @podkit/lima applies to
# every staged tree. The test VMs rebuild everything from source and run the
# suite, so this run strips documentation, generated fixtures and every build
# output the VM is about to regenerate — weight the build wrappers keep because
# they need a `bun install --frozen-lockfile` to resolve every workspace.
TEST_VM_EXCLUDES=(
  --exclude '.claude/'
  --exclude '.changeset/.cache/'
  --exclude 'build/'
  --exclude 'bin/'
  --exclude 'target/'
  --exclude 'packages/libgpod-node/prebuilds/'
  --exclude 'test-packages/gpod-testing/templates/'
  --exclude 'packages/demo/demo.gif'
  --exclude 'packages/docs-site/'
  --exclude 'tools/gpod-tool/gpod-tool'
  --exclude 'tools/gpod-tool/*.o'
  --exclude 'tools/libgpod-macos/'
  --exclude 'docs/'
  --exclude 'adr/'
  --exclude 'backlog/'
  --exclude 'devices/'
  --exclude 'test/manual-collection/'
)

# Create-or-start a test VM through the shared advisory lock — the same lock
# every other VM starter in the repo uses, so a `mise run test:linux` racing a
# builder task or a `vm:up` cannot double-start an instance.
ensure_vm() {
  local name=$1

  if ! command -v limactl &>/dev/null; then
    echo "ERROR: limactl not found. Install with: brew install lima" >&2
    exit 1
  fi

  "${PODKIT_VM[@]}" ensure "$name"
}

run_tests() {
  local name=$1
  local area=$2
  # The VM-local destination is declared in @podkit/lima's staging-area
  # registry rather than spelled here, so no two callers can end up rsyncing
  # into the same tree.
  local VM_WORK_DIR
  VM_WORK_DIR="$("${PODKIT_VM[@]}" stage-path "$name" --area "$area")"

  echo ""
  echo "=== Running tests on $name ==="
  echo "Syncing repo to VM-local directory ($VM_WORK_DIR)..."

  # Staging goes through the shared helper: one exclude floor, one rsync
  # exit-24 tolerance. Turbo cache lives at $HOME/.cache/podkit-turbo (outside
  # the staged directory) so --delete cannot touch it.
  "${PODKIT_VM[@]}" stage "$name" \
    --src "$REPO_DIR" \
    --dest "$VM_WORK_DIR" \
    "${TEST_VM_EXCLUDES[@]}"

  limactl shell "$name" -- bash -c "
    set -e
    export PATH=\$HOME/.bun/bin:\$PATH
    export TURBO_CACHE_DIR=$VM_TURBO_CACHE
    mkdir -p \$TURBO_CACHE_DIR

    cd '$VM_WORK_DIR'
    bun install

    # Build native tools and bindings (needed for integration tests).
    # Turbo will skip these on cache hit when sources are unchanged.
    make -C tools/gpod-tool clean 2>/dev/null || true
    make -C tools/gpod-tool
    mkdir -p bin
    cp tools/gpod-tool/gpod-tool bin/
    export PATH=\$PWD/bin:\$PATH

    # Build the libgpod-node native binding. Use \`bun run --cwd\` so
    # node_modules/.bin is on PATH (node-gyp is a workspace devDep). Avoid
    # \`cd a && cmd && cd b\` chains: bash skips \`set -e\` on non-final
    # commands in && lists, so a node-gyp failure would silently fall
    # through to the test run.
    bun run --cwd packages/libgpod-node build:native

    # Runtime smoke (TASK-472): compile the single-file binary and drive it
    # through the native libgpod path + the libudev-less firmware-inquiry
    # degrade — the same shared script CI runs, now on this VM's real libc.
    # Run it BEFORE the full suite so an unrelated flaky package test can't
    # mask the distribution smoke (it only needs the native binding, already
    # built above).
    command -v jq >/dev/null 2>&1 || if command -v apk >/dev/null 2>&1; then sudo apk add --no-cache jq; else sudo apt-get update -qq && sudo apt-get install -y -qq jq; fi
    bun run compile
    bash test-packages/e2e-shared/scripts/runtime-smoke.sh packages/podkit-cli/bin/podkit

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
    ensure_vm "podkit-test-glibc"
    run_tests "podkit-test-glibc" testGlibc
    ;;
  alpine)
    ensure_vm "podkit-test-musl"
    run_tests "podkit-test-musl" testMusl
    ;;
  all)
    ensure_vm "podkit-test-glibc"
    ensure_vm "podkit-test-musl"
    run_tests "podkit-test-glibc" testGlibc
    run_tests "podkit-test-musl" testMusl
    echo ""
    echo "All Linux tests passed."
    ;;
  *)
    echo "Usage: $0 [debian|alpine|all]" >&2
    exit 1
    ;;
esac
