---
title: Artist Transforms
description: Clean up messy artist lists on your device by moving featured artist credits into the track title.
sidebar:
  order: 3
---

Many portable players browse by the track-level Artist field rather than Album Artist. If your music tags tracks as "Daft Punk feat. Pharrell Williams", you end up with dozens of one-off artist entries cluttering your artist list. This is especially common on classic iPods and mass-storage DAPs that don't support Album Artist navigation.

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

## Reversibility

Transforms are reversible. If you disable a transform and re-sync, podkit updates the device tracks back to their original metadata — without re-copying or re-transcoding the audio files.

## More Options

For the full list of configuration options, recognized patterns, bracket positioning rules, and edge cases, see the [Clean Artists Transform Reference](/reference/clean-artists).

## See Also

- [Clean Artists Transform Reference](/reference/clean-artists) — Full configuration reference
- [Managing Devices](/user-guide/devices) — Device configuration overview
