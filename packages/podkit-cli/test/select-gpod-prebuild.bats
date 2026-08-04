#!/usr/bin/env bats
#
# Unit tests for the libgpod .node prebuild selection logic used by compile.sh.
#
# Regression coverage for the dual-libc bug: a glibc builder that also carries a
# stray `linux-{arch}-musl` prebuild (rsynced in from an earlier musl build)
# must still embed the GLIBC .node — not the musl one, which would dlopen-fail
# at runtime with `libc.musl-{arch}.so.1: cannot open shared object file`.
#
# The logic is exercised in isolation: the real `ldd` is shadowed by a fake on
# PATH so we can pin the host's apparent libc, and the prebuild dirs are
# fixtures. No `bun --compile` is run.

setup() {
  HELPER="${BATS_TEST_DIRNAME}/../scripts/select-gpod-prebuild.sh"

  # Fixture libgpod dir holding BOTH prebuild variants for arm64 and x64, each
  # with a distinctly-named .node so the selected file reveals which dir won.
  LIBGPOD="${BATS_TEST_TMPDIR}/libgpod-node"
  for triple in linux-arm64 linux-arm64-musl linux-x64 linux-x64-musl darwin-arm64 darwin-x64; do
    mkdir -p "${LIBGPOD}/prebuilds/${triple}"
    printf 'fake-node\n' > "${LIBGPOD}/prebuilds/${triple}/gpod_binding.node"
  done

  # Fake `ldd` on PATH so tests control the host's apparent libc. LDD_LIBC picks
  # the output ("musl" → musl host, anything else → glibc host).
  STUBS="${BATS_TEST_TMPDIR}/bin"
  mkdir -p "$STUBS"
  cat > "$STUBS/ldd" <<'EOF'
#!/usr/bin/env bash
if [ "${LDD_LIBC:-glibc}" = "musl" ]; then
  echo "/lib/ld-musl-x86_64.so.1 (0x00007f...)"
else
  echo "linux-vdso.so.1 => (0x00007fff...)"
  echo "libc.so.6 => /lib/x86_64-linux-gnu/libc.so.6 (0x00007f...)"
fi
EOF
  chmod +x "$STUBS/ldd"
  PATH="$STUBS:$PATH"

  # shellcheck source=../scripts/select-gpod-prebuild.sh
  source "$HELPER"
}

# ── gpod_prebuild_dir: directory selection by host libc ──────────────────────

@test "glibc host resolves the bare linux-{arch} dir" {
  LDD_LIBC=glibc run gpod_prebuild_dir linux arm64 "$LIBGPOD"
  [ "$status" -eq 0 ]
  [ "$output" = "${LIBGPOD}/prebuilds/linux-arm64" ]
}

@test "musl host resolves the linux-{arch}-musl dir" {
  LDD_LIBC=musl run gpod_prebuild_dir linux arm64 "$LIBGPOD"
  [ "$status" -eq 0 ]
  [ "$output" = "${LIBGPOD}/prebuilds/linux-arm64-musl" ]
}

@test "libc detection is per-arch consistent (x64 glibc → bare linux-x64)" {
  LDD_LIBC=glibc run gpod_prebuild_dir linux x64 "$LIBGPOD"
  [ "$output" = "${LIBGPOD}/prebuilds/linux-x64" ]
}

@test "darwin has no libc split — always the bare {platform}-{arch} dir" {
  # Even if `ldd` somehow reported musl, darwin must not gain a -musl suffix.
  LDD_LIBC=musl run gpod_prebuild_dir darwin arm64 "$LIBGPOD"
  [ "$output" = "${LIBGPOD}/prebuilds/darwin-arm64" ]
}

# ── Regression: both dirs present, glibc host must NOT pick musl ──────────────

@test "REGRESSION: glibc host with a stray musl dir present selects the glibc .node" {
  # Both linux-arm64 and linux-arm64-musl exist (the stray-musl scenario).
  # First-dir-wins (the old bug) would take the musl dir; libc-explicit selection
  # must take the glibc dir.
  LDD_LIBC=glibc
  export LDD_LIBC
  dir=$(gpod_prebuild_dir linux arm64 "$LIBGPOD")
  node=$(find_gpod_prebuild "$dir")
  [ "$node" = "${LIBGPOD}/prebuilds/linux-arm64/gpod_binding.node" ]
  case "$node" in
    *-musl/*) echo "picked a musl prebuild on a glibc host: $node" >&2; false ;;
  esac
}

@test "REGRESSION: musl host with a stray glibc dir present selects the musl .node" {
  LDD_LIBC=musl
  export LDD_LIBC
  dir=$(gpod_prebuild_dir linux arm64 "$LIBGPOD")
  node=$(find_gpod_prebuild "$dir")
  [ "$node" = "${LIBGPOD}/prebuilds/linux-arm64-musl/gpod_binding.node" ]
}

# ── find_gpod_prebuild: robustness ───────────────────────────────────────────

@test "find returns the .node path when the dir exists" {
  run find_gpod_prebuild "${LIBGPOD}/prebuilds/linux-x64"
  [ "$status" -eq 0 ]
  [ "$output" = "${LIBGPOD}/prebuilds/linux-x64/gpod_binding.node" ]
}

@test "find on a missing dir yields empty and exits 0 (no set -e abort)" {
  run find_gpod_prebuild "${LIBGPOD}/prebuilds/linux-riscv64"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "find on a dir with no .node yields empty" {
  mkdir -p "${BATS_TEST_TMPDIR}/empty"
  run find_gpod_prebuild "${BATS_TEST_TMPDIR}/empty"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}
