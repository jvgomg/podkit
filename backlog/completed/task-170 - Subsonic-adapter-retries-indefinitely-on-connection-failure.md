---
id: TASK-170
title: Subsonic adapter retries indefinitely on connection failure
status: Done
assignee: []
created_date: '2026-03-19 20:09'
updated_date: '2026-03-23 14:57'
labels:
  - bug
  - subsonic
  - docker
milestone: 'M3: Production Ready (v1.0.0)'
dependencies: []
references:
  - packages/podkit-core/src/collection/subsonic/
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When the Subsonic server is unreachable (e.g. DNS resolution fails, connection refused), `collection music` and `sync` spin forever with a "Fetching from..." spinner instead of failing after a reasonable number of retries.

### Reproduction

1. Configure a Subsonic source with an unreachable URL (e.g. a Tailscale MagicDNS hostname that doesn't resolve from the host)
2. Run `podkit collection music`
3. Observe: the command spins indefinitely, never errors out

### Expected behavior

The command should retry a reasonable number of times (e.g. 3) with backoff, then fail with a clear error message like "Failed to connect to Subsonic server after 3 attempts."

### Discovered during

Synology NAS validation (TASK-165). Tailscale userspace networking on Synology doesn't route TCP traffic, so the Navidrome URL was unreachable from inside the Docker container.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Subsonic connection failures fail after a bounded number of retries (not infinite)
- [x] #2 Clear error message on final failure includes the URL and suggests checking connectivity
- [x] #3 Retry count and/or timeout is reasonable (e.g. 3 retries or 30s total)
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Bounded retry logic added to Subsonic adapter in `packages/podkit-core/src/adapters/subsonic.ts`. 3 retries with exponential backoff, 30s per-request timeout, `SubsonicConnectionError` with clear messaging. Full test coverage in `subsonic.test.ts`.
<!-- SECTION:FINAL_SUMMARY:END -->
