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
#     `no-libgpod`, `no-udev`, `no-sg-perms`, `corrupt-configfs`,
#     `device-mount-near-full`).
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
# install list in test-packages/lima/vms/podkit-device.yaml.
HEALTHY_PACKAGES="ffmpeg libgpod4 libgpod-common libglib2.0-0"

# Kernel modules required to be loaded in the `healthy` state. Mirrors the
# /etc/modules-load.d/podkit-device-harness.conf list in podkit-device.yaml. `sg` is
# the SCSI generic driver — /dev/sg* nodes are required by the `inquiry-methods`
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

  # 7. device-mount-near-full loopback — torn down. The state's apply
  #    function leaves a loopback mount + filled image behind; a
  #    transition back to `healthy` must remove them or subsequent runs
  #    will inherit a near-full mount that doctor doesn't expect.
  tear_down_near_full
  # 7b. TASK-412 ADR-018 / estimate-drift loopbacks — same teardown
  #     responsibility. The post-sweep loopback also carries
  #     chattr-immutable debris that MUST be cleared before unmount,
  #     else the image keeps inode-level immutability flags into the
  #     next reuse.
  tear_down_postsweep
  tear_down_drift
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

# ---------------------------------------------------------------------------
# device-mount-near-full
#
# Provisions a small ext4 loopback filesystem at a known mountpoint and fills
# it so the next sizeable write fails with ENOSPC. Used by the save-failure
# matrix to exercise the ENOSPC code path against a real filesystem without
# disturbing the rest of the VM.
#
# Layout:
#   $NEAR_FULL_IMG  — 5 MiB ext4 image file
#   $NEAR_FULL_MNT  — mountpoint
#   $NEAR_FULL_MNT/_fill — pad file written via dd to occupy the free space
#
# 5 MiB leaves room for the manifest + a couple of tiny metadata files but
# fails the first flac copy (the audio-multi-format fixtures used by the
# matrix are >50 KiB each).
# ---------------------------------------------------------------------------

NEAR_FULL_IMG=/var/lib/podkit-device-harness/podkit-device-fs.img
NEAR_FULL_MNT=/mnt/podkit-device-fs
# Padding leaves ~50 KiB free — enough for the ext4 superblock + journal +
# a manifest, but not enough for a flac source body.
NEAR_FULL_RESERVE_KIB=50

ensure_near_full_tooling() {
  # mkfs.ext4 ships in e2fsprogs; losetup in util-linux. Both are in the
  # Debian 12 cloud image base, but the device-harness yaml does not
  # explicitly pin e2fsprogs — install if absent.
  if ! command -v mkfs.ext4 >/dev/null 2>&1; then
    log "installing e2fsprogs (mkfs.ext4 missing)"
    apt_quiet update
    apt_quiet install --no-install-recommends e2fsprogs
  fi
}

tear_down_near_full() {
  # Idempotent cleanup. Best-effort umount + image removal so transitions
  # back to `healthy` leave the VM in a known-clean state.
  if mountpoint -q "$NEAR_FULL_MNT" 2>/dev/null; then
    umount -l "$NEAR_FULL_MNT" || true
    log "unmounted: $NEAR_FULL_MNT"
  fi
  if [ -f "$NEAR_FULL_IMG" ]; then
    rm -f "$NEAR_FULL_IMG"
    log "removed: $NEAR_FULL_IMG"
  fi
}

apply_device_mount_near_full() {
  ensure_near_full_tooling

  # Always tear down first — idempotent re-application starts from a clean
  # image so the fill calculation is deterministic.
  tear_down_near_full

  # 5 MiB image, ext4, filled so ~50 KiB free remains. Delegates to the
  # shared helper for symmetry with the TASK-412 postsweep + drift states.
  provision_loopback_ext4 "$NEAR_FULL_IMG" "$NEAR_FULL_MNT" 5 "$NEAR_FULL_RESERVE_KIB"

  # Final state echo for diagnostics in CI logs.
  df_line=$(df --output=avail,used,size "$NEAR_FULL_MNT" | tail -n1)
  log "near-full df (avail/used/size KiB): $df_line"
}

# ---------------------------------------------------------------------------
# Shared loopback ext4 helper (TASK-412)
#
# Used by the post-sweep + drift SystemStates. Provisions a fresh ext4
# loopback at the given mountpoint, sized to the requested total size,
# and (optionally) fills it so the remaining free space matches the
# requested reserve.
#
# Args:
#   $1 - image path (e.g. /var/lib/podkit-device-harness/postsweep.img)
#   $2 - mountpoint (e.g. /mnt/podkit-device-fs-postsweep)
#   $3 - total image size in MiB (e.g. 1, 2)
#   $4 - reserve_kib: free KiB to leave after fill (use "none" to skip fill)
# ---------------------------------------------------------------------------
provision_loopback_ext4() {
  local img=$1
  local mnt=$2
  local size_mb=$3
  local reserve=$4

  mkdir -p "$(dirname "$img")"
  mkdir -p "$mnt"

  truncate -s "${size_mb}M" "$img"
  mkfs.ext4 -F -q "$img"
  mount -o loop "$img" "$mnt"
  log "mounted loopback: $img → $mnt (${size_mb}M)"
  chmod 0777 "$mnt"

  if [ "$reserve" = "none" ]; then
    log "loopback fill skipped: $mnt"
    return 0
  fi

  local avail_kib
  avail_kib=$(df --output=avail "$mnt" | tail -n1 | tr -d ' ')
  local fill_kib=$((avail_kib - reserve))
  if [ "$fill_kib" -lt 1 ]; then
    log "WARN: provision_loopback_ext4 $mnt: computed fill_kib=$fill_kib (avail=$avail_kib reserve=$reserve) — skipping fill"
  else
    dd if=/dev/zero of="${mnt}/_fill" bs=1K count="$fill_kib" 2>/dev/null || true
    log "filled $mnt: $fill_kib KiB written, ~$reserve KiB free"
  fi

  local df_line
  df_line=$(df --output=avail,used,size "$mnt" | tail -n1)
  log "$mnt df (avail/used/size KiB): $df_line"
}

# ---------------------------------------------------------------------------
# device-mount-fits-estimate-failed-sweep (TASK-412 ADR-018 post-sweep cell)
#
# Provisions a 1 MiB ext4 loopback with chattr-immutable debris under the
# Music content path. The pre-sync sweep walks the debris (scanner reports
# its bytes) but the per-path `rm` returns EPERM, so freedBytes stays 0
# and the post-sweep statfs sees the original ~200 KiB free.
# ---------------------------------------------------------------------------

POSTSWEEP_IMG=/var/lib/podkit-device-harness/podkit-device-fs-postsweep.img
POSTSWEEP_MNT=/mnt/podkit-device-fs-postsweep
POSTSWEEP_RESERVE_KIB=200
POSTSWEEP_DEBRIS_KIB=120
POSTSWEEP_DEBRIS_DIR_REL=Music/SeededArtist/SeededAlbum

tear_down_postsweep() {
  if mountpoint -q "$POSTSWEEP_MNT" 2>/dev/null; then
    # `chattr -i` BEFORE unmount — leaving the inode flag set inside the
    # image means the next mount + write attempt against those paths
    # will still see EPERM. Clear flags on every debris file.
    if [ -d "$POSTSWEEP_MNT/$POSTSWEEP_DEBRIS_DIR_REL" ]; then
      find "$POSTSWEEP_MNT/$POSTSWEEP_DEBRIS_DIR_REL" -type f \
        -exec chattr -i {} + 2>/dev/null || true
    fi
    umount -l "$POSTSWEEP_MNT" || true
    log "unmounted: $POSTSWEEP_MNT"
  fi
  if [ -f "$POSTSWEEP_IMG" ]; then
    rm -f "$POSTSWEEP_IMG"
    log "removed: $POSTSWEEP_IMG"
  fi
}

apply_device_mount_fits_estimate_failed_sweep() {
  ensure_near_full_tooling

  # Always tear down first — idempotent re-application starts from a clean
  # image so the fill + debris calculation is deterministic.
  tear_down_postsweep

  # 1 MiB image, ~200 KiB free after baseline fill.
  provision_loopback_ext4 "$POSTSWEEP_IMG" "$POSTSWEEP_MNT" 1 "$POSTSWEEP_RESERVE_KIB"

  # Seed debris under the Music content path. Two .podkit-tmp files at
  # ~60 KiB each = ~120 KiB total. The scanner reports their bytes;
  # chattr +i makes rm fail per-file with EPERM.
  local debris_dir="$POSTSWEEP_MNT/$POSTSWEEP_DEBRIS_DIR_REL"
  mkdir -p "$debris_dir"
  dd if=/dev/zero of="$debris_dir/01-old.flac.podkit-tmp" bs=1K count=60 2>/dev/null || true
  dd if=/dev/zero of="$debris_dir/02-old.flac.podkit-tmp" bs=1K count=60 2>/dev/null || true
  chattr +i "$debris_dir/01-old.flac.podkit-tmp"
  chattr +i "$debris_dir/02-old.flac.podkit-tmp"
  log "seeded chattr-immutable debris: $debris_dir/{01,02}-old.flac.podkit-tmp (~$POSTSWEEP_DEBRIS_KIB KiB total)"

  # Echo final free-space for diagnostics — the sync's pre-flight reads
  # this same value.
  local df_line
  df_line=$(df --output=avail,used,size "$POSTSWEEP_MNT" | tail -n1)
  log "postsweep df (avail/used/size KiB): $df_line"
}

# ---------------------------------------------------------------------------
# device-mount-fits-estimate-source-drifts (TASK-412 estimate-drift cell)
#
# Provisions a 2 MiB ext4 loopback sized to fit the planner's
# estimateCopySize prediction for a 30s mp3 (~960 KiB at 256 kbps default)
# but NOT the actual 320 kbps source body (~1200 KiB). The source itself
# is provisioned by the test, not this SystemState.
# ---------------------------------------------------------------------------

# The drift cell's planner estimate is ~940 KiB (30s mp3 × 256 kbps typical
# + M4A overhead) and the source's actual body is ~1200 KiB (30s × 320 kbps).
# Reserve must be > 940 KiB so the plan-time gate passes AND < 1200 KiB so
# the transfer-phase atomic copy ENOSPCs. 1100 KiB gives ~80 KiB margin on
# each side after ext4 reserved-blocks (5%) + fs overhead.
DRIFT_IMG=/var/lib/podkit-device-harness/podkit-device-fs-drift.img
DRIFT_MNT=/mnt/podkit-device-fs-drift
DRIFT_RESERVE_KIB=1100

tear_down_drift() {
  if mountpoint -q "$DRIFT_MNT" 2>/dev/null; then
    umount -l "$DRIFT_MNT" || true
    log "unmounted: $DRIFT_MNT"
  fi
  if [ -f "$DRIFT_IMG" ]; then
    rm -f "$DRIFT_IMG"
    log "removed: $DRIFT_IMG"
  fi
}

apply_device_mount_fits_estimate_source_drifts() {
  ensure_near_full_tooling
  tear_down_drift

  # 3 MiB image, ~1100 KiB free after baseline fill — enough headroom for
  # ext4's 5% reserved-blocks + journal overhead to leave the actual
  # `statfs` reading above the 940 KiB plan estimate but below the 1200
  # KiB actual mp3 body.
  provision_loopback_ext4 "$DRIFT_IMG" "$DRIFT_MNT" 3 "$DRIFT_RESERVE_KIB"

  local df_line
  df_line=$(df --output=avail,used,size "$DRIFT_MNT" | tail -n1)
  log "drift df (avail/used/size KiB): $df_line"
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
    echo "  state-id ∈ { healthy, no-ffmpeg, no-libgpod, no-udev, no-sg-perms, corrupt-configfs, device-mount-near-full, device-mount-fits-estimate-failed-sweep, device-mount-fits-estimate-source-drifts }" >&2
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
    device-mount-near-full)
      apply_device_mount_near_full
      ;;
    device-mount-fits-estimate-failed-sweep)
      apply_device_mount_fits_estimate_failed_sweep
      ;;
    device-mount-fits-estimate-source-drifts)
      apply_device_mount_fits_estimate_source_drifts
      ;;
    *)
      echo "apply-state.sh: unknown state id '$state_id'" >&2
      echo "  valid ids: healthy, no-ffmpeg, no-libgpod, no-udev, no-sg-perms, corrupt-configfs, device-mount-near-full, device-mount-fits-estimate-failed-sweep, device-mount-fits-estimate-source-drifts" >&2
      exit 2
      ;;
  esac

  log "applied: $state_id"
}

main "$@"
