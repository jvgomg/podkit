#!/usr/bin/env bash
# builder-contract.sh — the builder contract, as data.
#
# A "builder" is any SSH-reachable Debian host that satisfies what this file
# declares. It is sourced by both halves of the contract:
#
#   provision-builder.sh  — makes a plain Debian box satisfy it
#   builder-doctor.sh     — asserts that it does, and exits non-zero if not
#
# Nothing here knows which provisioner produced the box. Proxmox cloud-init,
# libvirt, a cloud instance and a spare amd64 machine all end at "a Debian box
# reachable over ssh", copy these scripts in, and run them.
#
# ---------------------------------------------------------------------------
# This is the INVERSE of substrate-contract.sh, and must never be merged with it
# ---------------------------------------------------------------------------
#
# The substrate's defining assertion is that no toolchain and no `-dev` package
# is present: that absence is precisely what lets it catch a static-linkage
# regression in a binary claiming to need neither. A builder needs exactly those
# packages. The two contracts therefore contradict each other by design.
#
# What they share is MECHANISM — three files, values/apply/assert, copied in and
# run as root, exit code is the verdict — and nothing else. Neither file sources
# the other, and there is no third file of "common" packages for them to agree
# on. The day one appears is the day a toolchain can reach the box whose entire
# job is to prove one is not needed (ADR-029 §4).
#
# `builder-contract.test.ts` pins that: it asserts the builder requires every
# command and package the substrate forbids, and that neither script sources the
# other's contract.
#
# Every value below is consumed by the scripts that source this file. A linter
# cannot see across a `.` boundary, so the unused-variable check is suppressed
# file-wide here rather than with one directive per assignment.
# shellcheck disable=SC2034
#
# This file declares values only. It must stay free of side effects: it is
# sourced by a doctor that is expected not to mutate the host it inspects.

# Debian major version a builder must run. Asserted hard, and for a reason the
# substrate's version of this assertion does not have: glibc.
#
# A `bun --compile` podkit binary links libgpod statically but glibc
# dynamically, so the builder's glibc becomes the produced artifact's minimum.
# Bookworm ships 2.36; a builder on trixie (2.41) yields binaries that will not
# start on the bookworm substrate they are transferred to, and the symptom is a
# runtime loader error on another machine rather than a build failure here.
#
# Kept in step with @podkit/substrate's `SUBSTRATE_DEBIAN_MAJOR` by
# `builder-contract.test.ts`: builder and substrate must move together or the
# ABI chain (builder produces → abi-verify vouches → substrate runs) becomes
# three unrelated observations.
BUILDER_DEBIAN_MAJOR="12"

# Point release the provisioning image pins. Reported as drift rather than
# asserted, for the same reason the substrate does it: which qcow2 you booted is
# a provisioning input, while the running point release advances with any
# security update.
#
# This restates `SUBSTRATE_DEBIAN_POINT_RELEASE` from @podkit/substrate because
# a builder is provisioned before it has a repo checkout on it. The restatement
# is checked rather than trusted — see `builder-contract.test.ts`.
BUILDER_DEBIAN_POINT_RELEASE="12.10"

# ---------------------------------------------------------------------------
# The toolchain
# ---------------------------------------------------------------------------

# apt packages the glibc builds need. This list is the same one the Lima glibc
# builder installs (test-packages/lima/vms/podkit-builder-glibc.yaml), and
# `builder-contract.test.ts` asserts the two agree exactly — the Lima YAML
# cannot source this file, so the duplication is unavoidable; the duplication
# going unnoticed is not.
#
# What each group buys:
#
#   build-essential pkg-config          the C toolchain itself
#   python3 python3-pip python3-venv    meson's runtime, and how it is upgraded
#   cmake ninja-build                   koffi and the static-deps builds
#   intltool autoconf automake libtool  libgpod's autotools bootstrap
#   gtk-doc-tools libxml-parser-perl    gtkdocize + the XML::Parser intltool wants
#   lib*-dev                            the static C-dep closure compile.sh embeds
#   libgpod-dev                         gpod-tool links libgpod-1.0 dynamically
#   ca-certificates curl unzip          fetching Node, Bun and image tarballs
#   git rsync                           staging a source tree onto this box
#   ffmpeg                              podkit's one runtime dependency, for smoke runs
BUILDER_TOOLCHAIN_PACKAGES="build-essential pkg-config python3 python3-pip python3-venv cmake ninja-build intltool autoconf automake libtool gtk-doc-tools libgdk-pixbuf-2.0-dev libglib2.0-dev libgpod-dev libplist-dev libffi-dev libsqlite3-dev libpng-dev libjpeg-dev libtiff-dev libxml2-dev zlib1g-dev libpcre2-dev libxml-parser-perl ca-certificates ffmpeg git curl unzip rsync"

# Commands that must be on PATH. Distinct from the package list rather than
# derived from it: `bun`, `node` and `meson` arrive from upstream installers
# rather than from apt, and a package being installed is not the same claim as
# its command being reachable by the user a build actually runs as.
#
# Every one of `bun`, `node` and `npm` is a command substrate-contract.sh
# FORBIDS. That contradiction is the contract, not an oversight.
BUILDER_COMMANDS="bun node npm gcc g++ make pkg-config cmake meson ninja autoconf automake libtoolize intltoolize gtkdocize git curl rsync unzip ffmpeg"

# pkg-config modules the native build resolves. Asserted alongside the package
# names because these are what the build actually consumes: a `-dev` package
# installed without its `.pc` file satisfies dpkg and then fails `configure`
# several minutes into a build.
#
# libjpeg is deliberately absent: its `.pc` is named inconsistently across
# distributions and implementations, so the package assertion is the honest
# check there. Everything listed here has one stable module name.
BUILDER_PKGCONFIG_MODULES="glib-2.0 gobject-2.0 gio-2.0 gdk-pixbuf-2.0 libgpod-1.0 libplist-2.0 libffi sqlite3 libpng libtiff-4 libxml-2.0 zlib libpcre2-8"

# Minimum meson. Debian 12 ships 1.0.1 and glib 2.82.4 requires >= 1.2.0, so a
# builder that passed every other assertion would still fail the static-deps
# build. Provisioning installs a newer meson over apt's via pip.
BUILDER_MESON_MIN_VERSION="1.2.0"

# Node major the builds are done against — matches what the Lima glibc builder
# installs from NodeSource. node-gyp bakes the ABI of whatever Node built the
# addon into it, so this is a property of the artifact, not a preference.
BUILDER_NODE_MAJOR="22"

# ---------------------------------------------------------------------------
# musl, without a second VM
# ---------------------------------------------------------------------------
#
# The macOS path builds musl artifacts in a second Lima VM. A builder does it in
# a container on the box it already has: a hypervisor that cannot comfortably
# hold a 2 GiB substrate and a 4 GiB builder at once certainly cannot hold a
# third VM, and the Alpine userland is the entire difference between the two
# builds.
#
# Decided in `backlog/docs/doc-060` ("musl on a remote builder means an Alpine
# container on that build host") and in TASK-520. NOT in ADR-029 §4 — that
# section decides builder-as-a-role and the inverse contract, and on libc says
# only that glibc and musl move together. Cited precisely because the two are
# easy to conflate and the ADR is the frozen record.

# Container runtime. Podman rather than Docker: no daemon to run on a box that
# is stopped when idle, and it is in Debian 12 main, so it arrives with the rest
# of the package list instead of from a third-party apt source.
BUILDER_CONTAINER_PACKAGES="podman"
BUILDER_CONTAINER_RUNTIME="podman"

# Base image for the musl build container. Pinned to the same Alpine minor the
# published Docker image is FROM (packages/podkit-docker/Dockerfile), because
# the binaries built in it ship in that image. Bumping is deliberate and moves
# with the Dockerfile.
BUILDER_MUSL_BASE_IMAGE="alpine:3.21"

# Name provisioning tags the built musl image with, and the name the musl build
# runs. Local to the builder — never pushed anywhere.
BUILDER_MUSL_IMAGE="podkit-musl-builder:local"

# Where the Containerfile that image is built from lives, relative to the
# directory these three scripts sit in. provision-builder.sh resolves it against
# its own location, because it runs on a box that has no repo checkout on it —
# only whatever was copied across.
#
# `BUILDER_MUSL_CONTAINERFILE_REL_PATH` restates the same tail from the repo
# root, for the test that has to find the file in a checkout. Derived from the
# value above rather than typed twice: the two answer different questions and
# must not be able to drift apart while doing it.
BUILDER_MUSL_CONTAINERFILE_SUBPATH="../builder/musl/Containerfile"
BUILDER_MUSL_CONTAINERFILE_REL_PATH="test-packages/device-testing/scripts/$BUILDER_MUSL_CONTAINERFILE_SUBPATH"

# ---------------------------------------------------------------------------
# Where work happens
# ---------------------------------------------------------------------------

# Directory a source tree is staged into. Unlike the substrate — which receives
# artifacts only and never a source tree — a builder is staged into by rsync
# over the link, so this directory exists and is writable by an unprivileged
# user.
#
# /var/tmp rather than /tmp: /tmp is cleared on boot and may be a tmpfs sized
# against RAM, and a full repo checkout plus a static-deps tree does not belong
# in either.
BUILDER_STAGING_DIR="/var/tmp/podkit-build"

# Cache directory for the static C-dep closure and the prebuild work tree. Kept
# OUTSIDE the staging directory so it survives `rsync --delete` and is reused
# across builds — a cold static-deps build is the expensive part of a builder's
# first run and nothing about it changes between source revisions.
BUILDER_CACHE_DIR="/var/cache/podkit-build"

# Where provisioning records which template produced this box. Same reasoning as
# the substrate's: the running point release advances on its own and answers a
# different question from "what was this built from".
BUILDER_PROVENANCE_FILE="/etc/podkit-builder-provenance"
