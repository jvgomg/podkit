---
id: doc-004
title: 'PRD: Docker Daemon Mode — Hotplug Sync with Notifications'
type: other
created_date: '2026-03-18 23:48'
---
## Problem Statement

Users who run podkit via Docker currently have to manually trigger syncs by running `docker compose run podkit sync` or setting up external cron jobs. There is no way to "plug in an iPod and have it sync automatically." The ideal Docker experience is: configure a compose stack once, plug in an iPod, get a notification that a sync is starting, get a second notification when it's done and safe to unplug.

Building this as a CLI feature (`podkit daemon`) would drag in platform-specific concerns (udev, launchd, systemd) that don't belong in the CLI. The CLI is a "run and exit" tool. Daemon mode is a deployment concern best solved in the Docker layer.

## Solution

A new `packages/podkit-daemon` package containing a lightweight Node.js process that:

1. **Polls for iPod devices** inside the container using `lsblk`
2. **Mounts the device** via `podkit mount`
3. **Runs a dry-run sync** via `podkit sync --dry-run --output json` to preview changes
4. **Sends a pre-sync notification** via an Apprise sidecar container summarizing what will be synced
5. **Runs the actual sync** via `podkit sync --output json`
6. **Sends a post-sync notification** with completion status
7. **Ejects the device** via `podkit eject` so it's safe to unplug

The daemon wraps the CLI rather than importing core directly. This avoids refactoring the config loading, device resolution, and sync orchestration code that currently lives in the CLI. The CLI is treated as a black box — the daemon shells out to it with `--output json` and parses the structured results.

Notifications are handled by an Apprise sidecar container in the Docker Compose stack. Apprise supports 130+ notification services (ntfy, Slack, Discord, Telegram, Pushover, etc.) and exposes a simple REST API. The daemon just POSTs to it — no notification logic to maintain.

### Target Platforms

- **Tested:** Linux, Synology NAS
- **Untested (community-reported):** Unraid, TrueNAS

macOS and Windows Docker Desktop cannot pass USB devices to containers. Users on those platforms should use the CLI binary directly.

### Device Detection Modes

- **Default: Polling** — Periodically runs `lsblk` to detect new block devices matching iPod characteristics. Works with basic Docker device passthrough (`--device /dev/bus/usb`).
- **Future enhancement: udev** — When the container runs with `--privileged`, a udev-based event listener can replace polling for faster, more efficient detection. This is a follow-up stream of work.

## User Stories

1. As a Docker user, I want to run a persistent compose stack that auto-syncs my iPod when I plug it in, so that I don't have to manually trigger syncs.
2. As a Docker user, I want to receive a notification on my phone when an iPod is detected and a sync is about to start, so that I know the system is working.
3. As a Docker user, I want the pre-sync notification to summarize what will be synced (device name, number of tracks/albums/artists to add, updates, removals), so that I can verify it looks correct.
4. As a Docker user, I want to receive a notification when the sync is complete, so that I know it's safe to unplug my iPod.
5. As a Docker user, I want the post-sync notification to include success/failure status and a summary of what was synced, so that I can spot problems.
6. As a Docker user, I want the daemon to use the same config file and environment variables as the CLI, so that I don't have to learn a new configuration system.
7. As a Docker user, I want to configure the notification service using environment variables (Apprise URL), so that setup is simple.
8. As a Docker user, I want the daemon to poll for devices at a configurable interval, so that I can balance responsiveness vs resource usage.
9. As a Docker user, I want the daemon to automatically mount and eject the iPod, so that the host OS doesn't need any special configuration.
10. As a Docker user, I want the daemon to handle only one iPod at a time, so that the sync process is predictable and simple.
11. As a Docker user, I want the daemon to report health status for Docker orchestration (HEALTHCHECK), so that container management tools know the daemon is running.
12. As a Docker user, I want the daemon to gracefully handle errors (adapter failures, mount failures, sync failures) and send error notifications rather than crashing, so that the system is reliable.
13. As a Docker user, I want the daemon to refuse to sync when a source adapter returns zero tracks (empty source abort), so that a source bug doesn't wipe my iPod.
14. As a Synology NAS user, I want the daemon to work with Synology's container support and USB passthrough, so that I can use my NAS as an always-on sync station.
15. As a Docker user, I want the compose stack to include an Apprise sidecar for notifications, so that I can use any notification service I prefer (ntfy, Slack, Discord, etc.).
16. As a Docker user, I want the daemon container to also bundle the CLI binary, so that I can shell into the container for manual operations (dry-runs, device info, etc.).
17. As a Docker user, I want the daemon to only support FAT32-formatted iPods, so that filesystem handling is simple and reliable.
18. As a Docker user, I want the Docker image to support both amd64 and arm64 architectures, so that it works on standard servers and ARM-based NAS devices.
19. As a Docker user, I want a clear Docker Compose example that shows how to set up the daemon with Apprise and USB passthrough, so that I can get started quickly.
20. As a Docker user, I want the daemon to log its activity (device detected, sync started, sync completed, errors) to stdout, so that I can use `docker logs` to troubleshoot.

## Implementation Decisions

### Architecture: CLI Wrapper Pattern

The daemon shells out to the podkit CLI binary with `--output json` rather than importing `@podkit/core` directly. This avoids extracting config loading, device resolution, environment variable parsing, adapter creation, and sync orchestration logic from the CLI into shared packages. The CLI is the source of truth for sync behavior; the daemon is a thin orchestration layer.

The daemon flow for each sync cycle:

1. Poll `lsblk` → detect new iPod block device
2. `podkit mount --disk /dev/sdXN --target /ipod --output json` → mount to fixed path
3. `podkit sync --device /ipod --dry-run --output json` → get plan summary
4. POST to Apprise → pre-sync notification
5. `podkit sync --device /ipod --output json` → execute sync
6. POST to Apprise → post-sync notification
7. `podkit eject --device /ipod --output json` → safely unmount

### New Package: `packages/podkit-daemon`

A private workspace package (`@podkit/podkit-daemon`) containing:

- **Device Poller** — Polls `lsblk` at a configurable interval (default 5s). Compares snapshots to detect new block devices. Uses iPod detection heuristics (USB vendor ID `0x05ac`, partition type). Emits device-appeared/device-disappeared events.
- **Sync Orchestrator** — State machine for one sync cycle: mount → dry-run → notify → sync → notify → eject. Handles errors at each stage (mount failure, sync failure, eject failure) and sends error notifications. Enforces one-device-at-a-time.
- **CLI Runner** — Shells out to the `podkit` binary with `--output json`. Parses results into typed objects. Similar pattern to the existing e2e-tests cli-runner.
- **Apprise Client** — POSTs to the Apprise REST API. Simple fetch-based HTTP client.
- **Notification Formatter** — Pure functions that take CLI JSON output and produce human-readable notification strings. Pre-sync: device name + summary of additions/updates/removals with album/artist counts. Post-sync: success/failure + completion summary.
- **Health Check** — Simple mechanism for Docker HEALTHCHECK (file-based or HTTP).
- **Entry point** — Reads daemon-specific env vars, wires modules together, starts the poll loop. Thin, minimal logic.

### CLI Enhancements Required

Small, non-breaking additions to the existing CLI:

1. **Mount command: add `--target` flag** — Allows specifying the mount point path (e.g., `podkit mount --disk /dev/sdb2 --target /ipod`). Currently the mount point is auto-generated from the volume name.
2. **Eject command: ensure JSON output works** — The eject command should support `--output json` with structured output.
3. **Sync JSON output: add album/artist aggregation** — Enrich the dry-run JSON plan with album count, artist count, and similar aggregations so the daemon can build rich notification summaries without parsing track name strings.
4. **Empty source abort** — When an adapter returns zero tracks for a collection, the CLI should refuse to sync that collection and exit with an error. This protects all users (not just daemon mode) against source bugs that would otherwise trigger mass deletion with `--delete`.

### Docker Changes

1. **Dockerfile** — Install the daemon's Node.js entry point alongside the CLI binary. The daemon runs as the default CMD when in daemon mode.
2. **Entrypoint** — Add `daemon` to the known commands list. When running in daemon mode, the entrypoint starts the Node.js daemon process instead of the CLI.
3. **Docker Compose example** — New compose file showing the daemon + Apprise sidecar setup with USB passthrough.
4. **HEALTHCHECK** — Add a HEALTHCHECK instruction for daemon mode.

### Daemon-Specific Configuration

Environment variables (not in the config file):

- `PODKIT_POLL_INTERVAL` — Device polling interval in seconds (default: 5)
- `PODKIT_APPRISE_URL` — URL of the Apprise API endpoint (e.g., `http://apprise:8000/notify`)

All sync-related configuration (collections, quality, transforms, delete, etc.) uses the existing config file and environment variables — no duplication.

### Notification Content

**Pre-sync notification:**
> Syncing to Terapod: adding 47 tracks (12 albums by 5 artists), removing 3 tracks, updating artwork on 8 tracks.

**Post-sync notification:**
> Terapod sync complete: 47 tracks added, 0 failed. Duration: 12m 34s. Safe to unplug.

**Error notification:**
> Terapod sync failed: FFmpeg not found. Check container logs for details.

### USB Passthrough

The container requires USB device access. Two modes:

- **`--device /dev/bus/usb`** — Passes all USB devices. Works with polling mode. Less privileged.
- **`--privileged`** — Full device access. Required for future udev mode. More permissive but needed on some NAS platforms.

The daemon documentation should recommend `--device /dev/bus/usb` as the default and note `--privileged` as an alternative for platforms that need it.

## Testing Decisions

### What makes a good test

Tests should verify external behavior and contracts, not implementation details. For the daemon, this means testing that the right CLI commands are executed in the right order with the right arguments, that notifications contain the right content, and that error scenarios are handled correctly — not testing internal state management.

### Modules to test

1. **Device Poller** — Mock `lsblk` output (provide JSON snapshots). Verify: new device detected, device removal detected, no false positives on non-iPod devices, polling interval respected. Prior art: integration tests in `packages/podkit-core/` that test LinuxDeviceManager with mocked lsblk.

2. **Notification Formatter** — Pure function tests. Provide SyncOutput JSON fixtures, verify formatted notification strings. Test edge cases: zero additions (metadata-only update), all operations failed, video-only sync, mixed music+video. Prior art: unit tests throughout the monorepo.

3. **Sync Orchestrator** — Mock the CLI Runner and Apprise Client. Verify the full state machine: happy path (mount → dry-run → notify → sync → notify → eject), mount failure aborts early with error notification, sync failure still ejects and notifies, empty source abort triggers error notification. Prior art: e2e-tests patterns for CLI subprocess testing.

### Testing approach

- Unit tests for Device Poller, Notification Formatter (fast, no dependencies)
- Integration tests for Sync Orchestrator with mocked CLI and Apprise (verify orchestration flow)
- E2E tests deferred to manual testing on real hardware (Linux host, Synology NAS)

## Out of Scope

- **macOS and Windows support** — Docker on these platforms cannot pass USB devices to containers. Users should use the CLI binary directly.
- **udev-based device detection** — Future enhancement when running with `--privileged`. The initial implementation uses polling only.
- **Multiple simultaneous iPods** — One device at a time. Multi-device support is a future enhancement.
- **HFS+ filesystem support** — FAT32 only. Most iPods in active use are FAT32-formatted.
- **Approval-gated sync** — Notifications are informational only. There is no mechanism to cancel a sync via notification reply.
- **s6-overlay or process supervision** — The daemon is a single Node.js process. Docker's restart policies (`restart: unless-stopped`) handle crash recovery.
- **Web UI or dashboard** — The daemon is headless. Use `docker logs` and notifications for visibility.
- **Refactoring CLI internals** — No extraction of config loading, device resolution, or sync orchestration into shared packages. The daemon wraps the CLI as-is.
- **Deletion threshold/guardrail** — Empty source abort is in scope. A percentage-based deletion threshold (e.g., "refuse to delete >50% of tracks") is a future consideration.

## Further Notes

### Relationship to Existing Tasks

- **TASK-144** (Docker daemon mode support) — This PRD supersedes that task's description. TASK-144 assumed daemon mode would be a CLI feature; this PRD moves it to a separate package that wraps the CLI.
- **TASK-145** (Docker USB auto-mount) — Covered by this PRD's mount flow. The daemon handles mounting via the CLI's mount command.
- **TASK-146** (Show filesystem UUID in device info) — Complementary. UUID display is useful for daemon debugging but not a dependency.

### Synology Testing

A Synology NAS is available for testing. Key things to validate:
- USB passthrough to containers works (may require `--privileged` on some models)
- `lsblk` is available or can be installed in the container
- iPod detection works through Synology's virtualization layer
- Apprise sidecar runs alongside the daemon container

### Future Enhancement: udev Mode

When a user runs the container with `--privileged`, the daemon could detect this and switch from polling to udev-based event listening. This would:
- Eliminate polling overhead
- Provide instant device detection
- Require `eudev` package in the Alpine image
- Need udev rules for iPod vendor/product ID matching

This is a separate stream of work that builds on the polling foundation.
