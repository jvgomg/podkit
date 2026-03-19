---
id: TASK-165
title: 'Daemon: documentation and Synology validation'
status: To Do
assignee: []
created_date: '2026-03-18 23:57'
labels:
  - daemon
  - docker
  - docs
  - synology
dependencies:
  - TASK-164
references:
  - docs/getting-started/docker.md
  - AGENTS.md
documentation:
  - backlog/documents/doc-004.md
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Write user-facing documentation for the daemon mode and validate on Synology NAS hardware.

See PRD doc-004 (Docker Daemon Mode) for full architecture context.

### Documentation

- New docs page for daemon mode setup (in `docs/getting-started/` or `docs/user-guide/`)
- Cover: Docker Compose setup, USB passthrough configuration, Apprise sidecar setup, env var reference (PODKIT_POLL_INTERVAL, PODKIT_APPRISE_URL), troubleshooting
- Synology-specific setup guide (how to configure USB passthrough in Synology Container Manager)
- Note untested compatibility with Unraid and TrueNAS
- Update existing Docker docs page (`docs/getting-started/docker.md`) to reference daemon mode
- Update AGENTS.md Docker section with daemon mode information

### Synology validation

Test the full daemon flow on a Synology NAS:
- USB passthrough to containers (may require --privileged on some models)
- lsblk availability inside the container
- iPod detection through Synology's virtualization layer
- Apprise sidecar running alongside the daemon
- End-to-end: plug in iPod → notification → sync → notification → eject
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Daemon mode docs page exists with Docker Compose setup, USB passthrough, Apprise config, and env var reference
- [ ] #2 Synology-specific setup guide covers Container Manager USB passthrough configuration
- [ ] #3 Docs note untested compatibility with Unraid and TrueNAS
- [ ] #4 Existing Docker docs page links to daemon mode documentation
- [ ] #5 AGENTS.md Docker section updated with daemon mode information
- [ ] #6 Daemon has been tested end-to-end on Synology NAS hardware (iPod detected, synced, ejected, notifications received)
- [ ] #7 Any Synology-specific issues discovered during testing are documented or fixed
<!-- AC:END -->
