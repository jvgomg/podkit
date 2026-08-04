#!/usr/bin/env bash
#
# Shared Linux glibc native-build entry point.
#
# Single source of truth invoked by:
#   - test-packages/device-testing/lima/podkit-linux-builder.yaml (local builds on macOS via Lima)
#   - .github/workflows/prebuild.yml         (CI prebuilds for linux-x64/arm64 glibc)
#   - .github/workflows/build-platform.yml   (glibc release CLI binary for Homebrew/Debian, in ubuntu:20.04)
#
# Responsibilities:
#   1. Build all static C dependencies (libgpod, gdk-pixbuf, glib, libplist, ...)
#      via tools/prebuild/build-static-deps.sh — unless STATIC_DEPS_DIR is
#      already populated (cache hit).
#   2. Run `bunx prebuildify --napi --strip` inside packages/libgpod-node/ to
#      produce a self-contained linux-${arch} prebuild with libgpod statically
#      linked into the .node addon.
#   3. Verify via `ldd` that the resulting prebuild has no runtime libgpod /
#      libglib / libgdk_pixbuf / libplist references.
#
# Skipped on this path:
#   - musl/Alpine (see prebuild.yml's prebuild-musl-x64 / prebuild-musl-arm64
#     jobs which run inside alpine:3.21 containers).
#   - macOS (handled by darwin matrix entries in prebuild.yml directly).
#
# Environment:
#   STATIC_DEPS_DIR  Where static .a files land. Defaults to $REPO_ROOT/static-deps.
#   WORK_DIR         Scratch dir for source tarballs and builds. Defaults to
#                    $REPO_ROOT/.prebuild-work.
#   SKIP_STATIC_DEPS If "1", skips build-static-deps.sh entirely (caller has
#                    already populated STATIC_DEPS_DIR).
#   SKIP_VERIFY      If "1", skips the ldd verification step. Useful for
#                    cross-compile/staged setups where the host's ldd is
#                    inappropriate. CI defaults to running it.
#
# Exits non-zero on:
#   - missing prerequisites (bun, build-static-deps.sh)
#   - any static-deps build failure
#   - prebuildify failure
#   - dynamic dependency on a library that should have been statically linked
#
# Run anywhere with bash, a working C toolchain (build-essential, pkg-config,
# autoconf, automake, libtool, cmake, meson, ninja, intltool, perl XML::Parser),
# and Node + Bun on PATH.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

STATIC_DEPS_DIR="${STATIC_DEPS_DIR:-$REPO_ROOT/static-deps}"
WORK_DIR="${WORK_DIR:-$REPO_ROOT/.prebuild-work}"
SKIP_STATIC_DEPS="${SKIP_STATIC_DEPS:-0}"
SKIP_VERIFY="${SKIP_VERIFY:-0}"

log() { echo "==> [build-linux-glibc] $1"; }

# ---------------------------------------------------------------------------
# Sanity: bail out early if we're not on Linux glibc
# ---------------------------------------------------------------------------
if [ "$(uname)" != "Linux" ]; then
  echo "ERROR: build-linux-glibc.sh must run on Linux (uname=$(uname))." >&2
  echo "       Run via the Lima builder VM on macOS: limactl shell podkit-linux-builder -- bash $0" >&2
  exit 1
fi

if ldd /bin/sh 2>/dev/null | grep -q musl; then
  echo "ERROR: detected musl libc; this script is for glibc only." >&2
  echo "       The musl/Alpine path runs inside .github/workflows/prebuild.yml's" >&2
  echo "       prebuild-musl-x64 / prebuild-musl-arm64 jobs." >&2
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
# Phase 2: prebuildify (produces packages/libgpod-node/prebuilds/linux-${arch}/)
# ---------------------------------------------------------------------------
# Invariant assumed by this script: $REPO_ROOT is a VM-local source tree, not
# a host-mounted one. The caller (build-linux-prebuild.sh on macOS, or the CI
# runner on GitHub Actions) rsyncs the repo into a VM-local path before
# invoking this script. Why this matters: node-gyp bakes absolute host paths
# (node_modules/.bun/node-gyp@<hash>, /tmp/prebuildify/node/<ver>) into
# build/*.d dep files. If the source tree is shared between host and VM, those
# baked paths reference filesystems that don't exist on the other side, and
# incremental rebuilds on `--force` rerun produce stale-state link failures.
# Building in a VM-local tree keeps the dep graph internally coherent and
# makes every rerun reproducible.
#
# --target node@22 pins prebuildify to Node 22 LTS headers. Without it,
# prebuildify selects the latest Node release line known to its node-abi
# dependency, currently Node 25 — silent input drift turbo can't see. The
# N-API ABI guarantees runtime compat across Node versions; --target only
# fixes which headers we *compile* against.
log "running prebuildify (linux-${NODE_ARCH})..."
cd "$REPO_ROOT/packages/libgpod-node"
# bunx instead of npx so the build path stays Bun-first; npm only enters
# transitively when prebuildify shells out to node-gyp (unavoidable — node-gyp
# is the canonical N-API build driver). Also avoids npm's "new major version
# available" nag in the log.
bunx prebuildify --napi --strip --target node@22.11.0

# ---------------------------------------------------------------------------
# Phase 3: verify the prebuild is genuinely statically linked
# ---------------------------------------------------------------------------
if [ "$SKIP_VERIFY" = "1" ]; then
  log "SKIP_VERIFY=1; skipping ldd check"
else
  PREBUILD="$(find prebuilds -name '*.node' -type f | head -1 || true)"
  if [ -z "$PREBUILD" ]; then
    echo "ERROR: no .node file produced under packages/libgpod-node/prebuilds/" >&2
    exit 1
  fi
  log "verifying static linking of $PREBUILD"
  ldd "$PREBUILD" || true
  # Forbidden runtime deps: libgpod plus the full glib/gdk-pixbuf/plist transitive
  # closure that must be statically linked into the addon. Keep this aligned with
  # the broader check in test-packages/device-testing/scripts/build-linux-binary.sh.
  if ldd "$PREBUILD" 2>/dev/null | grep -E 'libgpod|libgdk_pixbuf|libglib|libgobject|libgio|libgmodule|libplist|libffi|libxml2|libsqlite|libpcre2|libpng|libjpeg|libtiff'; then
    echo "ERROR: $PREBUILD has runtime dependencies on libraries that must be" >&2
    echo "       statically linked. Check tools/prebuild/build-static-deps.sh" >&2
    echo "       for --enable-static / --disable-shared / -fPIC flags." >&2
    exit 1
  fi
  log "OK: prebuild is statically linked"
fi

log "done — prebuild at packages/libgpod-node/prebuilds/linux-${NODE_ARCH}/"
