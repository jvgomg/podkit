#!/usr/bin/env bash
# bootstrap-pve.sh — phase 1 of the Proxmox setup: the privileged part, once.
#
# Run it ON the PVE host, or from a workstation that has ssh to it:
#
#   bash bootstrap-pve.sh                              # on the PVE host
#   bash bootstrap-pve.sh --pve-host root@<pve>        # from anywhere
#   bash bootstrap-pve.sh --pve-host root@<pve> --print-only
#   bash bootstrap-pve.sh --render podkit-builder      # the snippet, to stdout
#
# ---------------------------------------------------------------------------
# Re-running it on a host that already has guests
# ---------------------------------------------------------------------------
#
# It is idempotent, but step 2 REWRITES both snippets, and a snippet is not
# inert once a guest exists: PVE derives the cloud-init instance-id from the
# config it generates, so changing a snippet's CONTENT makes the next boot of
# any guest using it look like a new instance to cloud-init. Observed on PVE
# 9.1.4: the guest regenerated its SSH host keys, and every `known_hosts` entry
# for it stopped matching.
#
# That is survivable and not a defect — but it is only harmless if what you
# render is what the guest already authorises. Check before running it against
# a host with live guests:
#
#   diff <(bash bootstrap-pve.sh --render podkit-substrate) \
#        <(ssh root@<pve> cat /var/lib/vz/snippets/podkit-substrate.yaml)
#
# ---------------------------------------------------------------------------
# Why this script exists at all, and where it stops
# ---------------------------------------------------------------------------
#
# EXACTLY THREE things need root on the PVE host. This does those three and
# nothing else:
#
#   1. The `pveum` grant. That binary exists nowhere but a PVE host, and
#      creating roles, pools and tokens is a root operation by definition.
#   2. The cloud-init snippet. PVE's storage-upload API accepts `iso`, `vztmpl`
#      and `import` content — NOT `snippets` — so no API token can place one,
#      however scoped. It is a filesystem write on the host or nothing.
#   3. The pinned Debian image. `qm set --scsi0 …,import-from=<path>` reads a
#      file on the host, so the qcow2 has to be there first.
#
# It deliberately does NOT create any VM. Creating, starting, stopping,
# destroying and recreating guests are all inside the pool-scoped token's ACL
# that step 1 produces, so they belong to the low-privilege half (TASK-515) —
# not to the one operation a human with root has to perform.
#
# That boundary is the whole design. After this script runs once, a machine
# holding only the token can do the entire VM lifecycle, and a machine holding
# only an ssh key can apply the contract, install binaries and run the suites.
# Neither ever needs the hypervisor's root again.
#
# ---------------------------------------------------------------------------
# --print-only
# ---------------------------------------------------------------------------
#
# Emits the command sequence instead of running it — for someone who would
# rather paste it by hand, or read it before trusting a script with their
# hypervisor. Both are reasonable, and the point of generating the runbook from
# the same file that automates it is that the two cannot drift.
#
# Configure by environment; nothing about your infrastructure is committed.
# Every variable below is also read by pveum-recipe.sh, which this invokes.
#
#   PODKIT_PVE_USER            API user to create           (default podkit@pve)
#   PODKIT_PVE_TOKEN           token id under that user     (default automation)
#   PODKIT_PVE_POOL            pool the guests live in      (default podkit)
#   PODKIT_PVE_STORAGE         space-separated storages     (default "local-lvm local")
#   PODKIT_PVE_BRIDGE          bridge guests attach to      (default vmbr0)
#   PODKIT_PVE_SNIPPET_STORAGE storage holding snippets     (default local)
#   PODKIT_SSH_PUBKEY          public key(s) to authorise   (default ~/.ssh/id_ed25519.pub)
#
# PODKIT_SSH_PUBKEY may name a file holding SEVERAL key lines, and every one of
# them is authorised. Blank lines and `#` comments are ignored, so
# `~/.ssh/authorized_keys` is a valid value. A developer with a laptop and a
# build box has two keys, and rendering only the first silently revokes the
# other the next time the guest is recreated.

set -eu

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# How this directory is spelled from a repo root, for the commands --print-only
# emits: whoever pastes them is far more likely to be standing at the root than
# in here.
REPO_REL_DIR="test-packages/device-testing/substrate/proxmox"

PVE_HOST=""
PRINT_ONLY=0
RENDER_HOSTNAME=""

while [ $# -gt 0 ]; do
  case "$1" in
    --pve-host) PVE_HOST="${2:?--pve-host needs an ssh target}"; shift 2 ;;
    --print-only) PRINT_ONLY=1; shift ;;
    --render) RENDER_HOSTNAME="${2:?--render needs a guest hostname}"; shift 2 ;;
    -h|--help) sed -n '2,80p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "FATAL: unknown argument '$1'" >&2; exit 2 ;;
  esac
done

PVE_POOL="${PODKIT_PVE_POOL:-podkit}"
PVE_STORAGES="${PODKIT_PVE_STORAGE:-local-lvm local}"
PVE_BRIDGE="${PODKIT_PVE_BRIDGE:-vmbr0}"
PVE_USER="${PODKIT_PVE_USER:-podkit@pve}"
PVE_TOKEN="${PODKIT_PVE_TOKEN:-automation}"
SNIPPET_STORAGE="${PODKIT_PVE_SNIPPET_STORAGE:-local}"
SSH_PUBKEY="${PODKIT_SSH_PUBKEY:-$HOME/.ssh/id_ed25519.pub}"

# The pinned Debian cloud image, restated from @podkit/substrate's
# `SUBSTRATE_DEBIAN_IMAGE_SERIAL` because a PVE host has no TypeScript on it and
# this script must run there. Checked rather than trusted: `debian-image.test.ts`
# reads this file and fails if the URL disagrees with the module. Bump there,
# run that test, and fix every file it names.
PINNED_IMAGE_URL="https://cloud.debian.org/images/cloud/bookworm/20250316-2053/debian-12-generic-amd64-20250316-2053.qcow2"
PINNED_IMAGE_FILE="${PINNED_IMAGE_URL##*/}"

# Guest hostnames the snippets are rendered for. These are cloud-init hostnames,
# not registry ids: the repo's registry deliberately knows neither these nor the
# VMIDs, both of which are infrastructure detail belonging to your env file.
PROFILE_HOSTNAMES="podkit-substrate podkit-builder"

log()   { echo "==> $1"; }
warn()  { echo "WARN: $1" >&2; }
fatal() { echo "FATAL: $1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Rendering the template
# ---------------------------------------------------------------------------
#
# Two placeholders, and one of them is a LIST: `ssh_authorized_keys` takes any
# number of entries, and a developer with a laptop and a build box has two.
# Rendering only the first is not a cosmetic loss — it is the second machine's
# access, removed the next time the guest is recreated from the snippet, with
# nothing failing at render time to say so.
#
# awk rather than sed because a multi-line replacement needs GNU sed's `\n` in
# the RHS, which BSD sed — every macOS workstation — rejects, and this script
# renders on the workstation side.
#
# Any line containing the placeholder is emitted once per key, so the list
# indentation is preserved by construction rather than re-encoded here, and the
# template's own comment line documenting the placeholder is expanded the same
# way the YAML list is.
#
# The key file is read by awk itself rather than passed in with `-v`, for the
# same portability reason: a `-v` assignment may not contain a newline on BSD
# awk, and it processes backslash escapes that a key comment is free to
# contain.
#
# shellcheck disable=SC2016 # an awk program: $0 and the rest are awk's, not the shell's
RENDER_AWK='
function expand(line, placeholder, value,   pos) {
  # index/substr rather than sub(): an awk replacement string treats & and \\
  # as metacharacters, and a key comment is free text that may contain both.
  # Escaping them correctly is possible and is not portable — BSD awk and gawk
  # disagree on \\\\ — so the substitution avoids the replacement grammar
  # altogether.
  pos = index(line, placeholder)
  if (pos == 0) return line
  return substr(line, 1, pos - 1) value substr(line, pos + length(placeholder))
}
BEGIN {
  while ((getline line < keyfile) > 0) {
    if (line ~ /^[[:space:]]*#/ || line ~ /^[[:space:]]*$/) continue
    keys[++n] = line
  }
}
{
  line = expand($0, "__HOSTNAME__", hostname)
  if (index(line, "__SSH_PUBKEY__") > 0) {
    for (i = 1; i <= n; i++) print expand(line, "__SSH_PUBKEY__", keys[i])
  } else {
    print line
  }
}'

# Every key line in the file, so `~/.ssh/authorized_keys` is as valid a value
# for PODKIT_SSH_PUBKEY as a lone `.pub`. This one VALIDATES; RENDER_AWK
# applies the same rule while rendering, because it reads the file itself.
read_pubkeys() { grep -v -e '^[[:space:]]*#' -e '^[[:space:]]*$' "$1" || true; }

render_snippet() {
  awk -v hostname="$1" -v keyfile="$SSH_PUBKEY" "$RENDER_AWK" \
    "$SCRIPT_DIR/cloud-init.user-data.yaml"
}

# ---------------------------------------------------------------------------
# Transport
# ---------------------------------------------------------------------------
#
# One function, two modes, so every step below is written once regardless of
# where the human is sitting. Local mode is a plain `bash -c`; remote mode is
# the same string handed to ssh. Nothing is copied to the host and cleaned up
# afterwards — payloads are piped on stdin, which leaves no temp file to
# forget about.

# The command string is assembled HERE and expanded THERE, which is the whole
# point: every value the host needs — pool, storage, image path — is known on
# this side and must arrive already substituted. shellcheck flags that pattern
# because client-side expansion is usually the bug; here it is the mechanism.
# Wrap a command in single quotes for DISPLAY, escaping any it contains.
#
# Needed because several of the commands below legitimately contain single
# quotes — step 2's `sed -n 's/…/p'` and step 3's `echo '==> …'`. Printing them
# inside a naive `'…'` terminates the quoting early, and what came out was a
# line that reads plausibly and does not run. Since --print-only exists so the
# sequence can be pasted or reviewed, a subtly unpasteable runbook is worse than
# no runbook.
#
# `'\''` is the standard idiom: close the quote, an escaped quote, reopen.
quote_for_display() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

# shellcheck disable=SC2029 # deliberate client-side expansion — see above
pve_run() {
  if [ "$PRINT_ONLY" -eq 1 ]; then
    if [ -n "$PVE_HOST" ]; then printf 'ssh %s %s\n' "$PVE_HOST" "$(quote_for_display "$1")"
    else printf '%s\n' "$1"; fi
    return 0
  fi
  if [ -n "$PVE_HOST" ]; then ssh "$PVE_HOST" "$1"; else bash -c "$1"; fi
}

# Same, but the caller pipes a payload in on stdin — used for the two files that
# live in this repo and have to reach a host with no clone of it. $2 is how the
# pipe's left-hand side is DISPLAYED under --print-only; it is never executed.
# shellcheck disable=SC2029 # deliberate client-side expansion — see pve_run
pve_pipe() {
  if [ "$PRINT_ONLY" -eq 1 ]; then
    if [ -n "$PVE_HOST" ]; then printf '%s | ssh %s %s\n' "$2" "$PVE_HOST" "$(quote_for_display "$1")"
    else printf '%s | %s\n' "$2" "$1"; fi
    # Drain the payload the caller redirected in, so --print-only neither blocks
    # nor leaves it for whatever runs next.
    cat > /dev/null
    return 0
  fi
  if [ -n "$PVE_HOST" ]; then ssh "$PVE_HOST" "$1"; else bash -c "$1"; fi
}

[ -r "$SCRIPT_DIR/cloud-init.user-data.yaml" ] || fatal "cloud-init.user-data.yaml not beside this script"

# ---------------------------------------------------------------------------
# --render: the snippet for one guest, to stdout
# ---------------------------------------------------------------------------
#
# Contacts nothing. It exists so the rendered result can be DIFFED against what
# a host already serves before a re-run rewrites it — see the header on why a
# changed snippet is not inert once a guest exists.

if [ -n "$RENDER_HOSTNAME" ]; then
  [ -r "$SSH_PUBKEY" ] || fatal "no readable public key at $SSH_PUBKEY (set PODKIT_SSH_PUBKEY)"
  [ -n "$(read_pubkeys "$SSH_PUBKEY")" ] || fatal "$SSH_PUBKEY holds no key lines"
  render_snippet "$RENDER_HOSTNAME"
  exit 0
fi

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------

if [ "$PRINT_ONLY" -eq 0 ]; then
  [ -r "$SSH_PUBKEY" ] || fatal "no readable public key at $SSH_PUBKEY (set PODKIT_SSH_PUBKEY)"
  # A file that exists but holds only comments renders a guest nobody can log
  # into, and the snippet looks plausible.
  [ -n "$(read_pubkeys "$SSH_PUBKEY")" ] || fatal "$SSH_PUBKEY holds no key lines"

  # Assert the transport BEFORE doing anything, so a wrong --pve-host fails in
  # one second rather than halfway through a grant.
  if [ -n "$PVE_HOST" ]; then
    log "checking ssh to $PVE_HOST"
    ssh -o BatchMode=yes "$PVE_HOST" true \
      || fatal "cannot ssh to $PVE_HOST non-interactively — check the alias, the key, and that the key is agent-served"
  fi

  log "checking this is a PVE host"
  pve_run 'command -v pveum >/dev/null 2>&1 && pveversion' \
    || fatal "pveum not found on the target. Run this ON the PVE host, or pass --pve-host <ssh-target>."

  # Root is what every step below needs, and discovering that at step 3 wastes
  # the two that already ran.
  # shellcheck disable=SC2016 # $(id -u) must evaluate on the PVE host, not here
  pve_run '[ "$(id -u)" -eq 0 ]' \
    || fatal "not root on the PVE host. Use a root ssh target, or run this under sudo there."
fi

[ -r "$SCRIPT_DIR/pveum-recipe.sh" ] || fatal "pveum-recipe.sh not beside this script"

# ---------------------------------------------------------------------------
# 1. The pveum grant
# ---------------------------------------------------------------------------
#
# Piped rather than copied: the recipe is self-contained and sources nothing, so
# `bash -s` runs it with no file left behind on the hypervisor.
#
# It is idempotent in both directions — an existing role is modified, an
# existing pool/user is reported and skipped, and an existing token is left
# alone with a note that its secret cannot be re-read.

log "step 1/3 — granting the automation exactly one pool"
RECIPE_ENV="PODKIT_PVE_USER=$(printf %q "$PVE_USER") \
PODKIT_PVE_TOKEN=$(printf %q "$PVE_TOKEN") \
PODKIT_PVE_POOL=$(printf %q "$PVE_POOL") \
PODKIT_PVE_STORAGE=$(printf %q "$PVE_STORAGES") \
PODKIT_PVE_BRIDGE=$(printf %q "$PVE_BRIDGE")"
pve_pipe "env $RECIPE_ENV bash -s" "cat $REPO_REL_DIR/pveum-recipe.sh" < "$SCRIPT_DIR/pveum-recipe.sh"

# ---------------------------------------------------------------------------
# 2. The cloud-init snippets
# ---------------------------------------------------------------------------
#
# Resolved from the storage's configured path rather than assumed to be
# /var/lib/vz/snippets: that is only correct for the default `local` on a
# default install, and someone whose snippets live elsewhere would get a file
# written somewhere PVE never reads.

log "step 2/3 — rendering cloud-init snippets onto '$SNIPPET_STORAGE'"

if [ "$PRINT_ONLY" -eq 1 ]; then
  # Printed as a command for the reader to run, so the substitution must reach
  # them unevaluated — this is the one place the literal `$(...)` IS the output.
  # shellcheck disable=SC2016
  SNIPPET_DIR='$(pvesh get /storage/'"$SNIPPET_STORAGE"' --output-format json | sed -n '"'"'s/.*"path":"\([^"]*\)".*/\1/p'"'"')/snippets'
else
  SNIPPET_BASE="$(pve_run "pvesh get /storage/$SNIPPET_STORAGE --output-format json" \
    | sed -n 's/.*"path":"\([^"]*\)".*/\1/p')"
  [ -n "$SNIPPET_BASE" ] \
    || fatal "storage '$SNIPPET_STORAGE' has no filesystem path — snippets need a directory storage. Set PODKIT_PVE_SNIPPET_STORAGE."
  SNIPPET_DIR="$SNIPPET_BASE/snippets"

  # `snippets` is not enabled on any storage by default — including `local`,
  # which ships import,vztmpl,backup,iso. This is the single most likely thing
  # to be wrong, and its symptom is a --cicustom that resolves to nothing much
  # later, so it is checked here rather than discovered at qm create time.
  pve_run "pvesm status --content snippets 2>/dev/null | grep -q '^$SNIPPET_STORAGE '" \
    || warn "storage '$SNIPPET_STORAGE' does not advertise the 'snippets' content type. Enable it additively:
       pvesm set $SNIPPET_STORAGE --content <existing-list>,snippets"
fi

pve_run "mkdir -p $SNIPPET_DIR"

for hostname in $PROFILE_HOSTNAMES; do
  log "  $hostname.yaml"
  # One template, two guests — see the template's header for why there is no
  # builder-specific variant. Rendered here and piped, so the key never touches
  # a file on the hypervisor other than the snippet itself.
  if [ "$PRINT_ONLY" -eq 1 ]; then
    # The same render the reader could run themselves — `--render <hostname>`
    # is this line, spelled shorter.
    printf 'bash %s/bootstrap-pve.sh --render %s' "$REPO_REL_DIR" "$hostname"
    if [ -n "$PVE_HOST" ]; then
      printf ' | ssh %s %s\n' "$PVE_HOST" "$(quote_for_display "cat > $SNIPPET_DIR/$hostname.yaml")"
    else printf ' > %s/%s.yaml\n' "$SNIPPET_DIR" "$hostname"; fi
  else
    render_snippet "$hostname" | pve_run "cat > $SNIPPET_DIR/$hostname.yaml"
  fi
done

# ---------------------------------------------------------------------------
# 3. The pinned base image
# ---------------------------------------------------------------------------
#
# Fetched only when absent. It is pinned to an exact serial, so re-downloading
# it on every run would move nothing and cost 300 MB.

log "step 3/3 — ensuring the pinned Debian image is on the host"
IMAGE_DIR="/var/lib/vz/template/iso"
pve_run "mkdir -p $IMAGE_DIR && \
if [ -s $IMAGE_DIR/$PINNED_IMAGE_FILE ]; then \
  echo '==> $PINNED_IMAGE_FILE already present'; \
else \
  echo '==> fetching $PINNED_IMAGE_FILE'; \
  curl -fL --retry 3 -o $IMAGE_DIR/$PINNED_IMAGE_FILE $PINNED_IMAGE_URL; \
fi"

# ---------------------------------------------------------------------------
# What to do next
# ---------------------------------------------------------------------------

if [ "$PRINT_ONLY" -eq 1 ]; then
  exit 0
fi

cat <<NEXT

==> phase 1 complete.

Verify the token is confined before trusting it:

  ${PVE_HOST:+ssh $PVE_HOST }pveum user permissions '${PVE_USER}!${PVE_TOKEN}'

Nothing outside these paths should appear:

  /pool/$PVE_POOL
$(for s in $PVE_STORAGES; do echo "  /storage/$s"; done)
  /sdn/zones/localnetwork/$PVE_BRIDGE

Then put the token in this repo's gitignored env file. The secret was printed
ONCE by step 1 and cannot be retrieved again; if you lost it, delete and
recreate the token rather than hunting for it.

  # .env.local
  PODKIT_PVE_TOKEN_ID=${PVE_USER}!${PVE_TOKEN}
  PODKIT_PVE_TOKEN_SECRET=<the uuid step 1 printed>
  PODKIT_PVE_TLS_FINGERPRINT=<see below>

  ${PVE_HOST:+ssh $PVE_HOST }openssl x509 -noout -fingerprint -sha256 \\
    -in /etc/pve/local/pve-ssl.pem

From here nothing needs the hypervisor's root again:

  - creating, starting, stopping and destroying guests are inside that token
  - applying the contract, installing binaries and running the suites need
    only ssh to the guest

Snippets are placed for: $PROFILE_HOSTNAMES
Create the VMs with step 4 of the relevant playbook under docs/environments/.
NEXT
