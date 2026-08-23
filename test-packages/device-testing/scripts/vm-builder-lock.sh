#!/usr/bin/env bash
#
# Shared cross-process advisory lock for serialising Lima builder-VM
# start/create. Two independent turbo tasks (build:linux-prebuild and
# gpod-testing#build:linux-binary) can be scheduled concurrently and each may
# need to start the SAME shared builder VM (either can be a cache-miss while
# the other is a cache-hit). Without coordination, two `limactl start`s race
# the hostagent pidfile and crash with "another hostagent may already be
# running". This guards the whole check-then-start critical section so exactly
# one process starts the instance; the others wait, then observe it Running.
#
# macOS has no flock(1), so this is a mkdir-atomic lock (mkdir is an atomic
# create-or-fail) made liveness-aware: the lock records the owning shell PID,
# and a contender reclaims it if that PID is gone (crash-safe). Prototype for
# the @podkit/lima core lock — the real one moves into the podkit-vm CLI.
#
# Usage (source this file):
#   source "$SCRIPT_DIR/vm-builder-lock.sh"
#   acquire_vm_lock "$VM_NAME"
#   trap 'release_vm_lock "$VM_NAME"' EXIT
#   ...check-then-start the VM...
#   release_vm_lock "$VM_NAME"; trap - EXIT

_vm_lock_dir() { echo "${TMPDIR:-/tmp}/podkit-vmlock-$1"; }

# acquire_vm_lock <key> [timeout-seconds]
# Blocks until the lock is held. Default timeout 600s: a first-time VM create
# legitimately takes 5-10 min, so a contender must out-wait a real create
# rather than reclaim a live lock.
acquire_vm_lock() {
  local key="$1" timeout="${2:-600}" lockdir waited=0 holder
  lockdir="$(_vm_lock_dir "$key")"
  while ! mkdir "$lockdir" 2>/dev/null; do
    holder="$(cat "$lockdir/owner" 2>/dev/null || true)"
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
      # Owner process is gone — stale lock. Reclaim and retry (mkdir is
      # atomic, so if several contenders race the reclaim only one wins).
      rm -rf "$lockdir" 2>/dev/null || true
      continue
    fi
    if [ "$waited" -ge "$timeout" ]; then
      echo "ERROR: timed out after ${timeout}s waiting for VM lock '$key'" \
           "(held by PID ${holder:-unknown})" >&2
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "$$" >"$lockdir/owner"
}

# release_vm_lock <key>
release_vm_lock() {
  rm -rf "$(_vm_lock_dir "$1")" 2>/dev/null || true
}
