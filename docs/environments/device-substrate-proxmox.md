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
by default for every storage. `local` usually is.

---

## Steps

### 1. Grant the automation exactly one pool

On the PVE host, as root:

```bash
PODKIT_PVE_POOL=podkit \
PODKIT_PVE_STORAGE=local-lvm \
PODKIT_PVE_BRIDGE=vmbr0 \
  bash pveum-recipe.sh
```

The script is `test-packages/device-testing/substrate/proxmox/pveum-recipe.sh`.
It creates a dedicated user, a dedicated pool, three narrowly-scoped roles, and
a **privilege-separated** API token.

The token's effective rights are the *intersection* of the user's and its own,
so a token ACL'd only on `/pool/podkit` is confined to that pool even if its
user were later granted more. Verify the confinement rather than trusting it:

```bash
pveum user permissions podkit@pve --token automation
```

Nothing outside `/pool/<pool>`, `/storage/<storage>` and
`/sdn/zones/localnetwork/<bridge>` should appear. **The token secret is printed
once and cannot be retrieved again** — put it straight into the repo's gitignored
env file.

> PVE 8 requires `SDN.Use` on the bridge's zone path before a VM may attach a
> NIC; PVE 6 and 7 did not. Omitting it produces a 403 at `qm create` time that
> names nothing useful. The recipe grants it.

### 2. Render the cloud-init user-data

Take `test-packages/device-testing/substrate/proxmox/cloud-init.user-data.yaml`,
substitute the two placeholders, and place it on the snippets storage:

```bash
sed -e "s|__HOSTNAME__|podkit-substrate|" \
    -e "s|__SSH_PUBKEY__|$(cat ~/.ssh/id_ed25519.pub)|" \
    cloud-init.user-data.yaml > /var/lib/vz/snippets/podkit-substrate.yaml
```

The rendered file carries your public key and your hostname, so it lives on the
PVE host and never in the repo.

The template is deliberately tiny — it produces a plain Debian box with your key
on it and stops there. Everything that makes the box a *substrate* is applied in
step 5 by the same scripts the Lima path uses. Adding provisioning here instead
would re-encode the contract in a second place and drift from it.

### 3. Fetch the pinned Debian cloud image

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
  --net0 virtio,bridge=vmbr0 \
  --scsihw virtio-scsi-single \
  --serial0 socket --vga serial0 \
  --agent enabled=1 \
  --ostype l26

qm set $VMID --scsi0 local-lvm:0,import-from=/var/lib/vz/template/iso/debian-12-generic-amd64-20250316-2053.qcow2
qm set $VMID --ide2 local-lvm:cloudinit
qm set $VMID --cicustom "user=local:snippets/podkit-substrate.yaml"
qm set $VMID --boot order=scsi0
qm resize $VMID scsi0 20G

qm start $VMID
```

`--serial0 socket --vga serial0` matters: Debian's cloud images expect a serial
console, and without it a boot failure is invisible.

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
individually. A pass means this box is a substrate — by the same definition, and
the same three files, that the Lima VM on macOS satisfies.

Re-running `provision-substrate.sh` is safe on a live box: it reloads `dummy_hcd`
only when the UDC count is actually wrong, so it will not tear down a gadget
under a running test.

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

## Findings to record

Two facts about the PVE host belong in TASK-493 once observed:

- **Nested virtualisation** — whether the host offers it. Not required by this
  recipe (the substrate is a sibling), but it determines whether anything else
  could ever be nested inside the substrate.
- **`dummy_hcd` on the PVE kernel itself** — whether the hypervisor's own kernel
  ships the module. Also not required: the substrate needs it in the *guest*
  kernel. Worth knowing before someone proposes running the harness on the host.

---

## Related

- [ADR-028](../adr/adr-028-substrate-agnostic-device-harness.md) — substrate-agnostic device harness
- [ADR-016](../adr/adr-016-linux-vm-test-harness.md) — the Lima harness this generalises
- [linux-dev-host.md](./linux-dev-host.md) — the development box this is a sibling of
