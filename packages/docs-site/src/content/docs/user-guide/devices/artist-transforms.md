---
title: Artist Transforms
description: Clean up messy artist lists on your device by moving featured artist credits into the track title.
sidebar:
  order: 3
---

Many portable players browse by the track-level Artist field rather than Album Artist. If your music tags tracks as "Daft Punk feat. Pharrell Williams", you end up with dozens of one-off artist entries cluttering your artist list. This is especially common on classic iPods whose stock firmware doesn't support Album Artist navigation.

For the full configuration reference including all recognized patterns, bracket positioning, and edge cases, see the [Clean Artists Transform Reference](/reference/clean-artists).

## The Clean Artists Feature

The `cleanArtists` feature moves featured artist credits from the Artist field into the Title field during sync. Your source files are never modified. This works on all device types — iPods, mass-storage DAPs, and Rockbox devices.

| | Artist | Title |
|---|--------|-------|
| **Before** | Daft Punk feat. Pharrell Williams | Get Lucky |
| **After** | Daft Punk | Get Lucky (feat. Pharrell Williams) |

Your device's artist list goes from a mess of one-off entries to a clean, browsable list — and you still see who's featured in the track title.

## Quick Setup

Enable it globally in your [config file](/user-guide/configuration):

```toml
cleanArtists = true
```

That's all you need. podkit recognizes common featuring patterns (`feat.`, `ft.`, `featuring`, `with`, `vs`, `&`) and handles them automatically.

## Protecting Artist Names

Some artist names naturally contain words like "&" or "with" that the transform would incorrectly split on. Add these to the `ignore` list:

```toml
[cleanArtists]
ignore = ["Simon & Garfunkel", "Earth, Wind & Fire", "Hall & Oates"]
```

## Per-Device Override

You can enable the transform for some devices and not others. Devices can be referenced by their config name or mount path with `--device`:

```toml
# Global: clean artists enabled
cleanArtists = true

# This device uses the global setting
[devices.classic]
volumeUuid = "ABCD-1234"
volumeName = "CLASSIC"

# This device uses original metadata
[devices.nano]
volumeUuid = "EFGH-5678"
volumeName = "NANO"
cleanArtists = false
```

## Automatic Device Gating

When you enable `cleanArtists` globally, podkit automatically decides whether to apply it based on each device's capabilities. Devices that support Album Artist browsing (like Rockbox and the Echo Mini) don't need the transform — their firmware already groups tracks by Album Artist, keeping the artist list clean.

**How it works:**

- **iPod** (stock firmware): transform applies — iPod doesn't use Album Artist for browsing
- **Rockbox, Echo Mini, generic**: transform is auto-suppressed — these devices support Album Artist browsing

During `sync --dry-run`, podkit shows when the transform is skipped:

```
Clean artists: skipped (device supports Album Artist browsing)
```

### Force-enabling on a capable device

If you want the transform on a device that supports Album Artist browsing, set it explicitly per-device:

```toml
cleanArtists = true

[devices.my-rockbox.cleanArtists]
enabled = true
```

podkit will warn you that the transform may not be necessary, but it will respect your choice.

### Overriding device classification

If you have a `generic` device that doesn't actually support Album Artist browsing, override the capability:

```toml
[devices.mydap]
type = "generic"
supportsAlbumArtistBrowsing = false
```

The global `cleanArtists` setting will then auto-apply to this device.

## Reversibility

Transforms are reversible. If you disable a transform and re-sync, podkit updates the device tracks back to their original metadata — without re-copying or re-transcoding the audio files.

## More Options

For the full list of configuration options, recognized patterns, bracket positioning rules, and edge cases, see the [Clean Artists Transform Reference](/reference/clean-artists).

## See Also

- [Clean Artists Transform Reference](/reference/clean-artists) — Full configuration reference
- [Managing Devices](/user-guide/devices) — Device configuration overview
