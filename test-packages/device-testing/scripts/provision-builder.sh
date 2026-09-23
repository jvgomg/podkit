#!/usr/bin/env bash
# provision-builder.sh — make a plain Debian box satisfy the builder contract.
#
# Portable Debian bash. Knows nothing about Proxmox, libvirt, or how the box it
# is running on came to exist — a provisioner's entire output is an
# SSH-reachable Debian box, and this script takes it from there.
#
# This is the INVERSE of provision-substrate.sh. It installs precisely what that
# script's contract forbids, and the two must never be merged or given a shared
# base of "common" packages — see the header of builder-contract.sh.
#
# Contract:
#   - No arguments.
#   - Must run as root (apt-get, writes under /etc, /var/cache).
#   - Idempotent: running twice leaves the box in the same state and does not
#     error on already-applied steps.
#   - Exits 0 on success, non-zero on any failure.
#   - Declares nothing itself — every value comes from builder-contract.sh,
#     which builder-doctor.sh reads from too, so the two cannot disagree.
#
# Verify the result with builder-doctor.sh. This script does not self-check: a
# provisioner that grades its own work tends to grade it generously.
#
# Network-dependent, unlike its substrate sibling: Node and Bun come from
# upstream installers and the musl base image is pulled. A builder without
# egress can be provisioned no other way, so the failures are left loud.

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./builder-contract.sh
# shellcheck disable=SC1091 # lint-shell.mjs runs shellcheck without -x, so the
# source= directive above documents the target without shellcheck following it.
. "$SCRIPT_DIR/builder-contract.sh"

log() { echo "==> $1"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "FATAL: provision-builder.sh must run as root" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# The toolchain
# ---------------------------------------------------------------------------

log "installing the build toolchain"
export DEBIAN_FRONTEND=noninteractive
apt-get update
# --no-install-recommends, matching the Lima glibc builder exactly. The package
# NAMES agreeing is only half of "the same toolchain" — the installed closure is
# the other half, and letting recommends in here would quietly give a Proxmox
# builder a different one from the Mac's. Every artifact these two produce is
# supposed to be interchangeable.
# shellcheck disable=SC2086 # word splitting is the point — a package list
apt-get install -y --no-install-recommends $BUILDER_TOOLCHAIN_PACKAGES
# shellcheck disable=SC2086 # word splitting is the point — a package list
apt-get install -y --no-install-recommends $BUILDER_CONTAINER_PACKAGES

# Debian 12 ships meson 1.0.1 and glib 2.82.4 requires >= 1.2.0. pip into
# /usr/local so it shadows apt's copy for every user rather than only for root.
log "ensuring meson >= $BUILDER_MESON_MIN_VERSION"
meson_new_enough() {
  command -v meson >/dev/null 2>&1 || return 1
  meson --version | awk -F. -v want="$BUILDER_MESON_MIN_VERSION" '
    BEGIN { split(want, w, ".") }
    { exit !($1 > w[1] || ($1 == w[1] && $2 >= w[2])) }'
}
if meson_new_enough; then
  log "meson $(meson --version) already satisfies the floor"
else
  pip3 install --break-system-packages --upgrade "meson>=$BUILDER_MESON_MIN_VERSION"
fi

# ---------------------------------------------------------------------------
# Node and Bun
# ---------------------------------------------------------------------------
#
# Neither is an apt package on Debian 12 at a version this repo builds against.
# Both land in /usr/local so root and the unprivileged build user share one
# copy — a per-user install would leave `sudo` and a plain ssh session compiling
# against different runtimes.

if command -v node >/dev/null 2>&1 \
  && [ "$(node --version | sed 's/^v\([0-9]*\).*/\1/')" = "$BUILDER_NODE_MAJOR" ]; then
  log "node $(node --version) already installed"
else
  log "installing Node.js $BUILDER_NODE_MAJOR"
  curl -fsSL "https://deb.nodesource.com/setup_${BUILDER_NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

if command -v bun >/dev/null 2>&1; then
  log "bun $(bun --version) already installed"
else
  log "installing Bun system-wide"
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash
fi

# ---------------------------------------------------------------------------
# Work directories
# ---------------------------------------------------------------------------
#
# Mode 1777 rather than an owner: the builder has no single build user by
# contract — a contributor's ssh_config alias may resolve to `podkit`, `debian`
# or their own account — and naming one here would make the box work for
# whoever provisioned it and fail for everyone else. The sticky bit keeps two
# users from deleting each other's trees.

log "creating $BUILDER_STAGING_DIR and $BUILDER_CACHE_DIR"
install -d -m 1777 "$BUILDER_STAGING_DIR"
install -d -m 1777 "$BUILDER_CACHE_DIR"

# ---------------------------------------------------------------------------
# The musl build container
# ---------------------------------------------------------------------------
#
# Built now rather than lazily on first use so the builder is provably complete
# when the doctor passes, and so the expensive part (an Alpine apk toolchain
# closure) is paid once while someone is watching.
#
# Run as root. A builder is a trusted-network appliance like the substrate, and
# rootless podman on a cloud image needs subuid/subgid ranges cloud-init does
# not write — which fails at `newuidmap` with an error that reads like a podman
# bug. The build user reaches it through sudo.

CONTAINERFILE="$SCRIPT_DIR/$BUILDER_MUSL_CONTAINERFILE_SUBPATH"
if [ ! -r "$CONTAINERFILE" ]; then
  # Provisioning is run by copying the scripts to a box that has no repo on it,
  # so the Containerfile may legitimately not have been copied along. Skipped
  # rather than fatal: every glibc artifact still builds, and the doctor is what
  # reports the box as incomplete.
  echo "WARN: $CONTAINERFILE not found — skipping the musl image." >&2
  echo "WARN: copy test-packages/device-testing/builder/ alongside the scripts to build it." >&2
else
  log "building $BUILDER_MUSL_IMAGE from $BUILDER_MUSL_BASE_IMAGE"
  "$BUILDER_CONTAINER_RUNTIME" build \
    --build-arg "BASE_IMAGE=$BUILDER_MUSL_BASE_IMAGE" \
    --tag "$BUILDER_MUSL_IMAGE" \
    --file "$CONTAINERFILE" \
    "$(dirname "$CONTAINERFILE")"
fi

# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------

log "recording provenance in $BUILDER_PROVENANCE_FILE"
{
  printf '%s\n' '# Managed by provision-builder.sh — DO NOT EDIT.'
  printf 'debian_point_release=%s\n' "$BUILDER_DEBIAN_POINT_RELEASE"
} > "$BUILDER_PROVENANCE_FILE"
chmod 0644 "$BUILDER_PROVENANCE_FILE"

log "provisioning complete — verify with builder-doctor.sh"
