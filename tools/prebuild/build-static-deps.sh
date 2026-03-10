#!/bin/bash
set -e

# Build static dependencies for libgpod-node prebuilds.
#
# Produces a self-contained prefix at STATIC_DEPS_DIR with static libraries
# for libgpod and all its transitive dependencies. The resulting .node binary
# will have no runtime dependency on libgpod, glib, or any other native lib.
#
# Usage:
#   STATIC_DEPS_DIR=/path/to/prefix ./build-static-deps.sh
#
# Platforms:
#   macOS (x64/arm64): Copies Homebrew static libs + builds gdk-pixbuf and libgpod from source
#   Linux (x64/arm64): Uses system -dev packages (incl. libgpod-dev) + builds gdk-pixbuf from source

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

STATIC_DEPS_DIR="${STATIC_DEPS_DIR:-$REPO_ROOT/static-deps}"
WORK_DIR="${WORK_DIR:-$REPO_ROOT/.prebuild-work}"
NPROC=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

GDK_PIXBUF_VERSION="2.42.12"

log() { echo "==> $1"; }

mkdir -p "$STATIC_DEPS_DIR/lib" "$STATIC_DEPS_DIR/include" "$STATIC_DEPS_DIR/lib/pkgconfig"
mkdir -p "$WORK_DIR"

OS="$(uname)"

# ---------------------------------------------------------------------------
# Shared: build gdk-pixbuf from source as static (neither platform ships .a)
# ---------------------------------------------------------------------------
build_gdk_pixbuf_static() {
  local pkg_config_path="$1"
  local extra_link_args="$2"

  if [ -f "$STATIC_DEPS_DIR/lib/libgdk_pixbuf-2.0.a" ]; then
    log "gdk-pixbuf already built, skipping"
    return
  fi

  cd "$WORK_DIR"
  if [ ! -d "gdk-pixbuf-${GDK_PIXBUF_VERSION}" ]; then
    log "Downloading gdk-pixbuf source..."
    curl -sL "https://download.gnome.org/sources/gdk-pixbuf/2.42/gdk-pixbuf-${GDK_PIXBUF_VERSION}.tar.xz" | tar xJ
  fi

  log "Building gdk-pixbuf (static)..."
  cd "gdk-pixbuf-${GDK_PIXBUF_VERSION}"
  rm -rf _build
  meson setup _build --prefix="$STATIC_DEPS_DIR" \
    --default-library=static \
    --pkg-config-path="$pkg_config_path" \
    -Dc_args="-I$STATIC_DEPS_DIR/include" \
    -Dc_link_args="-L$STATIC_DEPS_DIR/lib $extra_link_args" \
    -Dman=false -Dgtk_doc=false -Dintrospection=disabled \
    -Dinstalled_tests=false -Dbuiltin_loaders=png,jpeg \
    -Dtests=false
  ninja -C _build -j"$NPROC"
  ninja -C _build install
  cd "$WORK_DIR"
}

# ---------------------------------------------------------------------------
# macOS
# ---------------------------------------------------------------------------
if [ "$OS" = "Darwin" ]; then
  HOMEBREW_PREFIX="$(brew --prefix)"

  copy_if_exists() {
    if [ -f "$1" ]; then cp "$1" "$2"; else log "  WARNING: $1 not found"; fi
  }

  # 1. Copy Homebrew static libs
  log "Copying static libraries from Homebrew..."

  GLIB_PREFIX="$(brew --prefix glib)"
  for lib in libglib-2.0.a libgobject-2.0.a libgio-2.0.a libgmodule-2.0.a; do
    copy_if_exists "$GLIB_PREFIX/lib/$lib" "$STATIC_DEPS_DIR/lib/$lib"
  done
  cp -R "$GLIB_PREFIX/include/glib-2.0" "$STATIC_DEPS_DIR/include/" 2>/dev/null || true
  cp -R "$GLIB_PREFIX/lib/glib-2.0" "$STATIC_DEPS_DIR/lib/" 2>/dev/null || true
  for pc in glib-2.0.pc gobject-2.0.pc gio-2.0.pc gmodule-2.0.pc; do
    copy_if_exists "$GLIB_PREFIX/lib/pkgconfig/$pc" "$STATIC_DEPS_DIR/lib/pkgconfig/$pc"
  done

  GETTEXT_PREFIX="$(brew --prefix gettext)"
  copy_if_exists "$GETTEXT_PREFIX/lib/libintl.a" "$STATIC_DEPS_DIR/lib/libintl.a"
  cp "$GETTEXT_PREFIX/include/libintl.h" "$STATIC_DEPS_DIR/include/" 2>/dev/null || true

  PCRE2_PREFIX="$(brew --prefix pcre2)"
  copy_if_exists "$PCRE2_PREFIX/lib/libpcre2-8.a" "$STATIC_DEPS_DIR/lib/libpcre2-8.a"

  LIBFFI_PREFIX="$(brew --prefix libffi)"
  copy_if_exists "$LIBFFI_PREFIX/lib/libffi.a" "$STATIC_DEPS_DIR/lib/libffi.a"

  LIBPLIST_PREFIX="$(brew --prefix libplist)"
  copy_if_exists "$LIBPLIST_PREFIX/lib/libplist-2.0.a" "$STATIC_DEPS_DIR/lib/libplist-2.0.a"
  cp -R "$LIBPLIST_PREFIX/include/plist" "$STATIC_DEPS_DIR/include/" 2>/dev/null || true

  for formula in libpng jpeg-turbo libtiff; do
    fprefix="$(brew --prefix "$formula" 2>/dev/null || true)"
    if [ -n "$fprefix" ] && [ -d "$fprefix" ]; then
      for a in "$fprefix"/lib/*.a; do [ -f "$a" ] && cp "$a" "$STATIC_DEPS_DIR/lib/"; done
      cp -R "$fprefix"/include/* "$STATIC_DEPS_DIR/include/" 2>/dev/null || true
    fi
  done

  # 2. Build gdk-pixbuf (Homebrew doesn't ship .a)
  # Collect pkg-config and linker paths for image libs
  PKG_PATHS="$STATIC_DEPS_DIR/lib/pkgconfig:$HOMEBREW_PREFIX/lib/pkgconfig"
  LINK_ARGS=""
  for formula in libpng jpeg-turbo libtiff zstd xz; do
    fprefix="$(brew --prefix "$formula" 2>/dev/null || true)"
    if [ -n "$fprefix" ] && [ -d "$fprefix/lib" ]; then
      LINK_ARGS="$LINK_ARGS -L$fprefix/lib"
      [ -d "$fprefix/lib/pkgconfig" ] && PKG_PATHS="$PKG_PATHS:$fprefix/lib/pkgconfig"
    fi
  done
  LINK_ARGS="$LINK_ARGS -lpng16 -ljpeg -ltiff -lz"

  build_gdk_pixbuf_static "$PKG_PATHS" "$LINK_ARGS"

  # 3. Build libgpod as static
  if [ ! -f "$STATIC_DEPS_DIR/lib/libgpod.a" ]; then
    log "Building libgpod from source (static)..."
    cd "$WORK_DIR"

    LIBGPOD_VERSION="0.8.3"
    if [ ! -f "libgpod-${LIBGPOD_VERSION}.tar.bz2" ]; then
      log "Downloading libgpod source..."
      curl -L -o "libgpod-${LIBGPOD_VERSION}.tar.bz2" \
        "https://downloads.sourceforge.net/project/gtkpod/libgpod/libgpod-0.8/libgpod-${LIBGPOD_VERSION}.tar.bz2"
    fi

    rm -rf "libgpod-${LIBGPOD_VERSION}"
    tar -xjf "libgpod-${LIBGPOD_VERSION}.tar.bz2"
    cd "libgpod-${LIBGPOD_VERSION}"

    curl -sL -o callout.patch "https://raw.githubusercontent.com/macports/macports-ports/master/multimedia/libgpod/files/patch-tools-generic-callout.c.diff"
    curl -sL -o libplist.patch "https://raw.githubusercontent.com/pld-linux/libgpod/master/libgpod-libplist.patch"
    patch -p0 < callout.patch
    patch -p1 < libplist.patch

    export PKG_CONFIG_PATH="$STATIC_DEPS_DIR/lib/pkgconfig:$HOMEBREW_PREFIX/lib/pkgconfig"
    export CFLAGS="-I$STATIC_DEPS_DIR/include -I$HOMEBREW_PREFIX/include"
    export LDFLAGS="-L$STATIC_DEPS_DIR/lib -L$HOMEBREW_PREFIX/lib"

    autoreconf -fi
    ./configure \
      --prefix="$STATIC_DEPS_DIR" \
      --enable-static --disable-shared \
      --disable-more-warnings --disable-silent-rules \
      --disable-udev --disable-pygobject \
      --with-python=no --without-hal
    make -j"$NPROC"
    make install
  else
    log "libgpod already built, skipping"
  fi

  log "macOS static dependencies built to $STATIC_DEPS_DIR"

# ---------------------------------------------------------------------------
# Linux: use system -dev packages, only build gdk-pixbuf from source
# ---------------------------------------------------------------------------
elif [ "$OS" = "Linux" ]; then
  log "Collecting system static libraries..."

  # Copy system .a files to our prefix
  for lib in libgpod.a \
             libglib-2.0.a libgobject-2.0.a libgio-2.0.a libgmodule-2.0.a \
             libffi.a libpcre2-8.a libplist-2.0.a \
             libpng16.a libpng.a libjpeg.a libtiff.a libz.a \
             libsqlite3.a libintl.a; do
    found=$(find /usr/lib /usr/lib64 /usr/local/lib -name "$lib" 2>/dev/null | head -1)
    [ -n "$found" ] && cp "$found" "$STATIC_DEPS_DIR/lib/"
  done

  # Copy headers
  for dir in /usr/include/glib-2.0 /usr/include/gdk-pixbuf-2.0 /usr/include/gpod-1.0; do
    [ -d "$dir" ] && cp -R "$dir" "$STATIC_DEPS_DIR/include/"
  done
  # GLib internal config header (glibconfig.h)
  GLIB_INTERNAL=$(find /usr/lib /usr/lib64 -path "*/glib-2.0/include" 2>/dev/null | head -1)
  if [ -n "$GLIB_INTERNAL" ]; then
    mkdir -p "$STATIC_DEPS_DIR/lib/glib-2.0"
    cp -R "$GLIB_INTERNAL" "$STATIC_DEPS_DIR/lib/glib-2.0/"
  fi

  # Copy pkg-config files
  for pc in glib-2.0.pc gobject-2.0.pc gio-2.0.pc gdk-pixbuf-2.0.pc libgpod-1.0.pc; do
    found=$(find /usr/lib /usr/lib64 /usr/share -path "*pkgconfig/$pc" 2>/dev/null | head -1)
    [ -n "$found" ] && cp "$found" "$STATIC_DEPS_DIR/lib/pkgconfig/"
  done

  # Build gdk-pixbuf from source (Ubuntu doesn't ship libgdk_pixbuf-2.0.a)
  SYS_PKG_PATH=$(pkg-config --variable pc_path pkg-config 2>/dev/null || echo "/usr/lib/pkgconfig:/usr/share/pkgconfig")
  build_gdk_pixbuf_static \
    "$STATIC_DEPS_DIR/lib/pkgconfig:$SYS_PKG_PATH" \
    "-lpng16 -ljpeg -ltiff -lz"

  log "Linux static dependencies built to $STATIC_DEPS_DIR"
fi

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------
log "Verifying static dependencies..."
MISSING=""
for lib in libgpod.a libglib-2.0.a libgobject-2.0.a libgdk_pixbuf-2.0.a; do
  if [ ! -f "$STATIC_DEPS_DIR/lib/$lib" ]; then
    MISSING="$MISSING $lib"
  fi
done

if [ -n "$MISSING" ]; then
  log "ERROR: Missing static libraries:$MISSING"
  exit 1
fi

log "All required static libraries present in $STATIC_DEPS_DIR/lib/"
ls -la "$STATIC_DEPS_DIR/lib/"*.a
