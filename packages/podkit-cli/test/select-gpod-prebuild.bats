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

# ── host_is_musl under compile.sh's shell options ────────────────────────────

@test "REGRESSION: musl probe survives pipefail when ldd writes after the musl line" {
  # musl's ldd prints one line per write. compile.sh runs with pipefail, so a
  # reader that stops at the first match leaves ldd to die of SIGPIPE on the
  # next line, and the probe reports glibc on a musl host.
  cat > "$STUBS/ldd" <<'EOF'
#!/usr/bin/env bash
echo "/lib/ld-musl-x86_64.so.1 (0x7f0000000000)"
sleep 0.2
echo "libc.musl-x86_64.so.1 => /lib/ld-musl-x86_64.so.1 (0x7f0000000000)"
EOF
  chmod +x "$STUBS/ldd"
  set -o pipefail
  run host_is_musl
  set +o pipefail
  [ "$status" -eq 0 ]
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

# ── target_libc: declared target vs host probe ───────────────────────────────

@test "target_libc follows the host probe when nothing is declared" {
  LDD_LIBC=musl run target_libc
  [ "$status" -eq 0 ]
  [ "$output" = "musl" ]
  LDD_LIBC=glibc run target_libc
  [ "$status" -eq 0 ]
  [ "$output" = "glibc" ]
}

@test "target_libc accepts a declaration the host agrees with" {
  LDD_LIBC=musl PODKIT_TARGET_LIBC=musl run target_libc
  [ "$status" -eq 0 ]
  [ "$output" = "musl" ]
}

@test "target_libc refuses a declaration the host contradicts" {
  LDD_LIBC=glibc PODKIT_TARGET_LIBC=musl run target_libc
  [ "$status" -ne 0 ]
  [[ "$output" == *"PODKIT_TARGET_LIBC=musl"* ]]
  [[ "$output" == *"glibc"* ]]
}

@test "target_libc refuses an unknown declaration" {
  PODKIT_TARGET_LIBC=uclibc run target_libc
  [ "$status" -ne 0 ]
  [[ "$output" == *"uclibc"* ]]
}

# ── assert_binding_libc: the embedded .node's DT_NEEDED libc ─────────────────

# Fake `readelf -d` printing the NEEDED entries named in READELF_NEEDED.
stub_readelf() {
  cat > "$STUBS/readelf" <<'EOF2'
#!/usr/bin/env bash
echo "Dynamic section at offset 0x9a5c38 contains 30 entries:"
echo "  Tag        Type                         Name/Value"
for lib in $READELF_NEEDED; do
  echo " 0x0000000000000001 (NEEDED)             Shared library: [$lib]"
done
echo " 0x000000000000000e (SONAME)             Library soname: [gpod_binding.node]"
EOF2
  chmod +x "$STUBS/readelf"
}

@test "assert_binding_libc passes a musl binding for a musl target" {
  stub_readelf
  READELF_NEEDED="libstdc++.so.6 libgcc_s.so.1 libc.musl-x86_64.so.1" \
    run assert_binding_libc "$LIBGPOD/prebuilds/linux-x64-musl/gpod_binding.node" musl
  [ "$status" -eq 0 ]
}

@test "REGRESSION: assert_binding_libc rejects a glibc binding for a musl target" {
  stub_readelf
  READELF_NEEDED="libm.so.6 libstdc++.so.6 libgcc_s.so.1 libc.so.6" \
    run assert_binding_libc "$LIBGPOD/prebuilds/linux-x64/gpod_binding.node" musl
  [ "$status" -ne 0 ]
  [[ "$output" == *"libc.so.6"* ]]
  [[ "$output" == *"linux-x64/gpod_binding.node"* ]]
}

@test "assert_binding_libc passes a glibc binding for a glibc target" {
  stub_readelf
  READELF_NEEDED="libm.so.6 libstdc++.so.6 libgcc_s.so.1 libc.so.6" \
    run assert_binding_libc "$LIBGPOD/prebuilds/linux-x64/gpod_binding.node" glibc
  [ "$status" -eq 0 ]
}

@test "assert_binding_libc rejects a musl binding for a glibc target" {
  stub_readelf
  READELF_NEEDED="libstdc++.so.6 libgcc_s.so.1 libc.musl-x86_64.so.1" \
    run assert_binding_libc "$LIBGPOD/prebuilds/linux-x64-musl/gpod_binding.node" glibc
  [ "$status" -ne 0 ]
  [[ "$output" == *"libc.musl"* ]]
}

@test "assert_binding_libc rejects a binding that names no libc at all" {
  stub_readelf
  READELF_NEEDED="libstdc++.so.6" \
    run assert_binding_libc "$LIBGPOD/prebuilds/linux-x64/gpod_binding.node" glibc
  [ "$status" -ne 0 ]
}

@test "assert_binding_libc fails when readelf is unavailable" {
  # A guard that silently skips is no guard. PATH is narrowed to the stubs dir
  # plus the coreutils the helper needs, none of which carry a readelf.
  PATH="$STUBS:/bin:/usr/bin"
  if command -v readelf >/dev/null 2>&1; then skip "host carries a system readelf"; fi
  run assert_binding_libc "$LIBGPOD/prebuilds/linux-x64/gpod_binding.node" glibc
  [ "$status" -ne 0 ]
  [[ "$output" == *"readelf"* ]]
}

@test "gpod_prebuild_dir follows the declared target and refuses a contradicted one" {
  LDD_LIBC=musl PODKIT_TARGET_LIBC=musl run gpod_prebuild_dir linux x64 "$LIBGPOD"
  [ "$output" = "${LIBGPOD}/prebuilds/linux-x64-musl" ]
  LDD_LIBC=glibc PODKIT_TARGET_LIBC=musl run gpod_prebuild_dir linux x64 "$LIBGPOD"
  [ "$status" -ne 0 ]
}
