#!/usr/bin/env bash
#
# Build the dummy-hcd daemon into a standalone Linux binary.
#
# Mirrors `packages/podkit-cli/scripts/compile.sh`: invokes
# `bun build --compile` and writes the resulting binary into the local
# `dist/` directory under a platform-tagged name. The host invoking this
# script needs Bun ≥1.3 — no other tooling.
#
# Cross-compile: Bun supports `--target=bun-linux-x64` and
# `--target=bun-linux-arm64` from macOS hosts, so the same script works
# inside the builder VM (TASK-322.03) and ad-hoc on a macOS dev host.
#
# Usage:
#   bash scripts/build.sh                  # auto-detect target from Bun's host
#   bash scripts/build.sh linux-x64        # explicit target
#   bash scripts/build.sh linux-arm64
#   bash scripts/build.sh all              # both linux-x64 and linux-arm64
#
# Output:
#   dist/dummy-hcd-daemon-linux-x64
#   dist/dummy-hcd-daemon-linux-arm64
#
# Bun's --compile produces a self-extracting single-file binary; no runtime
# dependencies, no Node/Bun install needed in the test VM.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DAEMON_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENTRY="$DAEMON_DIR/src/main.ts"
OUT_DIR="$DAEMON_DIR/dist"

mkdir -p "$OUT_DIR"

build_one() {
  local target="$1"
  local outfile="$OUT_DIR/dummy-hcd-daemon-$target"
  echo "==> bun build --compile --target=bun-$target → $outfile"
  bun build --compile --target="bun-$target" "$ENTRY" --outfile "$outfile"
  # Make sure the produced binary is executable. `--outfile` already sets
  # mode 0755 but defensively chmod for any future Bun behaviour change.
  chmod +x "$outfile"
}

TARGET="${1:-auto}"
case "$TARGET" in
  linux-x64|linux-arm64)
    build_one "$TARGET"
    ;;
  all)
    build_one linux-x64
    build_one linux-arm64
    ;;
  auto)
    HOST_ARCH="$(bun -e 'console.log(process.arch)')"
    case "$HOST_ARCH" in
      x64)   build_one linux-x64 ;;
      arm64) build_one linux-arm64 ;;
      *)
        echo "ERROR: cannot auto-detect target from host arch '$HOST_ARCH'." >&2
        echo "       Pass an explicit target: linux-x64 | linux-arm64 | all." >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "ERROR: unknown target '$TARGET'. Use linux-x64 | linux-arm64 | all | auto." >&2
    exit 1
    ;;
esac

echo "OK: build complete."
