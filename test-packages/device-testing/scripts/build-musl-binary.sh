#!/usr/bin/env bash
#
# Turbo task: @podkit/device-testing#build:musl-binary
#
# Runs on the macOS host. Uses the Lima Alpine `musl-builder` VM to run, in a
# VM-local source tree:
#
#   bun install (in-VM)
#   bunx turbo run build --filter=!@podkit/docs-site ...
#   bash packages/podkit-cli/scripts/compile.sh              (production)
#   PODKIT_DEV_HOOKS=1 bash packages/podkit-cli/scripts/compile.sh   (debug)
#   ( cd packages/podkit-daemon && bun run compile )         (daemon)
#
# The resulting musl-linked binaries are copied back to the host with the
# `-musl` suffix so they sit alongside the glibc binaries without clobbering:
#
#   packages/podkit-cli/bin/podkit-linux-${arch}-musl
#   packages/podkit-cli/bin/podkit-debug-linux-${arch}-musl
#   packages/podkit-daemon/bin/podkit-daemon-linux-${arch}-musl
#
# This is the musl sibling of build-linux-binary.sh. The in-VM compile block is
# lifted ~verbatim — compile.sh already selects the `${platform}-${arch}-musl`
# prebuild first, and the daemon `bun run compile` needs no changes.
#
# The musl CLI binary depends on the musl libgpod-node prebuild existing.
# Analogous to how the glibc binary build depends on build:linux-prebuild, this
# script runs build-musl-prebuild.sh's logic first (it is a turbo cache hit and
# a no-op rebuild once the prebuild exists).

set -euo pipefail

VM_NAME="${MUSL_BUILDER_VM_NAME:-podkit-builder-musl}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI_BIN_DIR="$REPO_ROOT/packages/podkit-cli/bin"
PODKIT_VM=(bun "$REPO_ROOT/test-packages/lima/src/cli.ts")

log() { echo "==> [build:musl-binary] $1"; }

if ! command -v limactl >/dev/null 2>&1; then
  echo "ERROR: limactl not found. Install with: brew install lima" >&2
  exit 1
fi

# The musl CLI binary embeds the musl libgpod-node prebuild (via compile.sh).
# Ensure it exists (and the builder VM is up) by running the prebuild driver
# first. It short-circuits cheaply when the prebuild + static-deps are cached.
log "ensuring musl prebuild exists (running build-musl-prebuild.sh)..."
bash "$SCRIPT_DIR/build-musl-prebuild.sh"

# Create-or-start the musl builder VM through the shared advisory lock. The
# prebuild driver above will usually have done this already; `ensure` is
# idempotent, and this task must be able to start the VM on its own because
# turbo can serve the prebuild from cache without ever booting it.
"${PODKIT_VM[@]}" ensure "$VM_NAME"

# Detect target arch from inside the VM (matches what `bun build --compile`
# produces). compile.sh picks the right musl prebuild based on process.arch.
TARGET_ARCH="$(limactl shell "$VM_NAME" bash -c "uname -m")"
case "$TARGET_ARCH" in
  x86_64)  NODE_ARCH=x64 ;;
  aarch64) NODE_ARCH=arm64 ;;
  *)
    echo "ERROR: unsupported builder arch '$TARGET_ARCH'." >&2
    exit 1
    ;;
esac

# Build inside a VM-local copy of the source tree, NOT the macOS-mounted repo
# (see build-linux-binary.sh for the full rationale — a host-mounted build
# tree lets the VM destroy the host's node_modules).
# Destination comes from @podkit/lima's staging-area registry, which keeps this
# tree distinct from the musl prebuild's — the musl pair is not scheduled
# concurrently today, but nothing enforced that, so the separation is now
# declared rather than incidental.
VM_SRC="$("${PODKIT_VM[@]}" stage-path "$VM_NAME" --area muslBinary)"
VM_BIN_DIR="$VM_SRC/packages/podkit-cli/bin"

# Stage the source into the VM-local tree. prebuilds/ is deliberately NOT
# excluded (unlike build-musl-prebuild.sh) — the freshly-built
# linux-${arch}-musl .node must ride along so compile.sh can embed it.
"${PODKIT_VM[@]}" stage "$VM_NAME" --src "$REPO_ROOT" --dest "$VM_SRC"

log "compiling podkit binary inside '$VM_NAME' (target=linux-${NODE_ARCH}-musl)..."
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

  # Debug binary — same source, dev hooks active (see documents/architecture/dev-builds.md).
  echo "==> compiling podkit binary (debug)..."
  PODKIT_DEV_HOOKS=1 bash packages/podkit-cli/scripts/compile.sh

  echo "==> verifying podkit-debug binary..."
  packages/podkit-cli/bin/podkit-debug --version

  # Daemon binary — compiled natively in-VM so its bundled koffi native assets
  # are the correct linux-musl prebuild. The daemon never reaches loadUsb at
  # runtime (it shells out to the podkit CLI), so the usb bundler-plugin is
  # deliberately NOT applied — a plain `bun run compile` is correct.
  echo "==> compiling podkit-daemon binary..."
  ( cd packages/podkit-daemon && bun run compile )

  echo "==> verifying podkit-daemon binary is a linux ELF..."
  # Do NOT execute the daemon — it is a poller with no --version fast-exit and
  # would hang. Inspect the ELF header only.
  test -s packages/podkit-daemon/bin/podkit-daemon
  file packages/podkit-daemon/bin/podkit-daemon
  if ! file packages/podkit-daemon/bin/podkit-daemon | grep -q "ELF"; then
    echo "ERROR: podkit-daemon binary is not an ELF." >&2
    exit 1
  fi
'

# Copy the compiled binaries back to the host with the -musl suffix.
mkdir -p "$CLI_BIN_DIR"
DEST="$CLI_BIN_DIR/podkit-linux-${NODE_ARCH}-musl"
log "copying ${VM_NAME}:${VM_BIN_DIR}/podkit → ${DEST}..."
limactl copy "${VM_NAME}:${VM_BIN_DIR}/podkit" "$DEST"
chmod +x "$DEST"
log "produced $DEST"

DEBUG_DEST="$CLI_BIN_DIR/podkit-debug-linux-${NODE_ARCH}-musl"
log "copying ${VM_NAME}:${VM_BIN_DIR}/podkit-debug → ${DEBUG_DEST}..."
limactl copy "${VM_NAME}:${VM_BIN_DIR}/podkit-debug" "$DEBUG_DEST"
chmod +x "$DEBUG_DEST"
log "produced $DEBUG_DEST"

# Daemon binary — copy from the VM-local daemon bin dir back to the host.
DAEMON_BIN_DIR="$REPO_ROOT/packages/podkit-daemon/bin"
VM_DAEMON_BIN_DIR="$VM_SRC/packages/podkit-daemon/bin"
mkdir -p "$DAEMON_BIN_DIR"
DAEMON_DEST="$DAEMON_BIN_DIR/podkit-daemon-linux-${NODE_ARCH}-musl"
log "copying ${VM_NAME}:${VM_DAEMON_BIN_DIR}/podkit-daemon → ${DAEMON_DEST}..."
limactl copy "${VM_NAME}:${VM_DAEMON_BIN_DIR}/podkit-daemon" "$DAEMON_DEST"
chmod +x "$DAEMON_DEST"
log "produced $DAEMON_DEST"
