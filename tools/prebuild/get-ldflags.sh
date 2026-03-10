#!/bin/bash
# Output linker flags for libgpod-node native build.
#
# When STATIC_DEPS_DIR is set (CI prebuild), outputs flags to statically
# link libgpod and all dependencies into the .node binary.
# Otherwise, falls back to pkg-config for dynamic linking.

set -e

if [ -n "$STATIC_DEPS_DIR" ]; then
  # Static linking: reference .a files directly so no dynamic deps remain.
  # Order matters for static linking — dependents before dependencies.
  LIBS=""

  # Helper: add .a if it exists, otherwise try dynamic -l flag, or skip
  add_static() {
    local path="$1"
    local fallback_flag="$2"  # e.g. "-lplist-2.0" or "" to skip
    if [ -f "$path" ]; then
      LIBS="$LIBS $path"
    elif [ -n "$fallback_flag" ]; then
      LIBS="$LIBS $fallback_flag"
    fi
  }

  # libgpod (core)
  add_static "${STATIC_DEPS_DIR}/lib/libgpod.a" "-lgpod"

  # GLib stack
  add_static "${STATIC_DEPS_DIR}/lib/libgio-2.0.a" "-lgio-2.0"
  add_static "${STATIC_DEPS_DIR}/lib/libgobject-2.0.a" "-lgobject-2.0"
  add_static "${STATIC_DEPS_DIR}/lib/libgmodule-2.0.a" "-lgmodule-2.0"
  add_static "${STATIC_DEPS_DIR}/lib/libglib-2.0.a" "-lglib-2.0"

  # gdk-pixbuf (for artwork)
  add_static "${STATIC_DEPS_DIR}/lib/libgdk_pixbuf-2.0.a" "-lgdk_pixbuf-2.0"

  # libplist (for iPhone/iPod Touch support) — optional, may not have .a on Linux
  add_static "${STATIC_DEPS_DIR}/lib/libplist-2.0.a" "-lplist-2.0"

  # GLib/GObject transitive deps
  add_static "${STATIC_DEPS_DIR}/lib/libffi.a" "-lffi"
  add_static "${STATIC_DEPS_DIR}/lib/libpcre2-8.a" "-lpcre2-8"
  # libintl: on Linux/glibc, gettext is built into libc — no separate lib needed
  add_static "${STATIC_DEPS_DIR}/lib/libintl.a" ""

  # Image format libs (gdk-pixbuf dependencies)
  add_static "${STATIC_DEPS_DIR}/lib/libpng16.a" "-lpng16"
  add_static "${STATIC_DEPS_DIR}/lib/libjpeg.a" "-ljpeg"
  add_static "${STATIC_DEPS_DIR}/lib/libtiff.a" "-ltiff"

  # System libraries
  if [ "$(uname)" = "Darwin" ]; then
    LIBS="$LIBS -liconv -lz -lm -lresolv -framework Foundation -framework CoreFoundation -framework AppKit -framework Carbon"
  else
    LIBS="$LIBS -lz -lm -lresolv -lpthread"
  fi

  echo "$LIBS"
else
  if [ "$(uname)" = "Darwin" ]; then
    PKG_CONFIG_PATH="${HOME}/.local/lib/pkgconfig:${PKG_CONFIG_PATH}" pkg-config --libs libgpod-1.0 glib-2.0
  else
    pkg-config --libs libgpod-1.0 glib-2.0
  fi
fi
