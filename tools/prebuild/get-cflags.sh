#!/bin/bash
# Output compiler flags for libgpod-node native build.
#
# When STATIC_DEPS_DIR is set (CI prebuild):
#   macOS: Use Homebrew pkg-config for headers (we don't copy headers to STATIC_DEPS_DIR)
#   Linux: Use STATIC_DEPS_DIR pkg-config for headers (everything built from source)
# Otherwise: falls back to local pkg-config (development build).

set -e

if [ -n "$STATIC_DEPS_DIR" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    # macOS: headers come from Homebrew — same as local dev builds
    HOMEBREW_PREFIX="$(brew --prefix)"
    LIBPLIST_PREFIX="$(brew --prefix libplist)"
    PKG_CONFIG_PATH="$STATIC_DEPS_DIR/lib/pkgconfig:$HOMEBREW_PREFIX/lib/pkgconfig:$LIBPLIST_PREFIX/lib/pkgconfig" \
      pkg-config --cflags libgpod-1.0 glib-2.0 gdk-pixbuf-2.0
  else
    # Linux: headers from STATIC_DEPS_DIR (everything built from source)
    # Include multi-arch path since meson may install glib to lib/{arch}-linux-gnu/
    LINUX_ARCH="$(uname -m)"
    case "$LINUX_ARCH" in
      x86_64)  MULTIARCH="x86_64-linux-gnu" ;;
      aarch64) MULTIARCH="aarch64-linux-gnu" ;;
      *)       MULTIARCH="$LINUX_ARCH-linux-gnu" ;;
    esac
    PKG_CONFIG_PATH="$STATIC_DEPS_DIR/lib/pkgconfig:$STATIC_DEPS_DIR/lib/$MULTIARCH/pkgconfig" \
      pkg-config --cflags libgpod-1.0 glib-2.0 gdk-pixbuf-2.0
  fi
else
  if [ "$(uname)" = "Darwin" ]; then
    PKG_CONFIG_PATH="${HOME}/.local/lib/pkgconfig:${PKG_CONFIG_PATH}" pkg-config --cflags libgpod-1.0 glib-2.0
  else
    pkg-config --cflags libgpod-1.0 glib-2.0
  fi
fi
