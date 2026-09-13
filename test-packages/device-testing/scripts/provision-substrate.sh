#!/usr/bin/env bash
# provision-substrate.sh — make a plain Debian box satisfy the device
# substrate contract.
#
# Portable Debian bash. Knows nothing about Lima, Proxmox, or how the box it
# is running on came to exist — a provisioner's entire output is an
# SSH-reachable Debian box, and this script takes it from there. Both the Lima
# path and the Proxmox path copy this in and run it.
#
# Contract:
#   - No arguments.
#   - Must run as root (apt-get, modprobe, writes under /etc).
#   - Idempotent: running twice leaves the box in the same state and does not
#     error on already-applied steps.
#   - Exits 0 on success, non-zero on any failure.
#   - Declares nothing itself — every value comes from substrate-contract.sh,
#     which substrate-doctor.sh reads from too, so the two cannot disagree.
#
# Verify the result with substrate-doctor.sh. This script does not self-check:
# a provisioner that grades its own work tends to grade it generously.

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./substrate-contract.sh
# shellcheck disable=SC1091 # lint-shell.mjs runs shellcheck without -x, so the
# source= directive above documents the target without shellcheck following it.
. "$SCRIPT_DIR/substrate-contract.sh"

MODULES_LOAD_CONF="/etc/modules-load.d/podkit-substrate.conf"
MODPROBE_CONF="/etc/modprobe.d/podkit-substrate-dummy-hcd.conf"

# Files written by the Lima YAML before provisioning moved into this script.
# A box provisioned by that YAML still carries them, and two files each
# declaring `options dummy_hcd num=` is a trap for whoever edits one of them.
LEGACY_CONFS="/etc/modules-load.d/podkit-device-harness.conf /etc/modprobe.d/podkit-device-harness-dummy-hcd.conf"

log() { echo "==> $1"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "FATAL: provision-substrate.sh must run as root" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Runtime packages
# ---------------------------------------------------------------------------

log "installing runtime packages (no toolchain, no -dev)"
export DEBIAN_FRONTEND=noninteractive
apt-get update
# --no-install-recommends matters here rather than being tidiness: several of
# these recommend -dev or toolchain packages that would fail the contract.
# shellcheck disable=SC2086 # word splitting is the point — a package list
apt-get install -y --no-install-recommends $SUBSTRATE_PACKAGES

# ---------------------------------------------------------------------------
# Kernel modules
# ---------------------------------------------------------------------------

for legacy in $LEGACY_CONFS; do
  if [ -e "$legacy" ]; then
    log "removing superseded $legacy"
    rm -f "$legacy"
  fi
done

log "configuring kernel modules to load at boot"
install -d /etc/modules-load.d
# printf rather than a heredoc: systemd-modules-load is whitespace-strict, and
# this file is written from contexts where a heredoc body would be indented.
{
  printf '%s\n' '# Managed by provision-substrate.sh — DO NOT EDIT.'
  printf '%s\n' '# Loaded by systemd-modules-load.service at boot.'
  for mod in $SUBSTRATE_MODULES; do printf '%s\n' "$mod"; done
} > "$MODULES_LOAD_CONF"

log "pinning dummy_hcd to num=$SUBSTRATE_UDC_COUNT"
install -d /etc/modprobe.d
{
  printf '%s\n' '# Managed by provision-substrate.sh — DO NOT EDIT.'
  printf '%s\n' "options dummy_hcd num=$SUBSTRATE_UDC_COUNT"
} > "$MODPROBE_CONF"

# Load now so the box is usable without a reboot.
#
# dummy_hcd needs care in both directions. modprobe is a no-op on an
# already-loaded module, so an instance carrying num=1 would survive a plain
# modprobe and leave one UDC where four are needed. But reloading it
# unconditionally tears down every live gadget — and this script runs on every
# `harness:setup`, so an unconditional reload means one person's setup can
# destroy another person's test run on a shared substrate.
#
# So: reload only when the UDC count is actually wrong. A box that already
# satisfies the contract is left alone.
log "loading modules"
udc_count() { [ -d /sys/class/udc ] && find /sys/class/udc -mindepth 1 -maxdepth 1 | wc -l || echo 0; }
if [ "$(udc_count)" -ge "$SUBSTRATE_UDC_COUNT" ]; then
  log "dummy_hcd already provides $(udc_count) UDCs — leaving it loaded"
else
  rmmod dummy_hcd 2>/dev/null || true
  modprobe dummy_hcd "num=$SUBSTRATE_UDC_COUNT" \
    || echo "WARN: modprobe dummy_hcd failed; boot-time loader will retry" >&2
fi
for mod in $SUBSTRATE_MODULES; do
  [ "$mod" = "dummy_hcd" ] && continue
  modprobe "$mod" || echo "WARN: modprobe $mod failed; boot-time loader will retry" >&2
done

# ---------------------------------------------------------------------------
# configfs
# ---------------------------------------------------------------------------

# configfs is enabled in Debian's stock kernel and systemd normally mounts it.
# The fstab entry is a safety net: a regression in systemd's configfs.mount
# unit would otherwise break gadget setup silently.
log "ensuring configfs is mounted at $SUBSTRATE_CONFIGFS_MOUNTPOINT"
if ! grep -q "$SUBSTRATE_CONFIGFS_MOUNTPOINT" /etc/fstab; then
  # No leading whitespace — mount -a rejects fstab lines that carry any.
  printf '%s\n' "configfs $SUBSTRATE_CONFIGFS_MOUNTPOINT configfs defaults 0 0" >> /etc/fstab
fi
mkdir -p "$SUBSTRATE_CONFIGFS_MOUNTPOINT"
mountpoint -q "$SUBSTRATE_CONFIGFS_MOUNTPOINT" \
  || mount -t configfs configfs "$SUBSTRATE_CONFIGFS_MOUNTPOINT"

# ---------------------------------------------------------------------------
# Artifact destination
# ---------------------------------------------------------------------------

log "ensuring $SUBSTRATE_BIN_DIR exists and is writable"
install -d -m 0755 "$SUBSTRATE_BIN_DIR"
test -w "$SUBSTRATE_BIN_DIR"

log "provisioning complete — verify with substrate-doctor.sh"
