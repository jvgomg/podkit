#!/usr/bin/env bash
#
# Docker image smoke test — E2E · host-docker-image · none.
# (doc-053 rollout stage 3; canonical taxonomy: documents/architecture/testing/taxonomy.md)
#
# Builds a representative podkit image for the native arch and asserts it boots
# and is internally consistent: --version + doctor run through the image,
# command-parity holds against the running binary, ffmpeg is present, both
# binaries + the entrypoint are executable.
#
# The linux binaries are the *glibc* binaries produced by the Lima builder
# (`@podkit/device-testing#build:linux-binary`, turbo-cached); the daemon is
# compiled in the same builder VM. The smoke image therefore uses a glibc base,
# not the shipped Alpine/musl image — see Dockerfile.smoke for the rationale.
#
# Requires: docker, limactl (Lima builder VM). Run from anywhere:
#   bun run test:smoke --filter @podkit/docker
#   # or: bash packages/podkit-docker/test/image-smoke.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CTX="$SCRIPT_DIR/smoke-context"
IMAGE="podkit-smoke:test"
VM_NAME="${BUILDER_VM_NAME:-podkit-linux-builder}"
VM_SRC="/tmp/podkit-builder-src"

log() { echo "==> [image-smoke] $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

# Always clean the staging context, even on early (set -e) exit. The image
# (podkit-smoke:test) is left for inspection.
cleanup() { rm -rf "$CTX"; }
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || fail "docker not found"
docker info >/dev/null 2>&1 || fail "docker daemon not running"

case "$(uname -m)" in
  arm64 | aarch64) NODE_ARCH=arm64 ;;
  x86_64 | amd64) NODE_ARCH=x64 ;;
  *) fail "unsupported host arch $(uname -m)" ;;
esac

# ── 1. Produce the linux binaries (Lima builder, turbo-cached) ───────────────
log "building linux CLI binary (turbo: build:linux-binary)..."
(cd "$REPO_ROOT" && bunx turbo run @podkit/device-testing#build:linux-binary)

CLI_BIN="$REPO_ROOT/packages/podkit-cli/bin/podkit-linux-${NODE_ARCH}"
[ -x "$CLI_BIN" ] || fail "CLI binary not found at $CLI_BIN"

# The daemon is not part of build:linux-binary; compile it in the same builder
# VM (the source tree + node_modules are already staged there) and copy it out.
# Always rebuilt — there is no source-hash check here, so a stale binary from a
# previous run must not be silently reused across source changes.
DAEMON_BIN="$REPO_ROOT/packages/podkit-daemon/bin/podkit-daemon-linux-${NODE_ARCH}"
command -v limactl >/dev/null 2>&1 || fail "limactl not found (needed to build podkit-daemon)"
log "compiling podkit-daemon in builder VM '$VM_NAME'..."
# $HOME/$PATH are intentionally expanded inside the VM, not on the host.
# shellcheck disable=SC2016
limactl shell --workdir "$VM_SRC" "$VM_NAME" bash -c '
  set -euo pipefail
  export PATH="/usr/local/bin:$HOME/.bun/bin:$PATH"
  bun build packages/podkit-daemon/src/main.ts --compile --outfile /tmp/podkit-daemon-smoke
'
mkdir -p "$(dirname "$DAEMON_BIN")"
rm -f "$DAEMON_BIN"
limactl copy "${VM_NAME}:/tmp/podkit-daemon-smoke" "$DAEMON_BIN"
chmod +x "$DAEMON_BIN"
[ -x "$DAEMON_BIN" ] || fail "daemon binary not found at $DAEMON_BIN"

# ── 2. Build the smoke image ─────────────────────────────────────────────────
# Assemble a tiny, dedicated build context (NOT the repo root) so docker does
# not upload node_modules/.git.
log "staging build context..."
rm -rf "$CTX"
mkdir -p "$CTX"
cp "$CLI_BIN" "$CTX/podkit"
cp "$DAEMON_BIN" "$CTX/podkit-daemon"
cp "$REPO_ROOT/packages/podkit-docker/entrypoint.sh" "$CTX/entrypoint.sh"
chmod +x "$CTX/podkit" "$CTX/podkit-daemon" "$CTX/entrypoint.sh"

log "building smoke image $IMAGE (native arch linux/${NODE_ARCH})..."
docker build -f "$SCRIPT_DIR/Dockerfile.smoke" -t "$IMAGE" "$CTX"

# ── 3. Assertions ────────────────────────────────────────────────────────────
PASS=0
check() {
  local desc="$1"; shift
  if "$@"; then
    echo "ok   - $desc"
    PASS=$((PASS + 1))
  else
    fail "$desc"
  fi
}

# --version through the image (direct binary entrypoint). `pipefail` so a
# non-zero `docker run` is not masked by a matching `grep`.
check "podkit --version runs through the image" \
  bash -o pipefail -c "docker run --rm --entrypoint podkit '$IMAGE' --version | grep -q ."

# doctor works (not just exists): registered + actually emits diagnostics.
check "podkit doctor --help is wired" \
  docker run --rm --entrypoint podkit "$IMAGE" doctor --help
# Run real diagnostics with no device via the system-only scope, and assert the
# JSON carries a `checks` array — not a loose word match that an error payload
# (or a Docker error on stderr) could satisfy.
check "podkit doctor runs diagnostics (system-only, no device)" \
  bash -o pipefail -c "
    out=\$(docker run --rm --entrypoint podkit '$IMAGE' doctor --system-only --json)
    echo \"\$out\" | grep -q '\"checks\"'
  "

# doctor through the FULL entrypoint path (the original blocker was doctor not
# being routed by the entrypoint at all).
check "doctor routes through the entrypoint" \
  docker run --rm "$IMAGE" doctor --help

# Command-parity against the running binary.
check "binary advertises doctor + sync + device (command parity)" \
  bash -o pipefail -c "
    out=\$(docker run --rm --entrypoint podkit '$IMAGE' __complete commands)
    echo \"\$out\" | grep -qx doctor && echo \"\$out\" | grep -qx sync && echo \"\$out\" | grep -qx device
  "

# ffmpeg present + runnable.
check "ffmpeg present and runnable" \
  docker run --rm --entrypoint ffmpeg "$IMAGE" -version

# Both binaries + entrypoint executable.
check "podkit, podkit-daemon, entrypoint are all executable" \
  docker run --rm --entrypoint sh "$IMAGE" -c \
    'test -x /usr/local/bin/podkit && test -x /usr/local/bin/podkit-daemon && test -x /entrypoint.sh'

# Daemon binary starts and runs. It has no --help/--version (it goes straight
# into its poll loop), so we run it under a timeout and require it to still be
# alive at the deadline (exit 124) — i.e. it loaded and started without crashing,
# rather than dying immediately on a missing interpreter / broken bundle.
# Note: this deliberately treats a clean exit (0) as a FAILURE — it would mean
# the daemon stopped polling. If the daemon ever gains a legitimate no-op exit
# path, reassess this assertion.
check "podkit-daemon starts and runs (does not crash on launch)" \
  bash -c "docker run --rm --entrypoint sh '$IMAGE' -c 'timeout 3 podkit-daemon >/dev/null 2>&1; [ \$? -eq 124 ]'"

echo ""
log "all $PASS smoke assertions passed"
