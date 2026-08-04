#!/usr/bin/env bash
#
# Update the Homebrew formula with a new version and SHA256 checksums.
#
# Usage: ./tools/update-homebrew-formula.sh <version> <formula-file> <checksums-file>
#
# The checksums file should contain lines like:
#   abc123  podkit-darwin-arm64.tar.gz
#   def456  podkit-darwin-x64.tar.gz
#   ...
#
# The formula uses #{version} interpolation for URLs, so only the version
# and sha256 values need updating.

set -euo pipefail

if [ $# -ne 3 ]; then
  echo "Usage: $0 <version> <formula-file> <checksums-file>" >&2
  exit 1
fi

VERSION="$1"
FORMULA="$2"
CHECKSUMS="$3"

if [ ! -f "$FORMULA" ]; then
  echo "Error: Formula file not found: $FORMULA" >&2
  exit 1
fi

if [ ! -f "$CHECKSUMS" ]; then
  echo "Error: Checksums file not found: $CHECKSUMS" >&2
  exit 1
fi

# Extract checksum for a given tarball name from the checksums file
get_sha256() {
  local tarball="$1"
  local sha
  sha=$(grep -F "  $tarball" "$CHECKSUMS" | awk '{print $1}')
  if [ -z "$sha" ]; then
    echo "Error: No checksum found for $tarball" >&2
    exit 1
  fi
  echo "$sha"
}

SHA_DARWIN_ARM64=$(get_sha256 "podkit-darwin-arm64.tar.gz")
SHA_DARWIN_X64=$(get_sha256 "podkit-darwin-x64.tar.gz")
# Homebrew routes Linux to the glibc (-gnu) tarballs — the musl tarballs are
# Docker-only. See build-platform.yml's build-glibc job.
SHA_LINUX_ARM64_GNU=$(get_sha256 "podkit-linux-arm64-gnu.tar.gz")
SHA_LINUX_X64_GNU=$(get_sha256 "podkit-linux-x64-gnu.tar.gz")

echo "Updating formula: $FORMULA"
echo "  Version: $VERSION"
echo "  darwin-arm64:   $SHA_DARWIN_ARM64"
echo "  darwin-x64:     $SHA_DARWIN_X64"
echo "  linux-arm64-gnu: $SHA_LINUX_ARM64_GNU"
echo "  linux-x64-gnu:   $SHA_LINUX_X64_GNU"

# Update version
sed -i.bak "s/^  version \".*\"/  version \"$VERSION\"/" "$FORMULA"

# Update sha256 values by matching the tarball filename on the preceding url line.
# Strategy: use awk to track which url we last saw and replace the next sha256 accordingly.
awk -v sha_da="$SHA_DARWIN_ARM64" \
    -v sha_dx="$SHA_DARWIN_X64" \
    -v sha_la="$SHA_LINUX_ARM64_GNU" \
    -v sha_lx="$SHA_LINUX_X64_GNU" '
  /url.*podkit-darwin-arm64/    { last_url = "darwin-arm64" }
  /url.*podkit-darwin-x64/      { last_url = "darwin-x64" }
  /url.*podkit-linux-arm64-gnu/ { last_url = "linux-arm64" }
  /url.*podkit-linux-x64-gnu/   { last_url = "linux-x64" }
  /sha256/ && last_url != "" {
    if (last_url == "darwin-arm64") sha = sha_da
    else if (last_url == "darwin-x64") sha = sha_dx
    else if (last_url == "linux-arm64") sha = sha_la
    else if (last_url == "linux-x64") sha = sha_lx
    sub(/"[^"]*"/, "\"" sha "\"")
    last_url = ""
  }
  { print }
' "$FORMULA" > "$FORMULA.tmp"

mv "$FORMULA.tmp" "$FORMULA"
rm -f "$FORMULA.bak"

echo "Formula updated successfully."
