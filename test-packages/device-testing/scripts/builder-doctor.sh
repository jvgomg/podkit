#!/usr/bin/env bash
# builder-doctor.sh — assert that this box satisfies the builder contract.
# The exit code is the verdict.
#
# This script IS the definition of "builder". A Proxmox VM, a libvirt guest, a
# cloud instance and a spare amd64 box under a desk are all legitimate builders
# if they pass it, and none of them is a builder if they do not.
#
# Contract:
#   - Optional flag: --strict (see BUILDER_DEBIAN_POINT_RELEASE below).
#   - Runs UNPRIVILEGED, and must be run that way. Several assertions are about
#     the user a build actually runs as — whether `bun` is on their PATH,
#     whether they can write the staging tree — and running as root would pass
#     them for a box no contributor can build on. It also inspects and never
#     mutates: a doctor that fixes what it finds cannot tell you whether
#     provisioning worked.
#   - Exits 0 when every assertion holds, 1 otherwise.
#   - Prints one line per assertion, naming the specific command, package,
#     module or directory at fault.
#
# Values come from builder-contract.sh, which provision-builder.sh sources too,
# so the check and the provisioning cannot drift apart.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./builder-contract.sh
# shellcheck disable=SC1091 # lint-shell.mjs runs shellcheck without -x, so the
# source= directive above documents the target without shellcheck following it.
. "$SCRIPT_DIR/builder-contract.sh"

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
    "$BUILDER_DEBIAN_MAJOR".*)
      pass "debian major $BUILDER_DEBIAN_MAJOR (running $DEBIAN_VERSION)"
      if [ "$DEBIAN_VERSION" != "$BUILDER_DEBIAN_POINT_RELEASE" ]; then
        note "point release is $DEBIAN_VERSION, template pinned $BUILDER_DEBIAN_POINT_RELEASE at provision time"
      fi
      ;;
    *)
      # Worth more than the usual one-line message: a newer Debian is the case
      # someone will hit by grabbing whatever image was to hand, and the
      # resulting artifact fails on another machine rather than here.
      fail "debian major must be $BUILDER_DEBIAN_MAJOR, found $DEBIAN_VERSION — a newer glibc raises the produced binary's floor above the substrate's"
      ;;
  esac
else
  fail "not a Debian system (/etc/debian_version absent)"
fi

if [ "$STRICT" -eq 1 ]; then
  if [ ! -r "$BUILDER_PROVENANCE_FILE" ]; then
    fail "no provenance at $BUILDER_PROVENANCE_FILE — provisioned before this was recorded; re-run provision-builder.sh"
  else
    PROVISIONED_RELEASE="$(sed -n 's/^debian_point_release=//p' "$BUILDER_PROVENANCE_FILE")"
    if [ "$PROVISIONED_RELEASE" = "$BUILDER_DEBIAN_POINT_RELEASE" ]; then
      pass "provisioned from the pinned template ($PROVISIONED_RELEASE)"
    else
      fail "provisioned from $PROVISIONED_RELEASE, template now pins $BUILDER_DEBIAN_POINT_RELEASE — recreate the builder"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Toolchain packages
# ---------------------------------------------------------------------------
#
# A package satisfied through Provides counts. This is the one place the check
# diverges from substrate-doctor.sh's, and the divergence follows from the
# lists: the substrate's are all concrete runtime packages, while several
# entries here are `-dev` metapackages that a distribution may ship as virtual
# names resolved by apt and invisible to `dpkg-query -W <name>`. Without this,
# the doctor would report a package as missing immediately after apt installed
# it.

pkg_installed() {
  dpkg-query -W -f='${db:Status-Status}' "$1" 2>/dev/null | grep -q '^installed$' && return 0
  dpkg-query -W -f='${db:Status-Status}\t${Provides}\n' 2>/dev/null \
    | awk -F'\t' -v want="$1" '
        $1 == "installed" {
          n = split($2, provided, ",")
          for (i = 1; i <= n; i++) {
            gsub(/^[ \t]+|[ \t]+$/, "", provided[i])
            sub(/ *\(.*\)$/, "", provided[i])
            if (provided[i] == want) { found = 1; exit }
          }
        }
        END { exit !found }'
}

for pkg in $BUILDER_TOOLCHAIN_PACKAGES $BUILDER_CONTAINER_PACKAGES; do
  if pkg_installed "$pkg"; then
    pass "package $pkg"
  else
    fail "package $pkg is not installed"
  fi
done

# ---------------------------------------------------------------------------
# Toolchain commands
# ---------------------------------------------------------------------------
#
# Separate from the packages above rather than implied by them. `bun`, `node`
# and `npm` come from upstream installers and no apt package accounts for them;
# and "dpkg says it is installed" is not "this user can run it", which is the
# claim a build depends on.
#
# These three are exactly what substrate-contract.sh's
# SUBSTRATE_FORBIDDEN_COMMANDS lists. The contradiction is the contract.

for cmd in $BUILDER_COMMANDS; do
  if command -v "$cmd" >/dev/null 2>&1; then
    pass "command $cmd ($(command -v "$cmd"))"
  else
    fail "command $cmd is not on PATH"
  fi
done

# meson's floor, not merely its presence: Debian 12 ships 1.0.1 and glib 2.82.4
# needs >= 1.2.0, so a builder can satisfy every other assertion here and still
# fail several minutes into the static-deps build.
if command -v meson >/dev/null 2>&1; then
  MESON_VERSION="$(meson --version 2>/dev/null)"
  if [ -z "$MESON_VERSION" ]; then
    # Not merely tidiness: awk given no input never runs its main block and
    # exits 0, so a meson that is on PATH but cannot report a version used to
    # be reported as a PASS with a blank version beside it.
    fail "meson is on PATH but \`meson --version\` produced nothing"
  elif printf '%s\n' "$MESON_VERSION" | awk -F. -v want="$BUILDER_MESON_MIN_VERSION" '
       BEGIN { split(want, w, ".") }
       { exit !($1 > w[1] || ($1 == w[1] && $2 >= w[2])) }'; then
    pass "meson $MESON_VERSION (need >= $BUILDER_MESON_MIN_VERSION)"
  else
    fail "meson $MESON_VERSION is below $BUILDER_MESON_MIN_VERSION — glib will not configure"
  fi
fi

# node-gyp bakes the building Node's ABI into the addon, so the major version is
# a property of the artifact rather than a preference.
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node --version | sed 's/^v\([0-9]*\).*/\1/')"
  if [ "$NODE_MAJOR" = "$BUILDER_NODE_MAJOR" ]; then
    pass "node major $NODE_MAJOR"
  else
    fail "node major is $NODE_MAJOR, contract wants $BUILDER_NODE_MAJOR — the addon's baked ABI would not match"
  fi
fi

# ---------------------------------------------------------------------------
# pkg-config modules
# ---------------------------------------------------------------------------
#
# What the build actually consumes. A `-dev` package whose `.pc` file is absent
# satisfies dpkg and then fails `configure`.

if command -v pkg-config >/dev/null 2>&1; then
  for mod in $BUILDER_PKGCONFIG_MODULES; do
    if pkg-config --exists "$mod" 2>/dev/null; then
      pass "pkg-config $mod ($(pkg-config --modversion "$mod" 2>/dev/null))"
    else
      fail "pkg-config cannot resolve $mod"
    fi
  done
fi

# ---------------------------------------------------------------------------
# Work directories
# ---------------------------------------------------------------------------
#
# Writability is asserted for the user running this script, which is why the
# doctor must not be run as root: root can write both of these on a box where
# nobody else can, and the build does not run as root.

for dir in "$BUILDER_STAGING_DIR" "$BUILDER_CACHE_DIR"; do
  if [ ! -d "$dir" ]; then
    fail "$dir does not exist"
  elif [ ! -w "$dir" ]; then
    fail "$dir is not writable by $(id -un) — builds do not run as root"
  else
    pass "$dir exists and is writable by $(id -un)"
  fi
done

# ---------------------------------------------------------------------------
# The musl build container
# ---------------------------------------------------------------------------
#
# The whole of doc-060's "musl on a remote builder means an Alpine container on
# that build host". Asserted here so a builder that can only produce half the
# artifacts is a failure rather than a surprise on release day.
#
# The image is inspected through sudo because provisioning builds it as root —
# see provision-builder.sh for why rootless is not used on a cloud image.

if command -v "$BUILDER_CONTAINER_RUNTIME" >/dev/null 2>&1; then
  if sudo -n "$BUILDER_CONTAINER_RUNTIME" image exists "$BUILDER_MUSL_IMAGE" 2>/dev/null; then
    pass "musl build image $BUILDER_MUSL_IMAGE present"
  elif sudo -n true 2>/dev/null; then
    fail "musl build image $BUILDER_MUSL_IMAGE is absent — re-run provision-builder.sh"
  else
    # Distinguished from a real failure: an operator running this by hand
    # without passwordless sudo has proven nothing about the image either way,
    # and reporting that as a defect sends them after the wrong thing.
    note "cannot check $BUILDER_MUSL_IMAGE — no passwordless sudo for $BUILDER_CONTAINER_RUNTIME"
  fi
fi

# ---------------------------------------------------------------------------
# What this doctor deliberately does NOT assert
# ---------------------------------------------------------------------------
#
# substrate-doctor.sh ends with negative assertions: no `bun`, no `node`, no
# `npm`, no `-dev` packages. They are absent here on purpose, and copying that
# block over would fail this box on every assertion above.
#
# The two contracts contradict each other because they are load-bearing in
# opposite directions. The substrate's absence of a toolchain is what makes its
# verdict on a statically-linked binary mean anything; the builder's presence of
# one is what produces the binary. Neither script sources the other's contract
# and there is no shared list of "common" packages for them to converge on —
# `builder-contract.test.ts` asserts all of that, so a well-meaning refactor
# that unifies them fails red rather than quietly defeating the substrate.

# ---------------------------------------------------------------------------

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "builder-doctor: PASS — this box satisfies the builder contract"
  exit 0
fi
echo "builder-doctor: FAIL — $FAILURES assertion(s) failed" >&2
exit 1
