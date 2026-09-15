#!/usr/bin/env bash
# boot-substrate.sh — bring up a device substrate as a QEMU/KVM guest and
# leave it reachable over ssh on localhost.
#
# The third provisioner recipe, beside `../proxmox/`. Like that one it produces
# nothing but "a Debian box you can ssh into"; what turns that box into a
# substrate is applied afterwards by the shared contract scripts:
#
#   ../../scripts/provision-substrate.sh
#   ../../scripts/substrate-doctor.sh
#
# Written for the CI conformance backstop (.github/workflows/
# substrate-conformance.yml), which needs a substrate on a machine nobody in
# this project owns. It is plain bash with no CI in it, so it also works as a
# local way to get a throwaway substrate on any Linux box with KVM.
#
# Usage:
#   SUBSTRATE_IMAGE_URL=$(bun -e 'import { substrateDebianImageUrl } from
#     "./test-packages/substrate/src/debian-image.ts";
#     console.log(substrateDebianImageUrl("amd64"))') \
#     test-packages/device-testing/substrate/ci/boot-substrate.sh
#
# The image URL is required rather than defaulted on purpose. `@podkit/substrate`
# is the single place the pinned Debian serial lives (`debian-image.ts`), and a
# default here would be a fourth copy of it — exactly the drift that module was
# extracted to kill. A shell script cannot import TypeScript, so the caller
# resolves it and passes it in.
#
# Contract:
#   - Requires SUBSTRATE_IMAGE_URL. Everything else has a default.
#   - Requires qemu-system-x86_64, qemu-img, cloud-localds, ssh-keygen, curl.
#   - Requires /dev/kvm to be writable by the invoking user. Deliberately not
#     falling back to TCG: a software-emulated boot takes minutes and would turn
#     a missing permission into a slow job rather than a clear error.
#   - Leaves behind, in $SUBSTRATE_WORK_DIR: the ssh key (`id_ed25519`), the
#     QEMU pidfile, and `console.log` — upload that one on failure, it is the
#     only evidence of a guest that never reached sshd.
#   - Exits 0 once `ssh` succeeds and cloud-init reports done.
#
# Tear-down is deliberately absent: on CI the runner is destroyed, and locally
# `kill $(cat "$SUBSTRATE_WORK_DIR/qemu.pid")` is the whole of it.

set -euo pipefail

: "${SUBSTRATE_IMAGE_URL:?SUBSTRATE_IMAGE_URL is required — see the header for how to resolve it}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=./substrate-ssh.sh
# shellcheck disable=SC1091 # lint-shell.mjs runs shellcheck without -x, so the
# source= directive above documents the target without shellcheck following it.
. "$SCRIPT_DIR/substrate-ssh.sh"

SUBSTRATE_IMAGE_CACHE="${SUBSTRATE_IMAGE_CACHE:-$SUBSTRATE_WORK_DIR/cache}"
SUBSTRATE_HOSTNAME="${SUBSTRATE_HOSTNAME:-podkit-ci-substrate}"
# 2 vCPUs of the runner's 4, and 2 GiB of its 16. The guest runs apt and a
# doctor, never a test suite; the runner still needs headroom for the job.
SUBSTRATE_VCPUS="${SUBSTRATE_VCPUS:-2}"
SUBSTRATE_MEMORY_MB="${SUBSTRATE_MEMORY_MB:-2048}"
# The generic cloud image ships a ~3 GiB virtual disk with well under a GiB
# free. The contract's package set (ffmpeg pulls a large dependency tree) does
# not fit in that, and apt's out-of-space failure is reported as a dpkg error
# several hundred lines from the cause.
SUBSTRATE_DISK_GROW="${SUBSTRATE_DISK_GROW:-8G}"
SUBSTRATE_BOOT_TIMEOUT="${SUBSTRATE_BOOT_TIMEOUT:-300}"

IMAGE_NAME="$(basename "$SUBSTRATE_IMAGE_URL")"
CACHED_IMAGE="$SUBSTRATE_IMAGE_CACHE/$IMAGE_NAME"
BOOT_DISK="$SUBSTRATE_WORK_DIR/substrate.qcow2"
SEED_IMAGE="$SUBSTRATE_WORK_DIR/seed.img"
CONSOLE_LOG="$SUBSTRATE_WORK_DIR/console.log"
QEMU_PIDFILE="$SUBSTRATE_WORK_DIR/qemu.pid"

log() { echo "==> $1"; }
fatal() { echo "FATAL: $1" >&2; exit 1; }

for tool in qemu-system-x86_64 qemu-img cloud-localds ssh-keygen ssh curl; do
  command -v "$tool" >/dev/null 2>&1 || fatal "$tool is not on PATH"
done

# Checked before the 443 MB download rather than after: a permission problem
# here is the single most likely reason this script fails on a hosted runner,
# and it costs nothing to find out first.
[ -w /dev/kvm ] || fatal "/dev/kvm is not writable by $(id -un) — on a GitHub runner, add the udev rule (see the workflow)"

mkdir -p "$SUBSTRATE_WORK_DIR" "$SUBSTRATE_IMAGE_CACHE"

# ---------------------------------------------------------------------------
# Pinned image
# ---------------------------------------------------------------------------

if [ -s "$CACHED_IMAGE" ]; then
  log "using cached image $CACHED_IMAGE"
else
  log "downloading $SUBSTRATE_IMAGE_URL"
  # Download to a temp name and rename: a cache directory that persists across
  # runs must never hold a truncated qcow2, which qemu reports as a corrupt
  # image rather than as a short file.
  curl -fSL --retry 3 --retry-delay 5 -o "$CACHED_IMAGE.partial" "$SUBSTRATE_IMAGE_URL"
  mv "$CACHED_IMAGE.partial" "$CACHED_IMAGE"
fi

# Copy-on-write overlay would be cheaper, but a backing file leaves the cached
# image mutable-by-reference: any guest write corrupts the next run's cache
# entry. Copying 443 MB takes about a second and makes the cache read-only in
# practice.
log "preparing boot disk (+$SUBSTRATE_DISK_GROW)"
cp "$CACHED_IMAGE" "$BOOT_DISK"
qemu-img resize "$BOOT_DISK" "+$SUBSTRATE_DISK_GROW"

# ---------------------------------------------------------------------------
# cloud-init seed
# ---------------------------------------------------------------------------
#
# Rendered from the committed Proxmox template, unmodified. Using the same file
# both provisioners use is most of this job's value beyond the doctor's exit
# code: the template is otherwise only ever exercised by hand on a PVE host, so
# a change that breaks it would be found by the next person to build a
# substrate rather than by CI.

log "generating an ephemeral ssh key"
rm -f "$SUBSTRATE_SSH_KEY" "$SUBSTRATE_SSH_KEY.pub"
ssh-keygen -t ed25519 -N '' -C 'podkit-ci-substrate' -f "$SUBSTRATE_SSH_KEY" >/dev/null

log "rendering cloud-init user-data"
USER_DATA="$SUBSTRATE_WORK_DIR/user-data.yaml"
TEMPLATE="$SCRIPT_DIR/../proxmox/cloud-init.user-data.yaml"
[ -r "$TEMPLATE" ] || fatal "cloud-init template missing at $TEMPLATE"
# Substituted literally, by hand, rather than with sed or awk's gsub. Both of
# those interpret their replacement text — `/` terminates a sed expression and
# `&` means "the matched text" in both — and the value being substituted here is
# an arbitrary public key line supplied by whoever runs this. Today's ed25519
# keys happen to be safe; that is not a property worth depending on in the one
# place a substrate's only credential is written.
awk -v host="$SUBSTRATE_HOSTNAME" -v key="$(cat "$SUBSTRATE_SSH_KEY.pub")" '
  function replace(s, needle, value,   out, i) {
    while ((i = index(s, needle)) > 0) {
      out = out substr(s, 1, i - 1) value
      s = substr(s, i + length(needle))
    }
    return out s
  }
  { print replace(replace($0, "__HOSTNAME__", host), "__SSH_PUBKEY__", key) }
' "$TEMPLATE" > "$USER_DATA"
if grep -q '__[A-Z_]*__' "$USER_DATA"; then
  fatal "unsubstituted placeholder left in $USER_DATA — the template grew one this script does not know about"
fi

cloud-localds "$SEED_IMAGE" "$USER_DATA"

# ---------------------------------------------------------------------------
# Boot
# ---------------------------------------------------------------------------
#
# User-mode networking with a single forwarded port. The guest needs egress
# (apt) and the host needs ssh in; it needs no address of its own, and asking
# for one would mean a bridge and root on the runner.

log "booting the guest (ssh on 127.0.0.1:$SUBSTRATE_SSH_PORT)"
rm -f "$CONSOLE_LOG" "$QEMU_PIDFILE"
qemu-system-x86_64 \
  -name "$SUBSTRATE_HOSTNAME" \
  -machine q35,accel=kvm \
  -cpu host \
  -smp "$SUBSTRATE_VCPUS" \
  -m "$SUBSTRATE_MEMORY_MB" \
  -drive "file=$BOOT_DISK,if=virtio,format=qcow2" \
  -drive "file=$SEED_IMAGE,if=virtio,format=raw" \
  -netdev "user,id=net0,hostfwd=tcp:127.0.0.1:$SUBSTRATE_SSH_PORT-:22" \
  -device virtio-net-pci,netdev=net0 \
  -display none \
  -serial "file:$CONSOLE_LOG" \
  -pidfile "$QEMU_PIDFILE" \
  -daemonize

log "waiting for sshd (up to ${SUBSTRATE_BOOT_TIMEOUT}s)"
deadline=$(( $(date +%s) + SUBSTRATE_BOOT_TIMEOUT ))
until substrate_ssh true 2>/dev/null; do
  if [ ! -s "$QEMU_PIDFILE" ] || ! kill -0 "$(cat "$QEMU_PIDFILE")" 2>/dev/null; then
    fatal "qemu exited before the guest came up — see $CONSOLE_LOG"
  fi
  [ "$(date +%s)" -lt "$deadline" ] || fatal "guest did not accept ssh within ${SUBSTRATE_BOOT_TIMEOUT}s — see $CONSOLE_LOG"
  sleep 5
done

# Not optional. The template sets `package_update: true` and installs
# qemu-guest-agent, so sshd answers while apt still holds the dpkg lock —
# provision-substrate.sh's first `apt-get update` would then fail on a lock
# rather than on anything real.
log "waiting for cloud-init to finish"
substrate_ssh "sudo cloud-init status --wait" \
  || fatal "cloud-init did not reach done — see $CONSOLE_LOG"

log "substrate is up: ssh -i $SUBSTRATE_SSH_KEY -p $SUBSTRATE_SSH_PORT $SUBSTRATE_SSH_USER@127.0.0.1"
