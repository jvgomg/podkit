#!/usr/bin/env bash
#
# Turbo task wrapper: @podkit/device-testing#build:dummy-hcd-daemon
#
# Delegates to tools/device-testing/dummy-hcd/scripts/build.sh, which is
# the source-of-truth build script. We re-export it from this package so
# turbo can hash the inputs against this workspace member's cache key —
# the dummy-hcd daemon directory is intentionally not a workspace member
# (it ships as a compiled binary, not as a publishable npm package).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Default to "all" so the cached output includes both arch variants. The
# test VM may be linux-x64 (Intel mac) or linux-arm64 (Apple silicon); we
# materialise both so a future architecture switch doesn't trigger a
# rebuild.
TARGET="${DUMMY_HCD_TARGET:-all}"

exec bash "$REPO_ROOT/tools/device-testing/dummy-hcd/scripts/build.sh" "$TARGET"
