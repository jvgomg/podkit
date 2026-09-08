#!/usr/bin/env bash
set -euo pipefail

# Compile the CLI into a standalone binary with the native .node addons embedded.
#
# Bun's --compile detects static require() calls to .node files and embeds
# them in the compiled binary. At runtime, Bun extracts the .node to a temp
# file, dlopen's it, then deletes it — producing a true single-file binary.
#
# The gpod_binding.node addon is embedded via the static require in
# src/compile-entry.js. The `usb` prebuild cannot be reached the same way
# (the package requires it through node-gyp-build, which Bun links
# statically), so it is embedded by a build plugin — hence the final build
# runs through scripts/compile-build.ts (the `bun build` CLI cannot take
# plugins) rather than a plain `bun build --compile` here.
#
# This script stages the correct platform's .node files to known paths
# ($CLI_DIR/gpod_binding.node and $CLI_DIR/usb_native.node), then compiles.
#
# Those paths are FIXED, not per-variant: src/compile-entry.js embeds the addon
# with a literal `require('../gpod_binding.node')`, and Bun's compiler only
# detects the file to embed when the specifier is a literal. So the production
# and debug builds necessarily stage to the same two paths.
#
# That makes concurrent invocations mutually exclusive. `podkit#compile` and
# `podkit#compile:debug` are independent turbo tasks with no dependency between
# them, so turbo runs them in parallel and they collide:
#
#   cp: cannot create regular file '.../gpod_binding.node': File exists
#
# The failing `cp` is only the loudest symptom. The worse interleaving is the
# EXIT trap below — whichever build finishes first deletes both staged files
# while the other is still compiling, which can produce a binary with a missing
# addon rather than a clean failure.
#
# Hence the lock. `mkdir` is atomic on every POSIX filesystem, which `flock`
# is not available to be (macOS ships no flock(1)), and the whole
# stage-then-compile span has to be inside it because the staged files must
# survive until `bun build` has read them.

CLI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LIBGPOD_DIR="$CLI_DIR/../libgpod-node"

STAGED="$CLI_DIR/gpod_binding.node"
USB_STAGED="$CLI_DIR/usb_native.node"

LOCK_DIR="$CLI_DIR/.compile.lock"
LOCK_TIMEOUT_SECONDS="${PODKIT_COMPILE_LOCK_TIMEOUT:-900}"

# Released by the EXIT trap installed immediately after acquisition, so an
# early failure (missing prebuild, failed build) cannot strand it.
acquire_compile_lock() {
  local waited=0
  until mkdir "$LOCK_DIR" 2>/dev/null; do
    if [ "$waited" -ge "$LOCK_TIMEOUT_SECONDS" ]; then
      echo "ERROR: timed out after ${LOCK_TIMEOUT_SECONDS}s waiting for $LOCK_DIR" >&2
      echo "  Another compile is holding it, or a previous one was killed." >&2
      echo "  If no compile is running, remove it: rmdir '$LOCK_DIR'" >&2
      exit 1
    fi
    if [ "$waited" -eq 0 ]; then
      echo "Waiting for a concurrent compile to release $LOCK_DIR ..."
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

cleanup() { rm -f "$STAGED" "$USB_STAGED"; rmdir "$LOCK_DIR" 2>/dev/null || true; }

acquire_compile_lock
trap cleanup EXIT

# Detect platform and arch using bun (always available) instead of node (may not be).
PLATFORM=$(bun -e 'console.log(process.platform)')
ARCH=$(bun -e 'console.log(process.arch)')

# Try prebuild first (CI creates these via prebuildify), then local node-gyp build.
# Prebuildify names the file after the package (e.g., @podkit+libgpod-node.node),
# so we find any .node file in the platform directory rather than hardcoding.
#
# The prebuild directory is chosen by the HOST's libc (musl vs glibc), never
# "first directory that exists wins" — a glibc builder can carry a stray
# linux-{arch}-musl dir, and embedding that musl .node yields a binary that
# fails at dlopen with `libc.musl-{arch}.so.1: cannot open shared object file`.
# See select-gpod-prebuild.sh for the full rationale; the `usb` prebuild below
# is selected by the same host-libc probe.
# shellcheck source-path=SCRIPTDIR
# shellcheck source=select-gpod-prebuild.sh
source "$CLI_DIR/scripts/select-gpod-prebuild.sh"
PREBUILD_DIR=$(gpod_prebuild_dir "$PLATFORM" "$ARCH" "$LIBGPOD_DIR")
PREBUILD=$(find_gpod_prebuild "$PREBUILD_DIR")
LOCAL_BUILD="$LIBGPOD_DIR/build/Release/gpod_binding.node"

if [ -n "$PREBUILD" ]; then
  cp "$PREBUILD" "$STAGED"
  echo "Staged prebuild: ${PREBUILD#"$LIBGPOD_DIR/"}"
elif [ -f "$LOCAL_BUILD" ]; then
  cp "$LOCAL_BUILD" "$STAGED"
  echo "Staged local build: build/Release/gpod_binding.node"
else
  echo "ERROR: No native binding found."
  echo "  Searched: $PREBUILD_DIR/*.node"
  echo "       and: $LOCAL_BUILD (local node-gyp build)"
  echo "  Run 'bun run build:native' in packages/libgpod-node to build from source,"
  echo "  or run 'bunx prebuildify --napi --strip' to create a prebuild."
  exit 1
fi

# Stage the matching `usb` npm prebuild. The package ships per-platform .node
# files under node_modules/usb/prebuilds/; node-gyp-build picks the right one
# at runtime, but that lookup fails inside a compiled binary — so we copy the
# resolved file to a fixed path that the bundler plugin (compile-build.ts)
# embeds via a static require during the build.
USB_PKG_DIR=$(cd "$CLI_DIR/../ipod-firmware" && bun -e "console.log(require('path').dirname(require.resolve('usb/package.json')))")
USB_PREBUILD=""
case "$PLATFORM" in
  darwin)
    USB_PREBUILD="$USB_PKG_DIR/prebuilds/darwin-x64+arm64/node.napi.node"
    ;;
  linux)
    # arm64 ships a single ABI-tagged prebuild (node.napi.armv8.node) — no
    # glibc/musl split. Only linux-x64 has the libc-variant filenames.
    if [ "$ARCH" = "arm64" ]; then
      USB_PREBUILD="$USB_PKG_DIR/prebuilds/linux-arm64/node.napi.armv8.node"
    else
      if host_is_musl; then USB_VARIANT=musl; else USB_VARIANT=glibc; fi
      USB_PREBUILD="$USB_PKG_DIR/prebuilds/linux-${ARCH}/node.napi.${USB_VARIANT}.node"
    fi
    ;;
  *)
    echo "ERROR: unsupported platform for usb prebuild: $PLATFORM"
    exit 1
    ;;
esac
if [ ! -f "$USB_PREBUILD" ]; then
  echo "ERROR: usb prebuild not found at $USB_PREBUILD"
  exit 1
fi
cp "$USB_PREBUILD" "$USB_STAGED"
echo "Staged usb prebuild: ${USB_PREBUILD#"$USB_PKG_DIR/"}"

# Compile the CLI binary
#
# Dev-hook policy (TASK-405 / dev-builds.md):
#   PODKIT_DEV_HOOKS=1 → __PODKIT_DEV_HOOKS__=true, output bin/podkit-debug.
#   Otherwise          → __PODKIT_DEV_HOOKS__=false, output bin/podkit
#                        (production: the dev-hooks ternary collapses + the
#                        bundler tree-shakes the body away).
cd "$CLI_DIR"
VERSION="${PODKIT_VERSION_OVERRIDE:-$(bun -e "console.log(require('./package.json').version)")}"

if [ "${PODKIT_DEV_HOOKS:-0}" = "1" ]; then
  DEV_HOOKS_DEFINE="true"
  OUTFILE="bin/podkit-debug"
  BUILD_LABEL="debug"
else
  DEV_HOOKS_DEFINE="false"
  OUTFILE="bin/podkit"
  BUILD_LABEL="production"
fi

PODKIT_COMPILE_OUTFILE="$OUTFILE" \
PODKIT_COMPILE_VERSION="$VERSION" \
PODKIT_COMPILE_DEV_HOOKS="$DEV_HOOKS_DEFINE" \
bun scripts/compile-build.ts

echo "Compiled: $OUTFILE (v$VERSION, $BUILD_LABEL)"
