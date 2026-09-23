# Device substrate (Proxmox VM)

Provisioning a **device substrate** on a Proxmox VE host — the Linux environment
the device-testing harness synthesises USB gadgets inside, reached over plain
SSH.

Written as a change log rather than prose so it can be lifted into automation.
Every step is idempotent.

A substrate is not "a Proxmox VM". It is any SSH-reachable Debian box that
passes `substrate-doctor.sh`; Proxmox is the reference recipe and a Lima VM on
macOS is another. See [ADR-028](../adr/adr-028-substrate-agnostic-device-harness.md)
and [CONTEXT.md](../../CONTEXT.md) §Test environments.

---

## Security posture — read before exposing this box

The substrate is a **trusted-network appliance**, not a hardened host. It runs
test daemons as root, loads USB gadget modules, mounts configfs and has its
`/dev/sg*` permissions deliberately loosened. Its own test suite roots it by
design.

Put it on a LAN, a VPN or a Tailnet. Do not give it a public address, and do not
reuse it for anything else.

---

## What is a sibling, and why

The substrate is a **sibling** of your Linux development box — a peer VM on the
same hypervisor, not a hypervisor nested inside it.

The harness needs `dummy_hcd`, `libcomposite`, `usb_f_fs`, `usb_f_mass_storage`,
`sg` and configfs **in the guest kernel**. Stock Debian cloud kernels ship all of
them. That is a guest-kernel requirement satisfied by any hypervisor — it is not
a nested-virtualisation requirement, and reading it as one buys a hypervisor
inside a hypervisor for nothing.

---

## Preconditions to assert

| Assertion | Check | Required value |
|---|---|---|
| PVE host reachable as root | `ssh <pve-host> pveversion` | prints a version |
| A storage that accepts disks | `pvesm status` | your target storage is `active` |
| A storage that accepts snippets | `pvesm status --content snippets` | at least one entry |
| The target bridge exists | `ip link show <bridge>` | present |
| Egress to the Debian mirror | `curl -sI https://cloud.debian.org/` | HTTP 200 |

The snippets one is the load-bearing check: cloud-init `user=` custom files must
live on a storage with the `snippets` content type enabled, which is **not** on
by default for any storage — including `local`, which on a PVE 9 host ships
`import,vztmpl,backup,iso` and nothing else. Adding it is additive and touches
no guest:

```bash
pvesm set <storage> --content import,vztmpl,backup,iso,snippets
```

Prefer a local directory storage over a network one. A snippet on a CIFS or NFS
storage makes the VM's cloud-init read depend on that server being up at start.

---

## Steps

### 1. Phase 1 — the privileged bootstrap, once

Run `bootstrap-pve.sh`. It does the three things that need root on the PVE host
and stops: the `pveum` grant below, the cloud-init snippets (step 2) and the
pinned image (step 3). It runs **either on the PVE host or from a workstation
with ssh to it**:

```bash
# from a workstation
PODKIT_PVE_POOL=podkit \
PODKIT_PVE_STORAGE="local-lvm local" \
PODKIT_PVE_BRIDGE=vmbr0 \
  bash test-packages/device-testing/substrate/proxmox/bootstrap-pve.sh \
    --pve-host root@<pve-host>

# on the PVE host, same script, no flag
bash bootstrap-pve.sh
```

Add `--print-only` to see the exact command sequence without running anything —
useful for pasting it by hand, or for reading it before handing a script your
hypervisor. The runbook is generated from the same file that automates it, so
the two cannot drift.

After it succeeds, **nothing needs the hypervisor's root again**: guest
lifecycle is inside the pool-scoped token it created, and everything else is
plain ssh to a guest.

The rest of this section explains what it does, for anyone running the steps by
hand.

#### What the grant is

```bash
PODKIT_PVE_POOL=podkit \
PODKIT_PVE_STORAGE="local-lvm local" \
PODKIT_PVE_BRIDGE=vmbr0 \
  bash pveum-recipe.sh
```

`PODKIT_PVE_STORAGE` is a **list**, and naming only one is the most likely way to
get this wrong. The layout below puts VM disks on LVM-thin but keeps the
cloud-init snippet and the Debian qcow2 on the local directory storage; a token
granted only the first cannot resolve `--cicustom` or import an image, and 403s
on `Datastore.Audit` for the other.

The script is `test-packages/device-testing/substrate/proxmox/pveum-recipe.sh`.
It creates a dedicated user, a dedicated pool, three narrowly-scoped roles, and
a **privilege-separated** API token.

The token's effective rights are the *intersection* of the user's and its own,
so a token ACL'd only on `/pool/podkit` is confined to that pool even if its
user were later granted more. Verify the confinement rather than trusting it:

```bash
pveum user permissions 'podkit@pve!automation'
```

The token id goes in as the user id — `--token` is not an option on PVE 9, and
the parse error it returns reads like a broken token.

Nothing outside `/pool/<pool>`, `/storage/<storage>` and
`/sdn/zones/localnetwork/<bridge>` should appear. **The token secret is printed
once and cannot be retrieved again** — put it straight into the repo's gitignored
env file.

> PVE 8+ requires `SDN.Use` on the bridge's zone path before a VM may attach a
> NIC; PVE 6 and 7 did not. The recipe grants it, and NIC attach was verified
> working with it on PVE 9.1.4. The 403 people actually hit at `qm create` time
> is the storage one above, not this.

### 2. Render the cloud-init user-data

**Done for you by step 1.** Described here for the by-hand path.

The snippet is one of the three things no API token can do for you: PVE's
storage-upload endpoint accepts `iso`, `vztmpl` and `import` content — not
`snippets` — so placing one is a filesystem write on the host or nothing. That
is the single biggest reason phase 1 exists as a separate, privileged step.

Take `test-packages/device-testing/substrate/proxmox/cloud-init.user-data.yaml`,
substitute the two placeholders, and place it on the snippets storage:

```bash
bash test-packages/device-testing/substrate/proxmox/bootstrap-pve.sh \
  --render podkit-substrate > /var/lib/vz/snippets/podkit-substrate.yaml
```

`--render` contacts nothing, so it is also how you diff what you are about to
place against what the host already serves. `PODKIT_SSH_PUBKEY` may name a file
holding several keys — every one is authorised, which is what keeps a second
machine's access from disappearing the next time the guest is recreated.

The rendered file carries your public key and your hostname, so it lives on the
PVE host and never in the repo.

The template is deliberately tiny — it produces a plain Debian box with your key
on it and stops there. Everything that makes the box a *substrate* is applied in
step 5 by the same scripts the Lima path uses. Adding provisioning here instead
would re-encode the contract in a second place and drift from it.

### 3. Fetch the pinned Debian cloud image

**Done for you by step 1**, and skipped there when the file is already present.
Described here for the by-hand path.

```bash
cd /var/lib/vz/template/iso
curl -LO https://cloud.debian.org/images/cloud/bookworm/20250316-2053/debian-12-generic-amd64-20250316-2053.qcow2
```

Pinned in sync with the Lima YAMLs. The doctor asserts the Debian **major**
version hard and reports a differing point release as drift rather than failing
it: which image you booted is a provisioning input, while the running point
release advances with any security update.

> The substrate must be **amd64**. Host architectures differ (arm64 Mac, amd64
> Linux) and artifacts are per-arch. Until target architecture is decoupled from
> host architecture, an arm64 Mac cannot build for this substrate — drive it from
> the amd64 box.

### 4. Create and start the VM

```bash
VMID=9000
qm create $VMID \
  --name podkit-substrate \
  --pool podkit \
  --memory 2048 --cores 2 \
  --cpu host \
  --net0 virtio,bridge=vmbr0 \
  --scsihw virtio-scsi-single \
  --serial0 socket --vga serial0 \
  --agent enabled=1 \
  --ostype l26

qm set $VMID --scsi0 local-lvm:0,import-from=/var/lib/vz/template/iso/debian-12-generic-amd64-20250316-2053.qcow2
qm set $VMID --ide2 local-lvm:cloudinit
qm set $VMID --cicustom "user=local:snippets/podkit-substrate.yaml"
qm set $VMID --ipconfig0 ip=dhcp
qm set $VMID --boot order=scsi0
qm resize $VMID scsi0 20G

qm start $VMID
```

`--serial0 socket --vga serial0` matters: Debian's cloud images expect a serial
console, and without it a boot failure is invisible.

`--cpu host` matters for a reason that does not show up until much later. PVE's
default `kvm64` model does not expose AVX, and a `bun --compile` podkit binary
needs it — on such a guest the binary spins at 100% CPU forever rather than
failing, so an installed `podkit` appears to hang on `podkit --version` with no
output and no error. The substrate carries no toolchain and so never trips over
this while being provisioned; it trips over it the first time a binary is
transferred to it. Observed on a substrate created without the flag, and fixed
by `qm set <vmid> --cpu host` plus a guest restart. See
[builder-proxmox.md](./builder-proxmox.md#4-create-and-start-the-vm) for the
builder-side symptom, which is louder.

Changing it on an existing guest is `qm set` plus a stop/start — but note what
else a `qm set` does: it regenerates the cloud-init drive, and if the snippet's
*content* has changed since the guest was created, the next boot looks like a
new instance to cloud-init and the guest regenerates its SSH host keys. Expect
`known_hosts` to stop matching, and verify the new fingerprint out of band
(`qm guest exec <vmid> -- ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`)
rather than accepting it blind.

`--ipconfig0` is separate from `--cicustom` and is not optional. `cicustom
user=` replaces only the *user-data*; network-config is still generated by PVE
from `ipconfig0`, so omitting it leaves the guest relying on cloud-init's
fallback rather than on anything you specified.

Confirm the box answers before going further:

```bash
ssh podkit@<substrate-ip> true
```

### 5. Apply and verify the substrate contract

From a repo clone, copy the three contract scripts over and run them:

```bash
scp test-packages/device-testing/scripts/substrate-contract.sh \
    test-packages/device-testing/scripts/provision-substrate.sh \
    test-packages/device-testing/scripts/substrate-doctor.sh \
    podkit@<substrate-ip>:/tmp/

ssh podkit@<substrate-ip> sudo bash /tmp/provision-substrate.sh
ssh podkit@<substrate-ip> sudo bash /tmp/substrate-doctor.sh
```

The doctor's exit code is the verdict, and its output names every assertion
individually (24 of them on the reference build). A pass means this box is a
substrate — by the same definition, and the same three files, that the Lima VM
on macOS satisfies.

One of those assertions is about the CPU rather than the OS: an x86-64 substrate
must expose `avx2`, because a `bun --compile` podkit binary embeds a Bun runtime
that requires it and *hangs* rather than failing on a CPU that does not. That is
the `--cpu host` above, asserted rather than trusted.

Re-running `provision-substrate.sh` is safe on a live box: it reloads `dummy_hcd`
only when the UDC count is actually wrong, so it will not tear down a gadget
under a running test.

**Then reboot the box and run the doctor again.** Provisioning writes an fstab
entry and a `modules-load.d` file, and neither is exercised until the next boot
— a substrate that passes once and comes back from a reboot unreachable is the
failure this step exists to catch. `/tmp` is cleared on boot, so copy the
scripts over again rather than assuming they survived.

> This is not hypothetical. The first Proxmox substrate mounted configfs from
> fstab with `defaults`, which is what `provision-substrate.sh` used to write.
> configfs is a module, so `/sys/kernel/config` does not exist when the
> generated `sys-kernel-config.mount` runs; the mount failed, took
> `local-fs.target` down with it, diverted the boot to `emergency.target`, and
> `multi-user.target` — and therefore sshd — never started. The script now
> writes `nofail`, rewrites the old line if it finds one, and the doctor
> asserts it.

### 6. Record the connection as an ssh_config alias

In `~/.ssh/config` on the machine that will drive the substrate:

```
Host podkit-substrate
    HostName <substrate-ip-or-name>
    User podkit
    IdentityFile ~/.ssh/id_ed25519
```

The repo stores only the alias *name*. Hostname, user, key, and any jump host or
VPN route stay here — which is what keeps a public repository from publishing
your infrastructure, and what lets a Tailscale or bastion route work without the
repo modelling it at all.

---

## Running it day to day

**Pin the address before writing an ssh alias.** A DHCP lease is not an
identity: the alias in `~/.ssh/config` outlives the lease, and the next address
the substrate gets belongs to something else. Use a DHCP reservation, a static
address, or a name from whatever resolver you run — then point the alias at the
name.

**Do not set `onboot`.** The substrate is 2 GB of a hypervisor that is also
running everything else you own, and it is only needed while tests are. Start it
when you need it and stop it when you do not:

```bash
ssh root@<pve-host> 'qm start 9000'
ssh root@<pve-host> 'qm shutdown 9000'
```

Those two lines are what TASK-515 replaces with `bun run vm:up device` over the
API — which is most of why that task exists.

---

## Findings from the first substrate

Measured on a PVE 9.1.4 host (kernel 6.17.4-2-pve) running the recipe above.

- **Nested virtualisation is available** (`/sys/module/kvm_intel/parameters/nested`
  reports `Y`). Not required by this recipe — the substrate is a sibling — but it
  means something could be nested inside the substrate later if a test ever
  needed it.
- **The PVE kernel does not ship `dummy_hcd`** (`modinfo dummy_hcd` reports
  *Module not found*). So the harness can never run on the hypervisor itself,
  whatever else is true of it. This is the concrete answer to anyone proposing to
  skip the guest.
- **The Debian 12 generic amd64 cloud kernel does** — `6.1.0-32-amd64` carries
  `dummy_hcd.ko` with the `num` parameter, and provisioning yields four UDCs.
  The image flavour is load-bearing: `generic` installs the full
  `linux-image-amd64`, while the `genericcloud` flavour is a trimmed config. Pin
  `generic`.
- The doctor passes 22/22 under `--strict` on the resulting box, unchanged from
  the Lima substrate.

---

## Related

- [ADR-028](../adr/adr-028-substrate-agnostic-device-harness.md) — substrate-agnostic device harness
- [ADR-016](../adr/adr-016-linux-vm-test-harness.md) — the Lima harness this generalises
- [linux-dev-host.md](./linux-dev-host.md) — the development box this is a sibling of
- [device-substrate-ci.md](./device-substrate-ci.md) — the same contract, applied to a throwaway substrate on a CI runner
- [builder-proxmox.md](./builder-proxmox.md) — the sibling VM that *builds* what this one runs, carrying the inverse contract
