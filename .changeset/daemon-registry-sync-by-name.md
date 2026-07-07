---
"@podkit/daemon": minor
---

Daemon applies per-device config settings by matching detected iPods against the device registry

When an iPod appears, the daemon now consults the config device registry (via `podkit --json device list`) and matches the detected volume UUID against your configured devices. A registered iPod is synced by its device name, so its per-device settings (quality, collections, artwork, transforms) apply exactly as they do on the CLI. An unregistered iPod — including the ENV-only single-device lane — keeps the existing path-based sync with global/ENV settings, and any registry-lookup failure degrades to path-based sync rather than failing the cycle.
