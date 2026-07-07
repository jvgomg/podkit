---
"podkit": minor
"@podkit/daemon": minor
---

Declare a single mass-storage device entirely via environment variables

`PODKIT_DEVICE_PATH` (+ optional `PODKIT_DEVICE_TYPE`, default `generic`, and `PODKIT_DEVICE_NAME`, default `default`) declares a mass-storage device with no config file, exactly as a `[devices.<name>]` entry would — and makes it the default device. `PODKIT_DEVICE_TYPE=ipod` is rejected: iPods are auto-detected and need no declaration. In daemon mode the declared path is polled automatically, giving iPod and mass-storage users symmetric ENV-only single-device lanes.

Path-based syncs (`-d /path`) now also match mass-storage devices declared in config by their `path` — previously matching was volume-UUID-only, which folder-based players without a filesystem UUID could never satisfy — so the declared preset and per-device settings apply.
