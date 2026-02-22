#!/bin/bash
set -e

# libgpod macOS build script
# Builds libgpod 0.8.3 from source using Homebrew dependencies

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_DIR="$SCRIPT_DIR/build"
DOWNLOAD_DIR="$SCRIPT_DIR/downloads"

LIBGPOD_VERSION="0.8.3"
LIBGPOD_URL="https://downloads.sourceforge.net/project/gtkpod/libgpod/libgpod-0.8/libgpod-${LIBGPOD_VERSION}.tar.bz2"
LIBGPOD_DIR="libgpod-${LIBGPOD_VERSION}"

# Patch URLs
PATCH_CALLOUT_URL="https://raw.githubusercontent.com/macports/macports-ports/master/multimedia/libgpod/files/patch-tools-generic-callout.c.diff"
PATCH_LIBPLIST_URL="https://raw.githubusercontent.com/pld-linux/libgpod/master/libgpod-libplist.patch"

# Installation prefix (default to user-local, no sudo required)
PREFIX="${PREFIX:-$HOME/.local}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_homebrew() {
    if ! command -v brew &> /dev/null; then
        log_error "Homebrew is not installed. Please install it first:"
        echo "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        exit 1
    fi
}

install_deps() {
    log_info "Installing Homebrew dependencies..."
    check_homebrew

    local deps=(
        libplist
        gdk-pixbuf
        intltool
        autoconf
        automake
        libtool
        gtk-doc
        pkg-config
        gettext
    )

    for dep in "${deps[@]}"; do
        if brew list "$dep" &>/dev/null; then
            log_info "  $dep already installed"
        else
            log_info "  Installing $dep..."
            brew install "$dep"
        fi
    done

    # Ensure gettext is linked (it's keg-only)
    if ! command -v autopoint &> /dev/null; then
        log_info "Linking gettext..."
        brew link --force gettext
    fi

    log_info "Dependencies installed successfully"
}

download_source() {
    log_info "Downloading libgpod source and patches..."
    mkdir -p "$DOWNLOAD_DIR"
    cd "$DOWNLOAD_DIR"

    # Download libgpod source
    if [ ! -f "libgpod-${LIBGPOD_VERSION}.tar.bz2" ]; then
        log_info "  Downloading libgpod-${LIBGPOD_VERSION}.tar.bz2..."
        curl -L -o "libgpod-${LIBGPOD_VERSION}.tar.bz2" "$LIBGPOD_URL"
    else
        log_info "  libgpod-${LIBGPOD_VERSION}.tar.bz2 already downloaded"
    fi

    # Download patches
    if [ ! -f "patch-tools-generic-callout.c.diff" ]; then
        log_info "  Downloading callout patch..."
        curl -L -o "patch-tools-generic-callout.c.diff" "$PATCH_CALLOUT_URL"
    else
        log_info "  callout patch already downloaded"
    fi

    if [ ! -f "libgpod-libplist.patch" ]; then
        log_info "  Downloading libplist patch..."
        curl -L -o "libgpod-libplist.patch" "$PATCH_LIBPLIST_URL"
    else
        log_info "  libplist patch already downloaded"
    fi

    log_info "Downloads complete"
}

extract_and_patch() {
    log_info "Extracting and patching source..."
    mkdir -p "$BUILD_DIR"
    cd "$BUILD_DIR"

    # Clean previous build
    if [ -d "$LIBGPOD_DIR" ]; then
        log_info "  Removing previous build directory..."
        rm -rf "$LIBGPOD_DIR"
    fi

    # Extract
    log_info "  Extracting tarball..."
    tar -xjf "$DOWNLOAD_DIR/libgpod-${LIBGPOD_VERSION}.tar.bz2"
    cd "$LIBGPOD_DIR"

    # Apply patches
    log_info "  Applying callout patch..."
    patch -p0 < "$DOWNLOAD_DIR/patch-tools-generic-callout.c.diff"

    log_info "  Applying libplist patch..."
    patch -p1 < "$DOWNLOAD_DIR/libgpod-libplist.patch"

    log_info "Patching complete"
}

configure_build() {
    log_info "Configuring build..."
    cd "$BUILD_DIR/$LIBGPOD_DIR"

    # Set up environment for Homebrew
    export PKG_CONFIG_PATH="$(brew --prefix)/lib/pkgconfig:$(brew --prefix libplist)/lib/pkgconfig:$PKG_CONFIG_PATH"
    export CFLAGS="-I$(brew --prefix)/include -I$(brew --prefix libplist)/include"
    export LDFLAGS="-L$(brew --prefix)/lib -L$(brew --prefix libplist)/lib"

    # Run autoreconf to regenerate build system
    log_info "  Running autoreconf..."
    autoreconf -fi

    # Configure
    log_info "  Running configure..."
    ./configure \
        --prefix="$PREFIX" \
        --disable-more-warnings \
        --disable-silent-rules \
        --disable-udev \
        --disable-pygobject \
        --with-python=no \
        --without-hal

    log_info "Configuration complete"
}

build_libgpod() {
    log_info "Building libgpod..."
    cd "$BUILD_DIR/$LIBGPOD_DIR"

    # Set up environment for Homebrew
    export PKG_CONFIG_PATH="$(brew --prefix)/lib/pkgconfig:$(brew --prefix libplist)/lib/pkgconfig:$PKG_CONFIG_PATH"
    export CFLAGS="-I$(brew --prefix)/include -I$(brew --prefix libplist)/include"
    export LDFLAGS="-L$(brew --prefix)/lib -L$(brew --prefix libplist)/lib"

    make -j$(sysctl -n hw.ncpu)

    log_info "Build complete"
}

install_libgpod() {
    log_info "Installing libgpod to $PREFIX..."
    cd "$BUILD_DIR/$LIBGPOD_DIR"

    # Create prefix directories if needed
    mkdir -p "$PREFIX/lib" "$PREFIX/include" "$PREFIX/lib/pkgconfig"

    make install

    log_info "Installation complete"
    log_info ""
    log_info "Add to your shell profile:"
    log_info "  export PKG_CONFIG_PATH=\"$PREFIX/lib/pkgconfig:\$PKG_CONFIG_PATH\""
    log_info "  export DYLD_LIBRARY_PATH=\"$PREFIX/lib:\$DYLD_LIBRARY_PATH\""
    log_info ""
    log_info "Then verify with:"
    log_info "  pkg-config --modversion libgpod-1.0"
}

clean_build() {
    log_info "Cleaning build directory..."
    rm -rf "$BUILD_DIR"
    log_info "Clean complete"
}

distclean() {
    log_info "Removing all build artifacts and downloads..."
    rm -rf "$BUILD_DIR"
    rm -rf "$DOWNLOAD_DIR"
    log_info "Distclean complete"
}

verify_install() {
    log_info "Verifying libgpod installation..."

    if pkg-config --exists libgpod-1.0; then
        local version=$(pkg-config --modversion libgpod-1.0)
        log_info "  libgpod version: $version"
        log_info "  Include path: $(pkg-config --cflags libgpod-1.0)"
        log_info "  Library path: $(pkg-config --libs libgpod-1.0)"
        log_info "Verification successful"
    else
        log_error "libgpod not found by pkg-config"
        log_info "You may need to add to your shell profile:"
        log_info "  export PKG_CONFIG_PATH=\"$PREFIX/lib/pkgconfig:\$PKG_CONFIG_PATH\""
        exit 1
    fi
}

show_help() {
    echo "libgpod macOS build script"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  deps       Install Homebrew dependencies"
    echo "  download   Download libgpod source and patches"
    echo "  build      Extract, patch, configure, and build"
    echo "  install    Install to $PREFIX (may require sudo)"
    echo "  verify     Verify installation"
    echo "  clean      Remove build directory"
    echo "  distclean  Remove build and download directories"
    echo "  all        Run deps, download, build, install, verify (default)"
    echo "  help       Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  PREFIX     Installation prefix (default: /usr/local)"
}

# Main
case "${1:-all}" in
    deps)
        install_deps
        ;;
    download)
        download_source
        ;;
    build)
        extract_and_patch
        configure_build
        build_libgpod
        ;;
    install)
        install_libgpod
        ;;
    verify)
        verify_install
        ;;
    clean)
        clean_build
        ;;
    distclean)
        distclean
        ;;
    all)
        install_deps
        download_source
        extract_and_patch
        configure_build
        build_libgpod
        install_libgpod
        verify_install
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        log_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
