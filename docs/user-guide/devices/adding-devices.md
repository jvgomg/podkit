---
title: Adding a Device
description: Register iPod devices with podkit using auto-detection or manual configuration.
sidebar:
  order: 4
---

Before you can sync music to an iPod, you need to register it with podkit. This page covers automatic and manual device registration.

## Auto-Detection with `podkit device add`

The easiest way to register a device is to plug it in and let podkit detect it:

```bash
# With the iPod mounted, auto-detect and register
podkit device add classic

# Specify mount point explicitly
podkit device add classic /Volumes/IPOD

# Add with quality settings
podkit device add nano --quality medium --no-artwork

# Add with separate audio/video quality
podkit device add classic --audio-quality lossless --video-quality high
```

podkit reads the volume UUID and name from the mounted filesystem and adds the device to your config file. The first device added is automatically set as the default.

## Changing Device Settings

After adding a device, you can update its settings with `podkit device set`:

```bash
# Set quality on an existing device
podkit device set classic --quality lossless

# Set audio and video quality separately
podkit device set nano --audio-quality medium --video-quality low

# Disable artwork
podkit device set nano --no-artwork

# Reset a setting to use the global default
podkit device set classic --clear-quality
```

## Manual Configuration

You can also add a device by editing `~/.config/podkit/config.toml` directly:

```toml
[devices.classic]
volumeUuid = "ABCD-1234"
volumeName = "CLASSIC"
```

### Finding the Volume UUID

On macOS, use `diskutil` to find the UUID of your mounted iPod:

```bash
diskutil info /Volumes/IPOD | grep "Volume UUID"
```

On Linux, use `blkid`:

```bash
sudo blkid /dev/sdX1
```

### Configuration Options

| Option | Description | Required |
|--------|-------------|----------|
| `volumeUuid` | Filesystem UUID used to identify the device | Yes |
| `volumeName` | Volume label shown in Finder/file manager | Yes |
| `quality` | Transcoding quality preset for this device | No |
| `artwork` | Whether to sync album artwork | No |

The `volumeUuid` uniquely identifies the device regardless of which port or mount point it uses. The `volumeName` is the label shown when the iPod mounts (e.g., "IPOD", "CLASSIC").

## Removing a Device

To unregister a device:

```bash
podkit device remove classic
```

This removes the device entry from your config file. It does not modify anything on the iPod itself.

## See Also

- [Supported Devices](/devices/supported-devices/) for iPod model compatibility
- [Managing Devices](./) for working with multiple devices
- [Mounting and Ejecting](./mounting-ejecting/) for connecting devices
