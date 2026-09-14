#!/usr/bin/env bash
#
# Shared guard for the builder-VM build scripts: the architecture a builder can
# actually produce, versus the architecture the run is targeting.
#
# `PODKIT_TARGET_ARCH` is the repo's one statement of "what are we building
# for" (see `targetArch()` in @podkit/substrate). It is hashed into the turbo
# cache key of every task that produces a Linux binary, and every host-side
# artifact path resolver derives its filename suffix from it.
#
# The builder VMs below are Lima instances on the developer's own machine, so
# each one produces exactly its own architecture and nothing else. If the two
# disagree, the build succeeds and writes a correctly-compiled artifact under
# the WRONG filename — and the consumer then looks for a file that no step
# produced, or finds a stale one from a previous run. Neither failure names the
# cause. This does.
#
# Sourced, not executed:  . "$SCRIPT_DIR/target-arch.sh"

# Normalise any accepted machine-type spelling to the filename convention
# (`arm64` / `x64`) that every turbo output glob and `bun --compile --target`
# already uses. Mirrors `normalizeTargetArch()` in @podkit/substrate — if you
# add a spelling there, add it here.
#
# Usage: NODE_ARCH="$(podkit_normalize_arch "$(uname -m)" 'builder arch')"
podkit_normalize_arch() {
  local raw="$1"
  local context="${2:-target architecture}"
  case "$raw" in
    arm64 | aarch64) echo arm64 ;;
    x64 | x86_64 | amd64) echo x64 ;;
    *)
      echo "ERROR: unsupported $context '$raw'." >&2
      return 1
      ;;
  esac
}

# Fail when the builder cannot produce what this run is targeting.
#
# Usage: podkit_assert_target_arch "$NODE_ARCH" "$VM_NAME"
podkit_assert_target_arch() {
  local builder_arch="$1"
  local builder_name="$2"
  local wanted="${PODKIT_TARGET_ARCH:-}"

  # Nothing configured: the builder's own architecture is the answer, which is
  # the single-machine case every developer is in today.
  [ -n "$wanted" ] || return 0

  local wanted_norm
  wanted_norm="$(podkit_normalize_arch "$wanted" 'PODKIT_TARGET_ARCH value')" || return 1
  [ "$wanted_norm" = "$builder_arch" ] && return 0

  echo "ERROR: this run targets linux-${wanted_norm} (PODKIT_TARGET_ARCH=${wanted}), but the" >&2
  echo "       builder '${builder_name}' is ${builder_arch} and can only produce" >&2
  echo "       linux-${builder_arch} artifacts." >&2
  echo "       Building anyway would write ${builder_arch} bytes under a" >&2
  echo "       linux-${wanted_norm} name, which nothing downstream would notice." >&2
  echo "       Unset PODKIT_TARGET_ARCH to build for this machine, or run the build on a" >&2
  echo "       ${wanted_norm} build host." >&2
  return 1
}
