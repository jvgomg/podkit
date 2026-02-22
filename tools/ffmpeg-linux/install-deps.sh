#!/usr/bin/env bash
#
# Install dependencies for building FFmpeg with libfdk_aac
# Supports: Debian, Ubuntu, and derivatives
#
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() { echo -e "${GREEN}[INFO]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# Check if running as root or with sudo
check_root() {
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run with sudo or as root"
        echo "Usage: sudo $0"
        exit 1
    fi
}

# Detect package manager
detect_package_manager() {
    if command -v apt-get &> /dev/null; then
        echo "apt"
    elif command -v dnf &> /dev/null; then
        echo "dnf"
    elif command -v yum &> /dev/null; then
        echo "yum"
    else
        error "Unsupported package manager. This script supports apt, dnf, and yum."
        exit 1
    fi
}

# Install dependencies for Debian/Ubuntu
install_apt() {
    info "Updating package lists..."
    apt-get update

    info "Installing build dependencies..."
    apt-get install -y \
        build-essential \
        yasm \
        nasm \
        pkg-config \
        git \
        wget \
        libfdk-aac-dev \
        libmp3lame-dev \
        libopus-dev \
        libvorbis-dev
}

# Install dependencies for Fedora/RHEL
install_dnf() {
    info "Installing build dependencies..."
    dnf install -y \
        @development-tools \
        yasm \
        nasm \
        pkgconfig \
        git \
        wget \
        fdk-aac-devel \
        lame-devel \
        opus-devel \
        libvorbis-devel
}

main() {
    check_root

    local pkg_manager
    pkg_manager=$(detect_package_manager)

    info "Detected package manager: $pkg_manager"

    case "$pkg_manager" in
        apt)
            install_apt
            ;;
        dnf|yum)
            install_dnf
            ;;
    esac

    info "Dependencies installed successfully!"
    echo ""
    echo "Next steps:"
    echo "  1. Run ./build-ffmpeg.sh to build FFmpeg"
}

main "$@"
