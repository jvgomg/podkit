---
id: TASK-492
title: Make container runtime pluggable and container/substrate cells skip loudly
status: To Do
assignee: []
created_date: '2026-09-07 23:35'
updated_date: '2026-09-07 23:55'
labels:
  - testing
  - infrastructure
dependencies: []
references:
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
  - docs/architecture/testing/taxonomy.md
  - docs/environments/linux-dev-host.md
priority: high
type: enhancement
ordinal: 271000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 1 of ADR-028 — the quick wins that need no new infrastructure.

Two independent problems, both small, both blocking a Linux dev box from having a useful inner loop:

**1. The container runtime is a hardcoded string.** `test:e2e:docker` (the `docker-source` surface) needs exactly one unprivileged, digest-pinned Navidrome container with a bind mount and a published port — a workload rootless Podman runs unmodified. The only blocker is the literal `'docker'` at four call sites with no env override:

- `test-packages/e2e-tests/src/docker/container-manager.ts:33` — `spawn('docker', args)`
- `test-packages/e2e-tests/src/docker/container-registry.ts:21` — duplicated private copy of the same helper
- `test-packages/e2e-tests/src/docker/container.ts:50` — `execSync(\`docker restart ...\`)`
- `test-packages/e2e-tests/src/docker-loopback/harness.ts:34` — `spawn('docker', ['exec', ...])`

Introduce `PODKIT_CONTAINER_RUNTIME` (default `docker`). Consider de-duplicating the two copies of the spawn helper while here.

**2. Missing infrastructure reports as failure, not skip.** Every `docker-source` test throws in `beforeAll` (e.g. `subsonic-sync.test.ts:35`, `device-add.test.ts:77`) — there is no `describe.skipIf` anywhere in the suite. `preflight.ts:116-120` does the same for the substrate, with `process.exit(1)`. So a machine without Docker reports four false failures where it should report skips.

Per ADR-028 §5: skip loudly with a reason, name the skipped cells in the gate summary, and have `quality` exit **non-zero**. A green gate that silently tested four of six surfaces is worse than no gate.

**Note the split by privilege, not by name:** `docker-source` is unprivileged and stays local. `docker-loopback` runs `--privileged` and `mknod`s 64 loop devices (`docker-loopback/harness.ts:62-80`) — it is out of scope here and goes to the substrate.

**Unverified assumption to prove first:** rootless Podman is expected to work on an unprivileged LXC via native overlay-in-userns (userns enabled, `/etc/subuid` populated, `overlay` in `/proc/filesystems`), but `/dev/fuse` is absent so fuse-overlayfs is unavailable. Prove this before relying on the local `docker-source` cell.

Incidental drift to fix while here: `orphan-cleaner.ts:126` and `preload.ts:29` tell users to run `bun run cleanup:docker`, which does not exist in any package.json. The real scripts are `cleanup` / `cleanup:force` / `cleanup:list`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Rootless Podman verified working on the LXC (or the assumption disproven and recorded in ADR-028)
- [ ] #2 PODKIT_CONTAINER_RUNTIME env var honoured at all four call sites, defaulting to 'docker'
- [ ] #3 The two duplicated docker-spawn helpers are reconciled into one
- [ ] #4 test:e2e:docker passes on Linux using rootless Podman
- [ ] #5 Cells with an unavailable runtime or substrate report as skipped with a stated reason, not as failures
- [ ] #6 The quality gate summary names every skipped cell
- [ ] #7 quality exits non-zero when any cell was skipped
- [ ] #8 cleanup:docker references corrected to the real script names
- [ ] #9 Container launches use `-p <containerPort>` (random host port) rather than `-p 0:<containerPort>`, which Podman rejects
- [ ] #10 Rootless Podman is configured with the slirp4netns network backend, or restart is replaced by stop-then-recreate
- [ ] #11 The stale comment at navidrome.ts:155 about restart reassigning the host port is corrected
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Spike result: rootless Podman verified working (2026-09-07)

AC #1 is **proven**. Rootless Podman 5.4.2 on Debian 13 trixie runs the real digest-pinned Navidrome workload on the unprivileged LXC. The ADR-028 assumption held: `/dev/fuse` is absent but irrelevant, because kernel 6.17 mounts **native overlay inside a user namespace**. Verified directly (`unshare -Umr mount -t overlay`, mount + write both succeed), and `podman info` confirms `driver=overlay rootless=true net=netavark cgroup=v2/cgroupfs`.

End-to-end proof: the digest-pinned Navidrome image launched with the harness's exact bind mounts, env and labels, served HTTP 200 on `/ping` within 2s, and wrote its SQLite DB into the host temp dir.

### Environment fix required (config, not code)

The LXC's default `/etc/subuid` is wrong for **any** rootless runtime. The container's userns maps container uids `0–65535`, but `/etc/subuid` allocated `james:100000:65536` — IDs outside its own namespace — so `newuidmap` failed with `write to uid_map failed: Operation not permitted`. Fixed by reallocating inside the available range:

```
sudo sh -c 'echo james:10000:55534 > /etc/subuid; echo james:10000:55534 > /etc/subgid'
podman system migrate
```

This is machine setup, not repo work, but belongs in the developer docs for Linux contributors.

### Two real Docker/Podman incompatibilities found

**1. `-p 0:4533` is rejected.** Docker reads host port `0` as "pick a free port"; Podman errors `port numbers must be between 1 and 65535 (inclusive), got 0`. `container-manager.ts` launches with exactly `ports: ['0:4533']`.

Fix: use `-p 4533` (container port alone), which means "publish to a random host port" in **both** runtimes. Verified: assigned 44249, and `podman port` output is byte-identical to Docker's (`4533/tcp -> 0.0.0.0:44249`), so the existing parser at `container-manager.ts:106-124` needs no change.

**2. `restart` fails under the default rootless network backend.** With `pasta` (Podman 5.x rootless default), restart dies with `pasta failed with exit code 1: Failed to bind port 44881 (Address already in use)` — the outgoing pasta process has not released the host port when the new one binds. With `--rm` the container is additionally destroyed. **Not** a `--rm` issue: the non-`--rm` control fails identically, exiting 137.

Fix: `--network slirp4netns` (or `default_rootless_network_cmd = "slirp4netns"` in `containers.conf`). Verified working — restart exits 0, container survives, **and the host port is preserved**. Stop-then-recreate is the alternative and also works.

Port preservation differs from Docker but is harmless: `navidrome.ts:148-158` re-reads `handle.hostPort()` after restart and never asserts the value changed. Only the comment at `:155` ("A `docker restart` with dynamic port allocation reassigns the host port") becomes inaccurate.

### Verified working unchanged

`version` (the availability probe), `run -d --rm`, bind mounts (ro and rw), dynamic port publish, `port`, `ps -a --filter label= --format`, `exec`, `stop`, `rm -f`. Registry egress to Docker Hub confirmed. cgroup v2 with `cpu memory pids` delegated to the user slice.

### Cosmetic

Every `podman` invocation emits four stderr warnings about no systemd user session, falling back to `--cgroup-manager=cgroupfs`. Harmless but will pollute test output. Silenced with `loginctl enable-linger 1000`.

## Environment fixes applied and recorded (2026-09-07)

All host-side setup is now captured in `docs/environments/linux-dev-host.md`, written as an Ansible-ready change log.

**AC #10 is satisfiable by environment config, not code.** `~/.config/containers/containers.conf` with `default_rootless_network_cmd = "slirp4netns"` makes `podman restart` work with no flag passed by the harness — verified: restart exits 0 and the host port is preserved. So the repo change for AC #10 may be nothing more than a docs pointer; only AC #9 (`-p <port>` instead of `-p 0:<port>`) is a genuine code change to `container-manager.ts`.

The same file pins `cgroup_manager = "cgroupfs"`, which silences four stderr warnings on every `podman` invocation. `loginctl enable-linger 1000` alone does **not** silence them — there is no `/run/user/1000/bus` because `dbus-user-session` is absent and shells here are spawned from service units rather than logins.
<!-- SECTION:NOTES:END -->
