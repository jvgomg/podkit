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
`--device`/`--path` injection, su-exec privilege drop) run via `bats` (Tier 2 of
[doc-053](../backlog/docs/doc-053%20-%20podkit-docker-testing-strategy.md)). They
stub the external binaries on `PATH`, so they need no container and no real sync.

```bash
bun run test --filter @podkit/docker          # via turbo (also runs in `bun run quality`)
cd packages/podkit-docker && bun run test      # directly
```

`bats` is a devDependency of `@podkit/docker`; `bun install` provides it.

## Image smoke test (Tier 3)

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
Alpine/musl fidelity against a synthesized USB device is Tier 5 (Lima VM, CI).

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
- Runtime deps: FFmpeg + su-exec + shadow (for PUID/PGID)
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
