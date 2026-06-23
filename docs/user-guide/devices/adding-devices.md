---
title: Adding a Device
description: Register devices with podkit using auto-detection or manual configuration.
sidebar:
  order: 4
---

Before you can sync music, you need to register your device with podkit. This page covers automatic and manual device registration for both iPods and mass-storage DAPs.

## Auto-Detection with `podkit device add`

The easiest way to register a device is to plug it in and let podkit detect it:

```bash
# Auto-detect and register a connected device
podkit device add -d mydevice

# Specify mount point explicitly
podkit device add -d mydevice --path /Volumes/DEVICE

# Add with quality settings
podkit device add -d nano --quality medium --no-artwork

# Add with separate audio/video quality
podkit device add -d classic --audio-quality max --video-quality high
```

podkit reads the volume UUID and name from the mounted filesystem and adds the device to your config file. The first device added is automatically set as the default.

### Mass-storage DAPs

For non-iPod devices, specify the device type so podkit knows its capabilities:

```bash
# Register with a predefined device profile
podkit device add -d echomini --type echo-mini

# Register any mass-storage DAP with the generic profile
podkit device add -d mydap --type generic

# Register with custom content directory paths
podkit device add -d mydap --type generic --music-dir Music --movies-dir Videos/Movies --tv-shows-dir Videos/Shows
```

See [Supported Devices](/devices/supported-devices) for predefined profiles and their capabilities. If your device isn't listed, `generic` works with any mass-storage player — you can [override capabilities](/devices/supported-devices#custom-device-configuration) in your config file for more precise codec and artwork handling.

## Changing Device Settings

After adding a device, you can update its settings with `podkit device set`:

```bash
# Set quality on an existing device
podkit device set -d classic --quality max

# Set audio and video quality separately
podkit device set -d nano --audio-quality medium --video-quality low

# Disable artwork
podkit device set -d nano --no-artwork

# Reset a setting to use the global default
podkit device set -d classic --clear-quality
```

## Manual Configuration

You can also add a device by editing `~/.config/podkit/config.toml` directly.

### iPod

```toml
[devices.classic]
volumeUuid = "ABCD-1234"
volumeName = "CLASSIC"
```

### Mass-storage DAP

```toml
[devices.echomini]
type = "echo-mini"
volumeUuid = "WXYZ-9012"
```

For a device without a predefined profile, use `generic` and specify its capabilities:

```toml
[devices.mydap]
type = "generic"
volumeUuid = "HIJK-3456"
supportedAudioCodecs = ["aac", "alac", "mp3", "flac", "ogg"]
artworkMaxResolution = 320
musicDir = "Music"          # Content paths (use "/" or "" for device root)
moviesDir = "Video/Movies"
tvShowsDir = "Video/Shows"
```

#### Giving your device a nicer name

The built-in `generic` and `rockbox` profiles use placeholder display labels (`Mass-storage device`, `Rockbox device`). You can override them per-device with `manufacturer` and `productName` — useful when you have a no-name DAP and want `podkit device info` / `podkit device list` to show something more specific than "Mass-storage device":

```toml
[devices.mp3player]
type         = "generic"
volumeUuid   = "USB1-2345"
manufacturer = "AliExpress"
productName  = "USB MP3 player"
```

After this, `podkit device info -d mp3player` reads:

```
Device: mp3player
  Type:          USB MP3 player
  ...
```

and `podkit device add` (when run against the same device) shows the rich label:

```
Adding Mass-storage device device:
  Name:   mp3player
  Type:   AliExpress USB MP3 player (generic)
  ...
```

The preset id (`generic` here) stays in parentheses so you can still tell which `--type` token was used. Both fields are optional and independently inherited from the preset — set only `productName` to keep the preset's manufacturer, or only `manufacturer` to keep the preset's product name.

This is display-only: capability resolution (supported codecs, artwork resolution, etc.) still comes from the preset.

### Finding the Volume UUID

The easiest way to find your device's volume UUID is with the `scan` command:

```bash
podkit device scan
```

This shows the volume name, UUID, size, and mount point for each connected device.

Alternatively, you can use platform tools directly. On macOS:

```bash
diskutil info /Volumes/DEVICE | grep "Volume UUID"
```

On Linux:

```bash
sudo blkid /dev/sdX1
```

### Configuration Options

| Option | Description | Required |
|--------|-------------|----------|
| `type` | Device type: `ipod`, `echo-mini`, `rockbox`, `generic` | No (auto-detected for iPods) |
| `volumeUuid` | Filesystem UUID used to identify the device | Yes |
| `volumeName` | Volume label shown in Finder/file manager | No |
| `quality` | Transcoding quality preset for this device | No |
| `artwork` | Whether to sync album artwork | No |
| `manufacturer` | Vendor label shown by `device info` / `device add` (mass-storage only) | No |
| `productName` | Product label shown by `device info` / `device list` / `device add` (mass-storage only) | No |

The `volumeUuid` uniquely identifies the device regardless of which port or mount point it uses.

## Headless / Automation

`podkit device add` has three verification tiers. Choose the right one for your environment:

| Situation | Flag | What podkit does |
|-----------|------|-----------------|
| Device connected, SCSI/USB works (normal desktop) | _(default)_ | Reads device, requires on-disk SysInfo (offers to write SysInfoExtended if absent), runs live cross-check; refuses on identity mismatch |
| Device mounted in-container or on headless server — SCSI unavailable but on-disk SysInfo is present | `--no-verify` | Trusts on-disk SysInfo; skips live cross-check; errors with a "`run podkit doctor`" hint if SysInfo is absent |
| Device absent, CI, or scripted provisioning | `--no-validate` | Pure config write from your arguments — zero device I/O; on-disk SysInfo not required |

### Replug behaviour: volume UUID vs path-only

By default, podkit stores the volume UUID so it can find the device again after a replug (even if the mount path changes). When you pass only `--path` and no `--volume-uuid`, podkit stores just the mount path — the device will not be re-found if it remounts at a different path. The CLI warns you when this happens. Prefer `--volume-uuid` for any device that could change mount points.

### Docker / headless-server examples

**Mounting an iPod in a Docker container (on-disk SysInfo present):**

If the iPod is bind-mounted into the container at `/mnt/ipod` and `SysInfoExtended` was already written on an SCSI-capable host, use `--no-verify` to skip the unavailable SCSI cross-check while still validating the on-disk identity:

```bash
podkit device add -d ipod --no-verify --path /mnt/ipod
```

podkit reads the on-disk `SysInfo` / `SysInfoExtended` to identify the device and adds it to config. If SysInfo is absent, it refuses with a hint to run `podkit doctor` on a host with SCSI access first (see [Known Limitation](#docker-scsi-gap) below).

**Provisioning config offline (device not present):**

```bash
# By volume UUID — survives replug, preferred
podkit device add -d ipod --no-validate --type ipod --volume-uuid ABCD-1234

# By path — pinned to the mount path; warns that replug will break re-discovery
podkit device add -d ipod --no-validate --type ipod --path /mnt/ipod

# Mass-storage device
podkit device add -d echo --no-validate --type echo-mini --volume-uuid WXYZ-9012
```

`--no-validate` requires a complete identity: `--volume-uuid` or `--path`, plus `--type` for mass-storage devices. It writes the config row and exits without touching any device. This is also how e2e tests add devices without hardware attached.

JSON output from `device add --format json` includes a `verification` field reporting which tier ran: `"verified"`, `"trusted-disk"`, or `"config-only"`.

### Docker SCSI gap

:::caution[Known limitation]
A Docker user whose mounted iPod has **no on-disk SysInfo** is told to run `podkit doctor` — but `podkit doctor` writes `SysInfoExtended` via SCSI/USB inquiry, which may not be available inside the container. Checksum-based iPod generations (those identified by hash58/72/AB model numbers) **require** `SysInfoExtended` on disk for sync to produce a valid database checksum; without SCSI access somewhere, those devices cannot sync regardless of which `device add` tier you use.

**Current recommended workflow:** run `podkit doctor --repair sysinfo-extended` once on a host with SCSI access (macOS with iPodDriver.kext, or a Linux host with the `sg` module and the podkit udev rule), then use the iPod from Docker. The `SysInfoExtended` file persists on the device across remounts.

A future direction being considered (not yet implemented): synthesize `SysInfoExtended` from the declared `--type` / generation using the `@podkit/devices-ipod` tables, with no SCSI required. This would close the gap for offline provisioning. Whether `SG_IO` works inside Docker under `--privileged` (which would limit the gap to rootless containers only) is also unconfirmed.
:::

See [Device Health Checks](/user-guide/devices/doctor) for full `podkit doctor` documentation.

## Removing a Device

To unregister a device:

```bash
podkit device remove -d classic
```

This removes the device entry from your config file. It does not modify anything on the device itself.

## See Also

- [Supported Devices](/devices/supported-devices) for device profiles and custom configuration
- [Managing Devices](/user-guide/devices) for working with multiple devices
- [Mounting and Ejecting](/user-guide/devices/mounting-ejecting) for connecting devices
