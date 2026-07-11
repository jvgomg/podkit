#!/usr/bin/env bash
#
# Shared Linux musl native-build entry point.
#
# Single source of truth invoked by:
#   - test-packages/device-testing/lima/podkit-musl-builder.yaml (local builds
#     on macOS via the Lima Alpine builder VM)
#   - .github/workflows/prebuild.yml     (CI prebuilds for linux-{x64,arm64}-musl,
#     which run inside alpine:3.21 containers and open-code equivalent steps)
#
# This is the musl sibling of build-linux-glibc.sh — its structure and logging
# mirror that script; the libc assertion is the inverse (require musl, reject
# glibc), and it renames the prebuild dir to the `-musl` suffix that compile.sh
# selects first (see packages/podkit-cli/scripts/compile.sh).
#
# Responsibilities:
#   1. Build all static C dependencies (libgpod, gdk-pixbuf, glib, libplist,
#      libintl-for-musl, ...) via tools/prebuild/build-static-deps.sh — unless
#      STATIC_DEPS_DIR is already populated (cache hit). That script is already
#      musl-aware (it builds a static -fPIC libintl from source under musl).
#   2. Run `bunx prebuildify --napi --strip` inside packages/libgpod-node/ to
#      produce a self-contained linux-${arch} prebuild with libgpod statically
#      linked into the .node addon, then RENAME the output dir to
#      linux-${arch}-musl (prebuildify has no musl suffix of its own).
#   3. Verify via `ldd` that the resulting prebuild has no runtime libgpod /
#      libglib / libgdk_pixbuf / libplist references.
#
# Skipped on this path:
#   - glibc/Debian (see build-linux-glibc.sh).
#   - macOS (handled by the darwin matrix entries in prebuild.yml directly).
#
# Environment:
#   STATIC_DEPS_DIR  Where static .a files land. Defaults to $REPO_ROOT/static-deps.
#   WORK_DIR         Scratch dir for source tarballs and builds. Defaults to
#                    $REPO_ROOT/.prebuild-work.
#   SKIP_STATIC_DEPS If "1", skips build-static-deps.sh entirely (caller has
#                    already populated STATIC_DEPS_DIR).
#   SKIP_VERIFY      If "1", skips the ldd verification step.
#
# Exits non-zero on:
#   - missing prerequisites (bun, build-static-deps.sh)
#   - running on glibc (wrong builder)
#   - any static-deps build failure
#   - prebuildify failure
#   - dynamic dependency on a library that should have been statically linked

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

STATIC_DEPS_DIR="${STATIC_DEPS_DIR:-$REPO_ROOT/static-deps}"
WORK_DIR="${WORK_DIR:-$REPO_ROOT/.prebuild-work}"
SKIP_STATIC_DEPS="${SKIP_STATIC_DEPS:-0}"
SKIP_VERIFY="${SKIP_VERIFY:-0}"

log() { echo "==> [build-linux-musl] $1"; }

# ---------------------------------------------------------------------------
# Sanity: bail out early unless we're on Linux musl
# ---------------------------------------------------------------------------
if [ "$(uname)" != "Linux" ]; then
  echo "ERROR: build-linux-musl.sh must run on Linux (uname=$(uname))." >&2
  echo "       Run via the Lima Alpine builder VM on macOS: limactl shell podkit-musl-builder -- bash $0" >&2
  exit 1
fi

if ! ldd /bin/sh 2>/dev/null | grep -q musl; then
  echo "ERROR: did not detect musl libc; this script is for musl/Alpine only." >&2
  echo "       The glibc/Debian path is tools/prebuild/build-linux-glibc.sh." >&2
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)  NODE_ARCH=x64 ;;
  aarch64) NODE_ARCH=arm64 ;;
  *)
    echo "ERROR: unsupported arch '$ARCH'." >&2
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Phase 1: static deps (skip if cached)
# ---------------------------------------------------------------------------
if [ "$SKIP_STATIC_DEPS" = "1" ]; then
  log "SKIP_STATIC_DEPS=1; assuming $STATIC_DEPS_DIR is already populated."
elif [ -f "$STATIC_DEPS_DIR/lib/libgpod.a" ] \
   && [ -f "$STATIC_DEPS_DIR/lib/libgdk_pixbuf-2.0.a" ]; then
  log "static deps cached at $STATIC_DEPS_DIR — skipping build-static-deps.sh"
else
  log "building static deps via build-static-deps.sh (this can take 10-15 min)..."
  STATIC_DEPS_DIR="$STATIC_DEPS_DIR" WORK_DIR="$WORK_DIR" \
    bash "$SCRIPT_DIR/build-static-deps.sh"
fi

export STATIC_DEPS_DIR

# ---------------------------------------------------------------------------
# Phase 2: prebuildify (produces packages/libgpod-node/prebuilds/linux-${arch})
# ---------------------------------------------------------------------------
# Invariant (same as build-linux-glibc.sh): $REPO_ROOT is a VM-local source
# tree, not a host-mounted one. node-gyp bakes absolute host paths into
# build/*.d dep files; a shared host/VM tree makes `--force` reruns hit
# stale-state link failures.
#
# --target node@22.11.0 pins prebuildify to Node 22 LTS headers so header
# selection can't drift (prebuildify otherwise tracks the latest release line
# known to node-abi). N-API guarantees runtime ABI compat across Node versions.
log "running prebuildify (linux-${NODE_ARCH}, musl)..."
cd "$REPO_ROOT/packages/libgpod-node"
bunx prebuildify --napi --strip --target node@22.11.0

# ---------------------------------------------------------------------------
# Phase 2b: rename to the -musl suffix
# ---------------------------------------------------------------------------
# prebuildify emits plain linux-${arch} regardless of libc. compile.sh selects
# `${platform}-${arch}-musl` FIRST, so the musl prebuild must live under that
# name to be picked over any glibc prebuild present in the same tree. This
# rename is the critical prebuild-naming step (mirrors the CI musl jobs'
# `mv prebuilds/linux-arm64 prebuilds/linux-arm64-musl`).
if [ -d "prebuilds/linux-${NODE_ARCH}-musl" ]; then
  log "removing stale prebuilds/linux-${NODE_ARCH}-musl"
  rm -rf "prebuilds/linux-${NODE_ARCH}-musl"
fi
if [ ! -d "prebuilds/linux-${NODE_ARCH}" ]; then
  echo "ERROR: prebuildify did not produce prebuilds/linux-${NODE_ARCH}/" >&2
  exit 1
fi
mv "prebuilds/linux-${NODE_ARCH}" "prebuilds/linux-${NODE_ARCH}-musl"
log "renamed prebuild dir → prebuilds/linux-${NODE_ARCH}-musl"

# ---------------------------------------------------------------------------
# Phase 3: verify the prebuild is genuinely statically linked
# ---------------------------------------------------------------------------
if [ "$SKIP_VERIFY" = "1" ]; then
  log "SKIP_VERIFY=1; skipping ldd check"
else
  PREBUILD="$(find "prebuilds/linux-${NODE_ARCH}-musl" -name '*.node' -type f | head -1 || true)"
  if [ -z "$PREBUILD" ]; then
    echo "ERROR: no .node file produced under packages/libgpod-node/prebuilds/linux-${NODE_ARCH}-musl/" >&2
    exit 1
  fi
  log "verifying static linking of $PREBUILD"
  ldd "$PREBUILD" || true
  # Forbidden runtime deps: libgpod plus the glib/gdk-pixbuf/plist transitive
  # closure that must be statically linked. Kept aligned with build-linux-glibc.sh
  # and build-linux-binary.sh's checks.
  if ldd "$PREBUILD" 2>/dev/null | grep -E 'libgpod|libgdk_pixbuf|libglib|libgobject|libgio|libgmodule|libplist|libffi|libxml2|libsqlite|libpcre2|libpng|libjpeg|libtiff'; then
    echo "ERROR: $PREBUILD has runtime dependencies on libraries that must be" >&2
    echo "       statically linked. Check tools/prebuild/build-static-deps.sh" >&2
    echo "       for --enable-static / --disable-shared / -fPIC flags." >&2
    exit 1
  fi
  log "OK: prebuild is statically linked"
fi

log "done — prebuild at packages/libgpod-node/prebuilds/linux-${NODE_ARCH}-musl/"
