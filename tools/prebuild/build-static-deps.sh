#!/bin/bash
set -e

# Build static dependencies for libgpod-node prebuilds.
#
# Produces .a files at STATIC_DEPS_DIR/lib/ so the .node binary can be
# statically linked with no runtime dependency on libgpod, glib, etc.
#
# Usage:
#   STATIC_DEPS_DIR=/path/to/prefix ./build-static-deps.sh
#
# Platforms:
#   macOS: Uses Homebrew headers for compilation, collects .a files for linking,
#          builds gdk-pixbuf and libgpod from source (Homebrew doesn't ship .a for these)
#   Linux: Uses system -dev packages (incl. libgpod-dev), builds gdk-pixbuf from source

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

STATIC_DEPS_DIR="${STATIC_DEPS_DIR:-$REPO_ROOT/static-deps}"
WORK_DIR="${WORK_DIR:-$REPO_ROOT/.prebuild-work}"
NPROC=$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 4)

GDK_PIXBUF_VERSION="2.42.12"

log() { echo "==> $1"; }

mkdir -p "$STATIC_DEPS_DIR/lib"
mkdir -p "$WORK_DIR"

OS="$(uname)"

# ---------------------------------------------------------------------------
# Shared: build gdk-pixbuf .a from source (neither platform ships it)
# ---------------------------------------------------------------------------
build_gdk_pixbuf_static() {
  local pkg_config_path="$1"
  local extra_c_args="$2"
  local extra_link_args="$3"

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
    -Dc_args="$extra_c_args" \
    -Dc_link_args="$extra_link_args" \
    -Dman=false -Dgtk_doc=false -Dintrospection=disabled \
    -Dinstalled_tests=false -Dbuiltin_loaders=all \
    -Dgio_sniffing=false -Dtests=false

  # Only build the static library — skip utility executables which fail
  # linking due to libtiff's many transitive deps (zstd, lzma, jbig, etc.)
  ninja -C _build -j"$NPROC" gdk-pixbuf/libgdk_pixbuf-2.0.a

  cp _build/gdk-pixbuf/libgdk_pixbuf-2.0.a "$STATIC_DEPS_DIR/lib/"
  cd "$WORK_DIR"
}

# ---------------------------------------------------------------------------
# macOS — use Homebrew for headers, just collect .a files
# ---------------------------------------------------------------------------
if [ "$OS" = "Darwin" ]; then
  HOMEBREW_PREFIX="$(brew --prefix)"

  copy_if_exists() {
    if [ -f "$1" ]; then cp "$1" "$2"; else log "  WARNING: $1 not found"; fi
  }

  # 1. Copy .a files from Homebrew (headers stay in Homebrew — used via pkg-config)
  log "Copying static libraries from Homebrew..."

  GLIB_PREFIX="$(brew --prefix glib)"
  for lib in libglib-2.0.a libgobject-2.0.a libgio-2.0.a libgmodule-2.0.a; do
    copy_if_exists "$GLIB_PREFIX/lib/$lib" "$STATIC_DEPS_DIR/lib/$lib"
  done

  GETTEXT_PREFIX="$(brew --prefix gettext)"
  copy_if_exists "$GETTEXT_PREFIX/lib/libintl.a" "$STATIC_DEPS_DIR/lib/libintl.a"

  PCRE2_PREFIX="$(brew --prefix pcre2)"
  copy_if_exists "$PCRE2_PREFIX/lib/libpcre2-8.a" "$STATIC_DEPS_DIR/lib/libpcre2-8.a"

  LIBFFI_PREFIX="$(brew --prefix libffi)"
  copy_if_exists "$LIBFFI_PREFIX/lib/libffi.a" "$STATIC_DEPS_DIR/lib/libffi.a"

  LIBPLIST_PREFIX="$(brew --prefix libplist)"
  copy_if_exists "$LIBPLIST_PREFIX/lib/libplist-2.0.a" "$STATIC_DEPS_DIR/lib/libplist-2.0.a"

  for formula in libpng jpeg-turbo libtiff; do
    fprefix="$(brew --prefix "$formula" 2>/dev/null || true)"
    if [ -n "$fprefix" ] && [ -d "$fprefix" ]; then
      for a in "$fprefix"/lib/*.a; do [ -f "$a" ] && cp "$a" "$STATIC_DEPS_DIR/lib/"; done
    fi
  done

  # 2. Build gdk-pixbuf .a (Homebrew doesn't ship static lib)
  PKG_PATHS="$HOMEBREW_PREFIX/lib/pkgconfig"
  LINK_ARGS=""
  for formula in libpng jpeg-turbo libtiff zstd xz; do
    fprefix="$(brew --prefix "$formula" 2>/dev/null || true)"
    if [ -n "$fprefix" ] && [ -d "$fprefix/lib" ]; then
      LINK_ARGS="$LINK_ARGS -L$fprefix/lib"
      [ -d "$fprefix/lib/pkgconfig" ] && PKG_PATHS="$PKG_PATHS:$fprefix/lib/pkgconfig"
    fi
  done
  LINK_ARGS="$LINK_ARGS -lpng16 -ljpeg -ltiff -lz"

  build_gdk_pixbuf_static "$PKG_PATHS" "" "$LINK_ARGS"

  # 3. Build libgpod as static — use Homebrew for headers (like tools/libgpod-macos/build.sh)
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

    # Use Homebrew pkg-config paths — same as tools/libgpod-macos/build.sh
    LIBPLIST_PREFIX="$(brew --prefix libplist)"
    export PKG_CONFIG_PATH="$HOMEBREW_PREFIX/lib/pkgconfig:$LIBPLIST_PREFIX/lib/pkgconfig"
    export CFLAGS="-I$HOMEBREW_PREFIX/include -I$LIBPLIST_PREFIX/include"
    export LDFLAGS="-L$HOMEBREW_PREFIX/lib -L$LIBPLIST_PREFIX/lib"

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
# Linux: build libgpod + gdk-pixbuf from source with -fPIC, use system glib
# ---------------------------------------------------------------------------
elif [ "$OS" = "Linux" ]; then
  # On Linux, system .a files lack -fPIC so can't be statically linked into
  # a .node shared object. Only build libgpod and gdk-pixbuf from source
  # with -fPIC. Everything else (glib, libffi, etc.) links dynamically —
  # they're standard system libs present on any Linux install.

  # Build gdk-pixbuf .a from source with -fPIC (Ubuntu doesn't ship it)
  SYS_PKG_PATH=$(pkg-config --variable pc_path pkg-config 2>/dev/null || echo "/usr/lib/pkgconfig:/usr/share/pkgconfig")
  build_gdk_pixbuf_static \
    "$SYS_PKG_PATH" \
    "-fPIC" \
    "-lpng16 -ljpeg -ltiff -lz"

  # Build libgpod from source with -fPIC (Ubuntu's libgpod.a lacks -fPIC)
  if [ ! -f "$STATIC_DEPS_DIR/lib/libgpod.a" ]; then
    log "Building libgpod from source (static, -fPIC)..."
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

    # -Wno-incompatible-pointer-types: libgpod 0.8.3's ithumb-writer.c triggers
    # -Werror=incompatible-pointer-types in GCC 14+ (newer GLib g_object_ref macro)
    export CFLAGS="-fPIC -Wno-incompatible-pointer-types $(pkg-config --cflags glib-2.0 gdk-pixbuf-2.0 libplist-2.0)"
    export LDFLAGS="$(pkg-config --libs glib-2.0)"

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

  log "Linux static dependencies built to $STATIC_DEPS_DIR"
fi

# ---------------------------------------------------------------------------
# Verify
# ---------------------------------------------------------------------------
log "Verifying static dependencies..."
MISSING=""
if [ "$OS" = "Darwin" ]; then
  REQUIRED="libgpod.a libglib-2.0.a libgobject-2.0.a libgdk_pixbuf-2.0.a"
else
  # Linux: only libgpod and gdk-pixbuf are statically linked (glib is dynamic)
  REQUIRED="libgpod.a libgdk_pixbuf-2.0.a"
fi
for lib in $REQUIRED; do
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
