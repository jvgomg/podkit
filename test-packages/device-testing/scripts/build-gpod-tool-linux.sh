#!/usr/bin/env bash
#
# Turbo task: @podkit/gpod-testing#build:linux-binary
#
# Runs on the macOS host. Uses the Lima `podkit-builder-glibc` VM to run
# `make -C tools/gpod-tool` against apt's libgpod-dev, then copies the
# resulting Linux binary back to the host.
#
# Output: test-packages/gpod-testing/bin/gpod-tool-linux-<arch>
#
# The produced binary dynamically links libgpod-1.0 + glib-2.0 against the
# builder VM's apt libraries. The device-synthesis VM (podkit-device) carries
# runtime libgpod4 + libglib2.0-0 packages — the same shared-library ABI — so
# the binary loads cleanly there. ADR-016 §"Builder/test VM split" explicitly
# endorses libgpod4 in the device VM for the gpod-tool helper.

set -euo pipefail

VM_NAME="${BUILDER_VM_NAME:-podkit-builder-glibc}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
GPOD_TESTING_BIN_DIR="$REPO_ROOT/test-packages/gpod-testing/bin"
PODKIT_VM=(bun "$REPO_ROOT/test-packages/lima/src/cli.ts")

log() { echo "==> [build:gpod-tool-linux] $1"; }

if ! command -v limactl >/dev/null 2>&1; then
  echo "ERROR: limactl not found. Install with: brew install lima (or via mise)" >&2
  exit 1
fi

# Create-or-start the builder VM. `ensure` takes the shared advisory lock for
# the whole check-then-act, so the concurrently-scheduled
# device-testing#build:linux-prebuild task cannot start the same instance at the
# same moment. Crucially it also CREATES the instance when absent: the two tasks
# have no ordering edge in turbo, so on a host with no builder VM either one may
# arrive first, and refusing to create here used to abort the entire run.
"${PODKIT_VM[@]}" ensure "$VM_NAME"

# Match the arch suffix to the convention used by the sibling builds
# (vmArch() in lima-test-vm.ts): arm64 / x64 — not aarch64 / x86_64.
TARGET_ARCH="$(limactl shell "$VM_NAME" bash -c "uname -m")"
case "$TARGET_ARCH" in
  x86_64)  NODE_ARCH=x64 ;;
  aarch64) NODE_ARCH=arm64 ;;
  *)
    echo "ERROR: unsupported builder arch '$TARGET_ARCH'." >&2
    exit 1
    ;;
esac

# Build inside a VM-local copy of the source tree (matches build-linux-binary.sh).
# A direct $REPO_ROOT build would clobber host-side artefacts via Lima's $HOME
# mount; staging into /tmp keeps the host tree untouchable.
VM_SRC=/tmp/podkit-builder-src

# Stage the source into the VM-local tree using the shared exclude floor.
"${PODKIT_VM[@]}" stage "$VM_NAME" --src "$REPO_ROOT" --dest "$VM_SRC"

log "building gpod-tool inside '$VM_NAME' (target=linux-${NODE_ARCH})..."
limactl shell --workdir "$VM_SRC" "$VM_NAME" bash -c '
  set -euo pipefail
  cd tools/gpod-tool
  make clean
  make
  # Smoke: bare-help is sufficient — gpod-tool has no --version flag, and
  # invoking with no args prints usage to stderr with exit 1.
  ./gpod-tool --help 2>&1 | head -1 || true
  ldd ./gpod-tool || true
'

mkdir -p "$GPOD_TESTING_BIN_DIR"
DEST="$GPOD_TESTING_BIN_DIR/gpod-tool-linux-${NODE_ARCH}"
log "copying ${VM_NAME}:${VM_SRC}/tools/gpod-tool/gpod-tool -> ${DEST}..."
limactl copy "${VM_NAME}:${VM_SRC}/tools/gpod-tool/gpod-tool" "$DEST"
chmod +x "$DEST"
log "produced $DEST"
