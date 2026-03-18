#!/bin/bash
# Output linker flags for libgpod-node native build.
#
# When STATIC_DEPS_DIR is set (CI prebuild):
#   macOS: Statically link everything (.a files) — no runtime native deps
#   Linux: Statically link everything (.a files built with -fPIC) — no runtime native deps
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
    add_static "${STATIC_DEPS_DIR}/lib/libffi.a" "-lffi"
    add_static "${STATIC_DEPS_DIR}/lib/libpcre2-8.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libintl.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libpng16.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libjpeg.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libtiff.a" ""
    LIBS="$LIBS -liconv -lz -lm -lresolv -framework Foundation -framework CoreFoundation -framework AppKit -framework Carbon"
  else
    # Linux: statically link everything — all .a files built with -fPIC
    # Glib libraries may be in lib/ or lib/{arch}-linux-gnu/ depending on meson
    LINUX_ARCH="$(uname -m)"
    case "$LINUX_ARCH" in
      x86_64)  MULTIARCH="x86_64-linux-gnu" ;;
      aarch64) MULTIARCH="aarch64-linux-gnu" ;;
      *)       MULTIARCH="$LINUX_ARCH-linux-gnu" ;;
    esac

    # Helper: add .a checking both lib/ and lib/$MULTIARCH/
    add_static_multiarch() {
      local name="$1"
      if [ -f "${STATIC_DEPS_DIR}/lib/${name}" ]; then
        LIBS="$LIBS ${STATIC_DEPS_DIR}/lib/${name}"
      elif [ -f "${STATIC_DEPS_DIR}/lib/${MULTIARCH}/${name}" ]; then
        LIBS="$LIBS ${STATIC_DEPS_DIR}/lib/${MULTIARCH}/${name}"
      fi
    }

    add_static "${STATIC_DEPS_DIR}/lib/libgpod.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libgdk_pixbuf-2.0.a" ""
    add_static_multiarch "libgio-2.0.a"
    add_static_multiarch "libgobject-2.0.a"
    add_static_multiarch "libgmodule-2.0.a"
    add_static_multiarch "libglib-2.0.a"
    add_static "${STATIC_DEPS_DIR}/lib/libplist-2.0.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libxml2.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libsqlite3.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libffi.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libpcre2-8.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libpng16.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libjpeg.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libtiff.a" ""
    add_static "${STATIC_DEPS_DIR}/lib/libz.a" ""
    LIBS="$LIBS -lm -lpthread -ldl"

    # glibc has a separate libresolv; musl includes the resolver in libc
    if ldd /bin/sh 2>/dev/null | grep -q musl; then
      : # musl — resolver is built into libc
    else
      LIBS="$LIBS -lresolv"
    fi
  fi

  echo "$LIBS"
else
  if [ "$(uname)" = "Darwin" ]; then
    PKG_CONFIG_PATH="${HOME}/.local/lib/pkgconfig:${PKG_CONFIG_PATH}" pkg-config --libs libgpod-1.0 glib-2.0
  else
    pkg-config --libs libgpod-1.0 glib-2.0
  fi
fi
