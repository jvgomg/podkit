# Linux dev host (unprivileged Proxmox LXC)

Environment setup for a Linux development box running podkit's **local** test
cells: Unit, Integration, E2E `host-binary`·`local-dir`·`dir`, and E2E
`host-binary`·`docker-sidecar`·`dir` via rootless Podman.

Written as a change log rather than prose so it can be lifted into Ansible.
Every step is idempotent. Verified on Debian 13 (trixie), kernel 6.17, inside an
unprivileged Proxmox LXC.

This host deliberately does **not** run the `usb-synth` or `loopback-fat` cells —
see [ADR-028](../adr/adr-028-substrate-agnostic-device-harness.md). Those need
the device substrate (a sibling Proxmox VM), documented separately.

---

## Preconditions to assert

Fail fast rather than half-configuring. All are true of a stock unprivileged
Proxmox LXC on a modern kernel.

| Assertion | Check | Required value |
|---|---|---|
| User namespaces enabled | `/proc/sys/user/max_user_namespaces` | `> 0` |
| Overlay available | `grep overlay /proc/filesystems` | present |
| Overlay mounts unprivileged | `unshare -Umr mount -t overlay …` | succeeds |
| cgroup v2 | `stat -fc %T /sys/fs/cgroup` | `cgroup2fs` |
| Controllers delegated | `…/user@1000.service/cgroup.controllers` | `cpu memory pids` |
| Registry egress | `curl https://registry-1.docker.io/v2/` | HTTP 401 |

The overlay-in-userns check is the load-bearing one: `/dev/fuse` is absent in an
unprivileged LXC, so `fuse-overlayfs` is unavailable and Podman must use the
kernel's native overlay driver. Kernel ≥ 5.11 supports this; 6.17 is verified.

---

## Steps

### 1. Packages

```bash
apt-get install -y podman uidmap passt slirp4netns
```

Ansible: `ansible.builtin.apt`, `state: present`.

`uidmap` provides `newuidmap`/`newgidmap` — without it Podman cannot set up a
user namespace at all. `slirp4netns` is required by step 4; `passt` ships the
default backend Podman probes for.

FFmpeg and `metaflac` are **not** apt packages here — both are pinned project
tools (`conda:ffmpeg` and `conda:libflac` in `mise.toml`) and arrive with
`mise install`. Note the two are separate entries even though the conda ffmpeg
build physically contains `metaflac`: it exposes only `ffmpeg`, `ffplay` and
`ffprobe`, so the binary is present but unreachable without `conda:libflac`.

### 2. Reallocate subuid/subgid inside the container's own namespace

**This is the step that is easy to get wrong, and it is not Podman-specific —
any rootless runtime fails identically without it.**

Proxmox creates the LXC with `/etc/subuid` written as though the guest were a
host: `james:100000:65536`. But an unprivileged LXC's user namespace maps
container uids `0–65535` onto host `100000–165535`. So the allocated subuids
`100000–165535` **do not exist inside the container**, and `newuidmap` fails:

```
newuidmap: write to uid_map failed: Operation not permitted
```

The range must fall inside the container's own uid space, above the real
accounts and below `nobody` (65534):

```bash
echo "james:10000:55534" > /etc/subuid
echo "james:10000:55534" > /etc/subgid
```

Ansible: `ansible.builtin.lineinfile` or `copy`. **Do not hardcode `10000:55534`
blindly** — derive it. The container's namespace width is the third field of
`/proc/self/uid_map`, and the floor must clear the highest real uid in
`/etc/passwd` excluding `nobody`:

```
width  = awk '{print $3}' /proc/self/uid_map        # e.g. 65536
floor  = 10000                                      # > max real uid (1000)
count  = width - floor - 2                          # leave 65534 (nobody) free
```

### 3. Re-read the new mapping

```bash
podman system migrate
```

Ansible: `ansible.builtin.command`, guarded by a `changed_when` on step 2.
Required only when the subuid range changes; harmless otherwise.

### 4. Podman configuration

`~/.config/containers/containers.conf` (user-level; no root needed):

```toml
[engine]
cgroup_manager = "cgroupfs"

[network]
default_rootless_network_cmd = "slirp4netns"
```

Ansible: `ansible.builtin.copy` or `community.general.ini_file`, as the target
user.

Both settings fix real problems, not cosmetics:

- **`cgroup_manager = "cgroupfs"`.** There is no systemd user session bus on this
  host (`dbus-user-session` is not installed, and shells are spawned from
  service units rather than logins), so `/run/user/1000/bus` does not exist.
  Without this pin, every single `podman` invocation probes for it, fails, and
  emits four stderr warnings — which would pollute all test output. Note that
  `loginctl enable-linger 1000` alone does **not** fix this; installing
  `dbus-user-session` is the alternative, but pinning the manager is
  deterministic and does not depend on a session existing in every context.
- **`default_rootless_network_cmd = "slirp4netns"`.** Podman 5.x defaults
  rootless networking to `pasta`, which cannot rebind a published host port on
  `podman restart` — the outgoing process still holds it:

  ```
  pasta failed with exit code 1:
  Failed to bind port 44881 (Address already in use) for option '-t 44881-44881:8080-8080'
  ```

  The container then dies (exit 137). This is not a `--rm` artefact; it
  reproduces identically without `--rm`. `slirp4netns` restarts cleanly and
  preserves the host port.

### 5. Optional: linger

```bash
loginctl enable-linger 1000
```

Applied on this host. It is *not* required given step 4, and does not by itself
silence the warnings. Keep it if you later install `dbus-user-session` and want
a real user session; drop it otherwise.

---

## Deliberately absent — do not try to provision

These are structural properties of an unprivileged LXC, not missing packages.
Anything requiring them belongs on the device substrate.

| Absent | Consequence |
|---|---|
| `/lib/modules` | Cannot load kernel modules. `dummy_hcd` is unreachable, so `usb-synth` is impossible. |
| `/dev/loop*`, `CAP_SYS_ADMIN` | No `losetup`/`mkfs.vfat`/`mount`, so `loopback-fat` is impossible. `apply-state.sh` needs root plus `modprobe` and `udevadm`. |
| `/dev/kvm` | Nested VMs would run under software emulation. |
| `/dev/fuse` | No `fuse-overlayfs` — irrelevant, native overlay is used instead. |

---

## Verification

```bash
podman info --format 'driver={{.Store.GraphDriverName}} rootless={{.Host.Security.Rootless}}'
# expect: driver=overlay rootless=true

podman run --rm docker.io/library/alpine:3.21 echo ok
# expect: ok, with no warnings on stderr
```

Full end-to-end (what `test:e2e:docker` actually does): launch the
digest-pinned Navidrome image with a host bind mount and `-p 4533`, then read the
assigned port with `podman port` and expect HTTP 200 on `/ping`.

Note `-p 4533`, **not** `-p 0:4533`. Docker reads host port `0` as "pick a free
port"; Podman rejects it (`port numbers must be between 1 and 65535 (inclusive),
got 0`). The bare container-port form means "publish to a random host port" in
both runtimes and is the portable spelling — see task-492.

Image references must also be registry-qualified (`docker.io/deluan/navidrome@…`
rather than `deluan/navidrome@…`): Docker infers the registry for a short name,
Podman refuses to without `unqualified-search-registries` configured. The repo
now qualifies them, so no host `registries.conf` is needed.

Select the runtime with `PODKIT_CONTAINER_RUNTIME=podman`. It is declared in
`turbo.json`'s `globalPassThroughEnv`, so it survives Turbo's environment
filtering and reaches the test tasks.
