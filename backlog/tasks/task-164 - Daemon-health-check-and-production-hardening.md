---
id: TASK-164
title: 'Daemon: health check and production hardening'
status: To Do
assignee: []
created_date: '2026-03-18 23:56'
labels:
  - daemon
  - docker
dependencies:
  - TASK-163
references:
  - docker/Dockerfile
  - docker/docker-compose.yml
documentation:
  - backlog/documents/doc-004.md
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add production-readiness features to the daemon: health checks for Docker orchestration, graceful shutdown, and edge case handling.

See PRD doc-004 (Docker Daemon Mode) for full architecture context.

### Health check

Implement a health check mechanism that Docker's HEALTHCHECK instruction can use. Options: file-based (touch a file on each successful poll cycle, HEALTHCHECK checks file age) or HTTP (tiny HTTP server on an internal port). File-based is simpler and doesn't require port allocation.

### Graceful shutdown

Handle SIGTERM/SIGINT so the daemon can shut down cleanly. If a sync is in progress when the signal arrives, the daemon should wait for the current sync to complete (or at minimum eject the device) before exiting.

### Edge cases

- Device removed mid-sync (USB cable pulled during transfer)
- Mount failure recovery (device detected but mount fails — retry on next poll or skip?)
- Rapid plug/unplug cycles (debounce device detection)
- Sync completes but eject fails (notify and log, don't crash)

### Docker Compose

Update the compose example with `restart: unless-stopped` and the HEALTHCHECK instruction.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Docker HEALTHCHECK instruction verifies the daemon is alive and polling
- [ ] #2 Daemon handles SIGTERM gracefully — waits for in-progress sync to finish (or ejects device) before exiting
- [ ] #3 Daemon handles SIGINT gracefully (same as SIGTERM)
- [ ] #4 Device removal mid-sync is detected and handled without crashing (logs error, sends error notification)
- [ ] #5 Device detection is debounced to prevent rapid plug/unplug from triggering multiple syncs
- [ ] #6 Docker Compose example includes restart: unless-stopped policy
- [ ] #7 Docker Compose example includes HEALTHCHECK configuration
<!-- AC:END -->
