---
id: TASK-492
title: Make container runtime pluggable and container/substrate cells skip loudly
status: Done
assignee: []
created_date: '2026-09-07 23:35'
updated_date: '2026-09-08 16:47'
labels:
  - testing
  - infrastructure
dependencies: []
references:
  - docs/adr/adr-028-substrate-agnostic-device-harness.md
  - docs/architecture/testing/taxonomy.md
  - docs/environments/linux-dev-host.md
modified_files:
  - packages/podkit-cli/scripts/compile.sh
  - .gitignore
  - turbo.json
  - mise.toml
  - docs/agents/testing.md
  - docs/environments/linux-dev-host.md
  - test-packages/device-testing/src/capabilities.ts
  - test-packages/device-testing/src/capabilities.test.ts
  - test-packages/device-testing/scripts/run-mirror-body.ts
  - test-packages/e2e-tests/src/docker/runtime.ts
  - test-packages/e2e-tests/src/docker/runtime.test.ts
  - test-packages/e2e-tests/src/docker/availability.ts
  - test-packages/e2e-tests/src/docker/container-manager.ts
  - test-packages/e2e-tests/src/docker/container-registry.ts
  - test-packages/e2e-tests/src/docker/container.ts
  - test-packages/e2e-tests/src/docker/constants.ts
  - test-packages/e2e-tests/src/docker/index.ts
  - test-packages/e2e-tests/src/docker/navidrome.ts
  - test-packages/e2e-tests/src/docker/orphan-cleaner.ts
  - test-packages/e2e-tests/src/docker-loopback/harness.ts
  - test-packages/e2e-tests/src/scripts/cleanup-containers.ts
  - test-packages/e2e-tests/src/setup/preload.ts
  - test-packages/e2e-tests/src/sources/subsonic.ts
  - test-packages/test-fixtures/src/require-binary.ts
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
- [x] #2 PODKIT_CONTAINER_RUNTIME env var honoured at all four call sites, defaulting to 'docker'
- [x] #3 The two duplicated docker-spawn helpers are reconciled into one
- [x] #4 test:e2e:docker passes on Linux using rootless Podman
- [x] #5 Cells with an unavailable runtime or substrate report as skipped with a stated reason, not as failures
- [x] #6 The quality gate summary names every skipped cell
- [x] #7 quality exits non-zero when any cell was skipped
- [x] #8 cleanup:docker references corrected to the real script names
- [x] #9 Container launches use `-p <containerPort>` (random host port) rather than `-p 0:<containerPort>`, which Podman rejects
- [x] #10 Rootless Podman is configured with the slirp4netns network backend, or restart is replaced by stop-then-recreate
- [x] #11 The stale comment at navidrome.ts:155 about restart reassigning the host port is corrected
- [x] #12 The podkit#compile / compile:debug staging race is fixed, and test:e2e:docker passes at default turbo concurrency
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

## Implementation (2026-09-08)

### Runtime seam

New `test-packages/e2e-tests/src/docker/runtime.ts` owns `containerRuntime()` and `runContainerCommand()`. It is a **leaf module** with no imports from the rest of `docker/`, which is what let `container-manager` and `container-registry` share the spawn primitive — the import cycle between them was the reason the primitive had been copy-pasted into both (AC #3). `runDockerCommand` survives as a deprecated alias so the name used across the suites keeps working.

`PODKIT_CONTAINER_RUNTIME` is read per call rather than cached at module load, so setting it after import still works.

### Skip, don't fail

New `src/docker/availability.ts` exports `containerRuntimeStatus()`, `isContainerRuntimeAvailable()` and `describeContainerSuite()`. The probe is **synchronous** (`spawnSync <runtime> version`, cached per process) specifically so `describe.skipIf` can use it at module scope — an async probe would have forced every caller through a preload and made the skip depend on load order.

All 8 `docker-source` files converted. Six used `beforeAll` + throw; those now guard with `if (!isContainerRuntimeAvailable()) return;` and declare suites via `describeContainerSuite`. Two are `defineMatrix` based, which registers suites at module scope, so the guard sits around the `defineMatrix(...)` call instead.

Verified both directions: with a nonexistent runtime the suites report **8 skip, 0 fail** with a stated reason (previously 1 hard failure per file); under Podman they pass.

`availability.ts` imports `bun:test`, so it is deliberately **not** re-exported from `docker/index.ts` — that entrypoint is imported by `cleanup-containers.ts` outside any test runner. Verified `bun run cleanup:list` still works.

### Gate contract

New `test-packages/device-testing/src/capabilities.ts` probes the container runtime and the device substrate and renders a report naming the taxonomy cells each missing capability costs. `run-mirror-body.ts` prints it before phase 1 and returns the new `EXIT_INCOMPLETE = 2` when every suite passed but some surface was never covered — distinguishable from a genuine failure, and still not a pass (AC #6, #7).

### A third Docker/Podman incompatibility, not in the original spike

Podman rejects **short image names**: `deluan/navidrome@sha256:…` fails with `short-name … did not resolve to an alias and no unqualified-search registries are defined`. Docker infers `docker.io/`. Fixed in the repo by qualifying `NAVIDROME_IMAGE` rather than configuring host `registries.conf`, so no host setup is needed.

### Turbo was filtering the variable

`PODKIT_CONTAINER_RUNTIME` had to be added to `turbo.json`'s `globalPassThroughEnv` — without it the variable never reached the test tasks and the suites saw plain `docker`.

### metaflac now comes from mise, not apt

Two suites failed on a missing `metaflac`, a pre-existing host gap unrelated to this task. Rather than an apt package, pinned `"conda:libflac" = "1.5.0"` in `mise.toml` — versioned, and identical on macOS and Linux like the existing `conda:ffmpeg` pin. Worth noting the trap: the conda ffmpeg build *contains* `metaflac` in its `bin/` but exposes only `ffmpeg`/`ffplay`/`ffprobe`, so it is present and unreachable without a separate entry.

### Docs

`docs/agents/testing.md` guidance at the 'writing a new test' step told authors to write the exact `beforeAll` + throw pattern this task removed; rewritten to state the rule directly — **throw for a broken checkout, skip for absent infrastructure**.

### Unrelated bug observed

`podkit#compile` and `podkit#compile:debug` race when turbo runs them concurrently: both stage `gpod_binding.node` to the same path and the loser dies with `cp: cannot create regular file … File exists`. Worked around with `--concurrency=1`. Not filed yet.

## Verified complete (2026-09-08)

`test:e2e:docker` under rootless Podman: **8 passed, 0 failed** (71.8s), all 8 `docker-source` files. Repo-wide `typecheck` 38/38, `lint` 0 errors, `format:check` clean apart from pre-existing warnings in `packages/docs-site/.astro/**` (build artefacts) and `test-packages/gpod-testing/src/index.integration.test.ts`, none of which this task touched.

Unit tests added for both new seams: `docker/runtime.test.ts` (4) pins the default-to-`docker` behaviour and the empty/whitespace fallback; `device-testing/src/capabilities.test.ts` (5) pins that an unavailable capability always names the surfaces it cost. Existing suites unchanged: device-testing 328 pass, e2e-tests unit 5 pass.

## Fixed the compile race (2026-09-08)

Supersedes the 'unrelated bug observed' note above — fixed rather than filed.

`podkit#compile` and `podkit#compile:debug` are independent turbo tasks with no dependency between them, so turbo runs them in parallel. Both invoke `packages/podkit-cli/scripts/compile.sh`, which stages to two **fixed** paths, `$CLI_DIR/gpod_binding.node` and `$CLI_DIR/usb_native.node`.

Those paths cannot be made per-variant. `src/compile-entry.js:16` embeds the addon with a literal `require('../gpod_binding.node')`, and Bun's compiler only detects a `.node` file to embed when the specifier is a literal. So both variants necessarily stage to the same place.

The `cp: cannot create regular file … File exists` failure is the loud symptom. The quiet one is worse: `trap cleanup EXIT` means whichever build finishes first deletes **both** staged files while the other is still compiling, which can yield a binary with a missing addon instead of a clean error.

Fix: a `mkdir`-based mutex spanning stage → compile → cleanup. `mkdir` is atomic on every POSIX filesystem; `flock(1)` was rejected because macOS does not ship it and the Mac is a first-class dev host. The lock is released by the EXIT trap, which is installed immediately after acquisition so an early failure cannot strand it, and it times out (default 900s, `PODKIT_COMPILE_LOCK_TIMEOUT`) with an actionable message naming the directory to remove.

Rejected alternative: declaring `compile:debug` as `dependsOn: [compile]` in turbo.json. It would serialise them, but it is a semantic lie (the debug build consumes nothing the production build produces) and it would only fix turbo-driven concurrency — two shells each running one of the scripts would still collide.

Verified: `turbo run compile compile:debug --force` now logs `Waiting for a concurrent compile to release …` and both succeed; lock and staged files are cleaned up; both binaries report v0.6.0 and `podkit device scan --json` works, which exercises the embedded native binding.

Also gitignored `usb_native.node` (pre-existing gap — only `gpod_binding.node` was listed) and `.compile.lock/`.

Confirmed at default turbo concurrency (no `--concurrency=1`): the lock engaged — this run it was `compile` waiting on `compile:debug`, the reverse of the earlier run, so it is symmetric regardless of which task wins the start — both compiled, and `test:e2e:docker` passed **8/8**, 19/19 turbo tasks, exit 0. `bash -n` clean; lint 0 errors; format clean apart from the same pre-existing `.astro` artefacts and `gpod-testing/src/index.integration.test.ts`. shellcheck is not installed on this host, so the file's existing shellcheck directives went unverified.

## Stress tested (2026-09-08)

Two green runs prove it works once; they say nothing about flakiness. The risky shape is specific: `gpod-tests-parallel --concurrency 3` runs three files at once, each starting its own Navidrome container with a runtime-assigned host port.

**Three consecutive cold runs** (`--force`, no turbo cache): **8 passed / 0 failed** each time, 73.3s / 72.7s / 124.0s wall-clock. The third run's slower time is host contention, not a failure.

**Zero retries** across all three. Worth checking explicitly — `bunfig.toml` sets `retry = 1`, so a flaky test could have passed on a second attempt and hidden itself. None did.

**No resource leaks.** Containers 0 before and after every run; 0 volumes; 1 network (Podman's default). Crucially **zero** docker-source temp dirs remain (`podkit-subsonic-test-*`, `podkit-artwork-change-*`, `podkit-comp-subsonic-*`, `podkit-device-add-docker-*`) — the suite tidies up completely.

**SIGINT cleanup verified.** Interrupting a run mid-container: `[docker-cleanup] Received SIGINT` → container stopped → exit 130 → 0 managed containers left. This exercises `containerRegistry.stopAll()`, which is on the path rewired to `runContainerCommand`, so it confirms the abstraction holds on the interrupt path too.

### Pre-existing observation, not from this task

97 `/tmp/podkit-*` directories exist, totalling **124K**. They are `podkit-reset-*`, `podkit-rename-*`, `podkit-migrate-*`, `podkit-backup-*`, `podkit-daemon-health` — residue from **host** e2e suites (device reset/rename, config migration), not docker-source. The count stayed at exactly 97 across all three runs, confirming nothing accumulates now. Tiny, and out of scope here, but a real (if minor) cleanup gap in the host e2e suites if anyone wants it.
<!-- SECTION:NOTES:END -->
