---
title: Docker Daemon Mode
description: Automatically detect and sync iPods when plugged in using the podkit daemon with Docker.
sidebar:
  order: 4
---

The podkit daemon runs as a persistent Docker service that automatically detects iPods when they're plugged in, syncs your music collection, and ejects them when done. Notifications keep you informed at each step.

Daemon mode is opt-in — the default Docker image still runs the CLI as documented in the [Docker guide](/getting-started/docker/). You switch to daemon mode by setting `command: daemon` in your Docker Compose file.

## Prerequisites

- **Linux Docker host** — macOS and Windows Docker Desktop cannot pass USB devices to containers. Use the [CLI binary](/getting-started/installation/) directly or manually run the [Docker image](/getting-started/docker/) on those platforms.
- **USB device access** — the container needs privileged mode (or explicit device passthrough) to detect iPod block devices.
- **Optional:** [Apprise](https://github.com/caronc/apprise) for notifications (ntfy, Slack, Discord, Telegram, etc.)

## Quick Start

Create a `docker-compose.yml`:

```yaml
services:
  podkit:
    image: ghcr.io/jvgomg/podkit:latest
    command: daemon
    restart: unless-stopped
    environment:
      - PUID=1000
      - PGID=1000
      - PODKIT_MUSIC_PATH=/music
    volumes:
      - /path/to/music:/music:ro
    privileged: true
```

```bash
docker compose up -d
```

Plug in an iPod and watch the logs:

```bash
docker compose logs -f
```

## How It Works

1. The daemon polls for iPod devices every 5 seconds (configurable).
2. A new iPod is detected and confirmed after 2 consecutive polls (debounced to avoid false positives from brief USB connections).
3. The iPod is mounted at `/ipod` inside the container.
4. A dry-run sync runs first to preview changes.
5. The actual sync executes.
6. The iPod is ejected — safe to unplug.
7. If configured, notifications are sent at each step via Apprise.

The daemon handles graceful shutdown on `SIGTERM` — if a sync is in progress when the container stops, it waits for the sync to complete before exiting. This prevents iPod database corruption.

## Configuration

### Daemon-Specific Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PODKIT_POLL_INTERVAL` | `5` | How often to check for new iPod devices (seconds) |
| `PODKIT_APPRISE_URL` | (unset) | Apprise notification endpoint URL |

### Standard podkit Settings

All standard podkit configuration works the same as CLI mode — collections, quality, artwork, clean artists, and everything else. Configure via environment variables or a config file:

```yaml
services:
  podkit:
    image: ghcr.io/jvgomg/podkit:latest
    command: daemon
    restart: unless-stopped
    environment:
      - PUID=1000
      - PGID=1000
      - PODKIT_MUSIC_PATH=/music
      - PODKIT_QUALITY=medium
      - PODKIT_ARTWORK=true
      - PODKIT_CLEAN_ARTISTS=true
    volumes:
      - /path/to/music:/music:ro
    privileged: true
```

Or mount a config file:

```yaml
    environment:
      - PUID=1000
      - PGID=1000
    volumes:
      - ./config:/config
      - /path/to/music:/music:ro
```

See [Environment Variables](/reference/environment-variables/) for the full list.

## Multiple iPods

If you have multiple iPods, configure named devices in your config file with their volume UUIDs. When an iPod is plugged in, podkit automatically matches it by UUID and applies the correct settings.

```toml
[music.main]
path = "/music"

[devices.nano]
volumeUuid = "ABCD-1234"
quality = "medium"
music = "main"

[devices.classic]
volumeUuid = "EFGH-5678"
quality = "high"
music = "main"
artwork = true
```

Each device can have its own quality preset, collection, artwork setting, and more. See [Config File Reference](/reference/config-file/) for all device-level options.

## Notifications with Apprise

The daemon can send notifications via [Apprise](https://github.com/caronc/apprise), which supports hundreds of notification services. Run Apprise as a sidecar container and point the daemon at it.

Here's the full setup from `packages/podkit-docker/docker-compose.daemon.yml`:

```yaml
services:
  podkit:
    image: ghcr.io/jvgomg/podkit:latest
    command: daemon
    restart: unless-stopped
    environment:
      - PUID=1000
      - PGID=1000
      - PODKIT_POLL_INTERVAL=5
      - PODKIT_APPRISE_URL=http://apprise:8000/notify
      - PODKIT_MUSIC_PATH=/music
    volumes:
      - ./config:/config
      - /path/to/music:/music:ro
    privileged: true
    healthcheck:
      test: ["CMD-SHELL", "test $$(( $$(date +%s) - $$(stat -c %Y /tmp/podkit-daemon-health 2>/dev/null || echo 0) )) -lt 60 || exit 1"]
      interval: 30s
      timeout: 5s
      start_period: 10s
      retries: 3

  apprise:
    image: caronc/apprise:latest
    restart: unless-stopped
    ports:
      - "8000:8000"  # Optional: expose for testing
    environment:
      - APPRISE_STATELESS_URLS=ntfy://your-topic
```

### Notification Service Examples

Configure the `APPRISE_STATELESS_URLS` variable on the Apprise container with your service URL:

| Service | URL Format |
|---------|------------|
| [ntfy](https://ntfy.sh) | `ntfy://your-topic` |
| Slack | `slack://tokenA/tokenB/channel` |
| Discord | `discord://webhook_id/webhook_token` |
| Telegram | `tgram://bot_token/chat_id` |

See the [Apprise wiki](https://github.com/caronc/apprise/wiki) for the full list of supported services.

### What Gets Notified

- **Pre-sync:** Summary of tracks to add, remove, and update
- **Post-sync:** Sync completed successfully with stats
- **Errors:** Sync failures with error details

## Health Monitoring

The daemon writes a health marker file after each successful poll cycle. The Docker healthcheck verifies this file was updated within the last 60 seconds.

Add the healthcheck to your Compose file:

```yaml
    healthcheck:
      test: ["CMD-SHELL", "test $$(( $$(date +%s) - $$(stat -c %Y /tmp/podkit-daemon-health 2>/dev/null || echo 0) )) -lt 60 || exit 1"]
      interval: 30s
      timeout: 5s
      start_period: 10s
      retries: 3
```

Check container health:

```bash
docker compose ps       # Shows health status
docker compose logs -f  # Watch daemon activity
```

## USB Passthrough

The daemon needs access to USB block devices to detect and mount iPods. The container must be able to see block devices like `/dev/sdb1` when an iPod is plugged in.

**Privileged mode (recommended for daemon):**

```yaml
    privileged: true
```

Privileged mode gives the container full device access, allowing it to see dynamically created block devices when iPods are plugged in or unplugged. This is the simplest and most reliable option for the daemon's auto-detection to work.

**Device passthrough (alternative):**

If you know the specific block device for your iPod, you can pass it directly:

```yaml
    devices:
      - /dev/sdb:/dev/sdb
```

This is more restrictive but less secure. Note that block device names can change between reboots or when other USB devices are connected, so this approach is fragile for auto-detection.

:::note
`--device /dev/bus/usb` passes raw USB bus access but may not be sufficient for the daemon — `lsblk` needs to see block devices (`/dev/sdb1`), not just USB bus nodes. If auto-detection isn't working, switch to privileged mode.
:::

## Platform Notes

| Platform | Status | Notes |
|----------|--------|-------|
| Linux (native Docker) | Supported | Full USB passthrough works |
| Synology NAS | Expected to work | Use Container Manager's USB passthrough (testing in progress) |
| Unraid / TrueNAS | Untested | Community reports welcome |
| macOS / Windows | Not supported | Docker Desktop cannot pass USB devices |

## Troubleshooting

**iPod not detected:**
- Ensure the container is running with `privileged: true`
- Check that block devices are visible: `docker compose exec podkit lsblk`
- Check daemon logs: `docker compose logs podkit`
- If `lsblk` shows nothing, the container can't see USB block devices — verify privileged mode is enabled

**Notifications not arriving:**
- Verify the Apprise URL is correct (`http://apprise:8000/notify` if using the sidecar)
- Check Apprise container logs: `docker compose logs apprise`
- Test Apprise directly: `curl -X POST -d '{"title":"test","body":"hello"}' http://localhost:8000/notify`

**Sync fails:**
- Verify your music path is mounted correctly
- Check collection configuration (env vars or config file)
- Run a one-off CLI sync to isolate the issue: `docker compose run --rm podkit sync --dry-run`

## See Also

- [Docker](/getting-started/docker/) — CLI mode with Docker
- [Environment Variables](/reference/environment-variables/) — All configuration variables
- [Config File Reference](/reference/config-file/) — Device-specific settings
- [Devices](/user-guide/devices/) — Device configuration and management
