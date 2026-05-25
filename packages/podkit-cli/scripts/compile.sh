#!/usr/bin/env bash
set -euo pipefail

# Compile the CLI into a standalone binary with the native .node addon embedded.
#
# Bun's --compile detects static require() calls to .node files and embeds
# them in the compiled binary. At runtime, Bun extracts the .node to a temp
# file, dlopen's it, then deletes it — producing a true single-file binary.
#
# This script stages the correct platform's .node file to a known path
# (packages/libgpod-node/gpod_binding.node) that binding.ts statically
# requires, then compiles the CLI.

CLI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LIBGPOD_DIR="$CLI_DIR/../libgpod-node"

STAGED="$CLI_DIR/gpod_binding.node"
USB_STAGED="$CLI_DIR/usb_native.node"

# Detect platform and arch using bun (always available) instead of node (may not be).
PLATFORM=$(bun -e 'console.log(process.platform)')
ARCH=$(bun -e 'console.log(process.arch)')

# Try prebuild first (CI creates these via prebuildify), then local node-gyp build.
# Prebuildify names the file after the package (e.g., @podkit+libgpod-node.node),
# so we find any .node file in the platform directory rather than hardcoding.
# On musl Linux (Alpine), prebuildify creates a linux-{arch}-musl directory.
PREBUILD=""
for DIR in "$LIBGPOD_DIR/prebuilds/${PLATFORM}-${ARCH}-musl" "$LIBGPOD_DIR/prebuilds/${PLATFORM}-${ARCH}"; do
  if [ -d "$DIR" ]; then
    PREBUILD=$(find "$DIR" -name "*.node" -type f | head -1)
    [ -n "$PREBUILD" ] && break
  fi
done
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
  echo "       and: $LOCAL_BUILD"
  echo "  Run 'bun run build:native' in packages/libgpod-node to build from source,"
  echo "  or run 'bunx prebuildify --napi --strip' to create a prebuild."
  exit 1
fi

# Stage the matching `usb` npm prebuild. The package ships per-platform .node
# files under node_modules/usb/prebuilds/; node-gyp-build picks the right one
# at runtime, but Bun --compile only embeds .node files reached via static
# require() — so we copy the resolved file to a fixed path that compile-entry
# can require statically.
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
      if ldd /bin/sh 2>/dev/null | grep -q musl; then USB_VARIANT=musl; else USB_VARIANT=glibc; fi
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

cleanup() { rm -f "$STAGED" "$USB_STAGED"; }
trap cleanup EXIT

# Compile the CLI binary
cd "$CLI_DIR"
VERSION="${PODKIT_VERSION_OVERRIDE:-$(bun -e "console.log(require('./package.json').version)")}"
bun build --compile src/compile-entry.js --outfile bin/podkit --define "PODKIT_VERSION='$VERSION'"

echo "Compiled: bin/podkit (v$VERSION)"
