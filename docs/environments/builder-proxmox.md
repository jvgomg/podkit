# Builder (Proxmox VM)

Provisioning a **builder** on a Proxmox VE host — the amd64 Linux box that
compiles podkit's Linux artifacts, reached over plain SSH.

Written as a change log rather than prose so it can be lifted into automation.
Every step is idempotent.

A builder is not "a Proxmox VM". It is any SSH-reachable Debian box that passes
`builder-doctor.sh`; Proxmox is the reference recipe, and any amd64 machine a
contributor already owns fills the role equally well — **including the machine
you are sitting at**, via a `podkit-builder` alias pointed at `localhost`. The
repo has no separate "local" provisioner for that case on purpose: `ssh` names
how a box is reached and says nothing about where it is, so localhost is the
same entry, the same link and the same contract rather than a fourth code path. See
[ADR-029](../adr/adr-029-portable-device-substrate.md) §4 and
[CONTEXT.md](../../CONTEXT.md) §Test environments.

This is the sibling of [device-substrate-proxmox.md](./device-substrate-proxmox.md),
and the two documents are deliberately parallel: the substrate answers *where do
the tests run*, this answers *where do the artifacts get built*. A Mac plus a
Proxmox host is enough for both — no third machine.

---

## The builder is the inverse of the substrate

Read this before assuming the two boxes can be merged, or that one box can be
both.

The substrate's defining assertion is that **no toolchain and no `-dev` package
is present**. That absence is the whole reason its verdict means anything: a
`podkit` binary statically links libgpod, and a `libgpod-dev` on the box would
satisfy at runtime precisely the linkage the tests exist to prove unnecessary.

A builder needs exactly those packages. So it is a second profile with its own
three files, and the two contracts contradict each other on purpose:

| | Substrate | Builder |
|---|---|---|
| Contract | `substrate-contract.sh` | `builder-contract.sh` |
| Apply | `provision-substrate.sh` | `provision-builder.sh` |
| Assert | `substrate-doctor.sh` | `builder-doctor.sh` |
| `bun`, `node`, `npm` | forbidden | required |
| `*-dev` packages | forbidden | required |
| Receives | artifacts only | a staged source tree |
| Memory | 2 GiB | 4 GiB |

What they share is **mechanism** — three files, values/apply/assert, copied in
and run as root, exit code is the verdict — and nothing else. Neither sources
the other, and there is no third file of "common" packages. A unit test
(`builder-contract.test.ts`) asserts that, so a well-meaning refactor that
unifies them fails red rather than quietly disarming the substrate.

**One box cannot be both.** Provisioning it as a builder makes it fail
`substrate-doctor.sh` on every negative assertion.

---

## Security posture — read before exposing this box

Like the substrate, the builder is a **trusted-network appliance**, not a
hardened host. It runs containers as root, accepts an rsynced source tree into a
world-writable staging directory, and exists to execute whatever build scripts
are handed to it.

Put it on a LAN, a VPN or a Tailnet. Do not give it a public address, and do not
reuse it for anything else.

---

## Preconditions to assert

Identical to the substrate's, because the two VMs are siblings from the same
cloud-init family. See
[device-substrate-proxmox.md](./device-substrate-proxmox.md#preconditions-to-assert)
— the load-bearing one is still a storage with the `snippets` content type
enabled, which is not on by default for any storage including `local`.

One extra precondition of its own:

| Assertion | Check | Required value |
|---|---|---|
| Room for a 4 GiB guest | `free -g` on the PVE host | 4 GiB free *while the substrate is stopped* |

That qualifier is not pessimism, it is the operating mode — see
[Running it day to day](#running-it-day-to-day). On a 16 GiB host the two did
coexist comfortably (≈7 GiB still available with both running), so read the
qualifier as the floor to plan for rather than a rule the hypervisor enforces.

---

## Steps

### 1. Reuse the phase-1 bootstrap

Nothing new to run. `bootstrap-pve.sh` prepares the builder alongside the
substrate — same pool, same grant, and it renders **both** snippets:

```bash
bash test-packages/device-testing/substrate/proxmox/bootstrap-pve.sh \
  --pve-host root@<pve-host>
```

If you already ran it for the substrate, `podkit-builder.yaml` is on the
snippets storage and the pinned image is on the host. Re-running is safe and
changes nothing.

A second pool would mean a second token with no second boundary to justify it,
so the builder shares the substrate's.

### 2. Render the cloud-init user-data

**Done for you by step 1.** Described here for the by-hand path.

The **same template** the substrate uses, rendered by the same script:

```bash
bash test-packages/device-testing/substrate/proxmox/bootstrap-pve.sh \
  --render podkit-builder > /var/lib/vz/snippets/podkit-builder.yaml
```

`--render` contacts nothing and writes nothing — it emits the snippet on stdout,
so it is also how you diff what you are about to place against what a host
already serves.

Not a copy of the template, and not a builder-specific variant — the same file
with a different hostname substituted. `PODKIT_SSH_PUBKEY` may name a file
holding several keys (`~/.ssh/authorized_keys` is a valid value) and every one
of them is authorised; a laptop and a build box are two keys, and rendering only
the first revokes the second the next time the guest is recreated.

That is worth a sentence, because a "builder cloud-init template" is the obvious
deliverable and would be the wrong one. The template is deliberately tiny: it
produces a plain Debian box with your key on it and stops there, and *everything*
that distinguishes a builder from a substrate is applied in step 5 by the
profile scripts. A second near-identical template would add a file that can
drift from the first while encoding no difference at all.

The rendered file carries your public key and your hostname, so it lives on the
PVE host and never in the repo.

### 3. Fetch the pinned Debian cloud image

Already on the host from the substrate build, at the same pinned serial. If
starting fresh, see
[step 3 of the substrate playbook](./device-substrate-proxmox.md#3-fetch-the-pinned-debian-cloud-image).

**The builder and the substrate must run the same Debian release**, and this is
a sharper requirement here than there. A `bun --compile` podkit binary links
libgpod statically but glibc *dynamically*, so the builder's glibc becomes the
produced artifact's minimum version. A builder on trixie (glibc 2.41) yields
binaries that cannot start on the bookworm substrate they are transferred to —
and the symptom is a loader error on another machine, long after the build
reported success. `builder-doctor.sh` asserts the major version hard for this
reason, and `builder-contract.test.ts` asserts the two contracts agree on it.

The builder must be **amd64**, for the same reason the substrate is: the
artifacts are per-arch and the substrate is the box they have to start on.

### 4. Create and start the VM

```bash
VMID=9001
qm create $VMID \
  --name podkit-builder \
  --pool podkit \
  --memory 4096 --cores 4 \
  --cpu host \
  --net0 virtio,bridge=vmbr0 \
  --scsihw virtio-scsi-single \
  --serial0 socket --vga serial0 \
  --agent enabled=1 \
  --ostype l26

qm set $VMID --scsi0 local-lvm:0,import-from=/var/lib/vz/template/iso/debian-12-generic-amd64-20250316-2053.qcow2
qm set $VMID --ide2 local-lvm:cloudinit
qm set $VMID --cicustom "user=local:snippets/podkit-builder.yaml"
qm set $VMID --ipconfig0 ip=dhcp
qm set $VMID --boot order=scsi0
qm resize $VMID scsi0 40G

qm start $VMID
```

`--cpu host` is not a performance tweak — it is what makes the box able to run
`bun` at all, and it is the one line whose absence costs the most time.

PVE's default CPU model is `kvm64`, which does not expose AVX. Bun's x64 build
requires it. On a `kvm64` guest every command in the builder contract installs
and every file lands where it should, and then `bun install` panics:

```
CPU lacks AVX support. Please consider upgrading to a newer CPU.
panic: a formatting trait implementation returned an error ...
oh no: Bun has crashed.
```

The same CPU model is worse on the *receiving* side: a `bun --compile` binary
does not report the missing instruction set, it spins at 100% CPU forever. A
binary built on a correctly-configured builder and copied to a `kvm64` substrate
hangs on `--version` with no output and no error, which reads like a corrupt
transfer rather than a host that cannot execute it. Give **both** guests the
host CPU model.

`--cpu host` is the simplest correct answer on a single hypervisor. If you
migrate guests between hosts, `--cpu x86-64-v3` is the portable floor that still
includes AVX and AVX2.

Three further deliberate differences from the substrate's recipe:

- **4096 MiB / 4 cores** rather than 2048 / 2, matching the Lima glibc builder.
  The builds are CPU-bound (gcc, meson, ninja) and the static-deps closure is
  where the time goes.
- **40 G rather than 20 G.** A repo checkout, a `node_modules`, the static-deps
  cache, a prebuild work tree, three `bun --compile` outputs and the Alpine musl
  image do not fit in 20 G with room to breathe. Growing a disk later is
  possible but is a `qm resize` plus a `growpart` plus a `resize2fs` inside the
  guest; picking the right number now is one line.
- **No `onboot`**, same as the substrate and for a sharper reason — see below.

`--serial0 socket --vga serial0` matters for the same reason it does on the
substrate: Debian's cloud images expect a serial console, and without it a boot
failure is invisible.

Confirm the box answers before going further:

```bash
ssh podkit@<builder-ip> true
```

### 5. Apply and verify the builder contract

From a repo clone, copy the three contract scripts plus the musl
`Containerfile` over and run them:

```bash
ssh podkit@<builder-ip> 'mkdir -p /tmp/podkit/scripts /tmp/podkit/builder'

scp test-packages/device-testing/scripts/builder-contract.sh \
    test-packages/device-testing/scripts/provision-builder.sh \
    test-packages/device-testing/scripts/builder-doctor.sh \
    podkit@<builder-ip>:/tmp/podkit/scripts/

scp -r test-packages/device-testing/builder/* \
    podkit@<builder-ip>:/tmp/podkit/builder/

ssh podkit@<builder-ip> sudo bash /tmp/podkit/scripts/provision-builder.sh
ssh podkit@<builder-ip> bash /tmp/podkit/scripts/builder-doctor.sh
```

The directory layout is not incidental: `provision-builder.sh` looks for the
Containerfile at `../builder/musl/Containerfile` relative to itself, so the two
trees must keep their relative positions. Copy only the scripts and provisioning
warns and skips the musl image rather than failing — the glibc half of a builder
is still useful, and the doctor is what reports the box as incomplete.

**Run the doctor unprivileged.** Not `sudo`, unlike the provisioning step above
it. Several of its assertions are about the user a build actually runs as —
whether `bun` is on their PATH, whether they can write the staging tree — and
root passes them on a box nobody else can build on.

The doctor's exit code is the verdict, and its output names every assertion
individually. Measured on the reference build: **73 `ok` lines, zero failures**
(74 under `--strict`, which adds the point-release provenance check).

Provisioning is safe to re-run on a live box: the toolchain install is an
apt no-op, meson and Node and Bun are each skipped when already satisfactory,
and the container image rebuild is layer-cached.

**Then reboot the box and run the doctor again.** Unlike the substrate, nothing
here writes an fstab entry or a `modules-load.d` file, so the reboot is cheaper
insurance — but `/tmp` is cleared on boot, and a builder that comes back without
its `/usr/local/bin/bun` or with a half-applied NodeSource repo is worth finding
now rather than mid-release. Copy the scripts over again rather than assuming
they survived.

### 6. Record the connection as an ssh_config alias

In `~/.ssh/config` on the machine that will drive the builder:

```
Host podkit-builder
    HostName <builder-ip-or-name>
    User podkit
    IdentityFile ~/.ssh/id_ed25519
```

`podkit-builder` is the alias name the registry declares
(`builderRemote` in `test-packages/substrate/src/registry.ts`). The repo stores
only that *name* — hostname, user, key, and any jump host or VPN route stay
here, which is what keeps a public repository from publishing your
infrastructure.

**The key must be agent-served.** podkit's harness runs ssh non-interactively, so
a passphrase-protected on-disk key that only works when something can prompt
will never work for a build. If your `~/.ssh/config` routes key material through
1Password or another agent, note that ssh config is **first-match-wins**: a
host-scoped `IdentityAgent` below a `Host *` block does nothing. `ssh -G
podkit-builder` prints the effective values, which is the only reliable way to
tell.

Being agent-served is necessary but not sufficient: the agent has to reach the
build, and turbo runs tasks under a strict environment where an undeclared
variable simply is not there. `SSH_AUTH_SOCK` is therefore listed in
`turbo.json`'s `globalPassThroughEnv` — pass-through rather than hashed, since
the socket path changes every login and says nothing about the artifacts.
Without it a build fails with `Permission denied (publickey)` against a host
that `ssh podkit-builder true` reaches from the same shell one line earlier,
and the error names ssh rather than turbo.

---

## What the builder produces

| Artifact | Built by | libc |
|---|---|---|
| `podkit` (production binary) | `packages/podkit-cli/scripts/compile.sh` | glibc |
| `podkit-debug` | the same, with `PODKIT_DEV_HOOKS=1` | glibc |
| `podkit-daemon` | `packages/podkit-daemon` → `bun run compile` | glibc |
| `gpod-tool` | `make -C tools/gpod-tool` | glibc |
| `libgpod-node` prebuild (`.node`) | `tools/prebuild/build-linux-glibc.sh` | glibc |
| the musl siblings of all of the above | the same scripts, inside the Alpine container | musl |

The prebuild is the one with an ordering constraint: `compile.sh` embeds it, so
it must exist before the binary is compiled.

### Driving a build

One command per artifact group, from a checkout on your own machine:

```bash
bun run --cwd test-packages/device-testing build:linux-prebuild   # the .node addon
bun run --cwd test-packages/device-testing build:linux-binary     # podkit, podkit-debug, podkit-daemon
bun run --cwd test-packages/gpod-testing   build:linux-binary     # gpod-tool
bun run --cwd test-packages/device-testing build:musl-prebuild    # the musl .node
bun run --cwd test-packages/device-testing build:musl-binary      # the musl trio
```

Each is a thin wrapper over one driver
(`test-packages/device-testing/scripts/build-artifacts.ts`), which selects a
build host, stages the tree over the link, runs the build, and collects the
artifacts back. Nothing names this box: it is chosen because it is the
registered builder that can produce the `(architecture, libc)` the run needs,
and because it is provisioned the same way as the selected substrate. See
`test-packages/substrate/src/build-host.ts`.

They are also the bodies of the turbo tasks, so `bun run test:vm` reaches them
on its own — you do not normally invoke them by hand.

**Set `PODKIT_SUBSTRATE` in `.env.local`, not on the command line.** It is what
points both the tests and (by default) the builds at this hypervisor rather than
at Lima. `bun run --cwd …` changes the working directory, and Bun loads
`.env.local` relative to it — so a bare `bun run --cwd test-packages/…` from the
repo root does NOT pick the file up. Either run through turbo, or export the
variable for the command.

Set `PODKIT_BUILD_HOST=builderRemote` as well to pin builds to this box when
your own machine could also build for the target architecture.

### Building by hand, without the driver

Occasionally useful when diagnosing the builder itself. A staged tree plus four
commands, run in a staging directory under `/var/tmp/podkit-build`:

```bash
bun install --frozen-lockfile
STATIC_DEPS_DIR=/var/cache/podkit-build/static-deps \
WORK_DIR=/var/cache/podkit-build/prebuild-work \
  bash tools/prebuild/build-linux-glibc.sh
bun run build            # workspace dists — compile.sh resolves @podkit/* through them
bash packages/podkit-cli/scripts/compile.sh
```

`bun run build` is easy to leave out and fails late and confusingly:
`compile.sh` reports `Could not resolve: "@podkit/ipod-firmware". Maybe you need
to "bun install"?` — which it does not.

Four things about the staging itself, each of which produced a wrong result
rather than an error when this was the only way to build. **The driver handles
all four**; they are recorded because a hand-run still hits them.

- **Exclude every build output from the rsync.** A macOS `gpod-tool` binary
  copied in with a newer mtime than its source makes `make` report `Nothing to
  be done for 'all'`, leaving a Mach-O file on an amd64 builder. The driver's
  shared exclude floor is `DEFAULT_STAGE_EXCLUDES` in
  `test-packages/substrate/src/stage-tree.ts`.
- **`rsync -a` fails on the staging directory** with `failed to set times on
  ".": Operation not permitted` (exit 23), because `/var/tmp/podkit-build` is
  root-owned and world-writable. The payload transfers; only the directory's
  own timestamp fails. `--omit-dir-times` fixes it, and every stage carries it.
- **Container-run builds write root-owned files** into the staged tree. The
  driver stages containerised jobs as root for that reason, and gives each job
  its own directory under `/var/tmp/podkit-build` so a musl build cannot leave
  a glibc one unable to write.
- **Keep the caches.** `/var/cache/podkit-build/{static-deps,prebuild-work}` and
  their `-musl` siblings are what the driver passes as `STATIC_DEPS_DIR` and
  `WORK_DIR`.

### musl comes from a container, not a second VM

The macOS path builds musl artifacts in a second Lima VM
(`podkit-builder-musl.yaml`) because it has one to spare. A hypervisor that
cannot comfortably hold a 2 GiB substrate and a 4 GiB builder at once certainly
cannot hold a third guest — and the Alpine userland is the *entire* difference
between the two builds, which is exactly what a container is for.

Provisioning builds and tags the image from
`test-packages/device-testing/builder/musl/Containerfile`, pinned to the same
Alpine minor the published Docker image is `FROM`. Run a musl build by mounting
the staged tree into it:

```bash
sudo podman run --rm \
  -v /var/tmp/podkit-build/musl-prebuild:/src \
  -w /src \
  podkit-musl-builder:local \
  bash tools/prebuild/build-linux-musl.sh
```

That is exactly what the driver issues for a musl job — it writes the job's
script into the staged tree and runs `bash /src/.podkit-build-job.sh` inside the
image, so the script that ran is left on the box for whoever has to debug it.

Containers run as **root** on the builder. Rootless podman on a cloud image
needs subuid/subgid ranges cloud-init does not write, and the failure is a
`newuidmap` error that reads like a podman bug rather than a missing range. The
build user reaches the runtime through the NOPASSWD sudo the cloud-init template
already grants.

---

## Running it day to day

**Do not set `onboot`.** This matters more than it does for the substrate. At
4 GiB the builder is twice the substrate's footprint on a hypervisor that is
also running everything else you own, and unlike the substrate it is *not*
needed while tests are — it is needed for the minutes before them.

The operating mode is therefore **start for a build, stop after**:

```bash
ssh root@<pve-host> 'qm start 9001'
# ... build ...
ssh root@<pve-host> 'qm shutdown 9001'
```

That is the friction TASK-515 replaces with `bun run vm:up builderRemote` over
the pool-scoped API token. It is deliberately left as two manual lines until
then, so the cost is *measured* rather than assumed: if starting and stopping by
hand proves intolerable in practice, that is the argument for prioritising 515
over further build work. If it does not, 515 stays a convenience.

**The substrate and the builder generally do not coexist.** 2 GiB + 4 GiB is a
lot to ask of a modest host, and the two are needed at different moments anyway
— build, stop the builder, start the substrate, test. Sequencing them is the
expected rhythm, not a workaround.

**Pin the address before writing the ssh alias.** A DHCP lease is not an
identity: the alias in `~/.ssh/config` outlives the lease, and the next address
the builder gets belongs to something else. Use a DHCP reservation, a static
address, or a name from whatever resolver you run.

**Keep the caches.** `/var/cache/podkit-build` holds the static C-dep closure and
the prebuild work tree, deliberately outside the staging directory so it
survives `rsync --delete`. A cold static-deps build is the expensive part of a
builder's first run and nothing in it changes between source revisions — so
never "clean up" that directory to reclaim disk without meaning to pay for it
again. Measured here: 4m51s cold, 41s warm.

**A cache is only reusable at the path it was built at.** `build-static-deps.sh`
installs generated `.pc` files carrying an absolute `prefix=`, so a closure
built under one mount point is unusable under another — and the symptom is not
"stale cache", it is `fatal error: gpod/itdb.h: No such file or directory` from
a tree whose headers are plainly present. This is why the driver mounts the
cache into the musl container **at the same path it has outside**. A hand-run
that mounts it somewhere else poisons it for the driver; the fix is to delete
the affected `static-deps*` and `prebuild-work*` directories and pay for one
cold build.

---

## Related

- [device-substrate-proxmox.md](./device-substrate-proxmox.md) — the sibling VM this is a peer of
- [ADR-029](../adr/adr-029-portable-device-substrate.md) §4 — builder as a role, and the inverse contract
- `backlog/docs/doc-060` — the full design ADR-029 delegates to, including the musl-in-a-container decision
- [ADR-016](../adr/adr-016-linux-vm-test-harness.md) — the Lima builder/test split this generalises
- [linux-dev-host.md](./linux-dev-host.md) — a development box, which is not a builder and not a substrate
