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
- **USB device access** — the container needs `privileged: true` to detect, mount, and sync iPod block devices. See [USB Passthrough](#usb-passthrough) for details on why this is required.
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
3. The iPod is mounted at a unique path inside the container (e.g., `/tmp/podkit-sdb1`).
4. The iPod's volume UUID is matched against the devices in your config file. A registered iPod is synced by its device name, so its per-device settings apply; an unregistered iPod is synced by path with global/environment settings.
5. A dry-run sync runs first to preview changes.
6. The actual sync executes.
7. The iPod is ejected — safe to unplug.
8. If configured, notifications are sent at each step via Apprise.

The daemon handles graceful shutdown on `SIGTERM` — if a sync is in progress when the container stops, it signals the sync to drain and save, then exits cleanly within Docker's 10-second timeout. Completed tracks are always preserved in the iPod database.

## Configuration

### Which mode do I need?

| Your setup | Configure via | How devices resolve |
|------------|---------------|---------------------|
| One iPod | ENV only (`PODKIT_MUSIC_PATH` + globals) | Auto-detected; synced by path with global settings — zero config |
| One mass-storage player | ENV only (`PODKIT_DEVICE_PATH` + `PODKIT_DEVICE_TYPE`) | Declared preset applies; path auto-polled |
| Multiple iPods, or per-device settings | Config file (`[devices.<name>]` with `volumeUuid`) | Matched by volume UUID, synced by name — per-device settings apply |
| Multiple mass-storage players | Config file (`[devices.<name>]` with `type` + `path`) + `PODKIT_MASS_STORAGE_PATHS` | Matched by path; each declared preset applies |

ENV declares at most one device and one default collection per type — anything
multiple or differentiated needs the config file. Mass-storage auto-sync always
requires a declared preset (via ENV or config); there is no on-device identity
to read, and podkit never guesses.

### Daemon-Specific Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PODKIT_POLL_INTERVAL` | `5` | How often to check for new iPod devices (seconds) |
| `PODKIT_APPRISE_URL` | (unset) | Apprise notification endpoint URL |
| `PODKIT_MASS_STORAGE_PATHS` | (unset) | Colon- or comma-separated mount paths of mass-storage players to auto-sync (see [Mass-Storage Devices](#mass-storage-devices)) |
| `PODKIT_DEVICE_PATH` | (unset) | Declare a single mass-storage device via ENV (with `PODKIT_DEVICE_TYPE`/`PODKIT_DEVICE_NAME`); its path is auto-polled (see [Mass-Storage Devices](#mass-storage-devices)) |

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

:::caution
If using a config file, it must include `version = 1` at the top. Configs without a version field will cause an error directing you to run `podkit migrate`. You can add the version manually or run migrate inside the container:

```bash
docker compose run --rm podkit migrate
```
:::

See [Environment Variables](/reference/environment-variables/) for the full list.

## Finding Your iPod's UUID

To configure named devices, you need each iPod's volume UUID. Run `device scan` to discover it:

```bash
docker run --rm --privileged ghcr.io/jvgomg/podkit device scan
```

This prints each connected iPod's volume name, UUID, size, and mount status. Copy the UUID into your config file (see below).

For JSON output (useful in scripts):

```bash
docker run --rm --privileged ghcr.io/jvgomg/podkit device scan --format json
```

## Multiple iPods

If you have multiple iPods, configure named devices in your config file with their volume UUIDs. When an iPod is plugged in, the daemon matches it by UUID against your configured devices and syncs it by name, so the correct per-device settings apply. An iPod that isn't in your config still syncs — by path, with your global/environment settings.

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

:::tip
You can plug in multiple iPods at the same time. The daemon syncs one iPod at a time — if a second iPod is plugged in while a sync is in progress, it is automatically queued and synced after the first completes. Each device gets its own mount point, so there are no conflicts.
:::

## Mass-Storage Devices

The daemon can also auto-sync mass-storage players (Echo Mini, Rockbox, and other folder-based devices). Mass-storage auto-sync requires a declared preset — unlike iPods, these devices carry no on-device identity podkit can read, so the preset (folder layout + capabilities) must come from a declaration.

**Single device, no config file** — declare it entirely via ENV:

```yaml
    environment:
      - PODKIT_DEVICE_PATH=/devices/echo
      - PODKIT_DEVICE_TYPE=echo-mini   # preset; defaults to "generic"
    volumes:
      - /mnt/echo-mini:/devices/echo
```

The declared path is polled automatically (no `PODKIT_MASS_STORAGE_PATHS` entry needed) and the device becomes the default, so one-shot `docker run … sync` works too.

**Multiple devices** — declare each in your config file and list the paths to poll:

```toml
[devices.echo]
type = "echo-mini"
path = "/devices/echo"

[devices.walkman]
type = "generic"
path = "/devices/walkman"
```

```yaml
    environment:
      - PODKIT_MASS_STORAGE_PATHS=/devices/echo,/devices/walkman
    volumes:
      - ./config:/config
      - /mnt/echo-mini:/devices/echo
      - /mnt/walkman:/devices/walkman
```

Each synced path is matched to its declared device by `path` — the entry must set an explicit `type` (path-matching is how mass-storage devices are identified; entries without a `type` are treated as iPods and matched by volume UUID instead). The right preset and per-device settings then apply. A mass-storage path with no matching declaration is never silently synced with guessed settings — the sync fails instead. See [Config File Reference](/reference/config-file/) for presets and device-level options, and [Environment Variables](/reference/environment-variables/) for the `PODKIT_DEVICE_*` reference.

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

The daemon needs access to USB block devices to detect and mount iPods. The container must be able to see block devices (like `/dev/sdb1`) when an iPod is plugged in, read USB vendor information from `/sys`, and mount FAT32 filesystems.

**Privileged mode (required):**

```yaml
    privileged: true
```

Privileged mode is required for the daemon to work. We tested several less-privileged configurations and none are sufficient:

| Configuration | Devices visible | Can mount | Result |
|---------------|----------------|-----------|--------|
| `--device /dev/bus/usb` + `CAP_SYS_ADMIN` | `lsblk` sees iPod, but no `/dev` nodes | No | Fails |
| `-v /dev:/dev` + `CAP_SYS_ADMIN` | `/dev/sdb*` visible | Permission denied | Fails |
| Above + `device_cgroup_rules: 'a *:* rwm'` | `/dev/sdb*` visible | Permission denied | Fails |
| `privileged: true` | Full access | Yes | **Works** |

The intermediate tiers fail because Docker's default security profile (AppArmor/seccomp) blocks the `mount` syscall even when `CAP_SYS_ADMIN` is granted. Privileged mode disables these restrictions entirely.

:::note
For **CLI mode** (not the daemon), you don't need privileged mode. Mount the iPod on the host and pass the mount point as a volume — see the [Docker guide](/getting-started/docker/).
:::

## Platform Notes

| Platform | Status | Notes |
|----------|--------|-------|
| Linux (bare metal / VM) | **Tested** | Full USB passthrough works with `privileged: true` |
| Synology NAS (DSM 7) | **Tested** | Works with `privileged: true` via SSH / Docker Compose. See [Synology setup](#synology-nas) below |
| Proxmox VM (QEMU) | **Tested** | Use USB passthrough to guest VM, then Docker `privileged: true`. Set CPU type to `host` |
| Proxmox LXC | **Not supported** | Docker-in-LXC cannot access USB block devices — use a VM instead |
| Unraid / TrueNAS | Untested | Community reports welcome |
| macOS / Windows | Not supported | Docker Desktop cannot pass USB devices |

### CPU Requirements

The podkit Docker image requires a CPU with **SSE4.2** support (Intel Nehalem / AMD Bulldozer or newer, circa 2008+). This is a requirement of the [Bun](https://bun.sh) JavaScript runtime used inside the container.

Most physical hardware from the last 15 years meets this requirement. Virtual machines may not — see [Troubleshooting](#troubleshooting) if you encounter issues.

### Synology NAS

Tested end-to-end on a Synology DS923+ running DSM 7.3.2, including daemon auto-detection, sync, and eject.

**Important:** Synology's Container Manager GUI may not support all the Docker options needed for daemon mode (specifically `privileged: true`). Use Docker Compose via SSH instead.

#### Setup

1. SSH into your Synology:
   ```bash
   ssh your-admin-user@your-nas
   ```

2. Docker is at `/usr/local/bin/docker` but may not be on your default SSH PATH:
   ```bash
   export PATH=/usr/local/bin:$PATH
   ```

3. Create a project directory:
   ```bash
   mkdir -p /volume1/docker/podkit/config
   cd /volume1/docker/podkit
   ```

4. Find your user's UID and GID (for `PUID`/`PGID`):
   ```bash
   id your-username
   # uid=1026(your-username) gid=100(users) ...
   ```

5. Create `docker-compose.yml`:
   ```yaml
   services:
     podkit:
       image: ghcr.io/jvgomg/podkit:latest
       command: daemon
       restart: unless-stopped
       environment:
         - PUID=1026
         - PGID=100
         - PODKIT_MUSIC_PATH=/music
         - PODKIT_POLL_INTERVAL=5
       volumes:
         - ./config:/config
         - /volume1/music:/music:ro
       privileged: true
       healthcheck:
         test: ["CMD-SHELL", "test $$(( $$(date +%s) - $$(stat -c %Y /tmp/podkit-daemon-health 2>/dev/null || echo 0) )) -lt 60 || exit 1"]
         interval: 30s
         timeout: 5s
         start_period: 10s
         retries: 3
   ```

6. Start and verify:
   ```bash
   docker compose up -d
   docker compose logs -f    # Watch for iPod detection
   docker compose ps          # Check health status
   ```

#### Synology-specific notes

- Synology uses non-standard block device names (`/dev/usb1p2` instead of `/dev/sdb2`). podkit handles this automatically.
- Privileged mode is required — Synology's Docker has additional restrictions that prevent mounting even with `CAP_SYS_ADMIN`.
- Music on a Synology shared folder should be mounted read-only: `-v /volume1/music:/music:ro`. Adjust the volume number to match your storage pool.

### Proxmox

For Proxmox users who want to run the daemon:

- **Use a VM, not an LXC container.** Docker containers inside LXC cannot access USB block devices — the iPod won't appear in `lsblk` inside Docker regardless of privilege settings.
- Pass the iPod through to the VM using QEMU USB passthrough (in the Proxmox GUI: VM → Hardware → Add → USB Device).
- Set the VM's CPU type to **`host`** (not the default `kvm64`). The default virtual CPU lacks instruction set extensions required by the podkit runtime. See [Troubleshooting](#troubleshooting) if you see "Illegal instruction" errors.

## Troubleshooting

**Check the startup device-access report first.** Every container start prints a `Device access:` report showing whether an iPod volume is mounted at `/ipod`, whether USB passthrough (`/dev/bus/usb`) is available for the one-time `device add` setup, and whether generic-SCSI nodes are present — each line with guidance for fixing what's missing. `docker compose logs podkit | head` shows it.

**iPod not detected:**
- Ensure the container is running with `privileged: true` — this is required, not optional
- Check that block devices are visible: `docker compose exec podkit lsblk`
- Check daemon logs: `docker compose logs podkit`
- If `lsblk` shows nothing, the container can't see USB block devices — verify privileged mode is enabled
- On Proxmox LXC: Docker-in-LXC cannot see USB block devices. Use a VM instead

**Notifications not arriving:**
- Verify the Apprise URL is correct (`http://apprise:8000/notify` if using the sidecar)
- Check Apprise container logs: `docker compose logs apprise`
- Test Apprise directly: `curl -X POST -d '{"title":"test","body":"hello"}' http://localhost:8000/notify`
- Ensure `APPRISE_STATELESS_URLS` is set on the Apprise container with a valid notification URL

**Config version error:**

If you see `Your config file is at version 0, but podkit requires version 1`, add `version = 1` as the first line of your `config.toml`, or run:

```bash
docker compose run --rm podkit migrate
```

**Sync fails:**
- Verify your music path is mounted correctly
- Check collection configuration (env vars or config file)
- Run a one-off CLI sync to isolate the issue: `docker compose run --rm podkit sync --dry-run`


**Illegal instruction crash:**

If the container crashes immediately with `Illegal instruction (core dumped)`, your CPU lacks the SSE4.2 instruction set required by the Bun runtime. This typically happens in virtual machines with a minimal virtual CPU:

- **Proxmox:** Change the VM's CPU type from `kvm64`/`qemu64` to `host` (VM → Hardware → Processor → Type)
- **Other hypervisors:** Ensure the guest CPU exposes SSE4.2. Passing through the host CPU features is the simplest fix
- **Physical hardware:** Any Intel/AMD processor from 2008 or later should work. If you're on very old hardware, this cannot be worked around

## See Also

- [Docker](/getting-started/docker/) — CLI mode with Docker
- [Environment Variables](/reference/environment-variables/) — All configuration variables
- [Config File Reference](/reference/config-file/) — Device-specific settings
- [Devices](/user-guide/devices/) — Device configuration and management
