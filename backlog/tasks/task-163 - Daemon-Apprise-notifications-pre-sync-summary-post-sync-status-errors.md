---
id: TASK-163
title: 'Daemon: Apprise notifications (pre-sync summary, post-sync status, errors)'
status: To Do
assignee: []
created_date: '2026-03-18 23:56'
labels:
  - daemon
  - docker
  - notifications
dependencies:
  - TASK-162
  - TASK-161
references:
  - docker/docker-compose.yml
documentation:
  - backlog/documents/doc-004.md
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add notification support to the daemon via an Apprise sidecar container. The daemon sends three types of notifications through the Apprise REST API:

1. **Pre-sync** — When a sync is about to start. Includes device name and a concise summary: track/album/artist counts to add, removals, metadata updates, artwork changes, transcode upgrades. Example: "Syncing to Terapod: adding 47 tracks (12 albums by 5 artists), removing 3 tracks, updating artwork on 8 tracks."

2. **Post-sync** — When sync completes. Includes success/failure, completed/failed counts, duration. Example: "Terapod sync complete: 47 tracks added, 0 failed. Duration: 12m 34s. Safe to unplug."

3. **Error** — When a stage fails (mount, sync, etc.). Example: "Terapod sync failed: FFmpeg not found. Check container logs for details."

See PRD doc-004 (Docker Daemon Mode) for full notification content examples and architecture.

### Modules to implement

1. **Apprise Client** — Simple fetch-based HTTP client that POSTs to the Apprise REST API. Configured via `PODKIT_APPRISE_URL` env var (e.g., `http://apprise:8000/notify`). Notifications are fire-and-forget — Apprise failures should be logged but must not block the sync cycle.

2. **Notification Formatter** — Pure functions that take CLI JSON output (SyncOutput from dry-run and execution) and produce human-readable notification strings. Should handle: music-only, video-only, mixed music+video, zero additions (metadata-only updates), all operations failed.

### Docker Compose

- Add Apprise sidecar to the Docker Compose example (`docker/docker-compose.yml` or a new daemon-specific compose file)
- Use the `caronc/apprise` or `linuxserver/apprise-api` image
- Document how users configure their notification services via Apprise
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Apprise Client POSTs notifications to PODKIT_APPRISE_URL when configured
- [ ] #2 Notifications are skipped gracefully when PODKIT_APPRISE_URL is not set (daemon works without notifications)
- [ ] #3 Apprise Client failures are logged but do not block or abort the sync cycle
- [ ] #4 Pre-sync notification includes device name and concise summary of planned changes (tracks, albums, artists to add; removals; updates)
- [ ] #5 Pre-sync notification includes video summary (movies, TV shows) when video operations are present
- [ ] #6 Post-sync notification includes success/failure status, completed/failed counts, and duration
- [ ] #7 Error notifications are sent when mount, sync, or eject fails, with the error message
- [ ] #8 Notification Formatter handles edge cases: music-only, video-only, mixed, zero additions, all failures
- [ ] #9 Docker Compose example includes Apprise sidecar service configuration
- [ ] #10 Unit tests for Notification Formatter covering all edge cases
<!-- AC:END -->
