---
id: TASK-144
title: Docker daemon mode support
status: To Do
assignee: []
created_date: '2026-03-17 20:50'
updated_date: '2026-03-18 02:24'
labels:
  - docker
  - daemon
  - future
dependencies: []
references:
  - docker/Dockerfile
  - docker/entrypoint.sh
  - docs/getting-started/docker.md
documentation:
  - AGENTS.md (Docker Image > Future considerations)
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When daemon mode is implemented in the CLI, the Docker image needs updates:

1. **Entrypoint**: Default CMD should switch from `sync` to `daemon` (or support both via env var like `PODKIT_MODE=daemon`)
2. **Process supervision**: Consider adopting s6-overlay for long-running container process management (restart on crash, graceful shutdown)
3. **Health check**: Add a `HEALTHCHECK` instruction or s6 health check so Docker orchestration knows the daemon is healthy
4. **USB auto-detect**: Document and support `--privileged` or `--device /dev/bus/usb` for USB device passthrough. May need udev rules inside the container for iPod connect/disconnect events
5. **Restart policy**: Update docker-compose examples with `restart: unless-stopped`

This task is blocked until the daemon mode CLI feature is implemented.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Container runs as a long-lived daemon that auto-syncs on iPod connection
- [ ] #2 Health check endpoint or command exists for orchestration
- [ ] #3 USB device passthrough is documented and tested
- [ ] #4 Container restarts gracefully after crashes
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
TASK-145 covers USB auto-mount (detect and mount iPod filesystem inside the container). That work depends on this task for daemon-mode hotplug support.

## UUID validation use cases for daemon mode

When running as a long-lived daemon (especially in Docker with cron), UUID validation prevents syncing to the wrong device:

1. **Wrong iPod at mount point** — User has Classic (max quality) and Nano (medium). If Nano gets mounted where Classic was expected, daemon syncs 200GB ALAC to 16GB device. UUID catches this.
2. **Docker cron + device swap** — Cron job auto-syncs on schedule. User plugs in different iPod, automount reuses same path. UUID prevents unintended sync.
3. **Multi-device Docker Compose** — Each service targets a different iPod. If mounts get crossed, UUID validation per-service prevents data going to wrong device.

When implementing daemon mode with hotplug detection, UUID should be the primary mechanism for matching detected devices to device configs.
<!-- SECTION:NOTES:END -->
