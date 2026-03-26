#!/usr/bin/env bash
set -euo pipefail

# Build and install a development binary as "podkit-dev" on PATH.
#
# This compiles the CLI from the current source tree using bun build --compile,
# then symlinks it to ~/.local/bin/podkit-dev. Useful for testing shell
# completions and other features that need a real binary on PATH.
#
# Usage:
#   bun run install:dev          # build + install
#   bun run install:dev --clean  # remove the installed binary

CLI_DIR="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL_DIR="$HOME/.local/bin"
BINARY_NAME="podkit-dev"
INSTALL_PATH="$INSTALL_DIR/$BINARY_NAME"

if [[ "${1:-}" == "--clean" ]]; then
  rm -f "$INSTALL_PATH"
  echo "Removed $INSTALL_PATH"
  exit 0
fi

# Build using the existing compile script, with a -dev version suffix
echo "Building..."
cd "$CLI_DIR"
BASE_VERSION=$(bun -e "console.log(require('./package.json').version)")
PODKIT_VERSION_OVERRIDE="${BASE_VERSION}-dev" bash scripts/compile.sh

# Install
mkdir -p "$INSTALL_DIR"
cp bin/podkit "$INSTALL_PATH"
chmod +x "$INSTALL_PATH"

echo ""
echo "Installed: $INSTALL_PATH"

# Check if install dir is on PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo ""
  echo "WARNING: $INSTALL_DIR is not on your PATH."
  echo "Add this to your ~/.zshrc:"
  echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
fi
