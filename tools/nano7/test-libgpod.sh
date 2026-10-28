#!/bin/bash
# Use the same native dependency selection as the Node binding.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

cflags_text=$(bash "$SCRIPT_DIR/../prebuild/get-cflags.sh")
ldflags_text=$(bash "$SCRIPT_DIR/../prebuild/get-ldflags.sh")
read -r -a cflags <<< "$cflags_text"
read -r -a ldflags <<< "$ldflags_text"
# The prebuild archives reference optional libraries of libtiff and glib
# (zstd, lzma, webp, libdeflate, Lerc, selinux) that the Node module leaves
# unresolved; the roundtrip never reaches that code, so link it the same way.
unresolved=()
if [ -n "${STATIC_DEPS_DIR:-}" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    unresolved=("-Wl,-undefined,dynamic_lookup")
  else
    unresolved=("-Wl,--unresolved-symbols=ignore-all")
  fi
fi
"${CC:-cc}" "${cflags[@]}" "$SCRIPT_DIR/libgpod-roundtrip.c" \
  "${ldflags[@]}" -lz -lm ${unresolved[@]+"${unresolved[@]}"} -o "$TEST_DIR/libgpod-roundtrip"
python3 "$SCRIPT_DIR/test_probe.py" -v
LIBGPOD_ROUNDTRIP="$TEST_DIR/libgpod-roundtrip" python3 "$SCRIPT_DIR/test_libgpod.py" -v
