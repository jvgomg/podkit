---
"podkit": minor
"@podkit/core": minor
---

Sync now refuses an unidentified iPod instead of silently degrading to a "generic iPod"

When an iPod's model cannot be resolved from its on-disk identity, sync previously warned and continued, treating the device as a generic iPod — risking the wrong artwork format or an incompatible database without the user knowing. Sync now stops with a typed `UNKNOWN_IPOD_MODEL` error before any database open or transcoding, and tells the user how to fix it: set the iPod up once over USB (`podkit device add` with the device connected — in Docker, pass the USB device through once), or run `podkit doctor --repair sysinfo-extended` to write the identity from firmware. After setup, later syncs need only the mounted volume.

This is a deliberate behavior change on host and Docker alike, and it makes the background daemon correct for free: because the daemon shells out to `sync`, it now refuses unsetup devices rather than mangling them. The decision lives in a pure, table-tested guard (`assertKnownIpodModel`) so the failure is deterministic and easy to reason about.
