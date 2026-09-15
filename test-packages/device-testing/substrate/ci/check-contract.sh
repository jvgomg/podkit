#!/usr/bin/env bash
# check-contract.sh — turn a booted Debian box into a device substrate and
# assert that it is one. The exit code is the conformance verdict.
#
# Runs the same two steps, in the same order, that `harness:setup` runs against
# a Lima VM and that the Proxmox playbook runs by hand:
#
#   1. copy the three contract scripts in
#   2. sudo provision-substrate.sh
#   3. substrate-doctor.sh, unprivileged, exit zero required
#
# That sameness is the point. If this script needed a step the other two paths
# do not, the contract would have grown a clause that only CI satisfies — which
# is the inverse of the drift this backstop exists to catch.
#
# Expects a substrate already reachable, i.e. boot-substrate.sh has run (or an
# ssh-reachable box is described by the SUBSTRATE_SSH_* variables).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./substrate-ssh.sh
# shellcheck disable=SC1091 # lint-shell.mjs runs shellcheck without -x, so the
# source= directive above documents the target without shellcheck following it.
. "$SCRIPT_DIR/substrate-ssh.sh"

CONTRACT_SRC="$SCRIPT_DIR/../../scripts"
REMOTE_DIR="${SUBSTRATE_REMOTE_DIR:-/tmp/podkit-substrate}"

log() { echo "==> $1"; }

# All three, because provision-substrate.sh and substrate-doctor.sh each source
# substrate-contract.sh from their own directory. Copying two of them yields a
# "No such file or directory" from a `.` line, which reads as a broken script
# rather than as a missing file.
CONTRACT_FILES=(
  "$CONTRACT_SRC/substrate-contract.sh"
  "$CONTRACT_SRC/provision-substrate.sh"
  "$CONTRACT_SRC/substrate-doctor.sh"
)
for file in "${CONTRACT_FILES[@]}"; do
  [ -r "$file" ] || { echo "FATAL: missing $file" >&2; exit 1; }
done

log "copying the contract to $REMOTE_DIR"
substrate_ssh "mkdir -p '$REMOTE_DIR'"
substrate_scp "${CONTRACT_FILES[@]}" "$REMOTE_DIR/"

# `bash <path>` rather than `./<path>`: scp does not carry the execute bit, and
# a substrate is not required to have the copy destination on a mounted-exec
# filesystem.
log "provisioning"
substrate_ssh "sudo bash '$REMOTE_DIR/provision-substrate.sh'"

# Unprivileged, deliberately: the doctor's contract says it runs that way, and
# running it under sudo here would let an assertion that silently needs root
# pass on CI and fail for the next person who follows the playbook.
log "running the doctor"
substrate_ssh "bash '$REMOTE_DIR/substrate-doctor.sh'"

echo
echo "conformance: PASS — a Debian box provisioned by the shared contract scripts"
echo "satisfies substrate-doctor.sh on hardware this project does not own."
