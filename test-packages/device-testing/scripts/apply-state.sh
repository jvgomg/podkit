#!/usr/bin/env bash
# apply-state.sh — mutate the Lima test VM to match a named SystemState.
#
# Called by the @podkit/device-testing snapshot orchestrator (see
# test-packages/device-testing/src/runners/lima-test-vm-state.ts) when a base
# snapshot for the requested state is missing — typically on first run or
# after the VM has been reprovisioned. The mutated VM is then captured into
# `base-<state-id>` so subsequent test runs can restore the snapshot in <1s
# instead of re-running apt/chmod/modprobe.
#
# Contract:
#   - Single positional arg: a SystemState id (one of `healthy`, `no-ffmpeg`,
#     `no-libgpod`, `no-udev`, `no-sg-perms`, `corrupt-configfs`).
#   - Exits 0 on success; non-zero on any failure.
#   - Idempotent: running twice with the same arg leaves the VM in the same
#     end state and does not error on already-applied mutations (e.g. removing
#     a package that is already absent).
#   - Mutates running state only — does not change provisioning, fstab, etc.
#   - Must run as root (uses apt-get, chmod, modprobe, udevadm, umount).
#
# State definitions live in test-packages/device-testing/src/system-states/. This
# script is the in-VM realisation of those definitions; the TypeScript registry
# is the source of truth, the script is the executor.
#
# See: adr/adr-016-linux-vm-test-harness.md §"Snapshot-based state layering"
#      adr/adr-017-device-persona-fixtures.md §"SystemState schema"

set -eu

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------

# Packages required to be present in the `healthy` state. Mirrors the apt
# install list in test-packages/device-testing/lima/podkit-device-harness.yaml.
HEALTHY_PACKAGES="ffmpeg libgpod4 libgpod-common libglib2.0-0"

# Kernel modules required to be loaded in the `healthy` state. Mirrors the
# /etc/modules-load.d/podkit-device-harness.conf list in podkit-device-harness.yaml. `sg` is the
# SCSI generic driver — /dev/sg* nodes are required by the `inquiry-methods`
# doctor check.
HEALTHY_MODULES="dummy_hcd libcomposite usb_f_mass_storage usb_f_fs sg"

# Marker udev rules file controlling /dev/sg* group access. Owned by this
# script — distinct from libgpod's own udev rules so we can flip it on/off
# without touching distro-shipped files.
#
# MODE=0664 (world-readable) is deliberately permissive: the test VM has a
# single non-root user (`james`, uid 501) who is NOT a member of the `disk`
# group, and group changes don't propagate to existing limactl ssh
# sessions. Real-world podkit users install
# `91-podkit-ipod.rules` (TAG+="uaccess"), which grants access via systemd-
# logind ACLs — but limactl shell sessions arrive over ssh, not via a
# console seat, so uaccess doesn't fire. World-readable on the test VM
# avoids both rabbit holes; production posture is unaffected.
SG_PERMS_RULE="/etc/udev/rules.d/40-podkit-sg-perms.rules"
SG_PERMS_RULE_BODY='# Managed by test-packages/device-testing/scripts/apply-state.sh — DO NOT EDIT.
# Grants world-readable access to /dev/sg* nodes for the Lima test VM
# (TASK-348). See SG_PERMS_RULE comment in apply-state.sh for why mode 0664.
KERNEL=="sg[0-9]*", MODE="0664"'

# Path glob for libgpod-shipped udev rules. libgpod-common (Debian 12.10)
# installs rules under /lib/udev/rules.d/. The "missing" state moves them
# aside; healthy state moves them back.
LIBGPOD_UDEV_GLOB="/lib/udev/rules.d/*libgpod*"
LIBGPOD_UDEV_STASH_DIR="/var/lib/podkit-device-harness/stashed-udev"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

log() {
  # Single-line per mutation for grep-friendly logs.
  echo "[apply-state] $*"
}

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "apply-state.sh: must be run as root (use sudo)" >&2
    exit 2
  fi
}

apt_quiet() {
  # apt-get wrapper that suppresses progress noise but keeps stderr for real
  # failures. DEBIAN_FRONTEND=noninteractive avoids prompts during purge.
  DEBIAN_FRONTEND=noninteractive apt-get -qq -y "$@"
}

package_installed() {
  # Returns 0 if the named .deb package is currently installed.
  dpkg-query -W -f='${db:Status-Status}\n' "$1" 2>/dev/null \
    | grep -q '^installed$'
}

module_loaded() {
  # Returns 0 if the named kernel module is currently loaded.
  lsmod | awk -v m="$1" 'NR>1 && $1==m { found=1 } END { exit found?0:1 }'
}

trigger_udev_reload() {
  # Reload + re-trigger so the new rules apply to existing /dev/sg* nodes
  # without needing the VM to reboot. `settle` blocks until the trigger has
  # been processed so the snapshot is taken with the change actually live.
  udevadm control --reload-rules
  udevadm trigger --subsystem-match=scsi_generic --action=change || true
  udevadm settle --timeout=5 || true
}

stash_libgpod_udev_rules() {
  # Move any libgpod-shipped udev rules into a private stash so they can be
  # restored later (idempotent: if no files match, this is a no-op).
  mkdir -p "$LIBGPOD_UDEV_STASH_DIR"
  # Narrow `set +e` to the glob probe only — `mkdir` above must stay under
  # `set -e` so a failure to create the stash dir aborts.
  set +e
  # shellcheck disable=SC2086  # intentional word-split on glob expansion
  ls $LIBGPOD_UDEV_GLOB >/dev/null 2>&1
  matched=$?
  set -e
  if [ "$matched" -eq 0 ]; then
    for f in $LIBGPOD_UDEV_GLOB; do
      [ -e "$f" ] || continue
      mv -f "$f" "$LIBGPOD_UDEV_STASH_DIR/"
      log "stashed udev rule: $f"
    done
    trigger_udev_reload
  else
    log "no libgpod udev rules to stash (already absent)"
  fi
}

restore_libgpod_udev_rules() {
  # Move any previously-stashed libgpod udev rules back into place. Also a
  # no-op if the stash is empty.
  if [ -d "$LIBGPOD_UDEV_STASH_DIR" ] && [ -n "$(ls -A "$LIBGPOD_UDEV_STASH_DIR" 2>/dev/null || true)" ]; then
    for f in "$LIBGPOD_UDEV_STASH_DIR"/*; do
      [ -e "$f" ] || continue
      mv -f "$f" /lib/udev/rules.d/
      log "restored udev rule: /lib/udev/rules.d/$(basename "$f")"
    done
    trigger_udev_reload
  fi
}

ensure_sg_perms_rule() {
  # Idempotent install of the marker udev rule that grants group-readable
  # access to /dev/sg*.
  if [ ! -f "$SG_PERMS_RULE" ] \
     || ! diff -q <(printf '%s\n' "$SG_PERMS_RULE_BODY") "$SG_PERMS_RULE" >/dev/null 2>&1
  then
    printf '%s\n' "$SG_PERMS_RULE_BODY" > "$SG_PERMS_RULE"
    log "installed sg-perms udev rule: $SG_PERMS_RULE"
    trigger_udev_reload
  fi
}

remove_sg_perms_rule() {
  # Remove the marker rule + force /dev/sg* nodes to mode 0600 so non-root
  # readers are blocked even before udev re-triggers.
  if [ -f "$SG_PERMS_RULE" ]; then
    rm -f "$SG_PERMS_RULE"
    log "removed sg-perms udev rule: $SG_PERMS_RULE"
    trigger_udev_reload
  fi
  # Best-effort: tighten any currently-existing /dev/sg* nodes. The udev
  # trigger above is the durable change; this is the immediate effect for
  # tests that run before udev settles.
  for node in /dev/sg[0-9]*; do
    [ -e "$node" ] || continue
    chmod 0600 "$node" || true
    chown root:root "$node" || true
    log "chmod 0600: $node"
  done
}

# ---------------------------------------------------------------------------
# State appliers (one per SystemState id)
# ---------------------------------------------------------------------------

apply_healthy() {
  # Ensure the baseline state: all packages installed, all modules loaded,
  # configfs mounted, sg-perms rule installed, libgpod udev rules in place.

  # 1. Packages.
  missing_pkgs=""
  for pkg in $HEALTHY_PACKAGES; do
    if ! package_installed "$pkg"; then
      missing_pkgs="$missing_pkgs $pkg"
    fi
  done
  if [ -n "$missing_pkgs" ]; then
    log "installing missing packages:$missing_pkgs"
    apt_quiet update
    # shellcheck disable=SC2086  # intentional word-split for apt-get args
    apt_quiet install --no-install-recommends $missing_pkgs
  fi

  # 2. Kernel modules.
  for mod in $HEALTHY_MODULES; do
    if ! module_loaded "$mod"; then
      if modprobe "$mod" 2>/dev/null; then
        log "modprobe: $mod"
      else
        log "WARN: modprobe $mod failed (module may be unavailable on this kernel)"
      fi
    fi
  done

  # 3. configfs mount.
  if ! mountpoint -q /sys/kernel/config; then
    mkdir -p /sys/kernel/config
    mount -t configfs configfs /sys/kernel/config
    log "mounted: /sys/kernel/config"
  fi

  # 4. libgpod udev rules — restore if previously stashed.
  restore_libgpod_udev_rules

  # 5. sg-perms udev rule — installed.
  ensure_sg_perms_rule

  # 6. podkit iPod udev rule (91-podkit-ipod.rules) — installed via
  #    `podkit doctor --repair udev-rule`. The doctor `udev-rule` check
  #    asserts this file's presence; without it, doctor exits 2 on a
  #    "healthy" VM even with /dev/sg* available. Production-equivalent
  #    repair, idempotent (doctor skips if the rule is already current).
  ensure_podkit_udev_rule
}

ensure_podkit_udev_rule() {
  if [ ! -x /usr/local/bin/podkit ]; then
    log "WARN: /usr/local/bin/podkit missing — skipping podkit udev rule install (runner prepare() should land the binary)"
    return 0
  fi
  if [ ! -f /etc/udev/rules.d/91-podkit-ipod.rules ]; then
    if /usr/local/bin/podkit doctor --repair udev-rule >/dev/null 2>&1; then
      log "installed podkit udev rule: /etc/udev/rules.d/91-podkit-ipod.rules"
    else
      log "WARN: podkit doctor --repair udev-rule failed (exit non-zero)"
    fi
  fi
  # The podkit udev rule sets MODE="0660" GROUP="plugdev" on Apple-vendor
  # /dev/sg* nodes. Our 40-podkit-sg-perms.rules with MODE=0664 runs
  # FIRST (40 < 91), so the Apple-vendor branch wins and /dev/sg* ends
  # up 0660 — unreadable to the test user (ssh sessions cannot add to
  # plugdev mid-session, since group membership is fixed at login).
  # Install a 99-prefix override that runs AFTER 91-podkit-ipod.rules
  # and forces MODE=0664 on every sg[0-9]* node regardless of vendor.
  # Test-VM-only; production posture is untouched.
  ensure_test_vm_sg_override
}

# Override rule that wins against 91-podkit-ipod.rules's MODE=0660 for
# Apple-vendor sg nodes. 99-prefix sorts last.
TEST_VM_SG_OVERRIDE_RULE="/etc/udev/rules.d/99-podkit-device-harness-sg-override.rules"
TEST_VM_SG_OVERRIDE_BODY='# Managed by test-packages/device-testing/scripts/apply-state.sh — DO NOT EDIT.
# Overrides 91-podkit-ipod.rules MODE=0660 with MODE=0664 for /dev/sg*
# on the test VM. Allows the ssh-attached test user (not on a console
# seat, so uaccess does not fire) to read SCSI generic nodes during
# VM tests. TASK-348.
KERNEL=="sg[0-9]*", MODE="0664"'

ensure_test_vm_sg_override() {
  if [ ! -f "$TEST_VM_SG_OVERRIDE_RULE" ] \
     || ! diff -q <(printf '%s\n' "$TEST_VM_SG_OVERRIDE_BODY") "$TEST_VM_SG_OVERRIDE_RULE" >/dev/null 2>&1
  then
    printf '%s\n' "$TEST_VM_SG_OVERRIDE_BODY" > "$TEST_VM_SG_OVERRIDE_RULE"
    log "installed test-VM sg override rule: $TEST_VM_SG_OVERRIDE_RULE"
    trigger_udev_reload
  fi
}

apply_no_ffmpeg() {
  if package_installed ffmpeg; then
    apt_quiet purge ffmpeg
    log "removed: ffmpeg"
  else
    log "ffmpeg already absent — no-op"
  fi
  # Verify post-condition.
  if command -v ffmpeg >/dev/null 2>&1; then
    echo "apply-state.sh no-ffmpeg: ffmpeg is still on PATH after purge" >&2
    exit 1
  fi
}

apply_no_libgpod() {
  # Remove the runtime libgpod packages. The podkit binary statically links
  # libgpod so this has no effect on `podkit` itself — the state exercises
  # gpod-tool failure modes (gpod-tool dynamically links libgpod) and the
  # libgpod-runtime doctor check.
  to_remove=""
  for pkg in libgpod4 libgpod-common; do
    if package_installed "$pkg"; then
      to_remove="$to_remove $pkg"
    fi
  done
  if [ -n "$to_remove" ]; then
    # shellcheck disable=SC2086  # intentional word-split for apt-get args
    apt_quiet purge $to_remove
    log "removed:$to_remove"
  else
    log "libgpod4/libgpod-common already absent — no-op"
  fi
}

apply_no_udev() {
  # Remove the libgpod-shipped udev rules. Use the stash mechanism so the
  # rules can be restored when transitioning back to `healthy`. Does NOT
  # remove libgpod packages themselves — purely a udev-rule scenario.
  stash_libgpod_udev_rules
}

apply_no_sg_perms() {
  # Remove the marker udev rule that grants group access + force-tighten
  # current /dev/sg* node modes.
  remove_sg_perms_rule
}

apply_corrupt_configfs() {
  # Unmount /sys/kernel/config. mountpoint -q returns 0 only when the path is
  # actively a mount point; once it is gone, the gadget setup path that
  # depends on configfs cannot proceed (which is the intended failure mode).
  if mountpoint -q /sys/kernel/config; then
    # Lazy unmount to avoid EBUSY if something inside the kernel is still
    # holding a reference (e.g. dummy_hcd-bound gadgets from a prior test).
    umount -l /sys/kernel/config
    log "unmounted: /sys/kernel/config"
  else
    log "/sys/kernel/config already unmounted — no-op"
  fi
}

# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

main() {
  if [ "$#" -ne 1 ]; then
    echo "usage: apply-state.sh <state-id>" >&2
    echo "  state-id ∈ { healthy, no-ffmpeg, no-libgpod, no-udev, no-sg-perms, corrupt-configfs }" >&2
    exit 2
  fi

  state_id="$1"
  require_root

  case "$state_id" in
    healthy)
      apply_healthy
      ;;
    no-ffmpeg)
      apply_no_ffmpeg
      ;;
    no-libgpod)
      apply_no_libgpod
      ;;
    no-udev)
      apply_no_udev
      ;;
    no-sg-perms)
      apply_no_sg_perms
      ;;
    corrupt-configfs)
      apply_corrupt_configfs
      ;;
    *)
      echo "apply-state.sh: unknown state id '$state_id'" >&2
      echo "  valid ids: healthy, no-ffmpeg, no-libgpod, no-udev, no-sg-perms, corrupt-configfs" >&2
      exit 2
      ;;
  esac

  log "applied: $state_id"
}

main "$@"
