---
"@podkit/daemon": patch
---

Daemon sends "Device Needs Init" guidance for a blank iPod

With `podkit sync` now emitting the distinct `IPOD_NEEDS_INIT` code, the daemon's dormant needs-init path is active: a freshly-wiped iPod gets a clear "run `podkit device init`" notification and a clean skip instead of a generic sync failure. The notification copy also now names the real command (`podkit device init`, not `podkit init`). The daemon never initialises a device automatically.
