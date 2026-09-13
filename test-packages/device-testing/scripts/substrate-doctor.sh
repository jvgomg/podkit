#!/usr/bin/env bash
# substrate-doctor.sh — assert that this box satisfies the device substrate
# contract. The exit code is the verdict.
#
# This script IS the definition of "substrate". A Lima VM, a Proxmox VM, a
# spare Debian box and a CI runner are all legitimate substrates if they pass
# it, and none of them is a substrate if they do not. That is what lets the
# harness stop knowing what a hypervisor is.
#
# Contract:
#   - Optional flag: --strict (see SUBSTRATE_DEBIAN_POINT_RELEASE below).
#   - Runs unprivileged. It inspects and never mutates — a doctor that fixes
#     what it finds cannot tell you whether provisioning worked.
#   - Exits 0 when every assertion holds, 1 otherwise.
#   - Prints one line per assertion, and names the specific module, package or
#     mountpoint at fault. "Something is wrong" is not an actionable verdict.
#
# Values come from substrate-contract.sh, which provision-substrate.sh sources
# too, so the check and the provisioning cannot drift apart.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./substrate-contract.sh
# shellcheck disable=SC1091 # lint-shell.mjs runs shellcheck without -x, so the
# source= directive above documents the target without shellcheck following it.
. "$SCRIPT_DIR/substrate-contract.sh"

STRICT=0
[ "${1:-}" = "--strict" ] && STRICT=1

FAILURES=0

pass() { printf 'ok       %s\n' "$1"; }
fail() { printf 'FAIL     %s\n' "$1" >&2; FAILURES=$((FAILURES + 1)); }
note() { printf 'note     %s\n' "$1"; }

# ---------------------------------------------------------------------------
# Base OS
# ---------------------------------------------------------------------------

if [ -r /etc/debian_version ]; then
  DEBIAN_VERSION="$(cat /etc/debian_version)"
  case "$DEBIAN_VERSION" in
    "$SUBSTRATE_DEBIAN_MAJOR".*)
      pass "debian major $SUBSTRATE_DEBIAN_MAJOR (running $DEBIAN_VERSION)"
      # Point-release drift is reported, not failed: which image was booted is
      # a provisioning input, while the running point release advances with
      # any security update. --strict makes it fatal for template validation.
      if [ "$DEBIAN_VERSION" != "$SUBSTRATE_DEBIAN_POINT_RELEASE" ]; then
        if [ "$STRICT" -eq 1 ]; then
          fail "point release is $DEBIAN_VERSION, template pins $SUBSTRATE_DEBIAN_POINT_RELEASE"
        else
          note "point release is $DEBIAN_VERSION, template pins $SUBSTRATE_DEBIAN_POINT_RELEASE"
        fi
      fi
      ;;
    *) fail "debian major must be $SUBSTRATE_DEBIAN_MAJOR, found $DEBIAN_VERSION" ;;
  esac
else
  fail "not a Debian system (/etc/debian_version absent)"
fi

# ---------------------------------------------------------------------------
# Required runtime packages
# ---------------------------------------------------------------------------

for pkg in $SUBSTRATE_PACKAGES; do
  if dpkg-query -W -f='${db:Status-Status}' "$pkg" 2>/dev/null | grep -q '^installed$'; then
    pass "package $pkg"
  else
    fail "package $pkg is not installed"
  fi
done

# ---------------------------------------------------------------------------
# Kernel modules
# ---------------------------------------------------------------------------

for mod in $SUBSTRATE_MODULES; do
  # lsmod normalises nothing, and module names appear with underscores in
  # /proc/modules regardless of how they were spelled to modprobe.
  if grep -q "^${mod} " /proc/modules; then
    pass "module $mod loaded"
  else
    fail "module $mod is not loaded"
  fi
done

# dummy_hcd's whole reason for carrying num=N is concurrent gadgets, so the
# count is asserted rather than merely the module's presence: num=1 loads
# cleanly and then fails the first two-daemon test with an unrelated error.
if [ -d /sys/class/udc ]; then
  UDC_COUNT="$(find /sys/class/udc -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"
  if [ "$UDC_COUNT" -ge "$SUBSTRATE_UDC_COUNT" ]; then
    pass "udc slots: $UDC_COUNT (need $SUBSTRATE_UDC_COUNT)"
  else
    fail "udc slots: $UDC_COUNT, need $SUBSTRATE_UDC_COUNT — is dummy_hcd loaded with num=$SUBSTRATE_UDC_COUNT?"
  fi
else
  fail "/sys/class/udc absent — no usb gadget support in this kernel"
fi

# ---------------------------------------------------------------------------
# configfs
# ---------------------------------------------------------------------------

if mountpoint -q "$SUBSTRATE_CONFIGFS_MOUNTPOINT"; then
  pass "configfs mounted at $SUBSTRATE_CONFIGFS_MOUNTPOINT"
else
  fail "configfs is not mounted at $SUBSTRATE_CONFIGFS_MOUNTPOINT"
fi

# ---------------------------------------------------------------------------
# Negative assertions
# ---------------------------------------------------------------------------
#
# The positives above make the box able to run the tests. These make its
# verdict trustworthy: podkit's linux binary statically links libgpod, and a
# toolchain or -dev package on the box can satisfy at runtime exactly the
# linkage the tests exist to prove is unnecessary.

for cmd in $SUBSTRATE_FORBIDDEN_COMMANDS; do
  if command -v "$cmd" >/dev/null 2>&1; then
    fail "$cmd is present at $(command -v "$cmd") — a toolchain masks linkage regressions"
  else
    pass "no $cmd on PATH"
  fi
done

DEV_PKGS="$(dpkg-query -W -f='${db:Status-Status} ${Package}\n' 2>/dev/null \
  | awk -v extra="$SUBSTRATE_FORBIDDEN_PACKAGES" '
      BEGIN { n = split(extra, forbidden, " ") }
      $1 == "installed" {
        if ($2 ~ /-dev$/) { print $2; next }
        for (i = 1; i <= n; i++) if ($2 == forbidden[i]) { print $2; next }
      }' || true)"
if [ -n "$DEV_PKGS" ]; then
  fail "toolchain or -dev packages installed: $(echo "$DEV_PKGS" | tr '\n' ' ')"
else
  pass "no -dev or toolchain packages installed"
fi

# ---------------------------------------------------------------------------
# Artifact destination
# ---------------------------------------------------------------------------

if [ -d "$SUBSTRATE_BIN_DIR" ]; then
  pass "$SUBSTRATE_BIN_DIR exists"
else
  fail "$SUBSTRATE_BIN_DIR does not exist"
fi

# ---------------------------------------------------------------------------

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "substrate-doctor: PASS — this box satisfies the device substrate contract"
  exit 0
fi
echo "substrate-doctor: FAIL — $FAILURES assertion(s) failed" >&2
exit 1
