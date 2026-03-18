---
title: Tips & Next Steps
description: Common tasks and use cases to explore after your first sync with podkit.
sidebar:
  order: 4
---

Now that you've completed your [first sync](/getting-started/quick-start), here are some common things you'll want to do.

## Setting Quality

podkit transcodes lossless files (FLAC, WAV, ALAC) to AAC. The default is `high` (~256 kbps VBR), but you can change it:

```bash
# Override quality for a single sync
podkit sync --quality medium

# Set quality when adding a device
podkit device add -d nano --quality medium --no-artwork

# Change quality on an existing device
podkit device set -d classic --audio-quality max --video-quality high

# Clear device quality (use global default instead)
podkit device set -d classic --clear-quality
```

| Preset | Bitrate | Best for |
|--------|---------|----------|
| `max` | Lossless or ~256 kbps | ALAC on supported devices, otherwise same as `high` |
| `high` | ~256 kbps VBR | Good quality, reasonable size (**default**) |
| `medium` | ~192 kbps VBR | Saving space |
| `low` | ~128 kbps VBR | Maximum compression |

Set it permanently in your config or per device — see [Audio Transcoding](/user-guide/transcoding/audio) for full details.

## Listing Media

See what's on your iPod or in your collections:

```bash
# Music on your iPod
podkit device music

# Video on your iPod
podkit device video

# Music in a collection
podkit collection music

# Output as JSON
podkit device music --format json
```

## Removing Content

By default, `podkit sync` only adds tracks. To remove tracks from your iPod that are no longer in your collection:

```bash
podkit sync --delete --dry-run   # Preview first
podkit sync --delete             # Then do it
```

To clear everything from a device:

```bash
podkit device clear              # Remove all content
podkit device clear --type music  # Remove only music
podkit device clear --type video # Remove only video
```

## Syncing Specific Collections

If you have multiple collections, you can sync them selectively:

```bash
podkit sync -t music             # Sync only music (skip video)
podkit sync -t video             # Sync only video (skip music)
podkit sync -t music -c main     # Sync a specific collection
```

## Setting Defaults

Set the default device and collections so you don't need to specify them every time:

```bash
# Set default device
podkit device default -d classic

# Set default music collection
podkit collection default -t music -c main

# Set default video collection
podkit collection default -t video -c movies
```

## Syncing to Different Devices

If you have multiple iPods registered:

```bash
podkit sync -d nano              # Sync to a specific device
podkit device info -d classic     # Check status of a specific device
```

See [Managing Devices](/user-guide/devices) for setting up per-device quality and defaults.

## Verbose Output

For debugging or just to see what's happening:

```bash
podkit sync -v      # Verbose
podkit sync -vv     # More verbose
podkit sync -vvv    # Debug level
```

## Troubleshooting

### "iPod not found"

1. Make sure the iPod is mounted (visible in Finder on macOS)
2. Check the mount point: `ls /Volumes/` (macOS) or `lsblk` (Linux)
3. Try specifying the path directly: `podkit sync --device /Volumes/IPOD`
4. On macOS with large iFlash cards, see [macOS Mounting Issues](/troubleshooting/macos-mounting)

### "Cannot read iPod database"

1. The iPod may need initialization:
   ```bash
   podkit device init --device /Volumes/IPOD
   ```
2. Check if the iPod_Control folder exists: `ls /Volumes/IPOD/iPod_Control/`
3. Try restoring the iPod with iTunes/Finder first

### "FFmpeg not found"

1. Install FFmpeg (see [Installation](/getting-started/installation))
2. Verify it's in your PATH: `which ffmpeg`
3. Check it has AAC support: `ffmpeg -encoders 2>/dev/null | grep aac`

For more issues, see [Common Issues](/troubleshooting/common-issues).

## Further Reading

- **[Configuration](/user-guide/configuration)** — Full config file reference
- **[Media Sources](/user-guide/collections)** — Directory, Subsonic, and more
- **[Audio Transcoding](/user-guide/transcoding/audio)** — Encoder selection, VBR vs CBR
- **[Video Transcoding](/user-guide/transcoding/video)** — Sync movies and TV shows
- **[CLI Reference](/reference/cli-commands)** — All available commands
