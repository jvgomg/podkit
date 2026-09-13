#!/usr/bin/env bash
# pveum-recipe.sh — grant podkit's automation exactly enough Proxmox to manage
# one pool of substrate VMs, and nothing else.
#
# Run this ON the PVE host, as root. It is idempotent.
#
# Why a pool rather than per-VM grants: creation privileges cannot be attached
# to a VMID that does not exist yet, so `VM.Allocate` has to sit on `/vms` or on
# a pool. A pool is the only one of those two that is not "every VM you own".
#
# Why an API token rather than an ssh account with `qm`: a privilege-separated
# token's effective rights are the INTERSECTION of its user's and its own, so a
# token ACL'd only on this pool is confined to this pool even though the user
# could be granted more. An ssh account with `qm` is confined by nothing.
#
# The dedicated user is not what confines the token — the ACL is. The user
# exists so that revoking one principal revokes every token under it at once.
#
# Configure by environment, so nothing about your infrastructure is committed:
#
#   PODKIT_PVE_USER     API user to create           (default podkit@pve)
#   PODKIT_PVE_TOKEN    token id under that user     (default automation)
#   PODKIT_PVE_POOL     pool the substrates live in  (default podkit)
#   PODKIT_PVE_STORAGE  space-separated storages to grant (default "local-lvm local")
#   PODKIT_PVE_BRIDGE   bridge the substrate attaches to (default vmbr0)
#
# The token secret is printed ONCE, on creation. Put it in the repo's
# gitignored env file; it cannot be retrieved afterwards.

set -eu

PVE_USER="${PODKIT_PVE_USER:-podkit@pve}"
PVE_TOKEN="${PODKIT_PVE_TOKEN:-automation}"
PVE_POOL="${PODKIT_PVE_POOL:-podkit}"
# A list, not a single storage. The documented layout puts VM disks on an
# LVM-thin storage but keeps the cloud-init snippet and the Debian qcow2 on a
# directory storage, and a token granted only the first cannot resolve
# `--cicustom` or import an image — it 403s on Datastore.Audit for the other.
PVE_STORAGES="${PODKIT_PVE_STORAGE:-local-lvm local}"
PVE_BRIDGE="${PODKIT_PVE_BRIDGE:-vmbr0}"
PVE_ROLE="PodkitSubstrate"

log() { echo "==> $1"; }

if ! command -v pveum >/dev/null 2>&1; then
  echo "FATAL: pveum not found — run this on the Proxmox VE host, not on your workstation." >&2
  exit 1
fi

# Lifecycle plus the config surface cloud-init provisioning touches. Nothing
# here reaches outside a VM: no Sys.*, no node-level rights, no storage
# administration. `pveum role list` on this host prints every valid privilege
# name if a version disagrees with one of these.
#
# VM.GuestAgent.Audit, not VM.Monitor: the latter was removed in favour of the
# VM.GuestAgent.* family and PVE 9 rejects the whole role for it. Audit is the
# privilege behind network-get-interfaces, which is how lifecycle automation
# discovers a freshly-booted substrate's address. VM.GuestAgent.Unrestricted is
# deliberately NOT taken — that is guest-exec, which would make the token
# strictly more powerful than the ssh access the substrate already grants.
#
# Pool.Audit lets the token address the pool it is confined to. Without it,
# GET /pools/<pool> 403s even though the token can see the guests inside it —
# listing guests is audit-filtered and needs no pool right.
ROLE_PRIVS="VM.Allocate,VM.Audit,VM.Clone,VM.Config.CDROM,VM.Config.CPU,VM.Config.Cloudinit,VM.Config.Disk,VM.Config.HWType,VM.Config.Memory,VM.Config.Network,VM.Config.Options,VM.Console,VM.GuestAgent.Audit,VM.PowerMgmt,VM.Snapshot,VM.Snapshot.Rollback,Pool.Audit"

log "creating role $PVE_ROLE"
if pveum role list --output-format json | grep -q "\"roleid\":\"$PVE_ROLE\""; then
  pveum role modify "$PVE_ROLE" --privs "$ROLE_PRIVS"
else
  pveum role add "$PVE_ROLE" --privs "$ROLE_PRIVS"
fi

log "creating pool $PVE_POOL"
pveum pool add "$PVE_POOL" --comment 'podkit device substrates' 2>/dev/null \
  || log "pool $PVE_POOL already exists"

log "creating user $PVE_USER"
pveum user add "$PVE_USER" --comment 'podkit substrate automation' 2>/dev/null \
  || log "user $PVE_USER already exists"

# The user needs the rights before the token can intersect with them — a
# privilege-separated token can never hold a permission its user lacks.
log "granting $PVE_ROLE on /pool/$PVE_POOL to $PVE_USER"
pveum acl modify "/pool/$PVE_POOL" --users "$PVE_USER" --roles "$PVE_ROLE"

# Disk allocation, plus template allocation for the cloud-init snippet. Scoped
# to the named storages rather than granted at /storage.
pveum role add PodkitSubstrateStorage \
  --privs 'Datastore.Audit,Datastore.AllocateSpace,Datastore.AllocateTemplate' 2>/dev/null \
  || pveum role modify PodkitSubstrateStorage \
       --privs 'Datastore.Audit,Datastore.AllocateSpace,Datastore.AllocateTemplate'
for store in $PVE_STORAGES; do
  log "granting datastore rights on /storage/$store to $PVE_USER"
  pveum acl modify "/storage/$store" --users "$PVE_USER" --roles PodkitSubstrateStorage
done

# PVE 8+ refuses to attach a NIC without SDN.Use on the bridge's zone path;
# PVE 6 and 7 did not require it. Measured on PVE 9.1.4: with this grant in
# place NIC attach succeeds, so the grant is necessary and sufficient.
#
# It is NOT the source of the late 403 this recipe used to warn about — that
# turned out to be the storage grant above, when only one storage was named.
log "granting SDN.Use on bridge $PVE_BRIDGE to $PVE_USER"
pveum role add PodkitSubstrateNetwork --privs 'SDN.Audit,SDN.Use' 2>/dev/null \
  || pveum role modify PodkitSubstrateNetwork --privs 'SDN.Audit,SDN.Use'
pveum acl modify "/sdn/zones/localnetwork/$PVE_BRIDGE" \
  --users "$PVE_USER" --roles PodkitSubstrateNetwork

log "creating privilege-separated token ${PVE_USER}!${PVE_TOKEN}"
if pveum user token list "$PVE_USER" --output-format json | grep -q "\"tokenid\":\"$PVE_TOKEN\""; then
  log "token already exists — its secret cannot be re-read; delete and recreate to rotate:"
  log "  pveum user token remove $PVE_USER $PVE_TOKEN"
else
  # --privsep 1 is the default and is stated anyway: it is the whole security
  # argument, and a future default change would silently widen the token.
  pveum user token add "$PVE_USER" "$PVE_TOKEN" --privsep 1
fi

# The token starts with zero rights of its own. Without this it authenticates
# and then can do nothing, which reads like a broken token rather than an
# unfinished setup.
log "granting the token the same scopes"
pveum acl modify "/pool/$PVE_POOL" \
  --tokens "${PVE_USER}!${PVE_TOKEN}" --roles "$PVE_ROLE"
for store in $PVE_STORAGES; do
  pveum acl modify "/storage/$store" \
    --tokens "${PVE_USER}!${PVE_TOKEN}" --roles PodkitSubstrateStorage
done
pveum acl modify "/sdn/zones/localnetwork/$PVE_BRIDGE" \
  --tokens "${PVE_USER}!${PVE_TOKEN}" --roles PodkitSubstrateNetwork

echo
log "done. Verify the confinement before trusting it:"
# The token id is passed as the user id. `--token` is not an option on PVE 9,
# and the parse error it produces reads like a broken token — which matters,
# because this is the command that is supposed to prove the token is safe.
echo "  pveum user permissions '${PVE_USER}!${PVE_TOKEN}'"
echo
log "The token must NOT show rights on any path outside:"
echo "  /pool/$PVE_POOL"
for store in $PVE_STORAGES; do echo "  /storage/$store"; done
echo "  /sdn/zones/localnetwork/$PVE_BRIDGE"
