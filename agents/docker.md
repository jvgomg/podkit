# Docker Image

Guidance for working on the Docker image and related infrastructure. See [AGENTS.md](../AGENTS.md) for project overview.

podkit is distributed as a Docker image at `ghcr.io/jvgomg/podkit`. See [docs/getting-started/docker.md](../docs/getting-started/docker.md) for user documentation.

## Key Files

| Purpose | Path |
|---------|------|
| Dockerfile | `packages/podkit-docker/Dockerfile` |
| Entrypoint script | `packages/podkit-docker/entrypoint.sh` |
| Docker Compose example | `packages/podkit-docker/docker-compose.yml` |
| Daemon Compose example | `packages/podkit-docker/docker-compose.daemon.yml` |
| CI workflow | `.github/workflows/docker.yml` |

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

- New CLI commands need to be added to the `PODKIT_COMMANDS` list in `packages/podkit-docker/entrypoint.sh`
- The Dockerfile sets `PODKIT_CONFIG=/config/config.toml` as an `ENV` variable, so every podkit invocation inside the container picks it up automatically
- `PODKIT_TIPS=false` is set in the Dockerfile (tips aren't useful in Docker context)

## Daemon Mode

- Opt-in via `command: daemon` in Docker Compose (CLI remains the default)
- Separate binary `podkit-daemon` polls for iPod devices and auto-syncs
- Requires USB passthrough (`--device /dev/bus/usb` or `--privileged`)
- Supports Apprise notifications via `PODKIT_APPRISE_URL`
- File-based health check at `/tmp/podkit-daemon-health`
- See [docs/getting-started/docker-daemon.md](../docs/getting-started/docker-daemon.md) for user docs
- Daemon entry point: `packages/podkit-daemon/src/main.ts`
