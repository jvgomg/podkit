#!/usr/bin/env bash
#
# Turbo task: @podkit/device-testing#build:linux-binary
#
# Runs on the macOS host. Uses the Lima `builder` VM (already provisioned
# by `build:linux-prebuild`) to run:
#
#   bun install (in-VM)
#   bunx turbo run build --filter=!@podkit/docs-site
#   bash packages/podkit-cli/scripts/compile.sh
#
# The resulting binary is moved to:
#
#   packages/podkit-cli/bin/podkit-linux-${arch}
#
# This matches the naming pattern declared in turbo.json's `outputs` glob
# (packages/podkit-cli/bin/podkit-linux-*).
#
# `compile.sh` itself writes to `packages/podkit-cli/bin/podkit` — we rename
# afterwards so the macOS `bun run compile` output (also `bin/podkit`) is
# not clobbered by host-side reuse of the same target.

set -euo pipefail

VM_NAME="${BUILDER_VM_NAME:-podkit-builder-glibc}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI_BIN_DIR="$REPO_ROOT/packages/podkit-cli/bin"
PODKIT_VM=(bun "$REPO_ROOT/test-packages/lima/src/cli.ts")

log() { echo "==> [build:linux-binary] $1"; }

if ! command -v limactl >/dev/null 2>&1; then
  echo "ERROR: limactl not found. Install with: brew install lima" >&2
  exit 1
fi

# Create-or-start the builder VM through the shared advisory lock. This task is
# DAG-ordered after build:linux-prebuild, but turbo caching means the prebuild
# can be a cache hit (VM never started) while this task is a miss — so it needs
# a real start path of its own, not an assume-running guard.
"${PODKIT_VM[@]}" ensure "$VM_NAME"

# Detect target arch from inside the VM (matches what `bun build --compile`
# will produce). Lima may run an arm64 image on Apple Silicon and an x64
# image on Intel — `compile.sh` picks the right prebuild from /podkit's
# packages/libgpod-node/prebuilds based on `process.arch`.
TARGET_ARCH="$(limactl shell "$VM_NAME" bash -c "uname -m")"
case "$TARGET_ARCH" in
  x86_64)  NODE_ARCH=x64 ;;
  aarch64) NODE_ARCH=arm64 ;;
  *)
    echo "ERROR: unsupported builder arch '$TARGET_ARCH'." >&2
    exit 1
    ;;
esac

# Build inside a VM-local copy of the source tree, NOT against the macOS-
# mounted repo. An earlier version of this script ran `bun install` directly
# in $REPO_ROOT (which Lima mounts read-write from macOS) and symlink-
# redirected node_modules to a /tmp path inside the VM. Both the symlink
# creation and the `mv node_modules /tmp/...-saved` happened in the host-
# mounted tree, leaving the host with a broken symlink to a VM-only path and
# the macOS-side node_modules destroyed (moved into the VM's tmpfs). Use a
# fully VM-local checkout to make the host tree untouchable by the build.
VM_SRC=/tmp/podkit-builder-src
VM_BIN_DIR="$VM_SRC/packages/podkit-cli/bin"

# Stage the source into the VM-local tree. The shared exclude floor lives in
# @podkit/lima's stageSourceTree; prebuilds/ is deliberately NOT excluded — the
# glibc .node built by build:linux-prebuild must ride along so compile.sh can
# embed it.
"${PODKIT_VM[@]}" stage "$VM_NAME" --src "$REPO_ROOT" --dest "$VM_SRC"

log "compiling podkit binary inside '$VM_NAME' (target=linux-${NODE_ARCH})..."
limactl shell --workdir "$VM_SRC" "$VM_NAME" bash -c '
  set -euo pipefail
  export PATH="/usr/local/bin:$HOME/.bun/bin:$PATH"

  bun install --frozen-lockfile --ignore-scripts

  echo "==> building TS packages..."
  bunx turbo run build --filter=!@podkit/docs-site --filter=!@podkit/virtual-ipod-app --filter=!@podkit/ipod-web --filter=!@podkit/demo

  echo "==> compiling podkit binary (production)..."
  bash packages/podkit-cli/scripts/compile.sh

  echo "==> verifying podkit binary..."
  packages/podkit-cli/bin/podkit --version
  ldd packages/podkit-cli/bin/podkit || true
  if ldd packages/podkit-cli/bin/podkit 2>/dev/null | grep -E "libgpod|libgdk_pixbuf|libglib|libgobject|libgio|libgmodule|libffi|libplist|libxml2|libsqlite|libpcre2|libpng|libjpeg|libtiff"; then
    echo "ERROR: podkit binary has unexpected dynamic dependencies." >&2
    exit 1
  fi

  # Debug binary — same source, hooks active. Tests that need the
  # devPause(key) primitive (see documents/architecture/dev-builds.md)
  # opt into bin/podkit-debug via the e2e cli runner. Production
  # binary above is unaffected — the `--define __PODKIT_DEV_HOOKS__=false`
  # path in compile.sh tree-shakes the hook bodies away there.
  echo "==> compiling podkit binary (debug)..."
  PODKIT_DEV_HOOKS=1 bash packages/podkit-cli/scripts/compile.sh

  echo "==> verifying podkit-debug binary..."
  packages/podkit-cli/bin/podkit-debug --version

  # Daemon binary — compiled natively in-VM so its bundled koffi native
  # assets are the correct linux prebuild. A plain `bun build --compile`
  # (the daemon package'"'"'s `compile` script) is correct here: the daemon
  # never reaches loadUsb at runtime (it shells out to the podkit CLI), so
  # the usb bundler-plugin is deliberately NOT applied.
  echo "==> compiling podkit-daemon binary..."
  ( cd packages/podkit-daemon && bun run compile )

  echo "==> verifying podkit-daemon binary is a linux ELF..."
  # Do NOT execute the daemon — it is a poller with no --version/--help
  # fast-exit path and would hang. Inspect the ELF header only.
  test -s packages/podkit-daemon/bin/podkit-daemon
  file packages/podkit-daemon/bin/podkit-daemon
  if ! file packages/podkit-daemon/bin/podkit-daemon | grep -q "ELF"; then
    echo "ERROR: podkit-daemon binary is not an ELF." >&2
    exit 1
  fi
'

# Copy the compiled binaries from the VM-local build tree back to the host.
# The libgpod-node prebuild .node file is NOT copied back — it was written
# to the host by `build-linux-prebuild.sh` (the prerequisite turbo task)
# before the rsync above carried it into the VM-local checkout, so the host
# tree already has the canonical copy at its turbo-cache-output path.
mkdir -p "$CLI_BIN_DIR"
DEST="$CLI_BIN_DIR/podkit-linux-${NODE_ARCH}"
log "copying ${VM_NAME}:${VM_BIN_DIR}/podkit → ${DEST}..."
limactl copy "${VM_NAME}:${VM_BIN_DIR}/podkit" "$DEST"
chmod +x "$DEST"
log "produced $DEST"

DEBUG_DEST="$CLI_BIN_DIR/podkit-debug-linux-${NODE_ARCH}"
log "copying ${VM_NAME}:${VM_BIN_DIR}/podkit-debug → ${DEBUG_DEST}..."
limactl copy "${VM_NAME}:${VM_BIN_DIR}/podkit-debug" "$DEBUG_DEST"
chmod +x "$DEBUG_DEST"
log "produced $DEBUG_DEST"

# Daemon binary — copy from the VM-local daemon bin dir back to the host.
DAEMON_BIN_DIR="$REPO_ROOT/packages/podkit-daemon/bin"
VM_DAEMON_BIN_DIR="$VM_SRC/packages/podkit-daemon/bin"
mkdir -p "$DAEMON_BIN_DIR"
DAEMON_DEST="$DAEMON_BIN_DIR/podkit-daemon-linux-${NODE_ARCH}"
log "copying ${VM_NAME}:${VM_DAEMON_BIN_DIR}/podkit-daemon → ${DAEMON_DEST}..."
limactl copy "${VM_NAME}:${VM_DAEMON_BIN_DIR}/podkit-daemon" "$DAEMON_DEST"
chmod +x "$DAEMON_DEST"
log "produced $DAEMON_DEST"
