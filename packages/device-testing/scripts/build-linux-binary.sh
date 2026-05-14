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

VM_NAME="${BUILDER_VM_NAME:-builder}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI_BIN_DIR="$REPO_ROOT/packages/podkit-cli/bin"

log() { echo "==> [build:linux-binary] $1"; }

if ! command -v limactl >/dev/null 2>&1; then
  echo "ERROR: limactl not found. Install with: brew install lima" >&2
  exit 1
fi

status=$(limactl list --format '{{.Status}}' "$VM_NAME" 2>/dev/null || echo "NotFound")
if [ "$status" = "NotFound" ] || [ "$status" = "Broken" ]; then
  echo "ERROR: builder VM '$VM_NAME' not available (state=$status). Run" >&2
  echo "       bunx turbo run @podkit/device-testing#build:linux-prebuild first." >&2
  exit 1
fi
if [ "$status" = "Stopped" ]; then
  log "starting builder VM '$VM_NAME'..."
  limactl start "$VM_NAME"
fi

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

log "compiling podkit binary inside '$VM_NAME' (target=linux-${NODE_ARCH})..."
# Lima 2.x: --workdir BEFORE instance, no `--` separator.
limactl shell --workdir "$REPO_ROOT" "$VM_NAME" bash -c '
  set -euo pipefail
  export PATH="/usr/local/bin:$HOME/.bun/bin:$PATH"

  # node_modules outside the host mount so we never clobber macOS-installed
  # binaries when running `bun install`. The mount is rw, but Bun rebuilds
  # native modules per platform; isolating per-VM avoids that.
  if [ ! -d /tmp/podkit-builder-nm ]; then
    mkdir -p /tmp/podkit-builder-nm
  fi
  # Symlink node_modules into a VM-local dir so install does not write
  # back into the host source tree.
  if [ -L node_modules ]; then rm node_modules; fi
  if [ -d node_modules ] && [ ! -L node_modules ]; then
    mv node_modules /tmp/podkit-builder-nm-host-saved 2>/dev/null || true
  fi
  if [ ! -e node_modules ]; then
    ln -s /tmp/podkit-builder-nm node_modules
  fi

  bun install --frozen-lockfile --ignore-scripts

  echo "==> building TS packages..."
  bunx turbo run build --filter=!@podkit/docs-site --filter=!@podkit/virtual-ipod-app --filter=!@podkit/ipod-web --filter=!@podkit/demo

  echo "==> compiling podkit binary..."
  bash packages/podkit-cli/scripts/compile.sh

  echo "==> verifying podkit binary..."
  packages/podkit-cli/bin/podkit --version
  ldd packages/podkit-cli/bin/podkit || true
  if ldd packages/podkit-cli/bin/podkit 2>/dev/null | grep -E "libgpod|libgdk_pixbuf|libglib|libgobject|libgio|libgmodule|libffi|libplist|libxml2|libsqlite|libpcre2|libpng|libjpeg|libtiff"; then
    echo "ERROR: podkit binary has unexpected dynamic dependencies." >&2
    exit 1
  fi
'

# Rename the binary to a platform-tagged path so the macOS-side build does
# not collide with it.
SRC="$CLI_BIN_DIR/podkit"
DEST="$CLI_BIN_DIR/podkit-linux-${NODE_ARCH}"
if [ ! -f "$SRC" ]; then
  echo "ERROR: expected $SRC after VM compile, not found." >&2
  exit 1
fi
mv "$SRC" "$DEST"
log "produced $DEST"
