---
id: TASK-164
title: 'Daemon: health check and production hardening'
status: Done
assignee: []
created_date: '2026-03-18 23:56'
updated_date: '2026-03-19 15:21'
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
- [x] #1 Docker HEALTHCHECK instruction verifies the daemon is alive and polling
- [x] #2 Daemon handles SIGTERM gracefully — waits for in-progress sync to finish (or ejects device) before exiting
- [x] #3 Daemon handles SIGINT gracefully (same as SIGTERM)
- [x] #4 Device removal mid-sync is detected and handled without crashing (logs error, sends error notification)
- [x] #5 Device detection is debounced to prevent rapid plug/unplug from triggering multiple syncs
- [x] #6 Docker Compose example includes restart: unless-stopped policy
- [x] #7 Docker Compose example includes HEALTHCHECK configuration
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Complete

- `health-check.ts` — file-based health check (touch/check `/tmp/podkit-daemon-health`)
- Health file touched after each successful poll cycle in `device-poller.ts`
- HEALTHCHECK in `docker-compose.daemon.yml` (checks file age < 60s)
- **Debounce:** devices must appear in 2 consecutive polls before `device-appeared` emits (pending → known promotion)
- **Mid-sync disconnect:** `_currentDevice` + `_deviceDisconnected` tracking, better error messages for disconnected devices, eject failures logged at warn level
- **Graceful shutdown:** already implemented in Phase 2 (`waitForIdle()` + SIGTERM/SIGINT)
- 8 new tests (5 health check + 5 debounce + 3 mid-sync disconnect, minus overlap with existing)
<!-- SECTION:NOTES:END -->
