#!/usr/bin/env bash
# substrate-contract.sh — the device substrate contract, as data.
#
# A "substrate" is any SSH-reachable Debian host that satisfies what this file
# declares. It is sourced by both halves of the contract:
#
#   provision-substrate.sh  — makes a plain Debian box satisfy it
#   substrate-doctor.sh     — asserts that it does, and exits non-zero if not
#
# Nothing here knows which provisioner produced the box. Lima and Proxmox
# cloud-init both end at "a Debian box reachable over ssh", copy these scripts
# in, and run them — so the substrate is defined by what it provides rather
# than by what created it.
#
# Every value below is consumed by the scripts that source this file. A linter
# cannot see across a `.` boundary, so the unused-variable check is suppressed
# file-wide here rather than with one directive per assignment.
# shellcheck disable=SC2034
#
# This file declares values only. It must stay free of side effects: it is
# sourced by a doctor that is expected not to mutate the host it inspects.

# Debian major version the harness is built against. Asserted hard: the
# module names, package names and gadget stack below are all bookworm's.
# Kept in step with @podkit/substrate's `SUBSTRATE_DEBIAN_MAJOR` by
# `debian-image.test.ts` — see the note on the point release below.
SUBSTRATE_DEBIAN_MAJOR="12"

# Point release the provisioning images pin. Reported as drift rather than
# asserted: which qcow2 you booted is a provisioning input, while the running
# point release moves under you with any security update. A box that has taken
# an update is not a box that has broken the contract.
#
# This restates `SUBSTRATE_DEBIAN_POINT_RELEASE` from @podkit/substrate
# (src/debian-image.ts) because a substrate has no TypeScript on it — and must
# not: this very file forbids a toolchain on the box. The restatement is checked
# rather than trusted: `debian-image.test.ts` reads this file and fails if the
# two values disagree. Bump the TypeScript constant, then run that test.
SUBSTRATE_DEBIAN_POINT_RELEASE="12.10"

# Runtime packages the harness needs present. Deliberately runtime-only — see
# SUBSTRATE_FORBIDDEN_* below for the other half of the invariant.
#
#   ffmpeg          the one system runtime dep podkit users install
#   libgpod4        runtime-only libgpod, for the gpod-tool test helper
#   libgpod-common  udev rules + data files shipped with libgpod runtime
#   libglib2.0-0    runtime glib; a libgpod4 dep, explicit for clarity
#   ca-certificates boot-time TLS for apt and for ssh
#   kmod            modprobe/lsmod/depmod, for boot-time module loading
#   dosfstools      mkfs.vfat, for synthesising FAT32 backing images
#   mtools          mcopy/mmd, to seed those images without loop-mounting
#   e2fsprogs       ext filesystem tooling for backing-image work
SUBSTRATE_PACKAGES="ffmpeg libgpod4 libgpod-common libglib2.0-0 ca-certificates kmod dosfstools mtools e2fsprogs"

# Kernel modules that must be loaded. dummy_hcd provides a virtual USB host
# controller; libcomposite plus the usb_f_* function modules are what the
# FunctionFS daemon builds iPod-shaped gadgets out of. `sg` provides the
# /dev/sg* SCSI generic nodes that podkit's inquiry-methods doctor check
# probes when scanning for iPods.
SUBSTRATE_MODULES="dummy_hcd libcomposite usb_f_mass_storage usb_f_fs sg"

# dummy_hcd ships with num=1 — one virtual UDC, so one gadget at a time. The
# harness needs at least two, to run two daemon instances side by side for
# multi-iPod scenarios. Four is arbitrary: well below the kernel's
# MAX_UDC_HOSTS (16), with headroom and no measurable boot cost.
SUBSTRATE_UDC_COUNT="4"

# Where the gadget configfs tree must be mounted.
SUBSTRATE_CONFIGFS_MOUNTPOINT="/sys/kernel/config"

# Commands that must NOT be present. The substrate exists to surface binary
# linkage problems in a statically-linked podkit: a toolchain on PATH can mask
# exactly the failure it is there to catch.
SUBSTRATE_FORBIDDEN_COMMANDS="bun node npm"

# Installed packages that must NOT be present: anything whose name ends in
# -dev, plus the toolchain metapackages. Same reasoning as above.
SUBSTRATE_FORBIDDEN_PACKAGES="build-essential pkg-config"

# Directory the harness installs transferred binaries into. Must exist and be
# writable by root; the substrate receives artifacts only, never a source tree.
SUBSTRATE_BIN_DIR="/usr/local/bin"
