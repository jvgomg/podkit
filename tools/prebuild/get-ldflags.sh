#!/bin/bash
# Output linker flags for libgpod-node native build.
#
# When STATIC_DEPS_DIR is set (CI prebuild):
#   macOS: Statically link everything (.a files) — no runtime native deps
#   Linux: Statically link libgpod + gdk-pixbuf (built with -fPIC),
#          dynamically link system libs (glib, libffi, etc. — always present)
# Otherwise: falls back to pkg-config for dynamic linking (development).

set -e

if [ -n "$STATIC_DEPS_DIR" ]; then
  LIBS=""

  # Helper: add .a if it exists, otherwise use dynamic -l flag
  add_static() {
    local path="$1"
    local fallback_flag="$2"
    if [ -f "$path" ]; then
      LIBS="$LIBS $path"
    elif [ -n "$fallback_flag" ]; then
      LIBS="$LIBS $fallback_flag"
    fi
  }

  if [ "$(uname)" = "Darwin" ]; then
    # macOS: statically link everything — all .a files are built with -fPIC
    add_static "${STATIC_DEPS_DIR}/lib/libgpod.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libgio-2.0.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libgobject-2.0.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libgmodule-2.0.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libglib-2.0.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libgdk_pixbuf-2.0.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libplist-2.0.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libffi.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libpcre2-8.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libintl.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libpng16.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libjpeg.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libtiff.a" ""
    LIBS="$LIBS -liconv -lz -lm -lresolv -framework Foundation -framework CoreFoundation -framework AppKit -framework Carbon"
  else
    # Linux: only statically link libs we built with -fPIC (libgpod, gdk-pixbuf).
    # System .a files lack -fPIC, so link those dynamically. GLib, libffi, etc.
    # are standard system libs present on any Linux install.
    add_static "${STATIC_DEPS_DIR}/lib/libgpod.a" "-lgpod"
    add_static "${STATIC_DEPS_DIR}/lib/libgdk_pixbuf-2.0.a" "-lgdk_pixbuf-2.0"
    LIBS="$LIBS $(pkg-config --libs glib-2.0 gobject-2.0 gio-2.0 gmodule-2.0)"
    LIBS="$LIBS -lplist-2.0 -lpng16 -ljpeg -ltiff -lz -lm -lresolv -lpthread"
  fi

  echo "$LIBS"
else
  if [ "$(uname)" = "Darwin" ]; then
    PKG_CONFIG_PATH="${HOME}/.local/lib/pkgconfig:${PKG_CONFIG_PATH}" pkg-config --libs libgpod-1.0 glib-2.0
  else
    pkg-config --libs libgpod-1.0 glib-2.0
  fi
fi
