---
"podkit": minor
---

Add user-defined mass-storage device presets via the new `[presets.<id>]` config section.

Declare a custom DAP in `~/.config/podkit/config.toml`:

```toml
[presets.my-walkman]
extends = "generic"
manufacturer = "Sony"
productName = "NW-A105"
supportedAudioCodecs = ["aac", "flac", "mp3"]
artworkMaxResolution = 240
musicDir = "MUSIC"
```

Then add a device that uses it:

```sh
podkit device add -d walkman --type my-walkman --path /Volumes/MyWalkman
```

`--type` previously rejected any value that wasn't `ipod`, `echo-mini`, `rockbox`, or `generic`. It now also accepts any preset id declared in the config. Built-in ids remain authoritative; `[presets.echo-mini]` collisions are refused at load time.

`device list`, `device info`, sync, and doctor mass-storage paths consult the merged registry so user-preset content-path and capability defaults flow through correctly. Two devices typed to the same user preset id resolve independently — they share the preset baseline but per-device overrides apply on top.

When a user preset declares `wav` or `aiff` in `supportedAudioCodecs`, the loader emits the same warning that `[devices.X]` overrides already produce: podkit transcodes sources in those formats rather than direct-copying.
