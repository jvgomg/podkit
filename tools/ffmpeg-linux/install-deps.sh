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

# Enable non-free repository for Debian (required for libfdk-aac-dev)
enable_nonfree_debian() {
    # Check if we're on Debian (not Ubuntu)
    if [[ -f /etc/os-release ]]; then
        source /etc/os-release
        if [[ "$ID" == "debian" ]]; then
            info "Enabling non-free repository for Debian..."

            # Modern Debian uses DEB822 format in /etc/apt/sources.list.d/*.sources
            # Check for DEB822 format first
            if ls /etc/apt/sources.list.d/*.sources &> /dev/null; then
                # Add non-free to existing DEB822 sources
                for f in /etc/apt/sources.list.d/*.sources; do
                    if grep -q "Components:" "$f" && ! grep -q "non-free" "$f"; then
                        sed -i 's/Components: main/Components: main contrib non-free non-free-firmware/' "$f"
                        info "Updated $f with non-free components"
                    fi
                done
            # Fall back to traditional sources.list
            elif [[ -f /etc/apt/sources.list ]]; then
                if ! grep -q "non-free" /etc/apt/sources.list; then
                    sed -i 's/main$/main contrib non-free non-free-firmware/' /etc/apt/sources.list
                    info "Updated /etc/apt/sources.list with non-free components"
                fi
            fi
        fi
    fi
}

# Install dependencies for Debian/Ubuntu
install_apt() {
    # Enable non-free repo if on Debian (libfdk-aac-dev is non-free)
    enable_nonfree_debian

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
