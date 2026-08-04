# shellcheck shell=bash
#
# Select the libgpod .node prebuild that matches the *host's* libc.
#
# prebuildify emits a bare `linux-{arch}` directory for glibc builds and a
# `linux-{arch}-musl` directory for musl builds. A single build host can end up
# carrying BOTH — e.g. a stray `linux-{arch}-musl` dir left over from an earlier
# musl build gets rsynced onto a glibc builder VM. Choosing the prebuild by
# "first directory that exists wins" then embeds the wrong-libc .node into the
# binary, which fails at dlopen time with:
#
#   libc.musl-{arch}.so.1: cannot open shared object file
#
# So selection MUST be explicit by the host's own libc, never first-dir-wins.
# This mirrors how the `usb` prebuild is selected in compile.sh.
#
# Only Linux has the musl/glibc split. On other platforms (darwin) there is a
# single `{platform}-{arch}` directory, resolved unconditionally.
#
# This file is meant to be `source`d. It defines two functions and runs nothing
# on its own, so it can be unit-tested in isolation (fixture dirs + a fake `ldd`
# on PATH) without invoking the full `bun --compile`.

# True (exit 0) if the host's libc is musl. `ldd /bin/sh | grep musl` is the
# cheapest host-libc probe available in a plain shell. Shared by both the
# libgpod prebuild selection below and the `usb` prebuild selection in
# compile.sh (which sources this file), so the two never drift apart.
host_is_musl() {
  ldd /bin/sh 2>/dev/null | grep -q musl
}

# Resolve the prebuild directory to search, based on host platform + libc.
# Prints the directory path (which may not exist) to stdout.
gpod_prebuild_dir() {
  local platform="$1" arch="$2" libgpod_dir="$3"
  local base="$libgpod_dir/prebuilds/${platform}-${arch}"

  # Only Linux splits musl vs glibc.
  if [ "$platform" = "linux" ] && host_is_musl; then
    echo "${base}-musl"
  else
    echo "$base"
  fi
}

# Find the first *.node prebuild in the given directory. Prints its path, or
# nothing if the directory is absent or holds no prebuild. Always exits 0 for a
# missing directory so callers under `set -e` are not aborted by "not found".
find_gpod_prebuild() {
  local dir="$1"
  if [ -d "$dir" ]; then
    find "$dir" -name "*.node" -type f | head -1
  fi
}
