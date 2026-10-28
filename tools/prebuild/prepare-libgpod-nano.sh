#!/bin/bash
# Apply the shared Nano signing patch before autoreconf.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fingerprint() {
  cat "$SCRIPT_DIR/libgpod-nano.patch" "$SCRIPT_DIR"/vendor/hashab/src/* | cksum
}

case "${1:-}" in
  --check)
    test -f "$2/lib/libgpod.a" && test -f "$2/lib/libgpod-nano.stamp" &&
      test "$(cat "$2/lib/libgpod-nano.stamp")" = "$(fingerprint)"
    ;;
  --stamp)
    fingerprint > "$2/lib/libgpod-nano.stamp"
    ;;
  *)
    SOURCE="${1:?usage: prepare-libgpod-nano.sh <libgpod source> | --check/--stamp <prefix>}"
    # Reject an unexpected or already-patched source before copying anything.
    patch --dry-run --batch --forward -d "$SOURCE" -p1 < "$SCRIPT_DIR/libgpod-nano.patch"
    patch --batch --forward -d "$SOURCE" -p1 < "$SCRIPT_DIR/libgpod-nano.patch"
    mkdir -p "$SOURCE/src/nano_hashab"
    cp "$SCRIPT_DIR"/vendor/hashab/src/* "$SOURCE/src/nano_hashab/"
    cp "$SCRIPT_DIR/vendor/hashab/LICENSE" "$SOURCE/src/nano_hashab/"
    ;;
esac
