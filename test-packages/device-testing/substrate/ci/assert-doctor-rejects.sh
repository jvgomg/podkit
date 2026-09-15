#!/usr/bin/env bash
# assert-doctor-rejects.sh — exercise substrate-doctor.sh's negative assertions
# by deliberately breaking a conforming substrate.
#
# A doctor whose failure path is never exercised is a doctor that passes
# everything. The doctor's negative half — "no toolchain, no -dev packages" — is
# the half that never fires in normal use, because nobody installs gcc on a
# substrate on purpose. So it is the half most likely to have been silently
# broken by an edit to the dpkg-query/awk pipeline it is implemented with.
#
# Two things are asserted, and the second is the one that matters:
#
#   1. the doctor fails (non-zero exit)
#   2. it names the offending packages
#
# A doctor that fails with "something is wrong" satisfies (1) while being
# useless to the person who has to fix the box. Asserting only the exit code
# would let the message rot into exactly that.
#
# DESTRUCTIVE. It installs a toolchain on the target and does not remove it —
# a box that has had build-essential on it is no longer trustworthy for the
# linkage claims the substrate exists to make, so the honest end state is
# "throw this box away", not "uninstall and hope". Run it last, against a
# disposable substrate. It will not poison a box the doctor does not already
# pass, which is the closest thing to a safety catch available here.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./substrate-ssh.sh
# shellcheck disable=SC1091 # lint-shell.mjs runs shellcheck without -x, so the
# source= directive above documents the target without shellcheck following it.
. "$SCRIPT_DIR/substrate-ssh.sh"

REMOTE_DIR="${SUBSTRATE_REMOTE_DIR:-/tmp/podkit-substrate}"
DOCTOR="bash '$REMOTE_DIR/substrate-doctor.sh'"

# Packages to install, and the names the doctor must then print. The three
# expected names cover both negative code paths and both of the dpkg sweep's
# branches:
#
#   npm             a forbidden *command*, found on PATH
#   build-essential a forbidden *package*, matched by name
#   libc6-dev       matched by the `-dev` suffix rule rather than by name,
#                   which is the branch a hand-maintained deny-list cannot have
#
# `node` is deliberately not required. Debian's nodejs packaging has moved
# /usr/bin/node in and out of the nodejs package across releases, and an
# assertion on it would fail for a reason that has nothing to do with the
# doctor.
POISON_PACKAGES="build-essential npm"
EXPECTED_NAMES="npm build-essential libc6-dev"

log() { echo "==> $1"; }
fatal() { echo "FATAL: $1" >&2; exit 1; }

# The baseline is not ceremony. If the doctor is already failing — a package
# that would not install, a module that would not load — then a non-zero exit
# after poisoning proves nothing at all, and this script would report a working
# negative assertion on the strength of an unrelated failure.
log "confirming the substrate passes before it is broken"
substrate_ssh "$DOCTOR" >/dev/null \
  || fatal "the doctor already fails on this box — the negative assertion below would be meaningless"

log "installing $POISON_PACKAGES to violate the contract on purpose"
substrate_ssh "sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $POISON_PACKAGES" >/dev/null

log "re-running the doctor — it must now fail, by name"
# The doctor writes failures to stderr and passes to stdout; both are wanted.
# errexit is lifted around the call rather than the status being swallowed
# with `|| true`, because the status *is* the first assertion — non-zero is the
# expected outcome here and has to survive to be checked.
set +e
output="$(substrate_ssh "$DOCTOR" 2>&1)"
status=$?
set -e

printf '%s\n' "$output"
echo

[ "$status" -ne 0 ] || fatal "the doctor exited 0 on a box carrying $POISON_PACKAGES"

missing=""
for name in $EXPECTED_NAMES; do
  case "$output" in
    *"$name"*) echo "ok       doctor named $name" ;;
    *) missing="$missing $name" ;;
  esac
done

if [ -n "$missing" ]; then
  fatal "the doctor failed but did not name:$missing — a generic failure is not an actionable verdict"
fi

echo
echo "negative assertions: PASS — the doctor rejected a non-conforming box and named"
echo "every offending package. This substrate is now poisoned; discard it."
