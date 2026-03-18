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
#   Linux: Builds ALL dependencies from source with -fPIC for full static linking.
#          Requires: cmake, meson, ninja-build, autoconf, automake, libtool

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
  # Install headers and pkgconfig (ninja install would build executables that fail to link)
  mkdir -p "$STATIC_DEPS_DIR/include/gdk-pixbuf-2.0/gdk-pixbuf"
  # Copy all public headers from source dir
  cp gdk-pixbuf/*.h "$STATIC_DEPS_DIR/include/gdk-pixbuf-2.0/gdk-pixbuf/" 2>/dev/null || true
  # Copy generated headers from build dir (gdk-pixbuf-features.h, gdk-pixbuf-enum-types.h, etc.)
  cp _build/gdk-pixbuf/*.h "$STATIC_DEPS_DIR/include/gdk-pixbuf-2.0/gdk-pixbuf/" 2>/dev/null || true
  # Install pkgconfig file
  cp _build/meson-private/gdk-pixbuf-2.0.pc "$STATIC_DEPS_DIR/lib/pkgconfig/" 2>/dev/null || true
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
# Linux: build ALL dependencies from source with -fPIC for full static linking
# ---------------------------------------------------------------------------
elif [ "$OS" = "Linux" ]; then
  # On Linux, system .a files lack -fPIC so can't be statically linked into
  # a .node shared object. Build everything from source with -fPIC.

  # Detect architecture for multi-arch pkgconfig paths
  LINUX_ARCH="$(uname -m)"
  case "$LINUX_ARCH" in
    x86_64)  MULTIARCH="x86_64-linux-gnu" ;;
    aarch64) MULTIARCH="aarch64-linux-gnu" ;;
    *)       MULTIARCH="$LINUX_ARCH-linux-gnu" ;;
  esac

  # Consolidated PKG_CONFIG_PATH for our static deps (updated as libs are built)
  STATIC_PKG_PATH="$STATIC_DEPS_DIR/lib/pkgconfig:$STATIC_DEPS_DIR/lib/$MULTIARCH/pkgconfig"

  # On musl (Alpine), glib references libintl_* symbols even with -Dnls=disabled
  # because the musl-libintl header maps dcgettext -> libintl_dcgettext.
  # Alpine's gettext-static libintl.a lacks -fPIC on x86_64, so build from source.
  IS_MUSL=false
  if ldd /bin/sh 2>/dev/null | grep -q musl; then IS_MUSL=true; fi
  if $IS_MUSL && [ ! -f "$STATIC_DEPS_DIR/lib/libintl.a" ]; then
    log "Building gettext libintl (static, -fPIC) for musl..."
    cd "$WORK_DIR"
    GETTEXT_VERSION="0.22.5"
    if [ ! -f "gettext-${GETTEXT_VERSION}.tar.gz" ]; then
      curl -L -o "gettext-${GETTEXT_VERSION}.tar.gz" \
        "https://ftp.gnu.org/pub/gnu/gettext/gettext-${GETTEXT_VERSION}.tar.gz"
    fi
    rm -rf "gettext-${GETTEXT_VERSION}"
    tar xzf "gettext-${GETTEXT_VERSION}.tar.gz"
    cd "gettext-${GETTEXT_VERSION}/gettext-runtime"
    ./configure --prefix="$STATIC_DEPS_DIR" --enable-static --disable-shared \
      --disable-java --disable-csharp --disable-libasprintf \
      CFLAGS="-fPIC"
    make -C intl -j"$NPROC"
    make -C intl install
  fi

  # -----------------------------------------------------------------------
  # Phase 1: No-dependency libraries (zlib, libffi, pcre2, sqlite3)
  # -----------------------------------------------------------------------

  # --- zlib 1.3.1 ---
  if [ ! -f "$STATIC_DEPS_DIR/lib/libz.a" ]; then
    log "Building zlib 1.3.1 (static, -fPIC)..."
    cd "$WORK_DIR"
    if [ ! -f "zlib-1.3.1.tar.gz" ]; then
      curl -L -o zlib-1.3.1.tar.gz https://github.com/madler/zlib/releases/download/v1.3.1/zlib-1.3.1.tar.gz
    fi
    rm -rf zlib-1.3.1
    tar xzf zlib-1.3.1.tar.gz
    cd zlib-1.3.1
    cmake -B build \
      -DCMAKE_INSTALL_PREFIX="$STATIC_DEPS_DIR" \
      -DCMAKE_C_FLAGS="-fPIC" \
      -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
      -DBUILD_SHARED_LIBS=OFF
    cmake --build build -j"$NPROC"
    cmake --install build
  else
    log "zlib already built, skipping"
  fi

  # --- libffi 3.4.6 ---
  if [ ! -f "$STATIC_DEPS_DIR/lib/libffi.a" ]; then
    log "Building libffi 3.4.6 (static, -fPIC)..."
    cd "$WORK_DIR"
    if [ ! -f "libffi-3.4.6.tar.gz" ]; then
      curl -L -o libffi-3.4.6.tar.gz https://github.com/libffi/libffi/releases/download/v3.4.6/libffi-3.4.6.tar.gz
    fi
    rm -rf libffi-3.4.6
    tar xzf libffi-3.4.6.tar.gz
    cd libffi-3.4.6
    ./configure --prefix="$STATIC_DEPS_DIR" --enable-static --disable-shared CFLAGS="-fPIC"
    make -j"$NPROC"
    make install
  else
    log "libffi already built, skipping"
  fi

  # --- pcre2 10.44 ---
  if [ ! -f "$STATIC_DEPS_DIR/lib/libpcre2-8.a" ]; then
    log "Building pcre2 10.44 (static, -fPIC)..."
    cd "$WORK_DIR"
    if [ ! -f "pcre2-10.44.tar.gz" ]; then
      curl -L -o pcre2-10.44.tar.gz https://github.com/PCRE2Project/pcre2/releases/download/pcre2-10.44/pcre2-10.44.tar.gz
    fi
    rm -rf pcre2-10.44
    tar xzf pcre2-10.44.tar.gz
    cd pcre2-10.44
    cmake -B build \
      -DCMAKE_INSTALL_PREFIX="$STATIC_DEPS_DIR" \
      -DCMAKE_C_FLAGS="-fPIC" \
      -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
      -DBUILD_SHARED_LIBS=OFF \
      -DPCRE2_BUILD_PCRE2_8=ON \
      -DPCRE2_BUILD_PCRE2_16=OFF \
      -DPCRE2_BUILD_PCRE2_32=OFF \
      -DPCRE2_BUILD_TESTS=OFF \
      -DPCRE2_BUILD_PCRE2GREP=OFF
    cmake --build build -j"$NPROC"
    cmake --install build
  else
    log "pcre2 already built, skipping"
  fi

  # --- sqlite3 3.45.3 ---
  if [ ! -f "$STATIC_DEPS_DIR/lib/libsqlite3.a" ]; then
    log "Building sqlite3 3.45.3 (static, -fPIC)..."
    cd "$WORK_DIR"
    if [ ! -f "sqlite-autoconf-3450300.tar.gz" ]; then
      curl -L -o sqlite-autoconf-3450300.tar.gz https://www.sqlite.org/2024/sqlite-autoconf-3450300.tar.gz
    fi
    rm -rf sqlite-autoconf-3450300
    tar xzf sqlite-autoconf-3450300.tar.gz
    cd sqlite-autoconf-3450300
    ./configure --prefix="$STATIC_DEPS_DIR" --enable-static --disable-shared CFLAGS="-fPIC"
    make -j"$NPROC"
    make install
  else
    log "sqlite3 already built, skipping"
  fi

  # -----------------------------------------------------------------------
  # Phase 2: glib (needs libffi, pcre2, zlib)
  # -----------------------------------------------------------------------

  # --- glib 2.82.4 ---
  if [ ! -f "$STATIC_DEPS_DIR/lib/libglib-2.0.a" ] && [ ! -f "$STATIC_DEPS_DIR/lib/$MULTIARCH/libglib-2.0.a" ]; then
    log "Building glib 2.82.4 (static, -fPIC)..."
    cd "$WORK_DIR"
    if [ ! -f "glib-2.82.4.tar.xz" ]; then
      curl -L -o glib-2.82.4.tar.xz https://download.gnome.org/sources/glib/2.82/glib-2.82.4.tar.xz
    fi
    rm -rf glib-2.82.4
    tar xJf glib-2.82.4.tar.xz
    cd glib-2.82.4
    meson setup _build --prefix="$STATIC_DEPS_DIR" --default-library=static \
      --pkg-config-path="$STATIC_PKG_PATH" \
      -Dc_args="-fPIC" \
      -Dlibmount=disabled \
      -Dtests=false \
      -Dintrospection=disabled \
      -Dnls=disabled \
      -Ddtrace=false \
      -Dsystemtap=false \
      -Dglib_debug=disabled
    ninja -C _build -j"$NPROC"
    ninja -C _build install
  else
    log "glib already built, skipping"
  fi

  # After glib install, .a files may land in lib/ or lib/$MULTIARCH/.
  # Ensure pkgconfig from both locations is included.
  STATIC_PKG_PATH="$STATIC_DEPS_DIR/lib/pkgconfig:$STATIC_DEPS_DIR/lib/$MULTIARCH/pkgconfig"

  # -----------------------------------------------------------------------
  # Phase 3: libplist, libxml2, libpng, libjpeg-turbo, libtiff
  # -----------------------------------------------------------------------

  # --- libplist 2.6.0 ---
  if [ ! -f "$STATIC_DEPS_DIR/lib/libplist-2.0.a" ]; then
    log "Building libplist 2.6.0 (static, -fPIC)..."
    cd "$WORK_DIR"
    if [ ! -f "libplist-2.6.0.tar.bz2" ]; then
      curl -L -o libplist-2.6.0.tar.bz2 https://github.com/libimobiledevice/libplist/releases/download/2.6.0/libplist-2.6.0.tar.bz2
    fi
    rm -rf libplist-2.6.0
    tar xjf libplist-2.6.0.tar.bz2
    cd libplist-2.6.0
    # libplist 2.6.0 uses autotools
    ./configure --prefix="$STATIC_DEPS_DIR" --enable-static --disable-shared \
      --without-cython CFLAGS="-fPIC" \
      PKG_CONFIG_PATH="$STATIC_PKG_PATH"
    make -j"$NPROC"
    make install
  else
    log "libplist already built, skipping"
  fi

  # --- libxml2 2.12.9 ---
  if [ ! -f "$STATIC_DEPS_DIR/lib/libxml2.a" ]; then
    log "Building libxml2 2.12.9 (static, -fPIC)..."
    cd "$WORK_DIR"
    if [ ! -f "libxml2-2.12.9.tar.xz" ]; then
      curl -L -o libxml2-2.12.9.tar.xz https://download.gnome.org/sources/libxml2/2.12/libxml2-2.12.9.tar.xz
    fi
    rm -rf libxml2-2.12.9
    tar xJf libxml2-2.12.9.tar.xz
    cd libxml2-2.12.9
    cmake -B build \
      -DCMAKE_INSTALL_PREFIX="$STATIC_DEPS_DIR" \
      -DCMAKE_C_FLAGS="-fPIC" \
      -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
      -DBUILD_SHARED_LIBS=OFF \
      -DLIBXML2_WITH_PYTHON=OFF \
      -DLIBXML2_WITH_TESTS=OFF \
      -DLIBXML2_WITH_LZMA=OFF \
      -DLIBXML2_WITH_ZLIB=ON \
      -DCMAKE_PREFIX_PATH="$STATIC_DEPS_DIR"
    cmake --build build -j"$NPROC"
    cmake --install build
  else
    log "libxml2 already built, skipping"
  fi

  # --- libpng 1.6.43 ---
  if [ ! -f "$STATIC_DEPS_DIR/lib/libpng16.a" ]; then
    log "Building libpng 1.6.43 (static, -fPIC)..."
    cd "$WORK_DIR"
    if [ ! -f "libpng-1.6.43.tar.xz" ]; then
      curl -L -o libpng-1.6.43.tar.xz https://downloads.sourceforge.net/project/libpng/libpng16/1.6.43/libpng-1.6.43.tar.xz
    fi
    rm -rf libpng-1.6.43
    tar xJf libpng-1.6.43.tar.xz
    cd libpng-1.6.43
    cmake -B build \
      -DCMAKE_INSTALL_PREFIX="$STATIC_DEPS_DIR" \
      -DCMAKE_C_FLAGS="-fPIC" \
      -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
      -DBUILD_SHARED_LIBS=OFF \
      -DPNG_TESTS=OFF \
      -DPNG_TOOLS=OFF \
      -DCMAKE_PREFIX_PATH="$STATIC_DEPS_DIR"
    cmake --build build -j"$NPROC"
    cmake --install build
  else
    log "libpng already built, skipping"
  fi

  # --- libjpeg-turbo 3.0.4 ---
  if [ ! -f "$STATIC_DEPS_DIR/lib/libjpeg.a" ]; then
    log "Building libjpeg-turbo 3.0.4 (static, -fPIC)..."
    cd "$WORK_DIR"
    if [ ! -f "libjpeg-turbo-3.0.4.tar.gz" ]; then
      curl -L -o libjpeg-turbo-3.0.4.tar.gz https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/3.0.4/libjpeg-turbo-3.0.4.tar.gz
    fi
    rm -rf libjpeg-turbo-3.0.4
    tar xzf libjpeg-turbo-3.0.4.tar.gz
    cd libjpeg-turbo-3.0.4
    cmake -B build \
      -DCMAKE_INSTALL_PREFIX="$STATIC_DEPS_DIR" \
      -DCMAKE_INSTALL_LIBDIR=lib \
      -DCMAKE_C_FLAGS="-fPIC" \
      -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
      -DENABLE_SHARED=OFF \
      -DENABLE_STATIC=ON
    cmake --build build -j"$NPROC"
    cmake --install build
  else
    log "libjpeg-turbo already built, skipping"
  fi

  # --- libtiff 4.6.0 ---
  if [ ! -f "$STATIC_DEPS_DIR/lib/libtiff.a" ]; then
    log "Building libtiff 4.6.0 (static, -fPIC)..."
    cd "$WORK_DIR"
    if [ ! -f "tiff-4.6.0.tar.gz" ]; then
      curl -L -o tiff-4.6.0.tar.gz https://download.osgeo.org/libtiff/tiff-4.6.0.tar.gz
    fi
    rm -rf tiff-4.6.0
    tar xzf tiff-4.6.0.tar.gz
    cd tiff-4.6.0
    cmake -B build \
      -DCMAKE_INSTALL_PREFIX="$STATIC_DEPS_DIR" \
      -DCMAKE_C_FLAGS="-fPIC" \
      -DCMAKE_POSITION_INDEPENDENT_CODE=ON \
      -DBUILD_SHARED_LIBS=OFF \
      -Dtiff-tests=OFF \
      -Dtiff-tools=OFF \
      -Dtiff-contrib=OFF \
      -Dtiff-docs=OFF \
      -Dzstd=OFF \
      -Dlzma=OFF \
      -Dwebp=OFF \
      -Djbig=OFF \
      -DCMAKE_PREFIX_PATH="$STATIC_DEPS_DIR"
    cmake --build build -j"$NPROC"
    cmake --install build
  else
    log "libtiff already built, skipping"
  fi

  # -----------------------------------------------------------------------
  # Phase 4: gdk-pixbuf (needs glib, libpng, libjpeg-turbo, libtiff)
  # -----------------------------------------------------------------------
  # gdk-pixbuf's meson build needs glib-compile-resources from our glib build
  export PATH="$STATIC_DEPS_DIR/bin:$PATH"
  build_gdk_pixbuf_static \
    "$STATIC_PKG_PATH" \
    "-fPIC" \
    "-L$STATIC_DEPS_DIR/lib -lpng16 -ljpeg -ltiff -lz"

  # -----------------------------------------------------------------------
  # Phase 5: libgpod (needs glib, gdk-pixbuf, libplist, libxml2, sqlite3)
  # -----------------------------------------------------------------------
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

    # Point pkg-config at our static deps so configure finds glib, gdk-pixbuf, libplist
    export PKG_CONFIG_PATH="$STATIC_PKG_PATH"
    # autoreconf needs glib m4 macros (AM_GLIB_GNU_GETTEXT etc.) from our source-built glib
    export ACLOCAL_PATH="$STATIC_DEPS_DIR/share/aclocal${ACLOCAL_PATH:+:$ACLOCAL_PATH}"
    # -Wno-incompatible-pointer-types: libgpod 0.8.3's ithumb-writer.c triggers
    # -Werror=incompatible-pointer-types in GCC 14+ (newer GLib g_object_ref macro)
    export CFLAGS="-fPIC -Wno-incompatible-pointer-types -I$STATIC_DEPS_DIR/include"
    export LDFLAGS="-L$STATIC_DEPS_DIR/lib -L$STATIC_DEPS_DIR/lib/$MULTIARCH"

    autoreconf -fi
    ./configure \
      --prefix="$STATIC_DEPS_DIR" \
      --enable-static --disable-shared \
      --disable-more-warnings --disable-silent-rules \
      --disable-udev --disable-pygobject \
      --with-python=no --without-hal
    # Build only the library (src/), not tools — the tools need complex static
    # linking of all transitive deps which autotools can't handle well.
    make -C src -j"$NPROC"
    make -C src install
    # Install pkgconfig file and top-level headers (not installed by src/ target)
    make install-pkgconfigDATA
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
  REQUIRED="libz.a libffi.a libpcre2-8.a libsqlite3.a libglib-2.0.a libgobject-2.0.a libplist-2.0.a libxml2.a libpng16.a libjpeg.a libtiff.a libgdk_pixbuf-2.0.a libgpod.a"
fi
for lib in $REQUIRED; do
  if [ ! -f "$STATIC_DEPS_DIR/lib/$lib" ]; then
    # Also check multi-arch path (glib/meson may install to lib/$MULTIARCH/)
    if [ "$OS" = "Linux" ] && [ -f "$STATIC_DEPS_DIR/lib/$MULTIARCH/$lib" ]; then
      continue
    fi
    MISSING="$MISSING $lib"
  fi
done

if [ -n "$MISSING" ]; then
  log "ERROR: Missing static libraries:$MISSING"
  exit 1
fi

log "All required static libraries present in $STATIC_DEPS_DIR/lib/"
ls -la "$STATIC_DEPS_DIR/lib/"*.a
