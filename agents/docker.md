# Docker Image

Guidance for working on the Docker image and related infrastructure. See [AGENTS.md](../AGENTS.md) for project overview.

podkit is distributed as a Docker image at `ghcr.io/jvgomg/podkit`. See [docs/getting-started/docker.md](../docs/getting-started/docker.md) for user documentation.

## Key Files

| Purpose | Path |
|---------|------|
| Dockerfile | `packages/podkit-docker/Dockerfile` |
| Entrypoint script | `packages/podkit-docker/entrypoint.sh` |
| Entrypoint tests (bats) | `packages/podkit-docker/test/entrypoint.bats` |
| Image smoke test | `packages/podkit-docker/test/image-smoke.sh`, `Dockerfile.smoke` |
| Docker Compose example | `packages/podkit-docker/docker-compose.yml` |
| Daemon Compose example | `packages/podkit-docker/docker-compose.daemon.yml` |
| CI workflow | `.github/workflows/docker.yml` |

## Testing the entrypoint

Shell-level tests of `entrypoint.sh` (command routing, command-parity, PUID/PGID,
`--device`/`--path` injection, su-exec privilege drop) run via `bats`. These are
the **Integration** depth in the [test taxonomy](../documents/architecture/testing/taxonomy.md)
(doc-053's rollout stage 2). They stub the external binaries on `PATH`, so they
need no container and no real sync.

```bash
bun run test --filter @podkit/docker          # via turbo (also runs in `bun run quality`)
cd packages/podkit-docker && bun run test      # directly
```

`bats` is a devDependency of `@podkit/docker`; `bun install` provides it.

## Image smoke test (E2E · host-docker-image · none)

Builds a podkit image for the native arch and asserts it boots and is internally
consistent: `--version` + `doctor` run through the image, command-parity holds
against the running binary, ffmpeg is present, both binaries + the entrypoint are
executable. Catches the "image drifted from the CLI" class.

```bash
bun run test:smoke --filter @podkit/docker
# or: bash packages/podkit-docker/test/image-smoke.sh
```

Requires **docker** and **limactl** (Lima builder VM). It builds the linux CLI
binary via `@podkit/device-testing#build:linux-binary` (turbo-cached, Lima
builder), compiles `podkit-daemon` in the same VM, then builds and exercises the
image. It is deliberately **not** in the `test`/`quality` gate — it is heavy and
host-specific.

Caveat: those Lima binaries are **glibc**, so the smoke image (`Dockerfile.smoke`)
uses a glibc base with `gosu` symlinked as `su-exec`, not the shipped Alpine/musl
image. It is a representative image for catching CLI/entrypoint drift; full
Alpine/musl fidelity against a synthesized USB device is the `vm-docker-image`
surface (Lima VM) — see the [test taxonomy](../documents/architecture/testing/taxonomy.md).

### Running the vm-docker-image e2e locally

This stage builds the real Alpine/musl image inside the `podkit-device-harness`
Lima VM and drives it against a synthesized USB iPod (5G Video persona) with
`nerdctl run --device` passthrough: `device add` (live USB firmware inquiry →
SysInfoExtended write), a real FLAC→AAC sync, then a read-back — all through the
shipped image.

```bash
bun run test:e2e:docker-dist
```

Prerequisites:

- The harness VM must be up: `bun run harness:status` (bring it up with
  `bun run harness:start` / `bun run harness:setup`).
- The musl binaries must exist. `test:e2e:docker-dist` depends on
  `@podkit/device-testing#build:musl-binary`; if they are absent, build them
  first with `bunx turbo run build:musl-binary --filter @podkit/device-testing`.

It is expensive (multi-minute image build) and fragile (live synthesized
device), so it is **local-only** — excluded from `test:vm` and the `quality`
DAG. Four gotchas the test encodes (all container constraints):

- **Path-based addressing** — volumeUuid resolution fails in-container; address
  the device by `path=/ipod` + `-d dockeripod`, never by UUID.
- **PUID=0 + `--device <blockDevice>`** — reading the block-device UUID
  (libblkid) fails as uid=1000, so `device add` runs with `-e PUID=0 -e PGID=0`
  and the block node passed via `--device`.
- **Wipe the stale on-disk SIE** before `device add` so the live USB inquiry
  writes a fresh identity (the 5G Video backing ships a stale SysInfoExtended
  that would otherwise trip IDENTITY_MISMATCH).
- **VZ-HID trap** — resolve device nodes by the persona's PID, never "first
  Apple device" (the VZ guest exposes Apple-vendor HID nodes sharing VID 05ac).

Persona caveat: the 5G Video proves the USB-inquiry code path + sync pipeline,
not 5G-over-USB realism (a real 5G Video uses SCSI inquiry). A USB-native
syncable persona is the realism refinement, deferred to the fuller persona
matrix (DRAFT-021).

`test:e2e:docker-dist` also runs `daemon.docker-dist.test.ts` — the bundled
`podkit-daemon` (not the one-shot CLI) driving the steady-state loop: it detects
the synthesized iPod, mounts, auto-syncs, and ejects on both detection lanes
(mass-storage bind-mount + lsblk raw-block), plus **SIGTERM graceful-drain**
(interrupt mid-sync → drain, exit 0, completed tracks preserved) and **Apprise
notification** delivery to a mock endpoint on the VM host (`--network host`).

### Running the loopback-fat CLI e2e locally (VM-free)

The shipped image, run as a `--privileged` container on the **host** Docker
daemon, driving the **podkit CLI** against a real loopback FAT block device
(`losetup` + `mkfs.vfat` inside the container — no VM). It owns the `device add`
`--no-verify` (trust-disk) verification tier and hard-error-on-generic:

```bash
bun run test:e2e:docker-loopback --filter @podkit/e2e-tests
```

- **CLI surface, not the daemon.** The daemon poller is USB-gated (excludes
  `loop` devices, requires an Apple USB vendor id — `device-poller.ts`), so a
  loopback can never drive daemon detection. Daemon steady-state e2e lives in
  the `vm-docker-image` · `usb-synth` stage above (task-474). The CLI, being
  transport-agnostic, works off a mounted iPod filesystem via on-disk identity.
- Requires **docker** (a privileged container for `losetup`/`mkfs.vfat`) and the
  musl binaries (turbo dep `@podkit/device-testing#build:musl-binary`; if run
  ad-hoc and missing, build with
  `bunx turbo run build:musl-binary --filter @podkit/device-testing`).
- The shipped alpine image lacks `mkfs.vfat`; the harness `apk add`s
  `dosfstools`/`util-linux` in the ephemeral container (fixture scaffolding, does
  not touch the binary under test).
- Cheap and VM-free (~12s), but still excluded from the default e2e run via the
  `docker-loopback/` surface-dir exclusion — it needs Docker.

## Device Support Boundary

Which iPods can be identified from the mounted volume alone (path baseline),
which need the one-time USB setup, and which are SCSI-only (not settable-up
in-container today) is documented in
[documents/architecture/device/identity-support-matrix.md](../documents/architecture/device/identity-support-matrix.md).
Read it before changing onboarding behavior, the firmware-inquiry transports,
or the Docker docs' setup guidance — and update it in the same PR if a device
moves between lanes.

## Architecture

- Base image: Alpine 3.21 (musl libc — CI produces musl-specific binaries for Docker)
- Multi-arch: linux/amd64 and linux/arm64 via `docker buildx`
- Pre-built musl binaries are copied from CI artifacts per `TARGETARCH`
- Runtime deps: FFmpeg + su-exec + shadow (for PUID/PGID) + eudev-libs (libudev.so.1 for the bundled `usb` prebuild — required for USB firmware inquiry during one-time `device add` setup) + findmnt (mount→device resolution for `device add --path`; Alpine's lsblk package does not include it)
- Follows LinuxServer.io conventions: PUID/PGID env vars, /config volume, branded startup banner

## Entrypoint Behavior

1. Creates user/group matching PUID/PGID
2. `init` command generates a config file into the mounted /config volume
3. `sync` command auto-injects `--device /ipod`
4. `daemon` command runs `podkit-daemon` (separate binary, polls for iPods and auto-syncs)

Collections can be configured via environment variables (e.g., `PODKIT_MUSIC_PATH=/music`) — no config file required. See [docs/reference/environment-variables.md](../docs/reference/environment-variables.md) for details.

## Impact on CLI Changes

- New CLI commands are recognised by the entrypoint automatically — `PODKIT_COMMANDS` in `packages/podkit-docker/entrypoint.sh` is derived at runtime from `podkit __complete commands` (which reads the live Commander command tree), so the routing list can never drift from the binary. The one exception is the `daemon` pseudo-command, appended explicitly because it routes to the separate `podkit-daemon` binary rather than a podkit subcommand. If you add a command that needs special entrypoint handling (like `init`/`sync`), add that branch; plain pass-through commands need no entrypoint change.
- The Dockerfile sets `PODKIT_CONFIG=/config/config.toml` as an `ENV` variable, so every podkit invocation inside the container picks it up automatically
- `PODKIT_TIPS=false` is set in the Dockerfile (tips aren't useful in Docker context)

## Daemon Mode

- Opt-in via `command: daemon` in Docker Compose (CLI remains the default)
- Separate binary `podkit-daemon` polls for iPod devices and auto-syncs
- Requires `privileged: true` (block-device visibility for detection + mounting; plain `--device /dev/bus/usb` is not sufficient for the daemon — see the passthrough table in docs/getting-started/docker-daemon.md)
- Supports Apprise notifications via `PODKIT_APPRISE_URL`
- File-based health check at `/tmp/podkit-daemon-health`
- See [docs/getting-started/docker-daemon.md](../docs/getting-started/docker-daemon.md) for user docs
- Daemon entry point: `packages/podkit-daemon/src/main.ts`
