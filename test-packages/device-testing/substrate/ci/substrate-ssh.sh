#!/usr/bin/env bash
# substrate-ssh.sh — how the other scripts in this directory talk to the guest.
#
# Sourced, never executed. It exists because three scripts need the same ssh
# options against the same forwarded port, and a substrate reached with
# slightly different options in one of them is a substrate whose failures are
# not reproducible from the other two.
#
# This file declares and defines only. Like substrate-contract.sh it must stay
# free of side effects — it is sourced by a script whose job is to assert.
# shellcheck disable=SC2034

# The one place these are declared. boot-substrate.sh sources this file rather
# than restating them, so a caller that overrides the port or the work directory
# for the boot gets the same value in every subsequent step without having to
# know which script reads which.
SUBSTRATE_WORK_DIR="${SUBSTRATE_WORK_DIR:-${RUNNER_TEMP:-/tmp}/podkit-ci-substrate}"
SUBSTRATE_SSH_PORT="${SUBSTRATE_SSH_PORT:-2222}"
SUBSTRATE_SSH_USER="${SUBSTRATE_SSH_USER:-podkit}"
SUBSTRATE_SSH_KEY="${SUBSTRATE_SSH_KEY:-$SUBSTRATE_WORK_DIR/id_ed25519}"

# BatchMode is the load-bearing one. The device harness runs ssh
# non-interactively, and a key that only authenticates when something can
# prompt for a passphrase will hang a CI job rather than fail it — the exact
# trap the Proxmox substrate hit from a workstation routing keys through an
# agent (docs/environments/device-substrate-proxmox.md).
#
# Host-key checking is off because the guest is rebuilt from a pinned image on
# every run and gets a fresh host key each time, over a loopback-forwarded
# port. There is no identity here for known_hosts to pin.
substrate_ssh_opts() {
  printf '%s\n' \
    -i "$SUBSTRATE_SSH_KEY" \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile=/dev/null \
    -o LogLevel=ERROR \
    -o ConnectTimeout=5 \
    -o BatchMode=yes \
    -o IdentitiesOnly=yes
}

# Run a command on the substrate. Arguments are passed to ssh verbatim, so the
# caller controls quoting exactly as it would locally.
substrate_ssh() {
  local opts=()
  mapfile -t opts < <(substrate_ssh_opts)
  ssh "${opts[@]}" -p "$SUBSTRATE_SSH_PORT" "$SUBSTRATE_SSH_USER@127.0.0.1" "$@"
}

# Copy local files to a directory on the substrate. scp spells the port -P
# where ssh spells it -p, which is why this is a function rather than a
# variable the callers splice in themselves.
substrate_scp() {
  local dest="${!#}"
  local sources=("${@:1:$#-1}")
  local opts=()
  mapfile -t opts < <(substrate_ssh_opts)
  scp "${opts[@]}" -P "$SUBSTRATE_SSH_PORT" "${sources[@]}" \
    "$SUBSTRATE_SSH_USER@127.0.0.1:$dest"
}
