#!/bin/bash
# Output compiler flags for libgpod-node native build.
#
# When STATIC_DEPS_DIR is set (CI prebuild):
#   macOS: Use Homebrew pkg-config for headers (we don't copy headers to STATIC_DEPS_DIR)
#   Linux: Use system pkg-config for headers
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
    # Linux: headers come from system -dev packages
    pkg-config --cflags libgpod-1.0 glib-2.0 gdk-pixbuf-2.0
  fi
else
  if [ "$(uname)" = "Darwin" ]; then
    PKG_CONFIG_PATH="${HOME}/.local/lib/pkgconfig:${PKG_CONFIG_PATH}" pkg-config --cflags libgpod-1.0 glib-2.0
  else
    pkg-config --cflags libgpod-1.0 glib-2.0
  fi
fi
