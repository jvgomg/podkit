#!/usr/bin/env bash
#
# Runtime smoke test for a *built* podkit binary — the gate whose absence
# let a non-executing / silently-broken binary ship (ADR-026, m-23).
#
# Unlike the unit/integration suites (which run against the workspace's
# freshly-built binding), this drives the ACTUAL single-file binary the
# way a user's shell does, and — crucially — reads a real gpod-tool
# iTunesDB THROUGH the native libgpod addon, asserting positive success +
# a known track count. That is what proves the embedded .node both loads
# AND functions, on this host's libc, rather than the weaker "it errored"
# check it replaces.
#
# It also asserts the firmware-inquiry USB path degrades cleanly when
# libudev is unavailable (the `usb` prebuild can't dlopen libudev.so.1) —
# a warn, not a crash.
#
# Usage:
#   runtime-smoke.sh <podkit-binary> [template-dir]
#
# template-dir defaults to the committed smoke fixture next to this script
# (an MA147 iPod Video 5G with a valid, empty gpod-tool iTunesDB).

set -euo pipefail

BIN="${1:?usage: runtime-smoke.sh <podkit-binary> [template-dir]}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMPLATE="${2:-$SCRIPT_DIR/../fixtures/smoke-ipod}"

# Known, deterministic properties of the committed MA147 fixture.
EXPECT_MODEL_NUMBER="A147"
EXPECT_MUSIC_COUNT="0"

fail() {
  echo "SMOKE FAIL: $*" >&2
  exit 1
}

command -v jq >/dev/null 2>&1 || fail "jq is required for the runtime smoke"
[ -x "$BIN" ] || fail "podkit binary not executable: $BIN"
[ -d "$TEMPLATE/iPod_Control" ] || fail "template dir missing iPod_Control: $TEMPLATE"

echo "==> [smoke] binary: $BIN"
echo "==> [smoke] template: $TEMPLATE"

# 1. --version — proves the binary executes at all (the literal
#    glibc-can't-execute / wrong-interpreter failure).
echo "==> [smoke] podkit --version"
version="$("$BIN" --version)" || fail "podkit --version exited non-zero"
[ -n "$version" ] || fail "podkit --version produced no output"
echo "    version: $version"

# 2. device scan --json — the USB-walk / sysfs path must emit a
#    well-formed envelope and exit cleanly even with no device attached.
echo "==> [smoke] podkit device scan --json"
scan="$("$BIN" device scan --json)" || fail "device scan exited non-zero"
echo "$scan" | jq -e '.success == true' >/dev/null || fail "device scan: success != true"
echo "$scan" | jq -e '.devices | type == "array"' >/dev/null || fail "device scan: .devices is not an array"

# 3. device info against a valid gpod-testing template — reads the
#    iTunesDB THROUGH the native libgpod addon. Assert POSITIVE success +
#    the known track count + the resolved model, not merely "no error".
echo "==> [smoke] podkit device info --device <template> --json (native libgpod read)"
info="$("$BIN" device info --device "$TEMPLATE" --json)" \
  || fail "device info exited non-zero (native libgpod read failed)"
echo "$info" | grep -qiE 'Failed to load native|Native binding not found' \
  && fail "device info: native binding failed to load"
echo "$info" | jq -e '.success == true' >/dev/null \
  || fail "device info: success != true (libgpod could not read the iTunesDB)"
model="$(echo "$info" | jq -r '.status.model.number')"
music="$(echo "$info" | jq -r '.status.musicCount')"
[ "$model" = "$EXPECT_MODEL_NUMBER" ] \
  || fail "device info: model.number '$model' != expected '$EXPECT_MODEL_NUMBER'"
[ "$music" = "$EXPECT_MUSIC_COUNT" ] \
  || fail "device info: musicCount '$music' != expected '$EXPECT_MUSIC_COUNT'"
echo "    libgpod read OK — model=$model musicCount=$music"

# 4. firmware inquiry degrades cleanly without libudev. The `usb` prebuild
#    dlopen()s libudev.so.1; shadowing it with a zero-byte decoy on
#    LD_LIBRARY_PATH makes that load fail, so inquiry-methods must WARN
#    (USB transport down) and doctor must exit non-zero-but-clean — never
#    crash or report the native binding as unloadable. (Linux only; macOS
#    uses IOKit, not libudev.)
if [ "$(uname -s)" = "Linux" ]; then
  echo "==> [smoke] doctor inquiry-methods degrades cleanly without libudev"
  decoy="$(mktemp -d)"
  : > "$decoy/libudev.so.1" # zero bytes → fails ELF validation at dlopen
  set +e
  degraded="$(LD_LIBRARY_PATH="$decoy:${LD_LIBRARY_PATH:-}" "$BIN" doctor --scope system --json 2>&1)"
  drc=$?
  set -e
  rm -rf "$decoy"
  echo "$degraded" | grep -qiE 'Failed to load native|Native binding not found|Segmentation' \
    && fail "doctor crashed / native binding unloadable under libudev-less USB"
  status="$(echo "$degraded" | jq -r '.checks[] | select(.id=="inquiry-methods") | .status')" \
    || fail "doctor did not emit valid JSON under libudev-less USB"
  [ "$status" = "warn" ] \
    || fail "inquiry-methods status '$status' != 'warn' under libudev-less USB"
  [ "$drc" -ne 0 ] \
    || fail "doctor exited 0 despite a warn check (expected non-zero)"
  echo "    inquiry-methods=warn, doctor exit=$drc (clean degrade)"
else
  echo "==> [smoke] skipping libudev degrade check (non-Linux host)"
fi

echo "==> [smoke] ALL RUNTIME SMOKE CHECKS PASSED"
